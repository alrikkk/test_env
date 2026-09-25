/**
 * Database Repository Entry Point
 */

import { MockAttendanceRepository } from './mockRepository.js';
import { SupabaseAttendanceRepository } from './supabaseRepository.js';
import { config } from '../config.js';

let defaultRepo = null;

export function getRepository(override = null) {
  if (override) return override;
  if (!defaultRepo) {
    if (config.supabaseUrl && config.supabaseSecretKey) {
      defaultRepo = new SupabaseAttendanceRepository();
    } else if (process.env.NODE_ENV === 'test' || process.env.USE_MOCK_DB === 'true') {
      defaultRepo = new MockAttendanceRepository();
    } else {
      throw new Error(
        'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY in the project .env file. ' +
        'Use USE_MOCK_DB=true only for intentional local mock runs.'
      );
    }
  }
  return defaultRepo;
}

export function setRepository(repo) {
  defaultRepo = repo;
}

export { MockAttendanceRepository, SupabaseAttendanceRepository };
