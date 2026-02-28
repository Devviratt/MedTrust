const axios = require('axios');
const crypto = require('crypto');
const { query } = require('../config/database');
const { setCache, getCache } = require('../config/redis');
const { logger } = require('../middleware/errorHandler');

const BLOCKCHAIN_API = process.env.BLOCKCHAIN_API_URL || 'http://localhost:8080';
const CHANNEL = process.env.BLOCKCHAIN_CHANNEL || 'medtrust-channel';
const CHAINCODE = process.env.BLOCKCHAIN_CHAINCODE || 'medtrust-cc';

const hashChunk = (data) => {
  return crypto.createHash('sha256').update(data).digest('hex');
};

const logVideoChunk = async (streamId, chunkData, timestamp, doctorId) => {
  const hash = hashChunk(chunkData);
  const payload = {
    channel: CHANNEL,
    chaincode: CHAINCODE,
    function: 'LogVideoChunk',
    args: [streamId, hash, timestamp.toString(), doctorId],
  };

  try {
    const response = await axios.post(`${BLOCKCHAIN_API}/invoke`, payload, { timeout: 5000 });

    await query(
      `INSERT INTO blockchain_logs (stream_id, chunk_hash, chunk_type, timestamp, tx_id, block_number)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [streamId, hash, 'video', new Date(timestamp), response.data.txId, response.data.blockNumber]
    );

    return { hash, txId: response.data.txId, blockNumber: response.data.blockNumber };
  } catch (err) {
    logger.error('Blockchain video log error:', err.message);
    // Store locally if blockchain unavailable
    await query(
      `INSERT INTO blockchain_logs (stream_id, chunk_hash, chunk_type, timestamp, tx_id, sync_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [streamId, hash, 'video', new Date(timestamp), 'pending', 'unsynced']
    );
    return { hash, txId: null, error: 'Blockchain unavailable, stored locally' };
  }
};

const logAudioChunk = async (streamId, audioData, timestamp, doctorId) => {
  const hash = hashChunk(audioData);
  const payload = {
    channel: CHANNEL,
    chaincode: CHAINCODE,
    function: 'LogAudioChunk',
    args: [streamId, hash, timestamp.toString(), doctorId],
  };

  try {
    const response = await axios.post(`${BLOCKCHAIN_API}/invoke`, payload, { timeout: 5000 });

    await query(
      `INSERT INTO blockchain_logs (stream_id, chunk_hash, chunk_type, timestamp, tx_id, block_number)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [streamId, hash, 'audio', new Date(timestamp), response.data.txId, response.data.blockNumber]
    );

    return { hash, txId: response.data.txId, blockNumber: response.data.blockNumber };
  } catch (err) {
    logger.error('Blockchain audio log error:', err.message);
    await query(
      `INSERT INTO blockchain_logs (stream_id, chunk_hash, chunk_type, timestamp, tx_id, sync_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [streamId, hash, 'audio', new Date(timestamp), 'pending', 'unsynced']
    );
    return { hash, txId: null, error: 'Blockchain unavailable, stored locally' };
  }
};

const validateChunkIntegrity = async (streamId, chunkData, chunkType) => {
  const hash = hashChunk(chunkData);
  const cacheKey = `blockchain:validate:${streamId}:${hash}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.post(
      `${BLOCKCHAIN_API}/query`,
      {
        channel: CHANNEL,
        chaincode: CHAINCODE,
        function: 'ValidateChunk',
        args: [streamId, hash, chunkType],
      },
      { timeout: 5000 }
    );

    const result = {
      valid: response.data.valid,
      hash,
      recorded_at: response.data.timestamp,
      block_number: response.data.blockNumber,
      score: response.data.valid ? 1.0 : 0.0,
    };

    await setCache(cacheKey, result, 30);
    return result;
  } catch (err) {
    logger.error('Blockchain validation error:', err.message);
    // Fallback: check local DB
    const localResult = await query(
      'SELECT * FROM blockchain_logs WHERE stream_id = $1 AND chunk_hash = $2',
      [streamId, hash]
    );
    return {
      valid: localResult.rows.length > 0,
      hash,
      source: 'local_fallback',
      score: localResult.rows.length > 0 ? 0.8 : 0.0,
    };
  }
};

const detectReplayAttack = async (streamId) => {
  try {
    const response = await axios.post(
      `${BLOCKCHAIN_API}/query`,
      {
        channel: CHANNEL,
        chaincode: CHAINCODE,
        function: 'DetectReplay',
        args: [streamId],
      },
      { timeout: 5000 }
    );

    if (response.data.replayDetected) {
      await query(
        `INSERT INTO audit_events (stream_id, event_type, severity, details)
         VALUES ($1, $2, $3, $4)`,
        [streamId, 'REPLAY_ATTACK', 'critical', JSON.stringify(response.data)]
      );
      logger.warn('Replay attack detected', { streamId, data: response.data });
    }

    return response.data;
  } catch (err) {
    logger.debug('Replay detection unavailable (external service):', err.message);
    return { replayDetected: false, error: err.message };
  }
};

const getAuditLogs = async (streamId, limit = 50, offset = 0) => {
  try {
    const response = await axios.get(
      `${BLOCKCHAIN_API}/history/${streamId}?limit=${limit}&offset=${offset}`,
      { timeout: 5000 }
    );
    return response.data;
  } catch (err) {
    logger.warn('Blockchain audit fetch failed, falling back to local:', err.message);
    const result = await query(
      `SELECT bl.*, ae.event_type, ae.severity 
       FROM blockchain_logs bl
       LEFT JOIN audit_events ae ON bl.stream_id = ae.stream_id
       WHERE bl.stream_id = $1
       ORDER BY bl.created_at DESC
       LIMIT $2 OFFSET $3`,
      [streamId, limit, offset]
    );
    return { logs: result.rows, source: 'local' };
  }
};

const getBlockchainIntegrityScore = async (streamId) => {
  const result = await query(
    `SELECT 
       COUNT(*) as total_chunks,
       COUNT(CASE WHEN sync_status != 'unsynced' THEN 1 END) as synced_chunks,
       COUNT(CASE WHEN tx_id IS NOT NULL THEN 1 END) as confirmed_chunks
     FROM blockchain_logs WHERE stream_id = $1`,
    [streamId]
  );

  const row = result.rows[0];
  const total = parseInt(row.total_chunks) || 1;
  const confirmed = parseInt(row.confirmed_chunks) || 0;
  return confirmed / total;
};

module.exports = {
  logVideoChunk,
  logAudioChunk,
  validateChunkIntegrity,
  detectReplayAttack,
  getAuditLogs,
  getBlockchainIntegrityScore,
  hashChunk,
};
