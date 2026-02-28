-- 007_biometric_enrollment.sql
-- Mandatory biometric enrollment for doctors

-- Add enrollment_status to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS enrollment_status TEXT NOT NULL DEFAULT 'pending_enrollment'
  CHECK (enrollment_status IN ('pending_enrollment','pending_admin_approval','approved','suspended'));

-- Doctors already approved (admin + existing verified doctors) get approved status
UPDATE users SET enrollment_status = 'approved'
WHERE role = 'admin';

UPDATE users u SET enrollment_status = 'approved'
WHERE u.role = 'doctor'
  AND EXISTS (
    SELECT 1 FROM doctor_profiles dp
    WHERE dp.user_id = u.id AND dp.verified_status = 'verified'
  );

UPDATE users u SET enrollment_status = 'pending_admin_approval'
WHERE u.role = 'doctor'
  AND u.biometric_enrolled = TRUE
  AND u.enrollment_status = 'pending_enrollment';

-- Doctor biometrics storage table
CREATE TABLE IF NOT EXISTS doctor_biometrics (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  face_embedding      JSONB,
  face_hash           TEXT,
  voice_embedding     JSONB,
  voice_hash          TEXT,
  baseline_bpm        NUMERIC(6,2),
  bpm_range_low       NUMERIC(6,2),
  bpm_range_high      NUMERIC(6,2),
  enrollment_location JSONB,
  liveness_passed     BOOLEAN NOT NULL DEFAULT FALSE,
  quality_score       NUMERIC(5,2),
  enrolled_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doctor_id)
);

CREATE INDEX IF NOT EXISTS idx_doctor_biometrics_doctor ON doctor_biometrics(doctor_id);
