/**
 * Attendance Check-In Service
 * Verifies QR tokens, resolves participants, and prevents duplicate check-ins.
 */

import { hashToken, extractToken } from '../crypto/token.js';
import { getRepository } from '../db/index.js';

/**
 * Validates whether an admin/official is authorized to check in participants.
 * 
 * @param {object} authenticatedAdmin
 * @returns {boolean}
 */
export function isAuthorizedAdmin(authenticatedAdmin) {
  if (!authenticatedAdmin || typeof authenticatedAdmin !== 'object' || authenticatedAdmin.verified !== true) {
    return false;
  }

  // Only server-verified Supabase app_metadata is trusted; user-editable metadata and
  // client-provided role/boolean flags are deliberately ignored.
  const appMetadata = authenticatedAdmin.app_metadata;
  if (!appMetadata || typeof appMetadata !== 'object') return false;

  const rawRoles = [appMetadata.role, ...(Array.isArray(appMetadata.roles) ? appMetadata.roles : [])];
  const roles = rawRoles.filter(role => typeof role === 'string').map(role => role.toLowerCase());
  const allowedRoles = ['admin', 'organizer', 'volunteer', 'official', 'staff'];
  return roles.some(role => allowedRoles.includes(role));
}

/**
 * Checks in a participant using their scanned QR token.
 * 
 * Flow:
 * 1. Validate request input.
 * 2. Verify authenticated admin/MSA user.
 * 3. Hash the supplied token with SHA-256.
 * 4. Find the matching active QR record.
 * 5. Resolve participant_id (BIGINT).
 * 6. Resolve participant name and team_name from public.participants.
 * 7. Check if attendance already exists -> return ALREADY CHECKED IN.
 * 8. Attempt atomic attendance creation.
 * 9. Catch database unique constraint violation (code 23505) -> return ALREADY CHECKED IN.
 * 10. If successful, return SUCCESS.
 * 11. Never expose database errors, SQL, hashes, credentials, or stack traces.
 * 
 * @param {string} rawTokenInput - The raw token or full QR check-in URL
 * @param {object} authenticatedAdmin - The authorized admin user performing the scan
 * @param {object} [options] - Optional repository or configuration overrides
 * @returns {Promise<{
 *   status: 'success' | 'already_checked_in' | 'invalid_qr' | 'unauthorized' | 'error',
 *   participant?: string,
 *   team?: string,
 *   checkedInAt?: string,
 *   message?: string
 * }>}
 */
export async function checkInParticipant(rawTokenInput, authenticatedAdmin, options = {}) {
  // 1. Validate request input
  const token = extractToken(rawTokenInput);
  if (!token) {
    return { status: 'invalid_qr' };
  }

  // 2. Verify authenticated admin/MSA user
  if (!isAuthorizedAdmin(authenticatedAdmin)) {
    return {
      status: 'unauthorized',
      message: 'Only authorized event officials may check in participants.'
    };
  }

  const repo = getRepository(options.repository);

  try {
    // 3. Hash the supplied token
    const tokenHash = hashToken(token);

    // 4. Find matching active QR record
    const qrRecord = await repo.getActiveQRByHash(tokenHash);
    if (!qrRecord || qrRecord.is_active !== true) {
      return { status: 'invalid_qr' };
    }

    // 5. Resolve participant_id (BIGINT)
    const participantId = qrRecord.participant_id;

    // 6. Resolve participant details from public.participants
    const participant = await repo.getParticipantById(participantId);
    if (!participant) {
      // Participant record does not exist
      return { status: 'invalid_qr' };
    }

    const participantName = participant.name || 'Participant';
    const teamName = participant.team_name || 'Individual';

    // 7. Check if attendance record already exists
    const existingAttendance = await repo.getAttendanceByParticipantId(participantId);
    if (existingAttendance) {
      return {
        status: 'already_checked_in',
        participant: participantName,
        team: teamName,
        checkedInAt: existingAttendance.checked_in_at
      };
    }

    // 8. Attempt atomic attendance creation
    const adminIdentifier = String(authenticatedAdmin.id || authenticatedAdmin.email || 'official');
    
    try {
      const newAttendance = await repo.createAttendanceRecord({
        participant_id: participantId,
        qr_id: qrRecord.id,
        scanned_by: adminIdentifier
      });

      return {
        status: 'success',
        participant: participantName,
        team: teamName,
        checkedInAt: newAttendance.checked_in_at
      };
    } catch (insertError) {
      // Handle PostgreSQL uniqueness constraint (code 23505) from race conditions
      if (insertError.code === '23505' || String(insertError.message).includes('unique')) {
        const raceAttendance = await repo.getAttendanceByParticipantId(participantId);
        return {
          status: 'already_checked_in',
          participant: participantName,
          team: teamName,
          checkedInAt: raceAttendance?.checked_in_at || new Date().toISOString()
        };
      }
      throw insertError;
    }
  } catch (error) {
    // Shield internal error details, SQL queries, credentials, and stack traces
    return {
      status: 'error',
      message: 'An error occurred while processing check-in. Please try again.'
    };
  }
}
