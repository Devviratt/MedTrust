const { query } = require('../config/database');
const { deleteCache } = require('../config/redis');
const { logger } = require('../middleware/errorHandler');
const { v4: uuidv4 } = require('uuid');

// GET /api/v1/admin/config
const getConfig = async (req, res) => {
  const result = await query(
    'SELECT config_key, config_value, description, updated_at FROM admin_configurations ORDER BY config_key'
  );

  const config = {};
  result.rows.forEach((row) => {
    config[row.config_key] = {
      value: parseFloat(row.config_value) || row.config_value,
      description: row.description,
      updated_at: row.updated_at,
    };
  });

  res.json(config);
};

// PUT /api/v1/admin/config
const updateConfig = async (req, res) => {
  const updates = req.body;
  const adminId = req.user.id;

  const allowedKeys = [
    'video_threshold', 'voice_threshold', 'biometric_threshold',
    'alert_threshold', 'suspicious_threshold',
    'video_weight', 'voice_weight', 'biometric_weight', 'blockchain_weight',
  ];

  const filteredUpdates = Object.entries(updates).filter(([k]) => allowedKeys.includes(k));

  for (const [key, value] of filteredUpdates) {
    await query(
      `INSERT INTO admin_configurations (config_key, config_value, updated_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (config_key) DO UPDATE
       SET config_value = EXCLUDED.config_value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [key, value.toString(), adminId]
    );
  }

  // Invalidate config cache
  await deleteCache('admin:config');

  await query(
    `INSERT INTO audit_events (event_type, severity, details) VALUES ($1, $2, $3)`,
    ['CONFIG_UPDATED', 'info', JSON.stringify({ admin_id: adminId, updates: filteredUpdates })]
  );

  logger.info('Admin config updated', { adminId, updates: filteredUpdates.map(([k]) => k) });

  res.json({ message: 'Configuration updated', updated_keys: filteredUpdates.map(([k]) => k) });
};

// GET /api/v1/admin/dashboard
const getDashboardStats = async (req, res) => {
  try {
    const [doctorStats, streamStats, alertStats, trustStats] = await Promise.all([
      query('SELECT COUNT(*) as total, COUNT(CASE WHEN is_active THEN 1 END) as active FROM doctors')
        .catch(() => ({ rows: [{ total: 0, active: 0 }] })),
      query(`SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'active' THEN 1 END) as active FROM streams`)
        .catch(() => ({ rows: [{ total: 0, active: 0 }] })),
      query(`SELECT COUNT(*) as total FROM audit_events WHERE severity = 'critical' AND created_at > NOW() - INTERVAL '24 hours'`)
        .catch(() => ({ rows: [{ total: 0 }] })),
      query(`SELECT AVG(trust_score) as avg_score, MIN(trust_score) as min_score, MAX(trust_score) as max_score,
                    COUNT(CASE WHEN status = 'alert' THEN 1 END) as alert_count
             FROM trust_logs WHERE created_at > NOW() - INTERVAL '24 hours'`)
        .catch(() => ({ rows: [{ avg_score: null, min_score: null, max_score: null, alert_count: 0 }] })),
    ]);

    const d = doctorStats.rows[0] || {};
    const s = streamStats.rows[0]  || {};
    const a = alertStats.rows[0]   || {};
    const t = trustStats.rows[0]   || {};

    return res.json({
      doctors: {
        total:  parseInt(d.total)  || 0,
        active: parseInt(d.active) || 0,
      },
      streams: {
        total:  parseInt(s.total)  || 0,
        active: parseInt(s.active) || 0,
      },
      alerts_24h: parseInt(a.total) || 0,
      trust_score_24h: {
        avg:         parseFloat(t.avg_score)   || 0,
        min:         parseFloat(t.min_score)   || 0,
        max:         parseFloat(t.max_score)   || 0,
        alert_count: parseInt(t.alert_count)   || 0,
      },
    });
  } catch (err) {
    logger.error('[ADMIN DASHBOARD ERROR]', { error: err.message });
    return res.status(500).json({
      error: 'Failed to fetch dashboard stats',
      doctors: { total: 0, active: 0 },
      streams: { total: 0, active: 0 },
      alerts_24h: 0,
      trust_score_24h: { avg: 0, min: 0, max: 0, alert_count: 0 },
    });
  }
};

// GET /api/v1/admin/compliance/report
const getComplianceReport = async (req, res) => {
  const { from, to, format = 'json' } = req.query;
  const fromDate = from || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const toDate = to || new Date().toISOString();

  const [events, trustLogs, blockchainLogs] = await Promise.all([
    query(
      `SELECT ae.*, d.full_name as doctor_name
       FROM audit_events ae
       LEFT JOIN streams s ON ae.stream_id = s.id
       LEFT JOIN doctors d ON s.doctor_id = d.id
       WHERE ae.created_at BETWEEN $1 AND $2
       ORDER BY ae.created_at DESC`,
      [fromDate, toDate]
    ),
    query(
      `SELECT tl.*, s.doctor_id
       FROM trust_logs tl
       LEFT JOIN streams s ON tl.stream_id = s.id
       WHERE tl.created_at BETWEEN $1 AND $2
       ORDER BY tl.created_at DESC`,
      [fromDate, toDate]
    ),
    query(
      `SELECT * FROM blockchain_logs WHERE created_at BETWEEN $1 AND $2`,
      [fromDate, toDate]
    ),
  ]);

  const alertCount = events.rows.filter((e) => e.severity === 'critical').length;
  const avgTrust = trustLogs.rows.reduce((s, r) => s + r.trust_score, 0) / (trustLogs.rows.length || 1);

  const report = {
    report_id: uuidv4(),
    generated_at: new Date().toISOString(),
    period: { from: fromDate, to: toDate },
    generated_by: req.user.id,
    summary: {
      total_events: events.rows.length,
      critical_alerts: alertCount,
      total_trust_logs: trustLogs.rows.length,
      average_trust_score: Math.round(avgTrust),
      total_blockchain_logs: blockchainLogs.rows.length,
    },
    audit_events: events.rows,
    trust_summary: trustLogs.rows.slice(0, 1000),
    blockchain_summary: blockchainLogs.rows.slice(0, 1000),
  };

  if (format === 'csv') {
    const csvLines = ['Event Type,Severity,Doctor,Timestamp'];
    events.rows.forEach((e) => {
      csvLines.push(`${e.event_type},${e.severity},${e.doctor_name || 'N/A'},${e.created_at}`);
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=compliance-report-${report.report_id}.csv`);
    return res.send(csvLines.join('\n'));
  }

  res.json(report);
};

// POST /api/v1/streams/create — self-service stream creation (no required body fields)
const createStream = async (req, res) => {
  const { doctor_id, patient_id, icu_room, metadata } = req.body || {};
  const streamId = uuidv4();
  const requestingUserId = req.user?.id;

  try {
    const result = await query(
      `INSERT INTO streams (id, doctor_id, patient_id, icu_room, status, metadata)
       VALUES ($1, $2, $3, $4, 'active', $5) RETURNING id, status, started_at, created_at`,
      [
        streamId,
        doctor_id || requestingUserId || null,
        patient_id || null,
        icu_room   || null,
        JSON.stringify(metadata || {}),
      ]
    );

    await query(
      `INSERT INTO audit_events (stream_id, event_type, severity, details) VALUES ($1, $2, $3, $4)`,
      [streamId, 'STREAM_CREATED', 'info', JSON.stringify({ created_by: requestingUserId })]
    );

    logger.info('[STREAM CREATE] New stream created', { stream_id: streamId, user: requestingUserId });

    return res.status(201).json({
      stream_id:  result.rows[0].id,
      status:     result.rows[0].status,
      created_at: result.rows[0].created_at,
    });
  } catch (err) {
    logger.error('[STREAM CREATE ERROR]', { error: err.message, code: err.code });
    return res.status(500).json({ error: 'Failed to create stream' });
  }
};

// POST /api/v1/admin/stream/start
const startStream = async (req, res) => {
  const { doctor_id, patient_id, icu_room } = req.body;
  const streamId = uuidv4();

  const result = await query(
    `INSERT INTO streams (id, doctor_id, patient_id, icu_room, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING *`,
    [streamId, doctor_id, patient_id, icu_room]
  );

  await query(
    `INSERT INTO audit_events (stream_id, event_type, severity, details) VALUES ($1, $2, $3, $4)`,
    [streamId, 'STREAM_STARTED', 'info', JSON.stringify({ doctor_id, patient_id, icu_room })]
  );

  res.status(201).json(result.rows[0]);
};

// PUT /api/v1/admin/stream/:streamId/stop
const stopStream = async (req, res) => {
  const { streamId } = req.params;

  await query(
    `UPDATE streams SET status = 'ended', ended_at = NOW() WHERE id = $1`,
    [streamId]
  );

  await query(
    `INSERT INTO audit_events (stream_id, event_type, severity, details) VALUES ($1, $2, $3, $4)`,
    [streamId, 'STREAM_ENDED', 'info', JSON.stringify({ ended_by: req.user.id })]
  );

  res.json({ message: 'Stream stopped', stream_id: streamId });
};

module.exports = { getConfig, updateConfig, getDashboardStats, getComplianceReport, createStream, startStream, stopStream };
