/**
 * Keeps a server-side Supabase Realtime subscription open and exposes only
 * connection status. Row-change payloads are intentionally ignored.
 */

import { config } from '../config.js';

let channel = null;
let realtimeClient = null;
let state = {
  status: 'NOT_STARTED',
  schema: config.supabaseRealtimeSchema,
  table: config.supabaseRealtimeTable
};

export function getRealtimeStatus() {
  return {
    status: state.status,
    connected: state.status === 'SUBSCRIBED',
    schema: state.schema,
    table: state.table
  };
}

export function startRealtimeConnection(client) {
  if (channel) return channel;
  if (!client) {
    state = { ...state, status: 'NOT_CONFIGURED' };
    return null;
  }

  const { supabaseRealtimeSchema: schema, supabaseRealtimeTable: table } = config;
  realtimeClient = client;
  state = { status: 'CONNECTING', schema, table };

  channel = client
    .channel(`qr-attendance-connectivity-${process.pid}`)
    .on('postgres_changes', { event: '*', schema, table }, () => {})
    .subscribe((status) => {
      state = { status, schema, table };
    });

  return channel;
}

export async function stopRealtimeConnection() {
  if (!channel) return;

  const activeChannel = channel;
  channel = null;
  try {
    await activeChannel.unsubscribe();
  } finally {
    realtimeClient?.realtime?.disconnect();
    realtimeClient = null;
    state = { ...state, status: 'CLOSED' };
  }
}
