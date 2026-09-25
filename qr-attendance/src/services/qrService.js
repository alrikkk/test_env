/**
 * QR Generation Service
 * Responsible for minting cryptographically secure QR identities for participants.
 */

import { generateSecureToken, hashToken, buildQRPayload } from '../crypto/token.js';
import { getRepository } from '../db/index.js';

/**
 * Validates and normalizes a participant ID (BIGINT).
 * 
 * @param {string|number|bigint} participantId 
 * @returns {bigint}
 */
export function normalizeParticipantId(participantId) {
  if (participantId === null || participantId === undefined) {
    throw new Error('participantId is required');
  }

  try {
    const bigIntVal = BigInt(participantId);
    if (bigIntVal <= 0n) {
      throw new Error('participantId must be a positive integer');
    }
    return bigIntVal;
  } catch (err) {
    throw new Error(`Invalid participantId format: ${err.message}`);
  }
}

/**
 * Generates a unique, high-entropy QR identity for a registered participant.
 * 
 * Flow:
 * 1. Validate participantId is a valid positive BIGINT.
 * 2. Verify that the participant exists in public.participants.
 * 3. Generate 32 bytes of cryptographic randomness.
 * 4. Calculate SHA-256 token_hash.
 * 5. Prepare the QR record (decoupled persistence layer).
 * 6. Construct the QR payload URL (https://<event-domain>/checkin?t=<token>).
 * 7. Return payload to caller without logging raw token.
 * 
 * @param {string|number|bigint} rawParticipantId - The participant's BIGINT primary key
 * @param {object} [options]
 * @param {boolean} [options.persist=false] - Whether to persist to DB (defaults to false until DB migration approval)
 * @param {string} [options.eventDomain] - Optional domain override for QR payload URL
 * @param {object} [options.repository] - Optional repository override (for tests)
 * @returns {Promise<{
 *   status: string,
 *   participantId: string,
 *   qrCodeId: string,
 *   qrPayload: string,
 *   token: string,
 *   tokenHash: string,
 *   preparedRecord: object
 * }>}
 */
export async function generateParticipantQR(rawParticipantId, options = {}) {
  // 1. Validate and normalize BIGINT ID
  const participantId = normalizeParticipantId(rawParticipantId);
  const repo = getRepository(options.repository);

  // 2. Verify participant exists
  const participant = await repo.getParticipantById(participantId);
  if (!participant) {
    const notFoundErr = new Error(`Participant with ID ${participantId.toString()} not found.`);
    notFoundErr.statusCode = 404;
    throw notFoundErr;
  }

  // 3. Generate 32 random bytes (256 bits entropy)
  const rawToken = generateSecureToken();

  // 4. Calculate SHA-256 hash for at-rest storage
  const tokenHash = hashToken(rawToken);

  // 5. Build QR check-in URL payload
  const qrPayload = buildQRPayload(rawToken, options.eventDomain);

  // 6. Prepare the QR record
  const preparedRecord = {
    participant_id: participantId.toString(),
    token_hash: tokenHash,
    is_active: true,
    created_at: new Date().toISOString()
  };

  let qrCodeId = 'prepared_pending_db_migration';

  // 7. Decoupled Persistence: Only executes DB insert if explicitly enabled
  if (options.persist === true) {
    const created = await repo.createQRRecord(preparedRecord);
    qrCodeId = created.id;
  }

  // 8. Return result without logging raw token server-side
  return {
    status: 'success',
    participantId: participantId.toString(),
    participantName: participant.name,
    teamName: participant.team_name,
    qrCodeId,
    qrPayload,
    token: rawToken, // Returned ONLY to registration caller for immediate badge/email delivery
    tokenHash,
    preparedRecord
  };
}
