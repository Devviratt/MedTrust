const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { setTrustScore, getTrustScore, setCache, getCache } = require('../config/redis');
const { logger } = require('../middleware/errorHandler');
const { grpcCall, getBiometricClient } = require('../config/grpc');

// Shared io reference — set on init, used by frameController + streamIntervalManager
let _io = null;
const getIo = () => _io;

const rooms = new Map(); // streamId -> Set of socket IDs
const socketToStream = new Map(); // socketId -> streamId

const initSignalingServer = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // JWT authentication middleware for Socket.IO
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers['authorization']?.split(' ')[1];
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      logger.warn('Socket.IO auth failed:', err.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info('Client connected', { socketId: socket.id, userId: socket.user?.userId });

    // ─── WebRTC Signaling ──────────────────────────────────────────────────────

    socket.on('join-stream', ({ streamId, role }) => {
      socket.join(streamId);
      socketToStream.set(socket.id, streamId);

      if (!rooms.has(streamId)) {
        rooms.set(streamId, new Set());
      }

      // Collect existing members BEFORE adding self — send them back to the joiner
      // so the joiner knows who to send a WebRTC offer to immediately
      const existingMembers = Array.from(rooms.get(streamId)).map(sid => ({
        socketId: sid,
      }));

      rooms.get(streamId).add(socket.id);

      // Tell the joiner about everyone already in the room
      socket.emit('room-members', {
        streamId,
        members: existingMembers,
        yourSocketId: socket.id,
      });

      // Tell everyone already in the room about the new peer
      socket.to(streamId).emit('peer-joined', {
        socketId: socket.id,
        userId: socket.user.userId,
        role,
      });

      logger.info('User joined stream', { streamId, userId: socket.user.userId, role, existingCount: existingMembers.length });
    });

    socket.on('leave-stream', ({ streamId }) => {
      handleLeaveStream(socket, streamId, io);
    });

    // WebRTC offer/answer/ICE exchange
    socket.on('webrtc-offer', ({ targetSocketId, offer, streamId }) => {
      socket.to(targetSocketId).emit('webrtc-offer', {
        offer,
        fromSocketId: socket.id,
        streamId,
      });
    });

    socket.on('webrtc-answer', ({ targetSocketId, answer, streamId }) => {
      socket.to(targetSocketId).emit('webrtc-answer', {
        answer,
        fromSocketId: socket.id,
        streamId,
      });
    });

    socket.on('ice-candidate', ({ targetSocketId, candidate, streamId }) => {
      socket.to(targetSocketId).emit('ice-candidate', {
        candidate,
        fromSocketId: socket.id,
        streamId,
      });
    });

    // ─── Real-Time Trust Score Broadcasting ──────────────────────────────────

    socket.on('subscribe-trust', async ({ streamId }) => {
      socket.join(`trust:${streamId}`);
      // Send latest score immediately
      const latest = await getTrustScore(streamId);
      if (latest) {
        socket.emit('trust-score-update', latest);
      }
    });

    socket.on('trust-score-push', async (scoreData) => {
      const { stream_id } = scoreData;
      if (!stream_id) return;

      // Broadcast to all subscribers of this stream's trust channel
      io.to(`trust:${stream_id}`).emit('trust-score-update', scoreData);

      // If alert status, broadcast globally to admins
      if (scoreData.status === 'alert') {
        io.to('admin-room').emit('deepfake-alert', {
          ...scoreData,
          alert_id: `alert-${Date.now()}`,
          message: `DEEPFAKE ALERT: Trust score ${scoreData.trust_score} on stream ${stream_id}`,
        });
      }
    });

    // ─── Admin Monitoring ─────────────────────────────────────────────────────

    socket.on('join-admin', () => {
      if (socket.user.role === 'admin') {
        socket.join('admin-room');
        logger.info('Admin joined monitoring room', { userId: socket.user.userId });
      } else {
        socket.emit('error', { message: 'Admin role required' });
      }
    });

    socket.on('request-active-streams', () => {
      const activeStreams = Array.from(rooms.entries()).map(([streamId, clients]) => ({
        streamId,
        clientCount: clients.size,
      }));
      socket.emit('active-streams', activeStreams);
    });

    // ─── Biometric pulse signal (Phase 3) ─────────────────────────────────────
    // Frontend sends average ROI luminance values every 500ms.
    // We accumulate a rolling window, compute variance → biometric_score,
    // then cache it in Redis so the next frame analysis picks it up.

    socket.on('biometric:pulse', async ({ stream_id, value, timestamp }) => {
      if (!stream_id || typeof value !== 'number') return;
      try {
        const windowKey = `biometric:window:${stream_id}`;
        const cached = await getCache(windowKey) || [];
        // Rolling window of last 30 values (30 × 500ms = 15s)
        const window = [...cached, value].slice(-30);
        await setCache(windowKey, window, 60);

        // Only compute score once we have ≥4 samples
        if (window.length >= 4) {
          const { computeBiometricScore } = require('../services/trustEngineV2');
          const biometric_score = computeBiometricScore(window);

          // Merge into existing cached trust score so next frame uses real value
          const existing = await getTrustScore(stream_id) || {};
          await setTrustScore(stream_id, { ...existing, biometric_score });

          // Broadcast waveform update to dashboard
          io.to(`trust:${stream_id}`).emit('rppg-update', {
            streamId: stream_id,
            waveform: window,
            biometric_score,
            timestamp,
          });
        }
      } catch (err) {
        logger.warn('[signalingServer] biometric:pulse error', { stream_id, error: err.message });
      }
    });

    // ─── Voice MFCC features (Phase 4) ────────────────────────────────────────
    // Frontend sends MFCC feature array every 3s.
    // We compute spectral flatness → voice_score → cache in Redis.

    socket.on('voice:mfcc', async ({ stream_id, features, timestamp }) => {
      if (!stream_id || !Array.isArray(features)) return;
      try {
        const { computeVoiceScore } = require('../services/trustEngineV2');
        const voice_score = computeVoiceScore(features);

        const existing = await getTrustScore(stream_id) || {};
        await setTrustScore(stream_id, { ...existing, voice_score });

        logger.debug('[signalingServer] voice:mfcc', { stream_id, voice_score, features_len: features.length });
      } catch (err) {
        logger.warn('[signalingServer] voice:mfcc error', { stream_id, error: err.message });
      }
    });

    // ─── rPPG Frame (legacy — gRPC path when AI services are online) ──────────

    socket.on('rppg:frame', async ({ stream_id, frame_data, timestamp }) => {
      if (!stream_id || !frame_data) return;
      try {
        const client = getBiometricClient();
        if (!client) return;
        const frameBytes = Buffer.from(frame_data, 'base64');
        const response = await grpcCall(client, 'ExtractRPPG', {
          stream_id,
          frame_data: frameBytes,
          timestamp:  timestamp || Date.now(),
        });
        if (response?.waveform?.length > 0) {
          io.to(`trust:${stream_id}`).emit('rppg-update', {
            streamId:   stream_id,
            waveform:   response.waveform,
            heart_rate: response.heart_rate,
            confidence: response.confidence,
            method:     response.method,
            timestamp,
          });
        }
      } catch (err) {
        logger.warn('[signalingServer] rppg:frame gRPC error', { stream_id, error: err.message });
      }
    });

    // ─── rPPG passthrough ─────────────────────────────────────────────────────

    socket.on('rppg-data', ({ streamId, waveform, timestamp }) => {
      io.to(`trust:${streamId}`).emit('rppg-update', { streamId, waveform, timestamp });
    });

    // ─── Disconnection ────────────────────────────────────────────────────────

    socket.on('disconnect', (reason) => {
      logger.info('Client disconnected', { socketId: socket.id, reason });
      const streamId = socketToStream.get(socket.id);
      if (streamId) {
        handleLeaveStream(socket, streamId, io);
      }
    });

    socket.on('error', (err) => {
      logger.error('Socket error:', { socketId: socket.id, error: err.message });
    });
  });

  _io = io;
  logger.info('WebRTC signaling server initialized');
  return io;
};

const handleLeaveStream = (socket, streamId, io) => {
  socket.leave(streamId);
  socketToStream.delete(socket.id);

  const room = rooms.get(streamId);
  if (room) {
    room.delete(socket.id);
    if (room.size === 0) {
      rooms.delete(streamId);
    }
  }

  socket.to(streamId).emit('peer-left', {
    socketId: socket.id,
    userId: socket.user?.userId,
  });

  logger.info('User left stream', { streamId, userId: socket.user?.userId });
};

module.exports = { initSignalingServer, getIo };
