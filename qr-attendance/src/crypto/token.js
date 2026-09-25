/**
 * Cryptographic Token Generation & Hashing Module
 * Enforces high entropy (256 bits) and one-way hashing at rest.
 */

import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Generates a cryptographically secure, unpredictable 32-byte (256-bit) random token.
 * 
 * Rules:
 * - Uses native OS crypto entropy via crypto.randomBytes(32).
 * - NEVER uses Math.random().
 * - NEVER derives tokens from names, emails, IDs, timestamps, or teams.
 * 
 * @returns {string} 64-character hexadecimal random token
 */
export function generateSecureToken() {
  const bytes = crypto.randomBytes(32);
  return bytes.toString('hex');
}

/**
 * Computes the SHA-256 digest of a raw token.
 * Only this hash is persisted to the database.
 * 
 * @param {string} rawToken - The 64-char hexadecimal token
 * @returns {string} 64-char SHA-256 hexadecimal hash
 */
export function hashToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new Error('Invalid token provided for hashing.');
  }
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

/**
 * Constructs the standard QR code check-in URL payload.
 * 
 * Format: https://<event-domain>/checkin?t=<raw-token>
 * 
 * @param {string} rawToken - The raw random token
 * @param {string} [customDomain] - Optional override for event domain
 * @returns {string} Full QR payload URL
 */
export function buildQRPayload(rawToken, customDomain) {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new Error('Raw token is required to build QR payload.');
  }
  const domain = (customDomain || config.eventDomain || 'event.msasrm.org').replace(/\/+$/, '');
  const cleanDomain = domain.replace(/^https?:\/\//, '');
  return `https://${cleanDomain}/checkin?t=${encodeURIComponent(rawToken.trim())}`;
}

/**
 * Extracts and sanitizes the raw token from either a full check-in URL or a direct token string.
 * 
 * @param {string} input - Either a raw token or a check-in URL
 * @returns {string|null} The extracted 64-character token, or null if invalid
 */
export function extractToken(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  // If input is a URL, extract the query param 't'
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed);
      const t = url.searchParams.get('t');
      return isValidTokenFormat(t) ? t : null;
    } catch {
      return null;
    }
  }

  // Otherwise check if it's already a direct valid token
  return isValidTokenFormat(trimmed) ? trimmed : null;
}

/**
 * Validates that a string is a valid 64-character hexadecimal token.
 * 
 * @param {string} token 
 * @returns {boolean}
 */
export function isValidTokenFormat(token) {
  if (!token || typeof token !== 'string') return false;
  return /^[0-9a-fA-F]{64}$/.test(token.trim());
}
