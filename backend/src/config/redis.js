const { createClient } = require('redis');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

let redisClient;

const isDemoInMemory = () => {
  const flag = String(process.env.DEMO_INMEMORY || '').toLowerCase();
  return flag === 'true' || flag === '1' || flag === 'yes' || flag === 'on';
};

const createInMemoryRedisClient = () => {
  const store = new Map(); // key -> { value: string, expiresAt: number }
  return {
    isOpen: true,
    on: () => { /* no-op */ },
    connect: async () => {},
    setEx: async (key, ttlSeconds, value) => {
      store.set(String(key), { value: String(value), expiresAt: Date.now() + (ttlSeconds * 1000) });
    },
    get: async (key) => {
      const entry = store.get(String(key));
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        store.delete(String(key));
        return null;
      }
      return entry.value;
    },
    del: async (key) => {
      store.delete(String(key));
    },
    publish: async () => {},
  };
};

const connectRedis = async () => {
  if (isDemoInMemory()) {
    redisClient = createInMemoryRedisClient();
    logger.warn('Using DEMO_INMEMORY redis (in-memory). Data is not persistent.');
    return redisClient;
  }

  redisClient = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
    },
    password: process.env.REDIS_PASSWORD || undefined,
    database: parseInt(process.env.REDIS_DB) || 0,
  });

  redisClient.on('error', (err) => logger.error('Redis client error:', err));
  redisClient.on('connect', () => logger.info('Redis client connected'));
  redisClient.on('reconnecting', () => logger.warn('Redis client reconnecting'));

  try {
    await redisClient.connect();
  } catch (err) {
    logger.error('Redis connect failed; falling back to in-memory cache', { error: err.message });
    redisClient = createInMemoryRedisClient();
  }
  return redisClient;
};

const getRedis = () => {
  if (!redisClient || !redisClient.isOpen) {
    throw new Error('Redis client not initialized');
  }
  return redisClient;
};

const setCache = async (key, value, ttl = parseInt(process.env.REDIS_TTL) || 3600) => {
  try {
    const client = getRedis();
    await client.setEx(key, ttl, JSON.stringify(value));
  } catch {
    // Redis write failure is non-fatal
  }
};

const getCache = async (key) => {
  try {
    const client = getRedis();
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
};

const deleteCache = async (key) => {
  try {
    const client = getRedis();
    await client.del(key);
  } catch {
    // Redis delete failure is non-fatal
  }
};

const setTrustScore = async (streamId, scoreData) => {
  try {
    const client = getRedis();
    const key = `trust_score:${streamId}`;
    await client.setEx(key, 30, JSON.stringify({ ...scoreData, timestamp: Date.now() }));
  } catch {
    // Redis write failure is non-fatal
  }
};

const getTrustScore = async (streamId) => {
  try {
    const client = getRedis();
    const data = await client.get(`trust_score:${streamId}`);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
};

const publishAlert = async (channel, message) => {
  try {
    const client = getRedis();
    await client.publish(channel, JSON.stringify(message));
  } catch {
    // Redis publish failure is non-fatal
  }
};

module.exports = { connectRedis, getRedis, setCache, getCache, deleteCache, setTrustScore, getTrustScore, publishAlert };
