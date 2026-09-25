# MSA SRM Event — QR Attendance Integration Contract & Specification
**Module:** `/qr-attendance/`  
**Status:** DRAFT / PROPOSED (Updated with Direct Schema Discovery Findings)  
**Security Level:** Production-Critical / Shared Database

---

## 1. Overview & Responsibility Boundary

This contract specifies the boundary between the **Event Registration System** (shared production tables) and the **QR Attendance System** (this isolated module).

- **Registration System Responsibility:**
  - Participant registration & data validation in `public.participants`.
  - User and staff records in `public.users`.
  - Main website and event database source of truth.
  - Calling the QR module immediately after a participant is successfully registered.
  - Delivering the QR code to the participant (via email, ticket portal, or badge).

- **QR Attendance Module Responsibility:**
  - Cryptographically secure QR token generation.
  - Secure storage of token hashes in `public.qr_codes`.
  - Check-in API endpoint (`POST /api/checkin`) consumed by the scanner.
  - Atomic attendance recording in `public.attendance`.
  - Database-enforced duplicate check-in prevention (`UNIQUE(participant_id)`).
  - Mobile-friendly scanner integration.

---

## 2. Discovered Shared Production Schema

From direct read-only inspection of the shared Supabase production database:

### 2.1 Table: `public.participants`
| Column | Type | Role | Notes |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT / int8` | **PRIMARY KEY** | Unique participant identifier. |
| `name` | `TEXT` | Attribute | Participant's full name. |
| `email` | `TEXT` | Attribute | Participant's contact email. |
| `team_name` | `TEXT` | Attribute | Team name string (NO separate teams table foreign key). |
| `status` | `TEXT` | Attribute | Registration status (e.g. registered, confirmed). |
| `created_at` | `TIMESTAMPTZ` | Timestamp | Record creation timestamp. |

*Safety Directive: The QR module will NEVER alter, rename, drop, or insert into `public.participants`.*

### 2.2 Table: `public.users`
| Column | Type | Role | Notes |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT / int8` | **PRIMARY KEY** | User identifier. |
| `full_name` | `TEXT` | Attribute | User's full name. |
| `email` | `TEXT` | Attribute | User's email. |
| `role` | `TEXT` | Role descriptor | Candidate for identifying MSA/admin officials (pending verification). |
| `created_at` | `TIMESTAMPTZ` | Timestamp | Account creation timestamp. |

*Safety Directive: The QR module will NEVER alter, rename, drop, or insert into `public.users`.*

---

## 3. Cryptographic Token Generation & Storage

### 3.1 Token Generation
- **Method:** 32 bytes of cryptographically secure pseudo-randomness generated server-side:
  ```typescript
  import crypto from 'node:crypto';
  const rawToken = crypto.randomBytes(32).toString('hex'); // 64 hex characters (256 bits entropy)
  ```
- **Prohibitions:** Tokens are NEVER generated using participant names, emails, phone numbers, timestamps, sequential IDs, or predictable pseudo-random generators (`Math.random()`).
- **QR Payload Format:**
  `https://<event-domain>/checkin?t=<rawToken>`
  *(The QR payload contains ONLY the unguessable token parameter `t`. No participant or team details are encoded in the QR).*

### 3.2 Secure Token Storage (Hashed)
- The raw token is **never stored in plaintext** in Supabase.
- The server stores the SHA-256 digest:
  ```typescript
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  ```
- **Security Guarantee:** If a database read-only leak occurs, raw tokens cannot be recovered or forged.

---

## 4. Proposed Database Objects (Pending User Explicit Approval)

*NOTE: These tables will ONLY be created after user explicitly approves the SQL migration.*

```sql
-- ====================================================================
-- MODULE: qr-attendance
-- PURPOSE: Isolated QR Token Storage & Strict Attendance Verification
-- INTEGRATION: References public.participants(id) [BIGINT]
-- SAFETY: Creates ONLY new isolated tables. Zero modification to existing data.
-- ====================================================================

-- 1. QR Codes Table
CREATE TABLE IF NOT EXISTS public.qr_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id BIGINT NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_qr_codes_token_hash UNIQUE (token_hash)
);

-- Partial index: strictly 1 active QR code per participant
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_qr_per_participant 
    ON public.qr_codes (participant_id) 
    WHERE is_active = true;

-- Index for fast token hash lookups
CREATE INDEX IF NOT EXISTS idx_qr_codes_token_hash 
    ON public.qr_codes (token_hash);

-- 2. Attendance Table
CREATE TABLE IF NOT EXISTS public.attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id BIGINT NOT NULL REFERENCES public.participants(id) ON DELETE RESTRICT,
    qr_id UUID REFERENCES public.qr_codes(id) ON DELETE RESTRICT,
    checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    scanned_by TEXT, -- Stores scanning official identity (e.g., users.id or auth user identifier)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_attendance_participant UNIQUE (participant_id) -- HARD CONSTRAINT: Zero duplicate attendance
);

-- Index for rapid participant attendance lookups
CREATE INDEX IF NOT EXISTS idx_attendance_participant_id 
    ON public.attendance (participant_id);

-- 3. Row Level Security (RLS)
ALTER TABLE public.qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
```

---

## 5. Duplicate & Concurrent Check-In Protection

1. **Database-Level Enforced Uniqueness:**
   - `CONSTRAINT uq_attendance_participant UNIQUE (participant_id)` ensures PostgreSQL strictly refuses to store more than one attendance record for any participant.
2. **Race Condition Immunity:**
   - If two officials scan the same participant at the exact same millisecond across different devices, PostgreSQL's row-level lock on the unique index guarantees that one transaction succeeds and the other immediately encounters error code `23505` (unique violation).
3. **Graceful Handling:**
   - The check-in backend catches code `23505`, fetches the existing check-in timestamp, and returns:
     ```json
     {
       "status": "already_checked_in",
       "participant": "<PARTICIPANT_NAME>",
       "team": "<TEAM_NAME>",
       "checkedInAt": "<CHECKED_IN_TIMESTAMP>"
     }
     ```

---

## 6. API Specifications

### 6.1 Registration → QR Generation Hook
Used by the registration service immediately after a participant record is created in `public.participants`.

- **Direct In-Code Function (Recommended):**
  ```typescript
  import { generateParticipantQR } from './qr-attendance/src/services/qrService';

  // Inside participant registration handler:
  const qrResult = await generateParticipantQR(participant.id); // participant.id is BIGINT
  // Returns:
  // {
  //   qrCodeId: "<QR_RECORD_UUID>",
  //   token: "<RAW_TOKEN>",
  //   qrPayload: "https://<event-domain>/checkin?t=<RAW_TOKEN>"
  // }
  ```

- **Internal HTTP Endpoint:**
  - **Endpoint:** `POST /api/qr/generate`
  - **Headers:** `Content-Type: application/json`, `x-internal-secret: <INTERNAL_API_SECRET>`
  - **Request Body:**
    ```json
    {
      "participantId": "<PARTICIPANT_ID>"
    }
    ```
  - **Response (201 Created):**
    ```json
    {
      "status": "success",
      "participantId": "<PARTICIPANT_ID>",
      "qrCodeId": "<QR_RECORD_UUID>",
      "qrPayload": "https://<event-domain>/checkin?t=<RAW_TOKEN>",
      "token": "<RAW_TOKEN>"
    }
    ```

---

### 6.2 Scanner → Check-In API
Used by authorized MSA officials/event staff scanning badges at the venue.

- **Endpoint:** `POST /api/checkin`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <AUTH_TOKEN>`
- **Request Body:**
  ```json
  {
    "token": "<RAW_SCANNED_TOKEN>"
  }
  ```

- **Server Verification Flow:**
  1. Authenticate scanner official.
  2. Compute `hash = sha256(token)`.
  3. Query `qr_codes WHERE token_hash = hash AND is_active = true`.
  4. If not found -> Return `400 Bad Request` (`status: "invalid_qr"`).
  5. Check if `participant_id` already exists in `attendance`:
     - If exists -> Return `200 OK` (`status: "already_checked_in"`).
  6. Attempt atomic insert into `attendance` with `participant_id = qr.participant_id`, `scanned_by = official.id`.
  7. Fetch participant `name` and `team_name` directly from `public.participants WHERE id = qr.participant_id`.
  8. Return `200 OK` (`status: "success"`).

- **Responses:**
  - **Success (First Scan):**
    ```json
    {
      "status": "success",
      "participant": "<PARTICIPANT_NAME>",
      "team": "<TEAM_NAME>",
      "checkedInAt": "<CHECKED_IN_TIMESTAMP>"
    }
    ```
  - **Duplicate Scan (Already Checked In):**
    ```json
    {
      "status": "already_checked_in",
      "participant": "<PARTICIPANT_NAME>",
      "team": "<TEAM_NAME>",
      "checkedInAt": "<CHECKED_IN_TIMESTAMP>"
    }
    ```
  - **Invalid / Tampered QR:**
    ```json
    {
      "status": "invalid_qr",
      "message": "QR code is invalid or deactivated."
    }
    ```
  - **Unauthorized:**
    ```json
    {
      "status": "unauthorized",
      "message": "Only authorized officials may check in participants."
    }
    ```
