/**
 * Abstract Repository Interface for QR Attendance Database Operations
 * Decouples service logic from persistence mechanisms.
 */

export class AttendanceRepository {
  /**
   * Find a participant by primary key (BIGINT)
   * @param {string|number|bigint} participantId
   * @returns {Promise<{ id: string|number, name: string, email: string, team_name: string, status: string }|null>}
   */
  async getParticipantById(participantId) {
    throw new Error('Method getParticipantById not implemented');
  }

  /**
   * Find a user by primary key or email (for admin verification)
   * @param {string|number|bigint} identifier
   * @returns {Promise<{ id: string|number, full_name: string, email: string, role: string }|null>}
   */
  async getUserById(identifier) {
    throw new Error('Method getUserById not implemented');
  }

  /**
   * Find an active QR code record by SHA-256 token hash
   * @param {string} tokenHash
   * @returns {Promise<{ id: string, participant_id: string|number, token_hash: string, is_active: boolean, created_at: string }|null>}
   */
  async getActiveQRByHash(tokenHash) {
    throw new Error('Method getActiveQRByHash not implemented');
  }

  /**
   * Find active QR code for a given participant ID
   * @param {string|number|bigint} participantId
   * @returns {Promise<{ id: string, participant_id: string|number, token_hash: string, is_active: boolean }|null>}
   */
  async getActiveQRByParticipantId(participantId) {
    throw new Error('Method getActiveQRByParticipantId not implemented');
  }

  /**
   * Store a new QR code record
   * @param {{ participant_id: string|number|bigint, token_hash: string, is_active: boolean }} record
   * @returns {Promise<{ id: string, participant_id: string|number, token_hash: string, is_active: boolean, created_at: string }>}
   */
  async createQRRecord(record) {
    throw new Error('Method createQRRecord not implemented');
  }

  /**
   * Find existing attendance record for a participant
   * @param {string|number|bigint} participantId
   * @returns {Promise<{ id: string, participant_id: string|number, checked_in_at: string, scanned_by: string }|null>}
   */
  async getAttendanceByParticipantId(participantId) {
    throw new Error('Method getAttendanceByParticipantId not implemented');
  }

  /**
   * Record attendance atomically.
   * If participant_id already exists, must throw a uniqueness violation.
   * @param {{ participant_id: string|number|bigint, qr_id: string, scanned_by: string }} record
   * @returns {Promise<{ id: string, participant_id: string|number, checked_in_at: string, scanned_by: string }>}
   */
  async createAttendanceRecord(record) {
    throw new Error('Method createAttendanceRecord not implemented');
  }
}
