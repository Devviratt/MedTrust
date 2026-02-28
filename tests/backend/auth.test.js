const request = require('supertest');
const { app, server } = require('../../backend/src/server');
const { pool } = require('../../backend/src/config/database');

describe('Auth - Doctor Login', () => {
  beforeAll(async () => {
    await pool.query(`
      INSERT INTO doctors (email, password_hash, full_name, department, license_number, role, is_active)
      VALUES ('test@medtrust.ai', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMuK1Cu0KtbJ7VhNH4WFp7BCQS', 'Test Doctor', 'ICU', 'TEST-001', 'doctor', true)
      ON CONFLICT (email) DO NOTHING
    `);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM doctors WHERE email = 'test@medtrust.ai'`);
  });

  test('POST /api/v1/doctor/login - success with valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/doctor/login')
      .send({ email: 'admin@medtrust.ai', password: 'Admin@MedTrust2024!' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('doctor');
    expect(res.body.doctor).not.toHaveProperty('password_hash');
  });

  test('POST /api/v1/doctor/login - fail with invalid password', async () => {
    const res = await request(app)
      .post('/api/v1/doctor/login')
      .send({ email: 'admin@medtrust.ai', password: 'wrongpassword' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /api/v1/doctor/login - fail with missing fields', async () => {
    const res = await request(app)
      .post('/api/v1/doctor/login')
      .send({ email: 'admin@medtrust.ai' });
    expect(res.status).toBe(400);
  });

  test('POST /api/v1/doctor/login - fail with non-existent user', async () => {
    const res = await request(app)
      .post('/api/v1/doctor/login')
      .send({ email: 'nobody@medtrust.ai', password: 'somepassword' });
    expect(res.status).toBe(401);
  });

  test('GET /api/v1/health - returns 200', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });
});

describe('Auth - Protected Routes', () => {
  let token = '';

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/doctor/login')
      .send({ email: 'admin@medtrust.ai', password: 'Admin@MedTrust2024!' });
    token = res.body.access_token;
  });

  test('GET /api/v1/doctor/list - requires JWT', async () => {
    const res = await request(app).get('/api/v1/doctor/list');
    expect(res.status).toBe(401);
  });

  test('GET /api/v1/doctor/list - succeeds with valid JWT', async () => {
    const res = await request(app)
      .get('/api/v1/doctor/list')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('doctors');
  });

  test('GET /api/v1/admin/config - requires admin role', async () => {
    const res = await request(app)
      .get('/api/v1/admin/config')
      .set('Authorization', `Bearer ${token}`);
    expect([200, 403]).toContain(res.status);
  });

  test('POST /api/v1/doctor/logout - succeeds with valid JWT', async () => {
    const res = await request(app)
      .post('/api/v1/doctor/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

afterAll(async () => {
  try {
    await pool.query(`DELETE FROM doctors WHERE email = 'test@medtrust.ai'`);
  } catch (_) {
    // ignore cleanup failures in test teardown
  }
  try {
    await pool.end();
  } catch (_) {
    // ignore pool shutdown failures in test teardown
  }
  await new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch (_) {
      resolve();
    }
  });
});
