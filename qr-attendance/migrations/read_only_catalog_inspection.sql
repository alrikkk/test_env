-- ============================================================================
-- MSA QR Attendance: production-safe catalog inspection
-- READ-ONLY: every statement is SELECT-only and reads metadata, never rows.
-- Do not add DDL/DML to this file. Do not output token, participant, or user data.
-- ============================================================================

-- 1. Existing public objects with QR, attendance, or check-in names.
SELECT n.nspname AS schema_name, c.relname AS object_name,
       CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned_table'
                      WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view'
                      WHEN 'f' THEN 'foreign_table' ELSE c.relkind::text END AS object_type,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND (c.relname ILIKE '%qr%' OR c.relname ILIKE '%attend%' OR c.relname ILIKE '%checkin%')
ORDER BY object_type, object_name;

-- 2. Columns, types, nullability, and defaults: public base tables plus auth.users.
SELECT table_schema, table_name, ordinal_position, column_name, data_type,
       udt_schema, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE (table_schema = 'public' AND table_name IN ('participants', 'users', 'qr_codes', 'attendance'))
   OR (table_schema = 'auth' AND table_name = 'users')
ORDER BY table_schema, table_name, ordinal_position;

-- 3. Primary, unique, check, and foreign-key constraints with fully qualified targets.
SELECT src_n.nspname AS table_schema, src.relname AS table_name,
       con.conname AS constraint_name, con.contype AS constraint_type,
       pg_catalog.pg_get_constraintdef(con.oid, true) AS constraint_definition,
       tgt_n.nspname AS referenced_schema, tgt.relname AS referenced_table
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS src ON src.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS src_n ON src_n.oid = src.relnamespace
LEFT JOIN pg_catalog.pg_class AS tgt ON tgt.oid = con.confrelid
LEFT JOIN pg_catalog.pg_namespace AS tgt_n ON tgt_n.oid = tgt.relnamespace
WHERE src_n.nspname = 'public'
  AND src.relname IN ('participants', 'users', 'qr_codes', 'attendance')
ORDER BY table_name, constraint_name;

-- 4. Indexes, including partial predicates, for the same objects.
SELECT schemaname, tablename, indexname, indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('participants', 'users', 'qr_codes', 'attendance')
ORDER BY tablename, indexname;

-- 5. RLS flags and policies for all relevant public tables.
SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND c.relname IN ('participants', 'users', 'qr_codes', 'attendance')
ORDER BY table_name;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('participants', 'users', 'qr_codes', 'attendance')
ORDER BY tablename, policyname;

-- 6. Triggers and the functions they invoke (metadata only; no function bodies).
SELECT event_object_schema AS table_schema, event_object_table AS table_name,
       trigger_name, action_timing, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table IN ('participants', 'users', 'qr_codes', 'attendance')
ORDER BY table_name, trigger_name;

SELECT table_n.nspname AS table_schema, table_c.relname AS table_name,
       trigger_c.tgname AS trigger_name, function_n.nspname AS function_schema,
       function_p.proname AS function_name,
       pg_catalog.pg_get_function_identity_arguments(function_p.oid) AS function_arguments
FROM pg_catalog.pg_trigger AS trigger_c
JOIN pg_catalog.pg_class AS table_c ON table_c.oid = trigger_c.tgrelid
JOIN pg_catalog.pg_namespace AS table_n ON table_n.oid = table_c.relnamespace
JOIN pg_catalog.pg_proc AS function_p ON function_p.oid = trigger_c.tgfoid
JOIN pg_catalog.pg_namespace AS function_n ON function_n.oid = function_p.pronamespace
WHERE NOT trigger_c.tgisinternal AND table_n.nspname = 'public'
  AND table_c.relname IN ('participants', 'users', 'qr_codes', 'attendance')
ORDER BY table_name, trigger_name;

-- 7. Actual auth-to-public relationship: direct FKs plus possible mapping columns.
SELECT src_n.nspname AS table_schema, src.relname AS table_name,
       con.conname AS constraint_name, pg_catalog.pg_get_constraintdef(con.oid, true) AS constraint_definition,
       tgt_n.nspname AS referenced_schema, tgt.relname AS referenced_table
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS src ON src.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS src_n ON src_n.oid = src.relnamespace
JOIN pg_catalog.pg_class AS tgt ON tgt.oid = con.confrelid
JOIN pg_catalog.pg_namespace AS tgt_n ON tgt_n.oid = tgt.relnamespace
WHERE (src_n.nspname = 'public' AND src.relname = 'users' AND tgt_n.nspname = 'auth' AND tgt.relname = 'users')
   OR (src_n.nspname = 'auth' AND src.relname = 'users' AND tgt_n.nspname = 'public' AND tgt.relname = 'users')
ORDER BY table_schema, constraint_name;

SELECT table_schema, table_name, column_name, data_type, udt_schema, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users'
  AND (column_name ILIKE '%auth%' OR column_name ILIKE '%user%' OR column_name ILIKE '%email%' OR column_name = 'id')
ORDER BY ordinal_position;

-- 8. Authorization evidence without exposing function definitions or user records.
SELECT schemaname, tablename, policyname, cmd,
       (COALESCE(qual, '') ILIKE '%role%' OR COALESCE(with_check, '') ILIKE '%role%') AS policy_mentions_role
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND (tablename IN ('participants', 'users', 'qr_codes', 'attendance') OR qual ILIKE '%users%' OR with_check ILIKE '%users%')
ORDER BY tablename, policyname;

SELECT n.nspname AS function_schema, p.proname AS function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS function_arguments,
       l.lanname AS language,
       (COALESCE(p.prosrc, '') ILIKE '%role%' OR COALESCE(p.prosrc, '') ILIKE '%public.users%') AS may_reference_role_or_users
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
WHERE n.nspname IN ('public', 'auth')
  AND (COALESCE(p.prosrc, '') ILIKE '%role%' OR COALESCE(p.prosrc, '') ILIKE '%public.users%')
ORDER BY function_schema, function_name;

-- Interpretation rule: only a returned FK, verified mapping column and its implementation,
-- or an explicit authorization policy/function can establish the mapping. Otherwise report:
-- "Authorization mapping remains unverified."

