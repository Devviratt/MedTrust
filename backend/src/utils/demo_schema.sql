-- Demo-only in-memory schema (pg-mem)
-- Enables running the API gateway without Postgres/Redis installed.

CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY,
  name              TEXT NOT NULL,
  email             TEXT UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('admin','doctor','patient')),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  biometric_enrolled BOOLEAN NOT NULL DEFAULT FALSE,
  enrollment_status TEXT NOT NULL DEFAULT 'approved',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS doctor_profiles (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialization   TEXT,
  license_number   TEXT UNIQUE,
  hospital_name    TEXT,
  years_experience INT DEFAULT 0,
  photo_url        TEXT,
  verified_status  TEXT NOT NULL DEFAULT 'verified' CHECK (verified_status IN ('pending','verified','suspended')),
  risk_score       NUMERIC(5,2) DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  assigned_doctor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  health_id          TEXT UNIQUE,
  condition_notes    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS streams (
  id         UUID PRIMARY KEY,
  doctor_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  patient_id UUID REFERENCES users(id) ON DELETE SET NULL,
  icu_room   TEXT,
  status     TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  ended_at   TIMESTAMPTZ,
  metadata   JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trust_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id        UUID REFERENCES streams(id) ON DELETE CASCADE,
  trust_score      SMALLINT NOT NULL DEFAULT 100,
  video_score      SMALLINT NOT NULL DEFAULT 100,
  voice_score      SMALLINT NOT NULL DEFAULT 100,
  biometric_score  SMALLINT NOT NULL DEFAULT 100,
  blockchain_score SMALLINT NOT NULL DEFAULT 100,
  status           TEXT NOT NULL DEFAULT 'safe' CHECK (status IN ('safe','suspicious','alert')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id  UUID REFERENCES streams(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity   TEXT NOT NULL DEFAULT 'info',
  details    JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id   UUID REFERENCES streams(id) ON DELETE CASCADE,
  report_data JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doctor_biometrics (
  doctor_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  face_embedding JSONB,
  face_hash    TEXT,
  voice_embedding JSONB,
  voice_hash   TEXT,
  baseline_bpm NUMERIC,
  bpm_range_low NUMERIC,
  bpm_range_high NUMERIC,
  enrollment_location JSONB,
  liveness_passed BOOLEAN DEFAULT FALSE,
  quality_score NUMERIC,
  enrolled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS impersonation_baselines (
  doctor_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  face_hash      TEXT,
  voice_hash     TEXT,
  face_embedding JSONB,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed users
-- Password for admin: Admin@MedTrust2024! (bcrypt hash, rounds=12)
INSERT INTO users (id, name, email, password_hash, role, is_active, biometric_enrolled, enrollment_status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'System Administrator',
  'admin@medtrust.ai',
  '$2a$12$3jOTOyaDGPi0mOTAR.QYG.i1TMgpY0rudLk70sNaLfP1IDDsb2UE6',
  'admin',
  TRUE,
  TRUE,
  'approved'
)
ON CONFLICT (email) DO NOTHING;

-- Demo verified doctor (so patients can browse/connect)
-- Password: Doctor@1234 (bcrypt hash, rounds=12)
INSERT INTO users (id, name, email, password_hash, role, is_active, biometric_enrolled, enrollment_status)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Dr. Demo Verified',
  'doctor@medtrust.ai',
  '$2a$12$THjoHfnM8qG7wVgXM1PtOuEMeTLmJcftKJDtEEvZpYBG5gPx2rkTi',
  'doctor',
  TRUE,
  TRUE,
  'approved'
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO doctor_profiles (user_id, specialization, license_number, hospital_name, verified_status, years_experience)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Critical Care',
  'DEMO-DOCTOR-001',
  'MedTrust Demo Hospital',
  'verified',
  8
)
ON CONFLICT (user_id) DO NOTHING;

-- Demo patient profile placeholder (created on register-self normally)
