/**
 * QR Generation Service Test Suite
 */

import assert from 'node:assert/strict';
import { generateParticipantQR, normalizeParticipantId } from '../src/services/qrService.js';
import { MockAttendanceRepository } from '../src/db/mockRepository.js';

export async function runQrServiceTests() {
  console.log('\n--- Running QR Generation Service Tests ---');

  // Setup isolated mock repository with simulated participants
  const mockRepo = new MockAttendanceRepository({
    participants: [
      ['101', { id: 101, name: 'Alice Smith', email: 'alice@example.com', team_name: 'Alpha Team', status: 'confirmed' }],
      ['102', { id: 102, name: 'Bob Jones', email: 'bob@example.com', team_name: 'Beta Team', status: 'confirmed' }]
    ]
  });

  // Test 1: BIGINT normalization
  assert.equal(normalizeParticipantId(101), 101n);
  assert.equal(normalizeParticipantId('102'), 102n);
  assert.equal(normalizeParticipantId(9007199254740993n), 9007199254740993n);
  assert.throws(() => normalizeParticipantId(-5), /positive integer/);
  assert.throws(() => normalizeParticipantId('invalid-abc'), /Invalid participantId/);
  console.log('✓ BIGINT participant ID normalization and validation verified');

  // Test 2: Generate QR for participant 101
  const qrResult1 = await generateParticipantQR(101, { repository: mockRepo });
  assert.equal(qrResult1.status, 'success');
  assert.equal(qrResult1.participantId, '101');
  assert.equal(qrResult1.participantName, 'Alice Smith');
  assert.equal(qrResult1.teamName, 'Alpha Team');
  assert.ok(qrResult1.token.length === 64, 'Token must be 64 characters');
  assert.ok(qrResult1.tokenHash.length === 64, 'Token hash must be 64 characters');
  assert.ok(qrResult1.qrPayload.includes(qrResult1.token), 'QR payload must contain raw token');
  assert.equal(qrResult1.preparedRecord.token_hash, qrResult1.tokenHash, 'Prepared record must contain hash');
  assert.equal(qrResult1.preparedRecord.participant_id, '101');
  console.log('✓ Unique QR identity generated for registered participant');

  // Test 3: Generate QR for participant 102 — tokens must be different
  const qrResult2 = await generateParticipantQR(102, { repository: mockRepo });
  assert.notEqual(qrResult1.token, qrResult2.token, 'Two participants must receive distinct tokens');
  assert.notEqual(qrResult1.tokenHash, qrResult2.tokenHash, 'Two participants must receive distinct token hashes');
  console.log('✓ Two different participants received different unpredictable tokens');

  // Test 4: Generation fails for non-existent participant
  await assert.rejects(
    async () => {
      await generateParticipantQR(999, { repository: mockRepo });
    },
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.ok(err.message.includes('not found'));
      return true;
    },
    'Should reject non-existent participant'
  );
  console.log('✓ Non-existent participant correctly rejected (404)');

  return true;
}
