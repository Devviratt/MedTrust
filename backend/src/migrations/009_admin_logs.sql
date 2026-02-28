-- 009_admin_logs.sql
CREATE TABLE IF NOT EXISTS admin_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  metadata       JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin  ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_target ON admin_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC);

-- Add suspicious_session_count to users if missing (used by patient risk flags)
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspicious_session_count INT NOT NULL DEFAULT 0;
