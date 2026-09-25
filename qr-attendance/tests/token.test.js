/**
 * Token Cryptography Test Suite
 */

import assert from 'node:assert/strict';
import { generateSecureToken, hashToken, buildQRPayload, extractToken, isValidTokenFormat } from '../src/crypto/token.js';

export async function runTokenTests() {
  console.log('\n--- Running Token Cryptography Tests ---');

  // Test 1: Secure token generates 64-char hex string (32 bytes)
  const token1 = generateSecureToken();
  assert.equal(typeof token1, 'string', 'Token must be a string');
  assert.equal(token1.length, 64, 'Token must be exactly 64 hex characters (32 bytes)');
  assert.ok(isValidTokenFormat(token1), 'Token must match hex pattern');
  console.log('✓ Token format and length (64 hex characters) verified');

  // Test 2: Unpredictability across multiple iterations
  const tokenSet = new Set();
  const iterations = 100;
  for (let i = 0; i < iterations; i++) {
    const t = generateSecureToken();
    assert.equal(tokenSet.has(t), false, 'Collision detected in secure random token generation');
    tokenSet.add(t);
  }
  assert.equal(tokenSet.size, iterations, 'All generated tokens must be distinct');
  console.log(`✓ Token unpredictability verified (${iterations} distinct tokens generated without collision)`);

  // Test 3: SHA-256 hashing produces consistent 64-char digest
  const hash1 = hashToken(token1);
  const hash2 = hashToken(token1);
  assert.equal(hash1.length, 64, 'SHA-256 hash must be 64 characters');
  assert.equal(hash1, hash2, 'Identical token must produce identical SHA-256 hash');
  assert.notEqual(token1, hash1, 'Hash must not equal raw token');
  console.log('✓ SHA-256 hash consistency and length verified');

  // Test 4: Two different tokens produce different hashes
  const token2 = generateSecureToken();
  const hashToken2 = hashToken(token2);
  assert.notEqual(hash1, hashToken2, 'Different tokens must produce different hashes');
  console.log('✓ Distinct token hash isolation verified');

  // Test 5: QR payload construction
  const payload = buildQRPayload(token1, 'tickets.srmevent.com');
  assert.equal(payload, `https://tickets.srmevent.com/checkin?t=${token1}`, 'QR payload URL mismatch');
  console.log('✓ Configurable QR payload URL structure verified');

  // Test 6: Token extraction from URL and raw string
  const extractedFromUrl = extractToken(payload);
  assert.equal(extractedFromUrl, token1, 'Extracted token from URL must match original token');
  const extractedRaw = extractToken(token1);
  assert.equal(extractedRaw, token1, 'Extracted token from raw string must match');
  const invalidExtract = extractToken('invalid-junk-token');
  assert.equal(invalidExtract, null, 'Invalid token extraction must return null');
  console.log('✓ Token extraction and sanitization verified');

  return true;
}
