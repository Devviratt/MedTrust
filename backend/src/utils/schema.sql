-- MedTrust AI - PostgreSQL Schema
-- Run this file to initialize the database

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Doctors ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    full_name       VARCHAR(100) NOT NULL,
    department      VARCHAR(100) NOT NULL,
    specialization  VARCHAR(100),
    license_number  VARCHAR(50) UNIQUE NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'doctor' CHECK (role IN ('admin','doctor','nurse','viewer')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctors_email ON doctors(email);
CREATE INDEX IF NOT EXISTS idx_doctors_role ON doctors(role);
CREATE INDEX IF NOT EXISTS idx_doctors_department ON doctors(department);

-- ─── Voice Embeddings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_embeddings (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id        UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    embedding_vector JSONB NOT NULL,
    model_version    VARCHAR(50) NOT NULL DEFAULT '1.0',
    sample_count     INTEGER NOT NULL DEFAULT 0,
    trained_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_doctor_embedding UNIQUE (doctor_id)
);

CREATE INDEX IF NOT EXISTS idx_voice_embeddings_doctor ON voice_embeddings(doctor_id);

-- ─── Streams ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS streams (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id   UUID REFERENCES doctors(id) ON DELETE SET NULL,
    patient_id  VARCHAR(100),
    icu_room    VARCHAR(50),
    status      VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended','error')),
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at    TIMESTAMPTZ,
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_streams_doctor ON streams(doctor_id);
CREATE INDEX IF NOT EXISTS idx_streams_status ON streams(status);
CREATE INDEX IF NOT EXISTS idx_streams_started ON streams(started_at DESC);

-- ─── Trust Logs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trust_logs (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id         UUID REFERENCES streams(id) ON DELETE CASCADE,
    trust_score       SMALLINT NOT NULL CHECK (trust_score BETWEEN 0 AND 100),
    video_score       SMALLINT NOT NULL CHECK (video_score BETWEEN 0 AND 100),
    voice_score       SMALLINT NOT NULL CHECK (voice_score BETWEEN 0 AND 100),
    biometric_score   SMALLINT NOT NULL CHECK (biometric_score BETWEEN 0 AND 100),
    blockchain_score  SMALLINT NOT NULL CHECK (blockchain_score BETWEEN 0 AND 100),
    status            VARCHAR(20) NOT NULL DEFAULT 'safe' CHECK (status IN ('safe','suspicious','alert')),
    raw_data          JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Create partitions for trust_logs (monthly)
CREATE TABLE IF NOT EXISTS trust_logs_2025_01 PARTITION OF trust_logs
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE IF NOT EXISTS trust_logs_2025_02 PARTITION OF trust_logs
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE IF NOT EXISTS trust_logs_2026_01 PARTITION OF trust_logs
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS trust_logs_2026_02 PARTITION OF trust_logs
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS trust_logs_2026_03 PARTITION OF trust_logs
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS trust_logs_future PARTITION OF trust_logs
    FOR VALUES FROM ('2026-04-01') TO ('2030-01-01');

CREATE INDEX IF NOT EXISTS idx_trust_logs_stream ON trust_logs(stream_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trust_logs_status ON trust_logs(status);
CREATE INDEX IF NOT EXISTS idx_trust_logs_created ON trust_logs(created_at DESC);

-- ─── Blockchain Logs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blockchain_logs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id     UUID REFERENCES streams(id) ON DELETE CASCADE,
    chunk_hash    VARCHAR(64) NOT NULL,
    chunk_type    VARCHAR(10) NOT NULL CHECK (chunk_type IN ('video','audio')),
    timestamp     TIMESTAMPTZ NOT NULL,
    tx_id         VARCHAR(255),
    block_number  BIGINT,
    sync_status   VARCHAR(20) DEFAULT 'synced',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blockchain_stream ON blockchain_logs(stream_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_hash ON blockchain_logs(chunk_hash);
CREATE INDEX IF NOT EXISTS idx_blockchain_tx ON blockchain_logs(tx_id);

-- ─── Audit Events ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_events (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id   UUID REFERENCES streams(id) ON DELETE SET NULL,
    event_type  VARCHAR(50) NOT NULL,
    severity    VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
    details     JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_stream ON audit_events(stream_id);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_events(severity);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);

-- ─── Admin Configurations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_configurations (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_key    VARCHAR(100) UNIQUE NOT NULL,
    config_value  TEXT NOT NULL,
    description   TEXT,
    updated_by    UUID REFERENCES doctors(id) ON DELETE SET NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default configuration values
INSERT INTO admin_configurations (config_key, config_value, description) VALUES
    ('video_weight',          '0.40',  'Weight of video authenticity in trust score'),
    ('voice_weight',          '0.30',  'Weight of voice authenticity in trust score'),
    ('biometric_weight',      '0.20',  'Weight of biometric sync in trust score'),
    ('blockchain_weight',     '0.10',  'Weight of blockchain integrity in trust score'),
    ('safe_threshold',        '75',    'Minimum score to be classified as safe'),
    ('suspicious_threshold',  '50',    'Minimum score to be classified as suspicious (below = alert)'),
    ('video_threshold',       '0.60',  'AI model threshold for video deepfake detection'),
    ('voice_threshold',       '0.65',  'AI model threshold for voice deepfake detection'),
    ('biometric_threshold',   '0.70',  'Biometric sync correlation threshold')
ON CONFLICT (config_key) DO NOTHING;

-- ─── Updated At Trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_doctors_updated_at BEFORE UPDATE ON doctors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Default Admin User (change password immediately) ─────────────────────────
-- Password: Admin@MedTrust2024! (bcrypt hash, rounds=12)
INSERT INTO doctors (id, email, password_hash, full_name, department, license_number, role)
VALUES (
    uuid_generate_v4(),
    'admin@medtrust.ai',
    '$2a$12$3jOTOyaDGPi0mOTAR.QYG.i1TMgpY0rudLk70sNaLfP1IDDsb2UE6',
    'System Administrator',
    'Administration',
    'ADMIN-001',
    'admin'
) ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;
