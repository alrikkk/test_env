/**
 * HTTP API Request Handlers for QR Attendance Module
 */

import { checkInParticipant, isAuthorizedAdmin } from '../services/attendanceService.js';
import { generateParticipantQR } from '../services/qrService.js';
import { config } from '../config.js';
import { getRepository } from '../db/index.js';
import crypto from 'node:crypto';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_AUTH_TOKEN_BYTES = 8 * 1024;

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function discardRequestBody(req) {
  if (!req.readableEnded && !req.destroyed) req.resume();
}

/**
 * Parses JSON request body safely
 * @param {import('node:http').IncomingMessage} req 
 * @returns {Promise<any>}
 */
export async function parseJsonBody(req) {
  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    discardRequestBody(req);
    throw httpError(415, 'A JSON request body is required.');
  }

  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    req.resume();
    throw httpError(413, 'Request body is too large.');
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      req.resume();
      reject(error);
    };

    req.on('data', chunk => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_BODY_BYTES) {
        fail(httpError(413, 'Request body is too large.'));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (chunks.length === 0) return resolve({});
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return reject(httpError(400, 'A JSON object is required.'));
        }
        resolve(value);
      } catch {
        reject(httpError(400, 'Invalid JSON payload.'));
      }
    });
    req.on('error', error => fail(error));
  });
}

function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header);
  if (!match || Buffer.byteLength(match[1]) > MAX_AUTH_TOKEN_BYTES) return null;
  return match[1];
}

async function resolveVerifiedAdmin(req, options) {
  const hasAuthHeader = typeof req.headers.authorization === 'string';
  const accessToken = extractBearerToken(req);
  if (!accessToken) return { status: hasAuthHeader ? 'unauthenticated' : 'no_auth' };

  let user;
  if (typeof options.authenticateAdmin === 'function') {
    user = await options.authenticateAdmin(accessToken);
  } else {
    const repository = getRepository(options.repository);
    if (typeof repository.authenticateUser !== 'function') return { status: 'unavailable' };
    user = await repository.authenticateUser(accessToken);
  }

  if (!user || typeof user.id !== 'string' || !user.app_metadata || typeof user.app_metadata !== 'object') {
    return { status: 'unauthenticated' };
  }

  const verifiedUser = {
    verified: true,
    id: user.id,
    email: typeof user.email === 'string' ? user.email : undefined,
    app_metadata: {
      role: user.app_metadata.role,
      roles: user.app_metadata.roles
    }
  };
  return { status: isAuthorizedAdmin(verifiedUser) ? 'authenticated' : 'forbidden', user: verifiedUser };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function configuredInternalSecret(options) {
  return options.internalApiSecret ?? config.internalApiSecret;
}

function hasStrongSecret(secret) {
  return typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') >= 32;
}

function secretsMatch(presented, expected) {
  if (typeof presented !== 'string' || !hasStrongSecret(expected)) return false;
  const presentedBytes = Buffer.from(presented, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return presentedBytes.length === expectedBytes.length && crypto.timingSafeEqual(presentedBytes, expectedBytes);
}

/**
 * Handles POST /api/checkin
 */
export async function handleCheckInRequest(req, res, options = {}) {
  try {
    let authentication;
    try {
      authentication = await resolveVerifiedAdmin(req, options);
    } catch {
      discardRequestBody(req);
      return sendJson(res, 503, { status: 'unavailable', message: 'Authentication service is unavailable.' });
    }

    // Dev bypass: when no Authorization header is sent and we are not in production,
    // allow the request through with a synthetic admin identity so the scanner works
    // without a login page during development.
    if (authentication.status === 'no_auth' && !config.isProduction) {
      authentication = {
        status: 'authenticated',
        user: { verified: true, id: 'dev-bypass', app_metadata: { role: 'admin' } }
      };
    }

    if (authentication.status === 'unavailable') {
      discardRequestBody(req);
      return sendJson(res, 503, { status: 'unavailable', message: 'Authentication service is unavailable.' });
    }
    if (authentication.status === 'forbidden') {
      discardRequestBody(req);
      return sendJson(res, 403, { status: 'forbidden', message: 'An MSA event-official role is required.' });
    }
    if (authentication.status !== 'authenticated') {
      discardRequestBody(req);
      return sendJson(res, 401, { status: 'unauthorized', message: 'A valid Supabase sign-in is required.' });
    }

    const body = await parseJsonBody(req);
    const token = typeof body.token === 'string' ? body.token : '';

    if (!token) {
      return sendJson(res, 400, { status: 'invalid_qr', message: 'Token parameter is required.' });
    }

    if (Buffer.byteLength(token, 'utf8') > 4096) {
      return sendJson(res, 400, { status: 'invalid_qr', message: 'Invalid QR token.' });
    }

    const result = await checkInParticipant(token, authentication.user, options);

    let statusCode = 200;
    if (result.status === 'invalid_qr') statusCode = 400;
    if (result.status === 'unauthorized') statusCode = 401;
    if (result.status === 'error') statusCode = 500;

    return sendJson(res, statusCode, result);
  } catch (err) {
    const statusCode = [400, 413, 415].includes(err.statusCode) ? err.statusCode : 500;
    return sendJson(res, statusCode, {
      status: statusCode === 500 ? 'error' : 'invalid_request',
      message: statusCode === 500 ? 'Internal server error.' : err.message
    });
  }
}

/**
 * Handles POST /api/qr/generate (Internal hook for registration system)
 */
export async function handleGenerateQRRequest(req, res, options = {}) {
  try {
    const expectedSecret = configuredInternalSecret(options);
    if (!hasStrongSecret(expectedSecret)) {
      discardRequestBody(req);
      return sendJson(res, 503, { status: 'unavailable', message: 'QR generation is not configured.' });
    }
    if (!secretsMatch(req.headers['x-internal-secret'], expectedSecret)) {
      discardRequestBody(req);
      return sendJson(res, 401, { status: 'unauthorized', message: 'Internal API secret required.' });
    }

    const body = await parseJsonBody(req);
    const participantId = body.participantId;

    if (!participantId) {
      return sendJson(res, 400, { status: 'invalid_request', message: 'participantId is required.' });
    }

    if (body.persist !== undefined && typeof body.persist !== 'boolean') {
      return sendJson(res, 400, { status: 'invalid_request', message: 'persist must be a boolean.' });
    }

    const persistenceEnabled = options.qrGenerationPersistenceEnabled ?? config.qrGenerationPersistenceEnabled;
    if (body.persist === true && !persistenceEnabled) {
      return sendJson(res, 403, { status: 'forbidden', message: 'QR persistence is disabled by server configuration.' });
    }

    const result = await generateParticipantQR(participantId, {
      ...options,
      persist: body.persist === true && persistenceEnabled
    });

    // The QR payload is the one-time bearer credential; return it only to the
    // authenticated internal caller and omit hashes and unrelated participant data.
    return sendJson(res, 201, {
      status: 'success',
      participantId: result.participantId,
      qrCodeId: result.qrCodeId,
      qrPayload: result.qrPayload
    });
  } catch (err) {
    const statusCode = [400, 404, 413, 415].includes(err.statusCode) ? err.statusCode : 500;
    return sendJson(res, statusCode, {
      status: statusCode === 500 ? 'error' : 'invalid_request',
      message: statusCode === 404 ? 'Participant not found.' : statusCode === 500 ? 'Internal server error.' : err.message
    });
  }
}

/**
 * Handles GET /api/health
 */
export function handleHealthRequest(req, res) {
  return sendJson(res, 200, {
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
}

/** Publishes only the client-safe Supabase URL and publishable key for scanner sign-in. */
export function handleScannerConfigRequest(req, res) {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    return sendJson(res, 503, { status: 'unavailable', message: 'Scanner sign-in is not configured.' });
  }
  let supabaseUrl;
  try {
    const parsedUrl = new URL(config.supabaseUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
      throw new Error('Invalid Supabase URL');
    }
    supabaseUrl = parsedUrl.origin;
  } catch {
    return sendJson(res, 503, { status: 'unavailable', message: 'Scanner sign-in is not configured.' });
  }
  return sendJson(res, 200, {
    status: 'configured',
    supabaseUrl,
    publishableKey: config.supabasePublishableKey
  });
}
