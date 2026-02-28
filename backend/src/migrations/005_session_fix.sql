-- 005_session_fix.sql — Fix streams status constraint + add missing tables/columns

-- 1. Expand streams status to include pending + blocked
ALTER TABLE streams DROP CONSTRAINT IF EXISTS streams_status_check;
ALTER TABLE streams ADD CONSTRAINT streams_status_check
  CHECK (status IN ('pending','active','paused','ended','blocked','error'));

-- 2. Ensure patient_id FK exists
ALTER TABLE streams DROP CONSTRAINT IF EXISTS streams_patient_id_fkey;
ALTER TABLE streams ADD CONSTRAINT streams_patient_id_fkey
  FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE SET NULL;

-- 3. Add trust_score to streams
ALTER TABLE streams ADD COLUMN IF NOT EXISTS trust_score NUMERIC(5,2) DEFAULT 0;

-- 4. Add doctor_notes to streams for session context
ALTER TABLE streams ADD COLUMN IF NOT EXISTS doctor_notes TEXT;

-- 5. Extend users with biometric + risk tracking
ALTER TABLE users ADD COLUMN IF NOT EXISTS biometric_enrolled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS risk_score NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspicious_session_count INT NOT NULL DEFAULT 0;

-- 6. Create verification_logs table
CREATE TABLE IF NOT EXISTS verification_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stream_id       UUID REFERENCES streams(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  face_score      NUMERIC(5,2) NOT NULL DEFAULT 0,
  voice_score     NUMERIC(5,2) NOT NULL DEFAULT 0,
  biometric_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  liveness_score  NUMERIC(5,2) NOT NULL DEFAULT 0,
  motion_score    NUMERIC(5,2) NOT NULL DEFAULT 0,
  final_trust     NUMERIC(5,2) NOT NULL DEFAULT 0,
  passed          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vlog_stream ON verification_logs(stream_id);
CREATE INDEX IF NOT EXISTS idx_vlog_user   ON verification_logs(user_id);

-- 7. Update existing biometric_enrolled on users that have impersonation_baselines
UPDATE users u
SET biometric_enrolled = TRUE
WHERE EXISTS (
  SELECT 1 FROM impersonation_baselines ib
  WHERE ib.doctor_id = u.id
    AND (ib.face_hash IS NOT NULL OR ib.face_embedding IS NOT NULL)
);
