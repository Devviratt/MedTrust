-- 006_session_state_machine.sql
-- Expand status to full state machine: pending → doctor_verifying → active → completed/blocked

ALTER TABLE streams DROP CONSTRAINT IF EXISTS streams_status_check;
ALTER TABLE streams ADD CONSTRAINT streams_status_check
  CHECK (status IN ('pending','doctor_verifying','active','paused','ended','completed','blocked','error'));
