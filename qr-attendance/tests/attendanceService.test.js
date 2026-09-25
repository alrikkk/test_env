/**
 * Attendance Check-In Service Test Suite
 */

import assert from 'node:assert/strict';
import { generateSecureToken, hashToken } from '../src/crypto/token.js';
import { checkInParticipant } from '../src/services/attendanceService.js';
import { MockAttendanceRepository } from '../src/db/mockRepository.js';

export async function runAttendanceServiceTests() {
  console.log('\n--- Running Attendance Check-In Service Tests ---');

  // Setup test tokens and active/inactive QR records
  const validToken = generateSecureToken();
  const validTokenHash = hashToken(validToken);

  const inactiveToken = generateSecureToken();
  const inactiveTokenHash = hashToken(inactiveToken);

  const adminUser = { verified: true, id: 'auth-admin', app_metadata: { role: 'admin' } };
  const volunteerUser = { verified: true, id: 'auth-volunteer', app_metadata: { roles: ['volunteer'] } };
  const unauthorizedUser = { verified: true, id: 'auth-attendee', user_metadata: { role: 'admin' }, app_metadata: {} };

  const mockRepo = new MockAttendanceRepository({
    participants: [
      ['201', { id: 201, name: 'Charlie Brown', email: 'charlie@example.com', team_name: 'CyberKnights', status: 'confirmed' }],
      ['202', { id: 202, name: 'Dana Scully', email: 'dana@example.com', team_name: 'X-Files Crew', status: 'confirmed' }]
    ],
    users: [
      ['1', adminUser],
      ['2', volunteerUser],
      ['3', unauthorizedUser]
    ]
  });

  // Pre-seed active QR for Charlie (201)
  const activeQR = await mockRepo.createQRRecord({
    participant_id: 201,
    token_hash: validTokenHash,
    is_active: true
  });

  // Pre-seed inactive QR for Dana (202)
  await mockRepo.createQRRecord({
    participant_id: 202,
    token_hash: inactiveTokenHash,
    is_active: false
  });

  // Test 1: Missing or malformed token is rejected
  const resEmpty = await checkInParticipant('', adminUser, { repository: mockRepo });
  assert.equal(resEmpty.status, 'invalid_qr');
  const resMalformed = await checkInParticipant('bad-short-token', adminUser, { repository: mockRepo });
  assert.equal(resMalformed.status, 'invalid_qr');
  console.log('✓ Missing and malformed tokens correctly rejected');

  // Test 2: Unauthorized official / missing credentials rejected
  const resUnauthorized = await checkInParticipant(validToken, unauthorizedUser, { repository: mockRepo });
  assert.equal(resUnauthorized.status, 'unauthorized');
  const resNoAuth = await checkInParticipant(validToken, null, { repository: mockRepo });
  assert.equal(resNoAuth.status, 'unauthorized');
  assert.equal((await checkInParticipant(validToken, { id: 'spoofed', role: 'admin' }, { repository: mockRepo })).status, 'unauthorized');
  assert.equal((await checkInParticipant(validToken, { verified: true, id: 'spoofed', is_admin: true, app_metadata: {} }, { repository: mockRepo })).status, 'unauthorized');
  console.log('✓ Unauthorized / unauthenticated check-in requests rejected');

  // Test 3: Non-existent token is rejected
  const randomUnknownToken = generateSecureToken();
  const resUnknown = await checkInParticipant(randomUnknownToken, adminUser, { repository: mockRepo });
  assert.equal(resUnknown.status, 'invalid_qr');
  console.log('✓ Non-existent QR token correctly rejected');

  // Test 4: Inactive QR code is rejected
  const resInactive = await checkInParticipant(inactiveToken, adminUser, { repository: mockRepo });
  assert.equal(resInactive.status, 'invalid_qr');
  console.log('✓ Inactive QR code correctly rejected');

  // Test 5: Valid QR code successfully checks in
  const resSuccess = await checkInParticipant(validToken, volunteerUser, { repository: mockRepo });
  assert.equal(resSuccess.status, 'success');
  assert.equal(resSuccess.participant, 'Charlie Brown');
  assert.equal(resSuccess.team, 'CyberKnights');
  assert.ok(resSuccess.checkedInAt, 'Must include checkedInAt timestamp');
  console.log('✓ Valid QR successfully checked in (First Scan)');

  // Verify DB state has exactly 1 attendance row for participant 201
  const attRecord = await mockRepo.getAttendanceByParticipantId(201);
  assert.ok(attRecord, 'Attendance record must exist in DB');
  assert.equal(attRecord.participant_id, 201);
  assert.equal(attRecord.qr_id, activeQR.id);

  // Test 6: Same QR scanned twice returns ALREADY_CHECKED_IN
  const resDuplicate = await checkInParticipant(validToken, adminUser, { repository: mockRepo });
  assert.equal(resDuplicate.status, 'already_checked_in');
  assert.equal(resDuplicate.participant, 'Charlie Brown');
  assert.equal(resDuplicate.team, 'CyberKnights');
  assert.equal(resDuplicate.checkedInAt, resSuccess.checkedInAt);
  console.log('✓ Repeated scan correctly returned ALREADY_CHECKED_IN with original timestamp');

  // Test 7: Simulated Concurrent Race Condition (Two Admins Scanning Nearly Simultaneously)
  // Setup fresh participant 203 with valid QR
  const raceToken = generateSecureToken();
  const raceTokenHash = hashToken(raceToken);
  mockRepo.participants.set('203', { id: 203, name: 'Eve Hacker', team_name: 'Shadows', status: 'confirmed' });
  await mockRepo.createQRRecord({ participant_id: 203, token_hash: raceTokenHash, is_active: true });

  // Fire two concurrent check-in promises simultaneously
  const [raceResult1, raceResult2] = await Promise.all([
    checkInParticipant(raceToken, adminUser, { repository: mockRepo }),
    checkInParticipant(raceToken, volunteerUser, { repository: mockRepo })
  ]);

  // Exactly ONE must succeed and the other must return ALREADY_CHECKED_IN
  const statuses = [raceResult1.status, raceResult2.status].sort();
  assert.deepEqual(statuses, ['already_checked_in', 'success'], 'Concurrent scans must result in exactly 1 success and 1 already_checked_in');

  // Verify only 1 row exists in attendance
  assert.equal(mockRepo.attendance.size, 2, 'Attendance database must hold exactly 2 records total (Charlie + Eve)');
  console.log('✓ Concurrent scan race condition handled: exactly ONE attendance row created');

  return true;
}
