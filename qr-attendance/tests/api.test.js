/**
 * HTTP API Integration Test Suite
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../src/server.js';
import { MockAttendanceRepository } from '../src/db/mockRepository.js';
import { generateSecureToken, hashToken } from '../src/crypto/token.js';
import { config, getSafeConfigStatus } from '../src/config.js';

export async function runApiTests() {
  console.log('\n--- Running HTTP API Integration Tests ---');

  const testToken = generateSecureToken();
  const testTokenHash = hashToken(testToken);

  const mockRepo = new MockAttendanceRepository({
    participants: [
      ['501', { id: 501, name: 'Grace Hopper', team_name: 'Compilers', status: 'confirmed' }]
    ]
  });

  // Seed active QR
  await mockRepo.createQRRecord({
    participant_id: 501,
    token_hash: testTokenHash,
    is_active: true
  });

  const adminJwt = 'header.payload.signature';
  const memberJwt = 'member.payload.signature';
  const internalSecret = 'local-test-only-internal-secret-value-32bytes';
  const server = createServer({
    repository: mockRepo,
    internalApiSecret: internalSecret,
    authenticateAdmin: async token => {
      if (token === adminJwt) return { id: 'auth-admin-1', email: 'official@example.test', app_metadata: { role: 'admin' } };
      if (token === memberJwt) return { id: 'auth-member-1', user_metadata: { role: 'admin' }, app_metadata: {} };
      return null;
    }
  });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. Test GET /api/health
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.status, 'healthy');
    assert.equal('config' in healthBody, false);
    assert.equal('realtime' in healthBody, false);
    assert.equal(healthRes.headers.get('cache-control'), 'no-store');
    assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthRes.headers.get('x-frame-options'), 'DENY');
    assert.equal(healthRes.headers.get('referrer-policy'), 'no-referrer');
    assert.ok(healthRes.headers.get('content-security-policy').includes("script-src 'self'"));
    assert.equal('supabaseSecretKey' in getSafeConfigStatus(), false);
    assert.equal('internalApiSecret' in getSafeConfigStatus(), false);
    console.log('✓ GET /api/health returned healthy status');

    // 2. Client-supplied IDs/roles and arbitrary bearer strings cannot authorize.
    const forgedRes = await fetch(`${baseUrl}/api/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer forged-token',
        'x-admin-id': 'auth-admin-1',
        'x-admin-role': 'admin',
        'x-dev-admin': 'true'
      },
      body: JSON.stringify({ token: testToken })
    });
    assert.equal(forgedRes.status, 401);
    assert.equal(mockRepo.attendance.size, 0, 'Forged auth must not reach the attendance write path');
    console.log('✓ Forged bearer and admin headers were rejected');

    // 3. A verified user without a trusted app_metadata role is not an official.
    const memberRes = await fetch(`${baseUrl}/api/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberJwt}` },
      body: JSON.stringify({ token: testToken })
    });
    assert.equal(memberRes.status, 403);
    assert.equal(mockRepo.attendance.size, 0);
    console.log('✓ User-editable role metadata cannot grant official access');

    // 4. Test POST /api/checkin with a verified Supabase-style admin identity.
    const checkinRes = await fetch(`${baseUrl}/api/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminJwt}`,
        'x-admin-role': 'attendee'
      },
      body: JSON.stringify({ token: testToken })
    });
    assert.equal(checkinRes.status, 200);
    const checkinBody = await checkinRes.json();
    assert.equal(checkinBody.status, 'success');
    assert.equal(checkinBody.participant, 'Grace Hopper');
    assert.equal(checkinBody.team, 'Compilers');
    console.log('✓ POST /api/checkin successfully checked in participant');

    // 5. Test POST /api/checkin repeated (duplicate scan)
    const duplicateRes = await fetch(`${baseUrl}/api/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminJwt}`
      },
      body: JSON.stringify({ token: testToken })
    });
    assert.equal(duplicateRes.status, 200);
    const duplicateBody = await duplicateRes.json();
    assert.equal(duplicateBody.status, 'already_checked_in');
    assert.equal(duplicateBody.participant, 'Grace Hopper');
    console.log('✓ POST /api/checkin duplicate scan returned already_checked_in');

    // 6. Test POST /api/checkin invalid token
    const invalidRes = await fetch(`${baseUrl}/api/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminJwt}`
      },
      body: JSON.stringify({ token: 'fake-unknown-token-12345678901234567890123456789012345678901234567890' })
    });
    assert.equal(invalidRes.status, 400);
    const invalidBody = await invalidRes.json();
    assert.equal(invalidBody.status, 'invalid_qr');
    console.log('✓ POST /api/checkin invalid token returned 400 invalid_qr');

    // 7. QR generation fails closed for a wrong secret and never returns stored hashes.
    const wrongSecretRes = await fetch(`${baseUrl}/api/qr/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': 'wrong-secret' },
      body: JSON.stringify({ participantId: 501 })
    });
    assert.equal(wrongSecretRes.status, 401);

    const noSecretServer = createServer({ repository: mockRepo, internalApiSecret: '' });
    await new Promise(resolve => noSecretServer.listen(0, '127.0.0.1', resolve));
    try {
      const unavailableRes = await fetch(`http://127.0.0.1:${noSecretServer.address().port}/api/qr/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: 501 })
      });
      assert.equal(unavailableRes.status, 503);
    } finally {
      await new Promise(resolve => noSecretServer.close(resolve));
    }

    const qrCountBefore = mockRepo.qrCodes.size;
    const generateRes = await fetch(`${baseUrl}/api/qr/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret },
      body: JSON.stringify({ participantId: 501, persist: false })
    });
    assert.equal(generateRes.status, 201);
    const generateBody = await generateRes.json();
    assert.equal(generateBody.status, 'success');
    assert.equal(generateBody.participantId, '501');
    assert.ok(generateBody.qrPayload.includes('/checkin?t='));
    assert.equal('tokenHash' in generateBody, false);
    assert.equal('preparedRecord' in generateBody, false);
    assert.equal('participantName' in generateBody, false);
    assert.equal(mockRepo.qrCodes.size, qrCountBefore, 'Non-persistent QR generation must not write');
    console.log('✓ Protected QR generation returned only the required payload; no row was written');

    const persistRes = await fetch(`${baseUrl}/api/qr/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret },
      body: JSON.stringify({ participantId: 501, persist: true })
    });
    assert.equal(persistRes.status, 403);
    assert.equal(mockRepo.qrCodes.size, qrCountBefore, 'Persistence-disabled request must not write');

    // 8. Input bounds and cross-origin defaults.
    const oversizedRes = await fetch(`${baseUrl}/api/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminJwt}` },
      body: JSON.stringify({ token: 'x'.repeat(20_000) })
    });
    assert.equal(oversizedRes.status, 413);

    const preflightRes = await fetch(`${baseUrl}/api/checkin`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST' }
    });
    assert.equal(preflightRes.status, 403);
    assert.equal(preflightRes.headers.get('access-control-allow-origin'), null);
    const allowedOrigin = 'https://scanner.example';
    config.corsAllowedOrigins.push(allowedOrigin);
    try {
      const allowedPreflight = await fetch(`${baseUrl}/api/checkin`, {
        method: 'OPTIONS',
        headers: { Origin: allowedOrigin, 'Access-Control-Request-Method': 'POST' }
      });
      assert.equal(allowedPreflight.status, 204);
      assert.equal(allowedPreflight.headers.get('access-control-allow-origin'), allowedOrigin);

      const allowedResponse = await fetch(`${baseUrl}/api/health`, { headers: { Origin: allowedOrigin } });
      assert.equal(allowedResponse.headers.get('access-control-allow-origin'), allowedOrigin);
    } finally {
      config.corsAllowedOrigins.pop();
    }
    console.log('✓ Oversized bodies and unapproved CORS preflights were rejected');

    // 9. Test GET / (Scanner page delivery)
    const scannerRes = await fetch(`${baseUrl}/`);
    assert.equal(scannerRes.status, 200);
    const htmlText = await scannerRes.text();
    assert.ok(htmlText.includes('QR Attendance Scanner'));
    assert.ok(htmlText.includes('src="/scanner.js"'));
    assert.ok(htmlText.includes('src="/jsqr.js"'));
    assert.ok(!htmlText.includes('x-dev-admin'));
    console.log('✓ GET / served scanner interface HTML');

    const scannerJsRes = await fetch(`${baseUrl}/scanner.js`);
    assert.equal(scannerJsRes.status, 200);
    const scannerJs = await scannerJsRes.text();
    assert.ok(scannerJs.includes('processToken'));
    assert.ok(!scannerJs.includes('innerHTML'));
    assert.ok(!scannerJs.includes('signIn'));
    console.log('✓ Scanner uses jsQR decoding without inline auth flow');

    const jsqrRes = await fetch(`${baseUrl}/jsqr.js`);
    assert.equal(jsqrRes.status, 200);
    assert.ok(jsqrRes.headers.get('content-type').includes('javascript'));
    console.log('✓ GET /jsqr.js served QR decoding library');

    // Dev bypass: a request with NO Authorization header reaches the service layer
    // (returns invalid_qr rather than 401) because NODE_ENV is not "production".
    const devBypassRes = await fetch(`${baseUrl}/api/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'dev-test-token-not-in-database-1234567890abcdef1234567890abcdef' })
    });
    assert.equal(devBypassRes.status, 400);
    const devBypassBody = await devBypassRes.json();
    assert.equal(devBypassBody.status, 'invalid_qr');
    assert.equal(mockRepo.attendance.size, 1, 'Dev bypass with unknown token must not create attendance');
    console.log('✓ Dev mode allows check-in without Bearer header (auth bypass)');

    // Each server instance applies a bounded per-IP check-in limit before auth/database work.
    let lastRateStatus = 0;
    for (let attempt = 0; attempt < 175; attempt++) {
      const rateRes = await fetch(`${baseUrl}/api/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer forged.token.value' },
        body: JSON.stringify({ token: testToken })
      });
      lastRateStatus = rateRes.status;
    }
    assert.equal(lastRateStatus, 429);
    assert.equal(mockRepo.attendance.size, 1, 'Rejected rate-limit probes must not create attendance');
    console.log('✓ Check-in requests are rate limited before repository writes');

  } finally {
    server.close();
  }

  return true;
}
