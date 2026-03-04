const { Pool } = require('pg');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

const isDemoInMemory = () => {
  const flag = String(process.env.DEMO_INMEMORY || '').toLowerCase();
  return flag === 'true' || flag === '1' || flag === 'yes' || flag === 'on';
};

let pool;

if (isDemoInMemory()) {
  // Demo-mode: run with an in-memory Postgres using pg-mem.
  // This keeps API contracts intact while removing the external DB dependency.
  const { newDb } = require('pg-mem');
  const crypto = require('crypto');
  const db = newDb({ autoCreateForeignKeyIndices: true });

  // Provide common Postgres UUID helpers used by migrations/schemas.
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid',
    impure: true,
    implementation: () => crypto.randomUUID(),
  });
  db.public.registerFunction({
    name: 'uuid_generate_v4',
    returns: 'uuid',
    impure: true,
    implementation: () => crypto.randomUUID(),
  });

  try {
    const schemaPath = path.join(__dirname, '..', 'utils', 'demo_schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.public.none(schemaSql);
    logger.info('Loaded demo schema into in-memory database', { schemaPath });
  } catch (err) {
    logger.error('Failed to load demo schema', { error: err.message });
    throw err;
  }

  const pgAdapter = db.adapters.createPg();
  pool = new pgAdapter.Pool();
  logger.warn('Using DEMO_INMEMORY database (pg-mem). Data is not persistent.');
} else {
  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'medtrust',
    user: process.env.DB_USER || 'medtrust_user',
    password: process.env.DB_PASSWORD || 'medtrust_password',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

pool.on('connect', () => {
  logger.info('PostgreSQL client connected');
});

pool.on('error', (err) => {
  logger.error('PostgreSQL pool error:', err);
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Query executed', { text, duration, rows: res.rowCount });
    return res;
  } catch (err) {
    logger.error('Database query error:', { text, error: err.message });
    throw err;
  }
};

const getClient = async () => {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);
  client.query = (...args) => {
    client.lastQuery = args;
    return originalQuery(...args);
  };
  client.release = () => {
    client.query = originalQuery;
    release();
  };
  return client;
};

module.exports = { pool, query, getClient };
