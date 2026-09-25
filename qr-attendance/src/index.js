/**
 * QR Attendance Module — Main Entry Point
 * Designed for clean, decoupled integration with the registration system.
 */

export { generateParticipantQR, normalizeParticipantId } from './services/qrService.js';
export { checkInParticipant, isAuthorizedAdmin } from './services/attendanceService.js';
export { generateSecureToken, hashToken, buildQRPayload, extractToken, isValidTokenFormat } from './crypto/token.js';
export { AttendanceRepository } from './db/repository.js';
export { MockAttendanceRepository } from './db/mockRepository.js';
export { SupabaseAttendanceRepository } from './db/supabaseRepository.js';
export { getRepository, setRepository } from './db/index.js';
export { getRealtimeStatus, startRealtimeConnection, stopRealtimeConnection } from './db/realtime.js';
export { createServer } from './server.js';
export { config, getSafeConfigStatus } from './config.js';
