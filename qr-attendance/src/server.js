/**
 * Standalone HTTP Server for QR Attendance Module
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, getSafeConfigStatus } from './config.js';
import { handleCheckInRequest, handleGenerateQRRequest, handleHealthRequest, handleScannerConfigRequest } from './api/routes.js';
import { getRepository } from './db/index.js';
import { startRealtimeConnection, stopRealtimeConnection } from './db/realtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scannerHtmlPath = path.resolve(__dirname, '../scanner/index.html');
const scannerJsPath = path.resolve(__dirname, '../scanner/scanner.js');
const jsqrPath = path.resolve(__dirname, '../../node_modules/jsqr/dist/jsQR.js');

const RATE_LIMITS = {
  '/api/checkin': { max: 180, windowMs: 60_000 },
  '/api/qr/generate': { max: 10, windowMs: 60_000 }
};

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');

  let supabaseOrigin = '';
  try {
    if (config.supabaseUrl) {
      const parsedSupabaseUrl = new URL(config.supabaseUrl);
      if (['http:', 'https:'].includes(parsedSupabaseUrl.protocol) && !parsedSupabaseUrl.username && !parsedSupabaseUrl.password) {
        supabaseOrigin = parsedSupabaseUrl.origin;
      }
    }
  } catch {
    // Invalid URLs are surfaced by the Supabase client; keep CSP restrictive meanwhile.
  }
  const connectSources = ["'self'", ...(supabaseOrigin ? [supabaseOrigin] : [])].join(' ');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src ${connectSources}; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
  );
}

function corsOriginAllowed(origin) {
  if (typeof origin !== 'string') return false;
  return config.corsAllowedOrigins.includes(origin);
}

function checkRateLimit(req, pathname, buckets, now = Date.now()) {
  const rule = RATE_LIMITS[pathname];
  if (!rule) return 0;

  const address = req.socket?.remoteAddress || 'unknown';
  const key = `${pathname}:${address}`;
  let bucket = buckets.get(key);
  if (!bucket && buckets.size >= 10_000) {
    for (const [bucketKey, value] of buckets) {
      if (now - value.startedAt >= 60_000) buckets.delete(bucketKey);
    }
    if (buckets.size >= 10_000) return 60;
  }
  if (!bucket || now - bucket.startedAt >= rule.windowMs) {
    bucket = { startedAt: now, count: 0 };
    buckets.set(key, bucket);
  }

  if (bucket.count >= rule.max) {
    return Math.max(1, Math.ceil((rule.windowMs - (now - bucket.startedAt)) / 1000));
  }
  bucket.count += 1;

  if (buckets.size > 10_000) {
    for (const [bucketKey, value] of buckets) {
      if (now - value.startedAt >= rule.windowMs) buckets.delete(bucketKey);
    }
  }
  return 0;
}

/**
 * Creates and configures the HTTP server
 * @param {object} [options]
 * @returns {http.Server}
 */
export function createServer(options = {}) {
  const rateLimitBuckets = new Map();
  const server = http.createServer(async (req, res) => {
    applySecurityHeaders(res);

    const origin = req.headers.origin;
    if (corsOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || '/', 'http://localhost');
    } catch {
      req.resume();
      return sendJson(res, 400, { status: 'invalid_request', message: 'Invalid request URL.' });
    }
    const pathname = parsedUrl.pathname;

    if (req.method === 'OPTIONS') {
      if (!corsOriginAllowed(origin)) {
        req.resume();
        return sendJson(res, 403, { status: 'forbidden', message: 'Cross-origin access is not allowed.' });
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '600');
      res.writeHead(204);
      return res.end();
    }

    const retryAfter = checkRateLimit(req, pathname, rateLimitBuckets);
    if (retryAfter > 0) {
      req.resume();
      return sendJson(res, 429, { status: 'rate_limited', message: 'Too many requests. Try again shortly.' }, { 'Retry-After': String(retryAfter) });
    }

    try {
      if (req.method === 'POST' && pathname === '/api/checkin') {
        return await handleCheckInRequest(req, res, options);
      }

      if (req.method === 'POST' && pathname === '/api/qr/generate') {
        return await handleGenerateQRRequest(req, res, options);
      }

      if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
        return handleHealthRequest(req, res);
      }

      if (req.method === 'GET' && pathname === '/api/scanner-config') {
        return handleScannerConfigRequest(req, res);
      }

      if (req.method === 'GET' && pathname === '/scanner.js') {
        if (fs.existsSync(scannerJsPath)) {
          const content = fs.readFileSync(scannerJsPath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Cache-Control': 'no-store'
          });
          return res.end(content);
        }
      }

      if (req.method === 'GET' && pathname === '/jsqr.js') {
        if (fs.existsSync(jsqrPath)) {
          const content = fs.readFileSync(jsqrPath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=86400'
          });
          return res.end(content);
        }
      }

      // Serve mobile scanner demo page
      if (req.method === 'GET' && (pathname === '/' || pathname === '/scanner' || pathname === '/scan')) {
        if (fs.existsSync(scannerHtmlPath)) {
          const content = fs.readFileSync(scannerHtmlPath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
          });
          return res.end(content);
        }
      }

      // 404 Fallback
      req.resume();
      return sendJson(res, 404, { status: 'not_found', message: 'Endpoint not found' });
    } catch {
      if (res.headersSent) return res.destroy();
      return sendJson(res, 500, { status: 'error', message: 'Internal server error' });
    }
  });

  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.timeout = 30_000;

  return server;
}

// Start standalone server if invoked directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repository = getRepository();
  startRealtimeConnection(repository.client);

  const server = createServer();
  server.once('close', () => {
    void stopRealtimeConnection();
  });

  server.listen(config.port, () => {
    console.log(`[QR Attendance] Server listening on port ${config.port}`);
    console.log(`[QR Attendance] Safe status:`, JSON.stringify(getSafeConfigStatus()));
  });
}
