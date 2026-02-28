-- Fix trust_logs: partitioned tables need partition key in PK
CREATE TABLE IF NOT EXISTS trust_logs (
    id                UUID DEFAULT uuid_generate_v4(),
    stream_id         UUID REFERENCES streams(id) ON DELETE CASCADE,
    trust_score       SMALLINT NOT NULL CHECK (trust_score BETWEEN 0 AND 100),
    video_score       SMALLINT NOT NULL CHECK (video_score BETWEEN 0 AND 100),
    voice_score       SMALLINT NOT NULL CHECK (voice_score BETWEEN 0 AND 100),
    biometric_score   SMALLINT NOT NULL CHECK (biometric_score BETWEEN 0 AND 100),
    blockchain_score  SMALLINT NOT NULL CHECK (blockchain_score BETWEEN 0 AND 100),
    status            VARCHAR(20) NOT NULL DEFAULT 'safe' CHECK (status IN ('safe','suspicious','alert')),
    raw_data          JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS trust_logs_2025 PARTITION OF trust_logs
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS trust_logs_2026_q1 PARTITION OF trust_logs
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS trust_logs_2026_q2 PARTITION OF trust_logs
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS trust_logs_2026_q3 PARTITION OF trust_logs
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS trust_logs_2026_q4 PARTITION OF trust_logs
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS trust_logs_future PARTITION OF trust_logs
    FOR VALUES FROM ('2027-01-01') TO ('2030-01-01');

CREATE INDEX IF NOT EXISTS idx_trust_logs_stream ON trust_logs(stream_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trust_logs_status ON trust_logs(status);
CREATE INDEX IF NOT EXISTS idx_trust_logs_created ON trust_logs(created_at DESC);
