/**
 * Production Supabase Repository Implementation
 * Connects to Supabase server-side via @supabase/supabase-js.
 * Operates strictly with server-side credentials and never exposes keys.
 */

import { createClient } from '@supabase/supabase-js';
import { AttendanceRepository } from './repository.js';
import { config } from '../config.js';

export class SupabaseAttendanceRepository extends AttendanceRepository {
  constructor(customConfig = {}) {
    super();
    const url = customConfig.supabaseUrl || config.supabaseUrl;
    const key = customConfig.supabaseSecretKey || config.supabaseSecretKey;

    if (!url || !key) {
      this.client = null;
      this.initError = 'Supabase client credentials not configured. SUPABASE_URL and server-side SUPABASE_SECRET_KEY are required.';
    } else {
      this.client = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
      this.initError = null;
    }
  }

  _ensureClient() {
    if (!this.client) {
      throw new Error(this.initError || 'Supabase client is uninitialized.');
    }
    return this.client;
  }

  /** Verify a user access token with Supabase Auth; never decode JWT claims locally. */
  async authenticateUser(accessToken) {
    const client = this._ensureClient();
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data?.user) return null;
    return data.user;
  }

  async getParticipantById(participantId) {
    const client = this._ensureClient();
    const id = typeof participantId === 'bigint' ? participantId.toString() : participantId;

    const { data, error } = await client
      .from('participants')
      .select('id, name, email, team_name, status, created_at')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query participant: ${error.message}`);
    }
    return data;
  }

  async getUserById(identifier) {
    const client = this._ensureClient();
    const isNumeric = /^\d+$/.test(String(identifier));

    let query = client.from('users').select('id, full_name, email, role, created_at');

    if (isNumeric) {
      query = query.eq('id', identifier);
    } else {
      query = query.eq('email', identifier);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(`Failed to query user: ${error.message}`);
    }
    return data;
  }

  async getActiveQRByHash(tokenHash) {
    const client = this._ensureClient();
    const { data, error } = await client
      .from('qr_codes')
      .select('id, participant_id, token_hash, is_active, created_at')
      .eq('token_hash', tokenHash)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query QR record: ${error.message}`);
    }
    return data;
  }

  async getActiveQRByParticipantId(participantId) {
    const client = this._ensureClient();
    const id = typeof participantId === 'bigint' ? participantId.toString() : participantId;

    const { data, error } = await client
      .from('qr_codes')
      .select('id, participant_id, token_hash, is_active, created_at')
      .eq('participant_id', id)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query participant active QR: ${error.message}`);
    }
    return data;
  }

  async createQRRecord(record) {
    const client = this._ensureClient();
    const pid = typeof record.participant_id === 'bigint' ? record.participant_id.toString() : record.participant_id;

    const { data, error } = await client
      .from('qr_codes')
      .insert({
        participant_id: pid,
        token_hash: record.token_hash,
        is_active: record.is_active !== undefined ? record.is_active : true
      })
      .select('id, participant_id, token_hash, is_active, created_at')
      .single();

    if (error) {
      const err = new Error(`Failed to insert QR record: ${error.message}`);
      err.code = error.code;
      throw err;
    }
    return data;
  }

  async getAttendanceByParticipantId(participantId) {
    const client = this._ensureClient();
    const id = typeof participantId === 'bigint' ? participantId.toString() : participantId;

    const { data, error } = await client
      .from('attendance')
      .select('id, participant_id, qr_id, checked_in_at, scanned_by, created_at')
      .eq('participant_id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query attendance: ${error.message}`);
    }
    return data;
  }

  async createAttendanceRecord(record) {
    const client = this._ensureClient();
    const pid = typeof record.participant_id === 'bigint' ? record.participant_id.toString() : record.participant_id;

    const { data, error } = await client
      .from('attendance')
      .insert({
        participant_id: pid,
        qr_id: record.qr_id,
        scanned_by: record.scanned_by
      })
      .select('id, participant_id, qr_id, checked_in_at, scanned_by, created_at')
      .single();

    if (error) {
      const err = new Error(`Failed to insert attendance: ${error.message}`);
      err.code = error.code; // PostgREST code 23505 for unique violation
      throw err;
    }
    return data;
  }
}
