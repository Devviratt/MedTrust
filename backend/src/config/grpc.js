const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

// Proto files live in ai-services/proto, relative to backend/src/config/
const PROTO_DIR = path.resolve(__dirname, '..', '..', '..', 'ai-services', 'proto');

const loadProto = (protoFile) => {
  const fullPath = path.join(PROTO_DIR, protoFile);
  const packageDef = protoLoader.loadSync(fullPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(packageDef);
};

let videoClient, audioClient, biometricClient;

const initGrpcClients = () => {
  const credentials = grpc.credentials.createInsecure();

  try {
    const videoProto = loadProto('video_detection.proto');
    videoClient = new videoProto.videodetection.VideoDetectionService(
      process.env.AI_VIDEO_SERVICE_URL || 'localhost:50051',
      credentials
    );
    logger.info('gRPC video client initialized', { url: process.env.AI_VIDEO_SERVICE_URL || 'localhost:50051' });
  } catch (err) {
    logger.warn('gRPC video client init failed (service may be offline):', err.message);
  }

  try {
    const audioProto = loadProto('audio_detection.proto');
    audioClient = new audioProto.audiodetection.AudioDetectionService(
      process.env.AI_AUDIO_SERVICE_URL || 'localhost:50052',
      credentials
    );
    logger.info('gRPC audio client initialized', { url: process.env.AI_AUDIO_SERVICE_URL || 'localhost:50052' });
  } catch (err) {
    logger.warn('gRPC audio client init failed (service may be offline):', err.message);
  }

  try {
    const biometricProto = loadProto('biometric_engine.proto');
    biometricClient = new biometricProto.biometric.BiometricService(
      process.env.AI_BIOMETRIC_SERVICE_URL || 'localhost:50053',
      credentials
    );
    logger.info('gRPC biometric client initialized', { url: process.env.AI_BIOMETRIC_SERVICE_URL || 'localhost:50053' });
  } catch (err) {
    logger.warn('gRPC biometric client init failed (service may be offline):', err.message);
  }

  logger.info('gRPC client initialization complete');
};

const grpcCall = (client, method, payload) => {
  return new Promise((resolve, reject) => {
    client[method](payload, (err, response) => {
      if (err) {
        logger.error(`gRPC call error [${method}]:`, err.message);
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
};

const getVideoClient = () => videoClient;
const getAudioClient = () => audioClient;
const getBiometricClient = () => biometricClient;

module.exports = { initGrpcClients, grpcCall, getVideoClient, getAudioClient, getBiometricClient };
