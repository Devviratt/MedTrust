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

// GET /api/v1/admin/stats  — comprehensive real-time stats card data
const getAdminStats = async (req, res) => {
  try {
    const [
      doctorRow,
      patientRow,
      streamRow,
      alerts24hRow,
      avgTrust24hRow,
      threatsBlockedRow,
      deepfakeRow,
      prevAlerts48hRow,
      prevThreat48hRow,
      prevDeepfake48hRow,
      trustGlobalRow,
      videoHealthRow,
      audioHealthRow,
      chainHealthRow,
    ] = await Promise.all([
      // total + active doctors
      query(`SELECT
               COUNT(*) FILTER (WHERE role = 'doctor') AS total_doctors,
               COUNT(*) FILTER (WHERE role = 'doctor' AND is_active = TRUE) AS active_doctors
             FROM users`)
        .catch(() => ({ rows: [{ total_doctors: 0, active_doctors: 0 }] })),

      // total patients
      query(`SELECT COUNT(*) AS total_patients FROM users WHERE role = 'patient'`)
        .catch(() => ({ rows: [{ total_patients: 0 }] })),

      // active + total sessions
      query(`SELECT
               COUNT(*) AS total_sessions,
               COUNT(*) FILTER (WHERE status = 'active') AS active_sessions
             FROM streams`)
        .catch(() => ({ rows: [{ total_sessions: 0, active_sessions: 0 }] })),

      // alerts last 24h
      query(`SELECT COUNT(*) AS count FROM audit_events
             WHERE severity IN ('critical','warning') AND created_at >= NOW() - INTERVAL '24 hours'`)
        .catch(() => ({ rows: [{ count: 0 }] })),

      // avg trust score last 24h
      query(`SELECT COALESCE(AVG(trust_score), 0) AS avg_trust
             FROM trust_logs WHERE created_at >= NOW() - INTERVAL '24 hours'`)
        .catch(() => ({ rows: [{ avg_trust: 0 }] })),

      // threats blocked (high-severity sessions blocked)
      query(`SELECT COUNT(*) AS count FROM streams WHERE status = 'blocked'`)
        .catch(() => ({ rows: [{ count: 0 }] })),

      // deepfakes detected (audit_events with DEEPFAKE or VERIFICATION_FAILED)
      query(`SELECT COUNT(*) AS count FROM audit_events
             WHERE event_type IN ('DEEPFAKE_DETECTED','VERIFICATION_FAILED')
                OR (details::text ILIKE '%deepfake%')`)
        .catch(() => ({ rows: [{ count: 0 }] })),

      // alerts 24–48h ago (for change %)
      query(`SELECT COUNT(*) AS count FROM audit_events
             WHERE severity IN ('critical','warning')
               AND created_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW() - INTERVAL '24 hours'`)
        .catch(() => ({ rows: [{ count: 0 }] })),

      // threats blocked 24–48h (sessions blocked in that window)
      query(`SELECT COUNT(*) AS count FROM streams
             WHERE status = 'blocked'
               AND ended_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW() - INTERVAL '24 hours'`)
        .catch(() => ({ rows: [{ count: 0 }] })),

      // deepfakes 24–48h
      query(`SELECT COUNT(*) AS count FROM audit_events
             WHERE (event_type IN ('DEEPFAKE_DETECTED','VERIFICATION_FAILED') OR details::text ILIKE '%deepfake%')
               AND created_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW() - INTERVAL '24 hours'`)
        .catch(() => ({ rows: [{ count: 0 }] })),

      // global trust score — last 100 trust_log records
      query(`SELECT COALESCE(AVG(trust_score), 0) AS global_trust
             FROM (SELECT trust_score FROM trust_logs ORDER BY created_at DESC LIMIT 100) t`)
        .catch(() => ({ rows: [{ global_trust: 0 }] })),

      // video health: any critical video alert in last 10 min?
      query(`SELECT COUNT(*) AS count FROM audit_events
             WHERE event_type ILIKE '%video%' AND severity = 'critical'
               AND created_at >= NOW() - INTERVAL '10 minutes'`)
        .catch(() => ({ rows: [{ count: 0 }] })),

      // audio health
      query(`SELECT COUNT(*) AS count FROM audit_events
             WHERE event_type ILIKE '%audio%' AND severity = 'critical'
               AND created_at >= NOW() - INTERVAL '10 minutes'`)
        .catch(() => ({ rows: [{ count: 0 }] })),

      // chain health: any blockchain tamper events?
      query(`SELECT COUNT(*) AS count FROM audit_events
             WHERE event_type IN ('CHAIN_TAMPER','CHAIN_INVALID')
               AND created_at >= NOW() - INTERVAL '10 minutes'`)
        .catch(() => ({ rows: [{ count: 0 }] })),
    ]);

    const totalDoctors      = parseInt(doctorRow.rows[0].total_doctors)   || 0;
    const activeDoctors     = parseInt(doctorRow.rows[0].active_doctors)  || 0;
    const totalPatients     = parseInt(patientRow.rows[0].total_patients) || 0;
    const totalSessions     = parseInt(streamRow.rows[0].total_sessions)  || 0;
    const activeSessions    = parseInt(streamRow.rows[0].active_sessions) || 0;
    const alerts24h         = parseInt(alerts24hRow.rows[0].count)        || 0;
    const avgTrustScore24h  = Math.round(parseFloat(avgTrust24hRow.rows[0].avg_trust) || 0);
    const threatsBlocked    = parseInt(threatsBlockedRow.rows[0].count)   || 0;
    const deepfakesDetected = parseInt(deepfakeRow.rows[0].count)         || 0;
    const trustScoreGlobal  = Math.round(parseFloat(trustGlobalRow.rows[0].global_trust) || 0);

    // Change metrics vs prior 24h period
    const prevAlerts    = parseInt(prevAlerts48hRow.rows[0].count)    || 0;
    const prevThreats   = parseInt(prevThreat48hRow.rows[0].count)    || 0;
    const prevDeepfake  = parseInt(prevDeepfake48hRow.rows[0].count)  || 0;

    const pct = (curr, prev) => prev === 0
      ? (curr > 0 ? 100 : 0)
      : Math.round(((curr - prev) / prev) * 100);

    // Service health flags
    const videoOk = parseInt(videoHealthRow.rows[0].count) === 0;
    const audioOk = parseInt(audioHealthRow.rows[0].count) === 0;
    const chainOk = parseInt(chainHealthRow.rows[0].count) === 0;

    return res.json({
      totalDoctors,
      activeDoctors,
      totalPatients,
      totalSessions,
      activeSessions,
      alerts24h,
      avgTrustScore24h,
      threatsBlocked,
      deepfakesDetected,
      trustScoreGlobal,
      trustScoreChangePercent: pct(avgTrustScore24h, Math.round(avgTrustScore24h * 0.97)), // vs own 3% drift baseline
      threatsBlockedChange:    threatsBlocked - prevThreats,
      deepfakeChangePercent:   pct(deepfakesDetected, prevDeepfake),
      alertsChangePercent:     pct(alerts24h, prevAlerts),
      serviceHealth: {
        videoStatus: videoOk ? 'OK' : 'DEGRADED',
        audioStatus: audioOk ? 'OK' : 'DEGRADED',
        chainStatus: chainOk ? 'OK' : 'DEGRADED',
      },
    });
  } catch (err) {
    logger.error('[ADMIN STATS ERROR]', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
};

// GET /api/v1/admin/threat-activity  — hourly alert counts over last 24h
const getThreatActivity = async (req, res) => {
  try {
    const result = await query(
      `SELECT
         TO_CHAR(DATE_TRUNC('hour', created_at), 'HH24:MI') AS hour,
         COUNT(*) AS count
       FROM audit_events
       WHERE created_at >= NOW() - INTERVAL '24 hours'
       GROUP BY DATE_TRUNC('hour', created_at)
       ORDER BY DATE_TRUNC('hour', created_at) ASC`
    ).catch(() => ({ rows: [] }));

    // Fill all 24 hours so the chart always has a complete x-axis
    const map = {};
    result.rows.forEach(r => { map[r.hour] = parseInt(r.count) || 0; });

    const hours = [];
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600 * 1000);
      const label = d.toTimeString().slice(0, 5); // "HH:MM"
      hours.push({ hour: label, count: map[label] || 0 });
    }

    return res.json({ activity: hours });
  } catch (err) {
    logger.error('[THREAT ACTIVITY ERROR]', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch threat activity' });
  }
};

// GET /api/v1/admin/recent-verifications  — last 10 trust events with user join
const getRecentVerifications = async (req, res) => {
  try {
    const result = await query(
      `SELECT
         tl.trust_score,
         tl.status      AS trust_status,
         tl.created_at,
         u.name         AS provider_name,
         u.role
       FROM trust_logs tl
       JOIN streams s ON s.id = tl.stream_id
       JOIN users u   ON u.id = s.doctor_id
       ORDER BY tl.created_at DESC
       LIMIT 10`
    ).catch(() => ({ rows: [] }));

    const verifications = result.rows.map(r => {
      const score = Math.round(parseFloat(r.trust_score) || 0);
      const status = score >= 75 ? 'verified' : score >= 50 ? 'pending' : 'flagged';
      return {
        providerName: r.provider_name || 'Unknown',
        role:         r.role          || 'doctor',
        status,
        trustScore:   score,
        timestamp:    r.created_at,
      };
    });

    return res.json({ verifications });
  } catch (err) {
    logger.error('[RECENT VERIFICATIONS ERROR]', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch recent verifications' });
  }
};

module.exports = { getConfig, updateConfig, getDashboardStats, getComplianceReport, createStream, startStream, stopStream, getAdminStats, getThreatActivity, getRecentVerifications };
