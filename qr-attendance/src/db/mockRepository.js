/**
 * In-Memory Mock Repository for Testing and Local Scaffolding
 * Simulates PostgreSQL constraints (code 23505) and isolated state.
 * Never performs real network or database calls.
 */

import crypto from 'node:crypto';
import { AttendanceRepository } from './repository.js';

export class MockAttendanceRepository extends AttendanceRepository {
  constructor(initialData = {}) {
    super();
    // In-memory collections
    this.participants = new Map(initialData.participants || []);
    this.users = new Map(initialData.users || []);
    this.qrCodes = new Map(); // id -> record
    this.attendance = new Map(); // participant_id -> record

    // Pre-populate QR codes if provided
    if (initialData.qrCodes) {
      for (const qr of initialData.qrCodes) {
        this.qrCodes.set(qr.id, { ...qr });
      }
    }

    // Pre-populate attendance if provided
    if (initialData.attendance) {
      for (const att of initialData.attendance) {
        this.attendance.set(String(att.participant_id), { ...att });
      }
    }
  }

  async getParticipantById(participantId) {
    const key = String(participantId);
    const participant = this.participants.get(key);
    return participant ? { ...participant } : null;
  }

  async getUserById(identifier) {
    const key = String(identifier);
    const user = this.users.get(key);
    if (user) return { ...user };
    // Also support lookup by email
    for (const u of this.users.values()) {
      if (u.email === identifier) return { ...u };
    }
    return null;
  }

  async getActiveQRByHash(tokenHash) {
    for (const record of this.qrCodes.values()) {
      if (record.token_hash === tokenHash && record.is_active === true) {
        return { ...record };
      }
    }
    return null;
  }

  async getActiveQRByParticipantId(participantId) {
    const targetPid = String(participantId);
    for (const record of this.qrCodes.values()) {
      if (String(record.participant_id) === targetPid && record.is_active === true) {
        return { ...record };
      }
    }
    return null;
  }

  async createQRRecord(record) {
    // Check token_hash uniqueness
    for (const existing of this.qrCodes.values()) {
      if (existing.token_hash === record.token_hash) {
        const err = new Error('duplicate key value violates unique constraint "uq_qr_codes_token_hash"');
        err.code = '23505';
        throw err;
      }
    }

    const id = crypto.randomUUID();
    const created = {
      id,
      participant_id: record.participant_id,
      token_hash: record.token_hash,
      is_active: record.is_active !== undefined ? record.is_active : true,
      created_at: new Date().toISOString()
    };
    this.qrCodes.set(id, created);
    return { ...created };
  }

  async getAttendanceByParticipantId(participantId) {
    const key = String(participantId);
    const att = this.attendance.get(key);
    return att ? { ...att } : null;
  }

  async createAttendanceRecord(record) {
    const key = String(record.participant_id);
    
    // Simulate PostgreSQL UNIQUE(participant_id) constraint
    if (this.attendance.has(key)) {
      const err = new Error('duplicate key value violates unique constraint "uq_attendance_participant"');
      err.code = '23505'; // PostgreSQL unique violation code
      throw err;
    }

    const id = crypto.randomUUID();
    const created = {
      id,
      participant_id: record.participant_id,
      qr_id: record.qr_id,
      scanned_by: record.scanned_by || 'system',
      checked_in_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    };
    this.attendance.set(key, created);
    return { ...created };
  }
}
