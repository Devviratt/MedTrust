const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { setCache, deleteCache, setCache: blacklistToken } = require('../config/redis');
const { grpcCall, getAudioClient } = require('../config/grpc');
const { logger } = require('../middleware/errorHandler');

// POST /api/v1/doctor/register
const registerDoctor = async (req, res) => {
  const { email, password, full_name, department, specialization, license_number, role } = req.body;

  const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

  const result = await query(
    `INSERT INTO doctors (id, email, password_hash, full_name, department, specialization, license_number, role)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, email, full_name, department, role, created_at`,
    [uuidv4(), email, hashedPassword, full_name, department, specialization, license_number, role || 'doctor']
  );

  const doctor = result.rows[0];

  await query(
    `INSERT INTO audit_events (event_type, severity, details)
     VALUES ($1, $2, $3)`,
    ['DOCTOR_REGISTERED', 'info', JSON.stringify({ doctor_id: doctor.id, email, role })]
  );

  logger.info('Doctor registered', { doctorId: doctor.id, email });

  res.status(201).json({
    message: 'Doctor registered successfully',
    doctor: { id: doctor.id, email: doctor.email, full_name: doctor.full_name, department: doctor.department, role: doctor.role },
  });
};

// POST /api/v1/doctor/login
const loginDoctor = async (req, res) => {
  const { email, password } = req.body;

  const result = await query(
    'SELECT id, email, password_hash, full_name, department, role, is_active FROM doctors WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const doctor = result.rows[0];

  if (!doctor.is_active) {
    return res.status(403).json({ error: 'Account is deactivated' });
  }

  const isValid = await bcrypt.compare(password, doctor.password_hash);
  if (!isValid) {
    await query(
      `INSERT INTO audit_events (event_type, severity, details) VALUES ($1, $2, $3)`,
      ['LOGIN_FAILED', 'warning', JSON.stringify({ email, ip: req.ip })]
    );
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const tokenPayload = { userId: doctor.id, role: doctor.role, email: doctor.email };
  const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' });
  const refreshToken = jwt.sign(tokenPayload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' });

  // Store refresh token
  await setCache(`refresh:${doctor.id}`, refreshToken, 7 * 24 * 3600);

  // Update last login
  await query('UPDATE doctors SET last_login = NOW() WHERE id = $1', [doctor.id]);

  await query(
    `INSERT INTO audit_events (event_type, severity, details) VALUES ($1, $2, $3)`,
    ['LOGIN_SUCCESS', 'info', JSON.stringify({ doctor_id: doctor.id, email })]
  );

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: process.env.JWT_EXPIRES_IN || '24h',
    doctor: { id: doctor.id, email: doctor.email, full_name: doctor.full_name, department: doctor.department, role: doctor.role },
  });
};

// POST /api/v1/doctor/logout
const logoutDoctor = async (req, res) => {
  // Blacklist current token
  const token = req.token;
  const decoded = jwt.decode(token);
  const ttl = decoded.exp - Math.floor(Date.now() / 1000);
  if (ttl > 0) {
    await setCache(`blacklist:${token}`, true, ttl);
  }

  await deleteCache(`refresh:${req.user.id}`);
  await deleteCache(`user:${req.user.id}`);

  await query(
    `INSERT INTO audit_events (event_type, severity, details) VALUES ($1, $2, $3)`,
    ['LOGOUT', 'info', JSON.stringify({ doctor_id: req.user.id })]
  );

  res.json({ message: 'Logged out successfully' });
};

// POST /api/v1/doctor/train-voice
const trainVoiceProfile = async (req, res) => {
  const { doctor_id, sample_count } = req.body;
  const audioFiles = req.files;

  if (!audioFiles || audioFiles.length === 0) {
    return res.status(400).json({ error: 'No audio samples provided' });
  }

  const audioClient = getAudioClient();
  if (!audioClient) {
    return res.status(503).json({ error: 'Audio AI service unavailable' });
  }

  // Build training payload
  const samples = audioFiles.map((f) => f.buffer.toString('base64'));

  let embeddingResult;
  try {
    embeddingResult = await grpcCall(audioClient, 'TrainVoiceProfile', {
      doctor_id,
      audio_samples: samples,
    });
  } catch (err) {
    logger.error('Voice training gRPC error:', err.message);
    return res.status(500).json({ error: 'Voice training failed', detail: err.message });
  }

  // Store voice embedding
  await query(
    `INSERT INTO voice_embeddings (doctor_id, embedding_vector, model_version, sample_count)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (doctor_id) DO UPDATE
     SET embedding_vector = EXCLUDED.embedding_vector,
         model_version = EXCLUDED.model_version,
         sample_count = EXCLUDED.sample_count,
         trained_at = NOW()`,
    [doctor_id, JSON.stringify(embeddingResult.embedding), embeddingResult.model_version, audioFiles.length]
  );

  await query(
    `INSERT INTO audit_events (event_type, severity, details) VALUES ($1, $2, $3)`,
    ['VOICE_TRAINED', 'info', JSON.stringify({ doctor_id, sample_count: audioFiles.length })]
  );

  res.json({
    message: 'Voice profile trained successfully',
    doctor_id,
    sample_count: audioFiles.length,
    model_version: embeddingResult.model_version,
  });
};

// GET /api/v1/doctor/profile/:id
const getDoctorProfile = async (req, res) => {
  const { id } = req.params;

  const result = await query(
    `SELECT d.id, d.email, d.full_name, d.department, d.specialization, d.role, d.is_active, d.last_login, d.created_at,
            ve.trained_at as voice_trained_at, ve.sample_count as voice_samples
     FROM doctors d
     LEFT JOIN voice_embeddings ve ON d.id = ve.doctor_id
     WHERE d.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Doctor not found' });
  }

  res.json(result.rows[0]);
};

// GET /api/v1/doctor/list
const listDoctors = async (req, res) => {
  const { page = 1, limit = 20, department, role } = req.query;
  const offset = (page - 1) * limit;

  let queryStr = `SELECT d.id, d.email, d.full_name, d.department, d.role, d.is_active, d.last_login,
                         ve.trained_at as voice_trained_at
                  FROM doctors d
                  LEFT JOIN voice_embeddings ve ON d.id = ve.doctor_id
                  WHERE 1=1`;
  const params = [];

  if (department) {
    params.push(department);
    queryStr += ` AND d.department = $${params.length}`;
  }
  if (role) {
    params.push(role);
    queryStr += ` AND d.role = $${params.length}`;
  }

  params.push(limit, offset);
  queryStr += ` ORDER BY d.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const result = await query(queryStr, params);
  const countResult = await query('SELECT COUNT(*) FROM doctors WHERE 1=1', []);

  res.json({
    doctors: result.rows,
    pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countResult.rows[0].count) },
  });
};

module.exports = { registerDoctor, loginDoctor, logoutDoctor, trainVoiceProfile, getDoctorProfile, listDoctors };
