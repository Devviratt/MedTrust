const {
  logVideoChunk,
  logAudioChunk,
  validateChunkIntegrity,
  detectReplayAttack,
  getAuditLogs,
  getBlockchainIntegrityScore,
  hashChunk,
} = require('../services/blockchainService');
const { query } = require('../config/database');

// POST /api/v1/blockchain/log
const logChunk = async (req, res) => {
  const { stream_id, chunk_data, chunk_type, timestamp } = req.body;
  const doctorId = req.user.id;

  let result;
  if (chunk_type === 'video') {
    result = await logVideoChunk(stream_id, chunk_data, timestamp, doctorId);
  } else if (chunk_type === 'audio') {
    result = await logAudioChunk(stream_id, chunk_data, timestamp, doctorId);
  } else {
    return res.status(400).json({ error: 'chunk_type must be video or audio' });
  }

  res.status(201).json({
    message: 'Chunk logged to blockchain',
    ...result,
    stream_id,
    chunk_type,
    timestamp,
  });
};

// POST /api/v1/blockchain/validate
const validateChunk = async (req, res) => {
  const { stream_id, chunk_data, chunk_type } = req.body;

  const result = await validateChunkIntegrity(stream_id, chunk_data, chunk_type);

  res.json({
    ...result,
    stream_id,
    chunk_type,
    validated_at: new Date().toISOString(),
  });
};

// GET /api/v1/blockchain/audit/:streamId
const getAudit = async (req, res) => {
  const { streamId } = req.params;
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset = Math.max(parseInt(req.query.offset) || 0,  0);

  if (!streamId || streamId.length < 8) {
    return res.status(400).json({ error: 'Invalid stream ID' });
  }

  try {
    // Query blockchain_logs directly — no JOIN to avoid row multiplication
    const logsResult = await query(
      `SELECT id, stream_id, chunk_hash, chunk_type, timestamp, tx_id,
              block_number, sync_status, created_at
         FROM blockchain_logs
         WHERE stream_id = $1
         ORDER BY block_number ASC
         LIMIT $2 OFFSET $3`,
      [streamId, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM blockchain_logs WHERE stream_id = $1`,
      [streamId]
    );

    const integrityScore = await getBlockchainIntegrityScore(streamId);
    const replayStatus   = await detectReplayAttack(streamId);

    return res.json({
      stream_id:       streamId,
      integrity_score: integrityScore,
      replay_status:   replayStatus,
      total:           parseInt(countResult.rows[0]?.total ?? 0),
      pagination:      { limit, offset },
      logs:            logsResult.rows,
    });
  } catch (err) {
    logger.error('[BLOCKCHAIN AUDIT]', { streamId, error: err.message });
    return res.status(500).json({ error: 'Failed to fetch audit log' });
  }
};

// GET /api/v1/blockchain/audit/all
const getAllAuditEvents = async (req, res) => {
  const { page = 1, limit = 50, severity, event_type } = req.query;
  const offset = (page - 1) * limit;

  let queryStr = `SELECT ae.*, d.full_name as doctor_name, d.email as doctor_email
                  FROM audit_events ae
                  LEFT JOIN streams s ON ae.stream_id = s.id
                  LEFT JOIN doctors d ON s.doctor_id = d.id
                  WHERE 1=1`;
  const params = [];

  if (severity) {
    params.push(severity);
    queryStr += ` AND ae.severity = $${params.length}`;
  }
  if (event_type) {
    params.push(event_type);
    queryStr += ` AND ae.event_type = $${params.length}`;
  }

  params.push(limit, offset);
  queryStr += ` ORDER BY ae.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const result = await query(queryStr, params);
  const countResult = await query('SELECT COUNT(*) FROM audit_events', []);

  res.json({
    events: result.rows,
    pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countResult.rows[0].count) },
  });
};

// GET /api/v1/blockchain/hash/:streamId/:chunkData
const computeHash = async (req, res) => {
  const { chunkData } = req.params;
  const hash = hashChunk(chunkData);
  res.json({ hash, algorithm: 'SHA-256' });
};

module.exports = { logChunk, validateChunk, getAudit, getAllAuditEvents, computeHash };
