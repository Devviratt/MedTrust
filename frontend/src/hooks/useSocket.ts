import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { useStreamStore } from '../store/streamStore';
import { SOCKET_BASE_URL } from '../config/runtime';

declare global {
  interface Window { __medtrustSocket: any; }
}

const SOCKET_URL = SOCKET_BASE_URL;

let socketInstance: Socket | null = null;

// Global callback registries for session lifecycle events
type SessionCb  = (data: { sessionId: string; final_trust?: number; reason?: string }) => void;
type FlaggedCb  = (data: { sessionId?: string; userId?: string; role?: string; risk_score?: number; message?: string }) => void;
const activatedCbs     = new Set<SessionCb>();
const blockedCbs       = new Set<SessionCb>();
const flaggedCbs       = new Set<FlaggedCb>();
const doctorVerifiedCbs = new Set<SessionCb>();

export const onSessionActivated  = (cb: SessionCb)  => { activatedCbs.add(cb);      return () => activatedCbs.delete(cb);      };
export const onSessionBlocked    = (cb: SessionCb)  => { blockedCbs.add(cb);        return () => blockedCbs.delete(cb);        };
export const onIdentityFlagged   = (cb: FlaggedCb)  => { flaggedCbs.add(cb);        return () => flaggedCbs.delete(cb);        };
export const onDoctorVerified    = (cb: SessionCb)  => { doctorVerifiedCbs.add(cb); return () => doctorVerifiedCbs.delete(cb); };

export const useSocket = () => {
  const { token } = useAuthStore();
  const { updateTrustScore, pushRppgData, addAlert } = useStreamStore();
  const socketRef = useRef<Socket | null>(null);

  const connect = useCallback(() => {
    if (socketInstance?.connected) return socketInstance;

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    socket.on('connect', () => { /* connected */ });

    socket.on('disconnect', () => { /* disconnected */ });

    socket.on('trust-score-update', (data) => {
      useStreamStore.getState().updateTrustScore(data);
      if (data.status === 'alert' || data.status === 'suspicious') {
        useStreamStore.getState().addAlert({
          id: `alert-${Date.now()}`,
          type: 'DEEPFAKE_ALERT',
          message: `Trust score ${data.trust_score} — ${data.status === 'alert' ? 'possible deepfake detected' : 'suspicious activity'}`,
          severity: data.status === 'alert' ? 'critical' : 'warning',
          timestamp: new Date().toISOString(),
          streamId: data.stream_id,
        });
      }
    });

    socket.on('rppg-update', ({ waveform, biometric_score }) => {
      if (Array.isArray(waveform)) useStreamStore.getState().pushRppgData(waveform);
      if (typeof biometric_score === 'number') {
        const cur = useStreamStore.getState().trustScore;
        if (cur) useStreamStore.getState().updateTrustScore({ ...cur, biometric_score });
      }
    });

    socket.on('deepfake-alert', (data) => {
      useStreamStore.getState().addAlert({
        id: `alert-${Date.now()}`,
        type: data.event_type || 'DEEPFAKE_ALERT',
        message: data.message || 'Deepfake alert received',
        severity: 'critical',
        timestamp: new Date().toISOString(),
        streamId: data.stream_id,
      });
    });

    socket.on('thread-log', (data) => {
      useStreamStore.getState().pushThreadLog(data);
    });

    socket.on('session_activated',  (data) => { activatedCbs.forEach(cb     => cb(data)); });
    socket.on('session_blocked',    (data) => { blockedCbs.forEach(cb       => cb(data)); });
    socket.on('identity_flagged',   (data) => { flaggedCbs.forEach(cb       => cb(data)); });
    socket.on('doctor_verified',    (data) => {
      doctorVerifiedCbs.forEach(cb => cb(data));
      // doctor_verified with final_trust means fully active — fire activatedCbs too
      if (data.final_trust !== undefined) activatedCbs.forEach(cb => cb(data));
    });

    socket.on('peer-joined', () => { /* peer joined */ });
    socket.on('connect_error', () => { /* silent */ });

    socketInstance = socket;
    socketRef.current = socket;
    // Expose for VideoPanel rppg:frame emitter (no prop drilling needed)
    (window as any).__medtrustSocket = socket;
    return socket;
  // Only re-create socket when token changes (login/logout)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const disconnect = useCallback(() => {
    if (socketInstance) {
      socketInstance.disconnect();
      socketInstance = null;
    }
  }, []);

  const joinStream = useCallback((streamId: string, role = 'viewer') => {
    socketInstance?.emit('join-stream', { streamId, role });
    socketInstance?.emit('subscribe-trust', { streamId });
  }, []);

  const leaveStream = useCallback((streamId: string) => {
    socketInstance?.emit('leave-stream', { streamId });
  }, []);

  const sendOffer = useCallback((targetSocketId: string, offer: RTCSessionDescriptionInit, streamId: string) => {
    socketInstance?.emit('webrtc-offer', { targetSocketId, offer, streamId });
  }, []);

  const sendAnswer = useCallback((targetSocketId: string, answer: RTCSessionDescriptionInit, streamId: string) => {
    socketInstance?.emit('webrtc-answer', { targetSocketId, answer, streamId });
  }, []);

  const sendIceCandidate = useCallback((targetSocketId: string, candidate: RTCIceCandidate, streamId: string) => {
    socketInstance?.emit('ice-candidate', { targetSocketId, candidate, streamId });
  }, []);

  useEffect(() => {
    if (token) connect();
    return () => { /* intentionally don't auto-disconnect on unmount */ };
  }, [token, connect]);

  return {
    socket: socketRef.current,
    connect,
    disconnect,
    joinStream,
    leaveStream,
    sendOffer,
    sendAnswer,
    sendIceCandidate,
    isConnected: socketInstance?.connected ?? false,
  };
};
