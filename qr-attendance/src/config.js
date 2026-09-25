/**
 * Configuration module for QR Attendance
 * All environment variables are loaded securely without exposing credentials.
 */

export const config = {
  // Event Domain for QR Check-In URLs
  eventDomain: process.env.EVENT_DOMAIN || 'event.msasrm.org',

  // Supabase Configuration (Server-Side)
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || '',
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
  supabaseRealtimeSchema: process.env.SUPABASE_REALTIME_SCHEMA || 'public',
  supabaseRealtimeTable: process.env.SUPABASE_REALTIME_TABLE || 'participants',

  // Browser origins allowed to call the API cross-origin. Same-origin needs no CORS entry.
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),

  // Internal API Secret for registration service communication
  internalApiSecret: process.env.INTERNAL_API_SECRET || '',

  // QR writes remain disabled unless explicitly enabled by deployment configuration.
  qrGenerationPersistenceEnabled: process.env.QR_GENERATION_PERSIST_ENABLED === 'true',

  // Server Port
  port: parseInt(process.env.PORT || '3000', 10),

  // Operational Flags
  isProduction: process.env.NODE_ENV === 'production',
};

/**
 * Safe status check that never exposes secret values
 */
export function getSafeConfigStatus() {
  return {
    eventDomain: config.eventDomain,
    supabaseUrlConfigured: Boolean(config.supabaseUrl),
    supabaseSecretKeyConfigured: Boolean(config.supabaseSecretKey),
    supabasePublishableKeyConfigured: Boolean(config.supabasePublishableKey),
    internalApiSecretConfigured: Boolean(config.internalApiSecret),
    qrGenerationPersistenceEnabled: config.qrGenerationPersistenceEnabled,
    corsAllowedOriginCount: config.corsAllowedOrigins.length,
    port: config.port,
    nodeEnv: process.env.NODE_ENV || 'development'
  };
}
