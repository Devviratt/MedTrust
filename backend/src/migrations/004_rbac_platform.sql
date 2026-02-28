-- ============================================================
-- Migration 004: RBAC Platform Upgrade
-- Adds: users table, patient_profiles, doctor_profiles (linked),
--       ai_thresholds, impersonation_baselines, session_reports
-- ============================================================

-- Unified users table (ADMIN / DOCTOR / PATIENT)
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'doctor', 'patient')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

-- Doctor profiles (linked to users)
CREATE TABLE IF NOT EXISTS doctor_profiles (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialization   TEXT,
  license_number   TEXT UNIQUE,
  hospital_name    TEXT,
  years_experience INT DEFAULT 0,
  photo_url        TEXT,
  verified_status  TEXT NOT NULL DEFAULT 'pending' CHECK (verified_status IN ('pending','verified','suspended')),
  risk_score       NUMERIC(5,2) DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Patient profiles (linked to users)
CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  assigned_doctor_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  health_id           TEXT UNIQUE,
  condition_notes     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_patient_doctor ON patient_profiles(assigned_doctor_id);

-- AI thresholds table (admin-managed, read by trust engine)
CREATE TABLE IF NOT EXISTS ai_thresholds (
  key         TEXT PRIMARY KEY,
  value       NUMERIC NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default thresholds
INSERT INTO ai_thresholds (key, value, description) VALUES
  ('min_safe_score',          75,   'Minimum trust score to classify as safe'),
  ('suspicious_score',        50,   'Trust score below which session is suspicious'),
  ('alert_score',             50,   'Trust score below which critical alert triggers'),
  ('video_drop_threshold',    30,   'Single-frame video drop that triggers alert'),
  ('biometric_variance_limit', 40,  'Biometric score below which alert triggers'),
  ('voice_flatness_limit',    40,   'Voice score below which alert triggers'),
  ('video_weight',            0.40, 'Weight for video integrity module'),
  ('voice_weight',            0.30, 'Weight for voice authenticity module'),
  ('biometric_weight',        0.20, 'Weight for biometric sync module'),
  ('blockchain_weight',       0.10, 'Weight for blockchain integrity module'),
  ('impersonation_threshold', 0.70, 'Similarity below which impersonation flagged')
ON CONFLICT (key) DO NOTHING;

-- Impersonation baselines (face + voice fingerprint per doctor)
CREATE TABLE IF NOT EXISTS impersonation_baselines (
  doctor_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  face_hash         TEXT,
  voice_hash        TEXT,
  face_embedding    JSONB,
  similarity_scores JSONB DEFAULT '[]',
  established_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Session reports (generated on stream end)
CREATE TABLE IF NOT EXISTS session_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id         UUID REFERENCES streams(id) ON DELETE CASCADE,
  avg_trust_score   NUMERIC(5,2),
  min_trust_score   NUMERIC(5,2),
  max_trust_score   NUMERIC(5,2),
  alert_count       INT DEFAULT 0,
  blockchain_valid  BOOLEAN DEFAULT TRUE,
  impersonation_risk TEXT DEFAULT 'LOW',
  total_frames      INT DEFAULT 0,
  report_data       JSONB,
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_session_reports_stream ON session_reports(stream_id);

-- Add patient_id column to streams if not present
ALTER TABLE streams ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Backfill: migrate existing doctors table rows into users table
-- (only if doctors table exists and users is empty for doctors)
INSERT INTO users (id, name, email, password_hash, role, is_active, created_at, last_login)
SELECT
  d.id,
  d.full_name,
  d.email,
  d.password_hash,
  CASE WHEN d.role = 'admin' THEN 'admin' ELSE 'doctor' END,
  d.is_active,
  d.created_at,
  d.last_login
FROM doctors d
ON CONFLICT (id) DO NOTHING;

-- Backfill doctor_profiles from doctors table
INSERT INTO doctor_profiles (user_id, specialization, license_number, hospital_name, verified_status)
SELECT
  d.id,
  d.specialization,
  d.license_number,
  d.department,
  'verified'
FROM doctors d
ON CONFLICT (user_id) DO NOTHING;
