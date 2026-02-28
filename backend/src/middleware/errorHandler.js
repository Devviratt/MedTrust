const winston = require('winston');
const fs = require('fs');
const path = require('path');

const logsDir = path.resolve(process.env.LOG_DIR || 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(logsDir, 'error.log'), level: 'error' }),
  ],
});

const errorHandler = (err, req, res, next) => {
  logger.error({
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url,
    userId: req.user?.id,
    ip: req.ip,
  });

  if (err.code === '23505') {
    return res.status(409).json({ error: 'Resource already exists', detail: err.detail });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced resource not found' });
  }
  if (err.code === '23502') {
    return res.status(400).json({ error: 'Missing required field', detail: err.detail });
  }

  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: err.message });
  }

  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Internal server error'
    : err.message;

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};

const notFound = (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.url} not found` });
};

module.exports = { errorHandler, notFound, logger };
