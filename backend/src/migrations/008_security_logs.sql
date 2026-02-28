-- 008_security_logs.sql
CREATE TABLE IF NOT EXISTS security_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID REFERENCES streams(id) ON DELETE SET NULL,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  role           TEXT,
  violation_type TEXT NOT NULL,
  risk_score     NUMERIC(5,2),
  location       JSONB,
  metadata       JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_logs_session  ON security_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_user     ON security_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_created  ON security_logs(created_at DESC);
