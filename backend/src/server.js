require('dotenv').config();
require('express-async-errors');

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const { v4: uuidv4 } = require('uuid');

const { pool } = require('./config/database');
const { connectRedis } = require('./config/redis');
const { initGrpcClients } = require('./config/grpc');
const { initSignalingServer } = require('./websocket/signalingServer');
const routes = require('./routes/index');
const { errorHandler, notFound, logger } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

const app = express();
const server = http.createServer(app);

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'wss:', 'ws:'],
      mediaSrc: ["'self'", 'blob:'],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

// ─── Request Tracking ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
  skip: (req) => req.url === '/api/v1/health',
}));

// ─── Parsing & Compression ────────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// ─── Prometheus Metrics ───────────────────────────────────────────────────────
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send([
    '# HELP medtrust_requests_total Total HTTP requests',
    '# TYPE medtrust_requests_total counter',
    `medtrust_requests_total ${global.requestCount || 0}`,
    '# HELP medtrust_active_streams Active ICU streams',
    '# TYPE medtrust_active_streams gauge',
    `medtrust_active_streams ${global.activeStreams || 0}`,
  ].join('\n'));
});

app.use((req, res, next) => {
  global.requestCount = (global.requestCount || 0) + 1;
  next();
});

// ─── API Routes ───────────────────────────────────────────────────────────────
const API_PREFIX = `/api/${process.env.API_VERSION || 'v1'}`;
app.use(API_PREFIX, apiLimiter, routes);

// ─── Static Files (uploads) ───────────────────────────────────────────────────
app.use('/uploads', express.static(process.env.UPLOAD_DIR || './uploads'));

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Bootstrap ────────────────────────────────────────────────────────────────
const bootstrap = async () => {
  try {
    // Test DB connection
    await pool.query('SELECT 1');
    logger.info('PostgreSQL connected');

    // Connect Redis
    await connectRedis();

    // Initialize gRPC clients
    initGrpcClients();

    // Initialize WebRTC signaling
    const io = initSignalingServer(server);
    app.set('io', io);

    const PORT = parseInt(process.env.PORT) || 4000;
    server.listen(PORT, () => {
      logger.info(`MedTrust API Gateway running on port ${PORT}`, {
        env: process.env.NODE_ENV,
        api: `${API_PREFIX}`,
      });
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      server.close(async () => {
        await pool.end();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error('Bootstrap failed:', err);
    process.exit(1);
  }
};

bootstrap();

module.exports = { app, server };
