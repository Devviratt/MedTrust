import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useSocket, onSessionBlocked } from '../hooks/useSocket';
import { sessionApi } from '../services/api';
import toast from 'react-hot-toast';
import {
  Shield, Square, Loader2, AlertTriangle, Clock,
  Mic, MicOff, Video, VideoOff, PhoneOff, User,
  Activity, CheckCircle, XCircle, RefreshCw, BadgeCheck,
} from 'lucide-react';

// ── Style helpers ──────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: 'var(--glass-bg)',
  border: '1px solid var(--border-default)',
  borderRadius: 16,
  boxShadow: 'var(--shadow-md)',
};

const trustColor = (s?: string) =>
  s === 'safe' ? 'var(--status-safe)' : s === 'suspicious' ? 'var(--status-warn)' : s === 'alert' ? 'var(--status-danger)' : 'var(--text-muted)';

const trustBg = (s?: string) =>
  s === 'safe' ? 'var(--status-safe-dim)' : s === 'suspicious' ? 'var(--status-warn-dim)' : s === 'alert' ? 'var(--status-danger-dim)' : 'var(--bg-elevated)';

const trustBorder = (s?: string) =>
  s === 'safe' ? 'var(--status-safe-border)' : s === 'suspicious' ? 'var(--status-warn-border)' : s === 'alert' ? 'var(--status-danger-border)' : 'var(--border-default)';

// ── Circular trust gauge ───────────────────────────────────────────────────────
const TrustGauge: React.FC<{ score: number; status?: string }> = ({ score, status }) => {
  const col = trustColor(status);
  const r = 52; const circ = 2 * Math.PI * r;
  const dash = circ * (Math.min(100, Math.max(0, score)) / 100);
  return (
    <svg width={130} height={130} viewBox="0 0 130 130">
      <circle cx={65} cy={65} r={r} fill="none" stroke="var(--border-subtle)" strokeWidth={10} />
      <circle cx={65} cy={65} r={r} fill="none" stroke={col} strokeWidth={10}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 65 65)"
        style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.4s ease' }} />
      <text x={65} y={60} textAnchor="middle" fill={col} fontSize={26} fontWeight={800} fontFamily="monospace">{score}</text>
      <text x={65} y={77} textAnchor="middle" fill="var(--text-muted)" fontSize={10} letterSpacing={1}>
        {(status ?? 'PENDING').toUpperCase()}
      </text>
    </svg>
  );
};

// ── Mini score bar ─────────────────────────────────────────────────────────────
const ScoreBar: React.FC<{ label: string; value: number }> = ({ label, value }) => {
  const col = value >= 70 ? 'var(--status-safe)' : value >= 45 ? 'var(--status-warn)' : 'var(--status-danger)';
  return (
    <div style={{ marginBottom: '0.625rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 700, color: col }}>{value}%</span>
      </div>
      <div style={{ height: 4, background: 'var(--border-subtle)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, background: col, borderRadius: 99, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
};

// ── Patient detail field ───────────────────────────────────────────────────────
const DetailRow: React.FC<{ label: string; value?: string | number | null }> = ({ label, value }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
    <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{label}</span>
    <span style={{ fontSize: '0.82rem', color: value != null ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: 500 }}>
      {value != null && value !== '' ? String(value) : '—'}
    </span>
  </div>
);

// ── WebRTC hook ────────────────────────────────────────────────────────────────
function useWebRTC(streamId: string | null, connect: () => any) {
  const localRef  = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const pcRef     = useRef<RTCPeerConnection | null>(null);
  // Track the remote peer's socketId so ICE candidates are routed correctly
  const peerSocketIdRef = useRef<string | null>(null);
  const retryTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localStreamRef  = useRef<MediaStream | null>(null);

  const [localStream,    setLocalStream]    = useState<MediaStream | null>(null);
  const [hasRemote,      setHasRemote]      = useState(false);
  const [connState,      setConnState]      = useState<string>('new');
  const [peerDisconnected, setPeerDisconnected] = useState(false);
  const [micMuted,       setMicMuted]       = useState(false);
  const [camOff,         setCamOff]         = useState(false);

  // Always get the live socket instance — avoids stale-ref issue
  const getSocket = useCallback(() => (window as any).__medtrustSocket ?? null, []);

  const startMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      if (localRef.current) {
        localRef.current.srcObject = stream;
        localRef.current.muted     = true;
        localRef.current.playsInline = true;
        localRef.current.autoplay    = true;
        localRef.current.play().catch(() => {});
      }
      return stream;
    } catch (err: any) {
      toast.error(
        err.name === 'NotAllowedError'
          ? 'Camera/microphone permission denied — check browser settings.'
          : `Media error: ${err.message}`
      );
      return null;
    }
  }, []);

  // Build (or reuse) RTCPeerConnection — always creates fresh on first call
  const getPC = useCallback((stream?: MediaStream): RTCPeerConnection => {
    if (pcRef.current && pcRef.current.signalingState !== 'closed') return pcRef.current;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    // Attach local tracks immediately if stream is available
    const s = stream ?? localStreamRef.current;
    if (s) {
      s.getTracks().forEach(t => pc.addTrack(t, s));
    }

    // Remote stream → attach to video element
    pc.ontrack = (e) => {
      setHasRemote(true);
      setPeerDisconnected(false);
      if (remoteRef.current) {
        remoteRef.current.srcObject = e.streams[0];
        remoteRef.current.playsInline = true;
        remoteRef.current.autoplay    = true;
        remoteRef.current.play().catch(() => {});
      }
    };

    // ICE: route to the specific peer socketId
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const sock = getSocket();
      if (sock && streamId && peerSocketIdRef.current) {
        sock.emit('ice-candidate', {
          targetSocketId: peerSocketIdRef.current,
          candidate: e.candidate,
          streamId,
        });
      }
    };

    // Connection state tracking + 10s retry on failure
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setConnState(state);
      if (state === 'connected') {
        if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
        setPeerDisconnected(false);
      }
      if (state === 'failed') {
        toast.error('WebRTC connection failed — retrying…');
        retryTimerRef.current = setTimeout(() => {
          // Close broken PC and let peer-joined / room-members trigger a fresh offer
          pcRef.current?.close();
          pcRef.current = null;
          const sock = getSocket();
          if (sock && streamId) {
            sock.emit('leave-stream',  { streamId });
            sock.emit('join-stream',   { streamId, role: 'doctor' });
            sock.emit('subscribe-trust', { streamId });
          }
        }, 2000);
      }
      if (state === 'disconnected') {
        // Give 10s for ICE restart before treating as failed
        retryTimerRef.current = setTimeout(() => {
          if (pcRef.current?.connectionState === 'disconnected') {
            pcRef.current.close();
            pcRef.current = null;
          }
        }, 10000);
      }
    };

    pcRef.current = pc;
    return pc;
  }, [streamId, getSocket]);

  // Add local tracks when stream arrives after PC was already created
  useEffect(() => {
    if (!localStream || !pcRef.current) return;
    const pc = pcRef.current;
    if (pc.signalingState === 'closed') return;
    const existingIds = pc.getSenders().map(s => s.track?.id);
    localStream.getTracks().forEach(t => {
      if (!existingIds.includes(t.id)) pc.addTrack(t, localStream);
    });
  }, [localStream]);

  // Send offer to a specific peer
  const sendOffer = useCallback(async (targetSocketId: string) => {
    if (!streamId) return;
    const sock = getSocket();
    if (!sock) return;
    peerSocketIdRef.current = targetSocketId;
    const pc = getPC();
    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
      sock.emit('webrtc-offer', { targetSocketId, offer, streamId });
    } catch (err: any) {
      toast.error(`Offer failed: ${err.message}`);
    }
  }, [streamId, getPC, getSocket]);

  // Socket signaling events
  useEffect(() => {
    if (!streamId) return;

    const handleRoomMembers = ({ members }: { members: { socketId: string }[]; yourSocketId: string }) => {
      // I joined into an existing room — existing members are already there
      // As the new peer I initiate the offer to each existing member
      members.forEach(m => sendOffer(m.socketId));
    };

    const handlePeerJoined = ({ socketId }: { socketId: string }) => {
      // Someone joined after me — they will send me an offer; just note their ID
      peerSocketIdRef.current = socketId;
      setPeerDisconnected(false);
    };

    const handleOffer = async ({ offer, fromSocketId }: any) => {
      peerSocketIdRef.current = fromSocketId;
      const sock = getSocket();
      if (!sock) return;
      const pc = getPC();
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sock.emit('webrtc-answer', { targetSocketId: fromSocketId, answer, streamId });
      } catch (err: any) {
        toast.error(`Answer failed: ${err.message}`);
      }
    };

    const handleAnswer = async ({ answer }: any) => {
      try {
        if (pcRef.current && pcRef.current.signalingState !== 'closed') {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        }
      } catch { /* ignore — can race with reconnect */ }
    };

    const handleIce = async ({ candidate }: any) => {
      try {
        if (pcRef.current && pcRef.current.signalingState !== 'closed' && candidate) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch { /* ignore stale candidates */ }
    };

    const handlePeerLeft = () => {
      setHasRemote(false);
      setPeerDisconnected(true);
      peerSocketIdRef.current = null;
      // Reset PC so it's ready for the peer to reconnect
      pcRef.current?.close();
      pcRef.current = null;
      if (remoteRef.current) remoteRef.current.srcObject = null;
    };

    const sock = getSocket();
    if (!sock) return;

    sock.on('room-members',  handleRoomMembers);
    sock.on('peer-joined',   handlePeerJoined);
    sock.on('webrtc-offer',  handleOffer);
    sock.on('webrtc-answer', handleAnswer);
    sock.on('ice-candidate', handleIce);
    sock.on('peer-left',     handlePeerLeft);

    return () => {
      sock.off('room-members',  handleRoomMembers);
      sock.off('peer-joined',   handlePeerJoined);
      sock.off('webrtc-offer',  handleOffer);
      sock.off('webrtc-answer', handleAnswer);
      sock.off('ice-candidate', handleIce);
      sock.off('peer-left',     handlePeerLeft);
    };
  }, [streamId, getPC, getSocket, sendOffer]);

  const stopAll = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    pcRef.current?.close();
    pcRef.current = null;
    peerSocketIdRef.current = null;
    localStreamRef.current = null;
    setLocalStream(null);
    setHasRemote(false);
    setConnState('closed');
    // Emit leave-room on cleanup
    const sock = getSocket();
    if (sock && streamId) sock.emit('leave-stream', { streamId });
  }, [streamId, getSocket]);

  const toggleMic = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setMicMuted(m => !m);
  };
  const toggleCam = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    setCamOff(c => !c);
  };

  return {
    localRef, remoteRef,
    hasRemote, connState, peerDisconnected,
    micMuted, camOff,
    startMedia, stopAll, toggleMic, toggleCam,
    getPC,
  };
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export const DashboardPage: React.FC = () => {
  const { streamId } = useParams<{ streamId: string }>();
  const navigate     = useNavigate();
  const { user }     = useAuthStore();
  const { connect, joinStream } = useSocket();

  const [session,      setSession]      = useState<any>(null);
  const [patientTrust, setPatientTrust] = useState<any>(null);
  const [sessionStart, setSessionStart] = useState<Date | null>(null);
  const [elapsed,      setElapsed]      = useState('00:00');
  const [loading,      setLoading]      = useState(true);
  const [ending,       setEnding]       = useState(false);
  const [blocked,      setBlocked]      = useState<string | null>(null);

  const {
    localRef, remoteRef,
    hasRemote, connState, peerDisconnected,
    micMuted, camOff,
    startMedia, stopAll, toggleMic, toggleCam,
  } = useWebRTC(streamId ?? null, connect);

  // ── Load session detail ──────────────────────────────────────────────────────
  const loadSession = useCallback(async () => {
    if (!streamId) return;
    try {
      const res = await sessionApi.getDetail(streamId);
      const s   = res.data.session;
      setSession(s);
      if (s?.started_at && !sessionStart) setSessionStart(new Date(s.started_at));
    } catch { /* 404 silent */ }
    finally { setLoading(false); }
  }, [streamId, sessionStart]);

  // ── Load patient trust score ───────────────────────────────────────────────
  const loadTrust = useCallback(async () => {
    if (!streamId) return;
    try {
      const res = await sessionApi.getPatientTrust(streamId);
      setPatientTrust(res.data);
      if (res.data.trust_score > 0 && res.data.trust_score < 45) {
        toast.error(`⚠ Patient trust critical: ${res.data.trust_score}`, { id: 'ptrust-critical', duration: 6000 });
      }
    } catch { /* 404 = no data yet */ }
  }, [streamId]);

  // ── Init on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!streamId) { navigate('/doctor-dashboard', { replace: true }); return; }
    connect();
    joinStream(streamId, 'doctor');
    startMedia();
    loadSession();
    loadTrust();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId]);

  // ── Polling ───────────────────────────────────────────────────────────────
  useEffect(() => { const t = setInterval(loadTrust,   8000); return () => clearInterval(t); }, [loadTrust]);
  useEffect(() => { const t = setInterval(loadSession, 12000); return () => clearInterval(t); }, [loadSession]);

  // ── Elapsed timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionStart) return;
    const t = setInterval(() => {
      const diff = Math.floor((Date.now() - sessionStart.getTime()) / 1000);
      setElapsed(`${String(Math.floor(diff / 60)).padStart(2, '0')}:${String(diff % 60).padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(t);
  }, [sessionStart]);

  // ── Socket: session blocked ───────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSessionBlocked((data) => {
      setBlocked(data.reason || 'Session terminated due to risk detection.');
      stopAll();
    });
    return () => { unsub(); };
  }, [stopAll]);

  // ── End session ───────────────────────────────────────────────────────────
  const handleEnd = async () => {
    if (!streamId) return;
    setEnding(true);
    try {
      await sessionApi.cancelSession(streamId);
    } catch { /* still navigate */ }
    stopAll();
    toast.success('Session ended');
    navigate('/doctor-dashboard', { replace: true });
  };

  const trust     = patientTrust?.trust_score ?? 0;
  const trustStat = patientTrust?.status      ?? 'safe';
  const isCritical = trust > 0 && trust < 45;

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader2 size={32} style={{ color: 'var(--status-safe)', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );

  return (
    <div className="page-container" style={{ maxWidth: 1400, display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* ── BLOCKED OVERLAY ── */}
      {blocked && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
        }}>
          <div style={{ ...card, maxWidth: 440, width: '100%', padding: '2.25rem', textAlign: 'center', border: '1px solid var(--status-danger-border)' }}>
            <div style={{
              width: 60, height: 60, borderRadius: '50%',
              background: 'var(--status-danger-dim)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1.25rem',
            }}>
              <XCircle size={30} style={{ color: 'var(--status-danger)' }} />
            </div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--status-danger)', margin: '0 0 0.75rem' }}>
              Session Terminated
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.65, margin: '0 0 1.75rem' }}>
              {blocked}
            </p>
            <button
              className="ds-btn ds-btn-danger"
              style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              onClick={() => navigate('/doctor-dashboard', { replace: true })}
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      )}

      {/* ── HEADER BAR ── */}
      <div style={{ ...card, padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--status-safe)',
              boxShadow: '0 0 6px var(--status-safe)',
              animation: 'status-pulse 2s ease-in-out infinite',
              display: 'inline-block',
            }} />
            <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--status-safe)', textTransform: 'uppercase' }}>
              Live Session
            </span>
          </div>
          <div style={{ width: 1, height: 16, background: 'var(--border-subtle)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <Clock size={12} />
            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{elapsed}</span>
          </div>
          {session?.patient_name && (
            <>
              <div style={{ width: 1, height: 16, background: 'var(--border-subtle)' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Patient: <strong style={{ color: 'var(--text-primary)' }}>{session.patient_name}</strong>
              </span>
            </>
          )}
        </div>
        <button
          className="ds-btn ds-btn-danger ds-btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
          onClick={handleEnd}
          disabled={ending}
        >
          {ending
            ? <Loader2 size={12} style={{ animation: 'spin 0.8s linear infinite' }} />
            : <Square size={10} fill="currentColor" />}
          End Session
        </button>
      </div>

      {/* ── CRITICAL TRUST BANNER ── */}
      {isCritical && (
        <div style={{
          ...card, padding: '0.75rem 1rem',
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          border: '1px solid var(--status-danger-border)',
          background: 'var(--status-danger-dim)',
          animation: 'trustAlert 1.2s ease-in-out infinite',
        }}>
          <AlertTriangle size={15} style={{ color: 'var(--status-danger)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.82rem', color: 'var(--status-danger)', fontWeight: 600 }}>
            Patient session flagged as suspicious — trust score: {trust}. Review immediately.
          </span>
        </div>
      )}

      {/* ── MAIN GRID: 70% / 30% ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1rem', alignItems: 'start' }}>

        {/* ── LEFT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

          {/* VIDEO CALL PANEL */}
          <div style={{ ...card, overflow: 'hidden' }}>
            {/* Panel header */}
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Video size={13} style={{ color: 'var(--accent-blue)' }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Patient Video Call</span>
              {session?.patient_name && (
                <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                  {session.patient_name}
                </span>
              )}
            </div>

            {/* Video area */}
            <div style={{ position: 'relative', background: '#080810', aspectRatio: '16/9', overflow: 'hidden' }}>
              {/* Remote patient video — large */}
              <video
                ref={remoteRef}
                autoPlay
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />

              {/* Placeholder: waiting / peer disconnected / connecting */}
              {!hasRemote && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: '0.875rem',
                }}>
                  <div style={{
                    width: 72, height: 72, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.05)',
                    border: '2px solid rgba(255,255,255,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {connState === 'connecting' || connState === 'checking'
                      ? <Loader2 size={30} style={{ color: 'rgba(255,255,255,0.5)', animation: 'spin 0.8s linear infinite' }} />
                      : <User size={30} style={{ color: 'rgba(255,255,255,0.25)' }} />}
                  </div>
                  <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 500,
                    color: peerDisconnected ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.3)' }}>
                    {peerDisconnected
                      ? 'Patient disconnected'
                      : connState === 'connecting' || connState === 'checking'
                        ? 'Establishing connection…'
                        : connState === 'failed'
                          ? 'Connection failed — retrying…'
                          : 'Waiting for patient to connect…'}
                  </p>
                  {connState !== 'new' && connState !== 'closed' && !peerDisconnected && (
                    <span style={{
                      fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)',
                      fontFamily: 'monospace', letterSpacing: '0.06em',
                    }}>
                      ICE: {connState}
                    </span>
                  )}
                </div>
              )}

              {/* Doctor self-preview — corner pip */}
              <div style={{
                position: 'absolute', bottom: 12, right: 12,
                width: 140, height: 90,
                background: '#111', borderRadius: 10,
                border: '2px solid rgba(255,255,255,0.15)',
                overflow: 'hidden',
                boxShadow: '0 4px 20px rgba(0,0,0,0.7)',
              }}>
                <video
                  ref={localRef}
                  autoPlay muted playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
                />
                {camOff && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: '#111',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <VideoOff size={18} style={{ color: 'rgba(255,255,255,0.3)' }} />
                  </div>
                )}
                <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', fontSize: '0.58rem', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.04em' }}>
                  YOU
                </div>
              </div>
            </div>

            {/* Call controls */}
            <div style={{ padding: '0.875rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.25rem' }}>
              <button
                onClick={toggleMic}
                title={micMuted ? 'Unmute' : 'Mute'}
                style={{
                  width: 44, height: 44, borderRadius: '50%', cursor: 'pointer',
                  background: micMuted ? 'var(--status-danger-dim)' : 'var(--bg-elevated)',
                  border: `1px solid ${micMuted ? 'var(--status-danger-border)' : 'var(--border-default)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 150ms ease',
                }}
              >
                {micMuted
                  ? <MicOff size={16} style={{ color: 'var(--status-danger)' }} />
                  : <Mic    size={16} style={{ color: 'var(--text-secondary)' }} />}
              </button>

              <button
                onClick={toggleCam}
                title={camOff ? 'Enable Camera' : 'Disable Camera'}
                style={{
                  width: 44, height: 44, borderRadius: '50%', cursor: 'pointer',
                  background: camOff ? 'var(--status-danger-dim)' : 'var(--bg-elevated)',
                  border: `1px solid ${camOff ? 'var(--status-danger-border)' : 'var(--border-default)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 150ms ease',
                }}
              >
                {camOff
                  ? <VideoOff size={16} style={{ color: 'var(--status-danger)' }} />
                  : <Video    size={16} style={{ color: 'var(--text-secondary)' }} />}
              </button>

              <button
                onClick={handleEnd}
                disabled={ending}
                title="End Session"
                style={{
                  width: 52, height: 52, borderRadius: '50%', cursor: 'pointer',
                  background: 'var(--status-danger)',
                  border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 2px 14px rgba(239,68,68,0.45)',
                  transition: 'transform 150ms ease',
                }}
              >
                {ending
                  ? <Loader2 size={18} style={{ color: '#fff', animation: 'spin 0.8s linear infinite' }} />
                  : <PhoneOff size={18} style={{ color: '#fff' }} />}
              </button>
            </div>
          </div>

          {/* CONNECTED PATIENT DETAILS */}
          {session && (
            <div style={{ ...card, padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <Activity size={14} style={{ color: 'var(--accent-blue)' }} />
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>Connected Patient Details</span>
                <button className="ds-btn ds-btn-ghost ds-btn-sm" style={{ marginLeft: 'auto' }} onClick={loadSession}>
                  <RefreshCw size={11} />
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.25rem' }}>
                <DetailRow label="Patient Name"      value={session.patient_name} />
                <DetailRow label="Patient ID"        value={session.health_id} />
                <DetailRow label="Email"             value={session.patient_email} />
                <DetailRow label="Medical Condition" value={session.condition_notes} />
                <DetailRow label="Prev. Sessions"    value={session.previous_sessions} />
                <DetailRow label="Risk Events"       value={session.risk_events} />
                <DetailRow label="Session ID"        value={session.id ? `${String(session.id).slice(0, 13)}…` : undefined} />
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

          {/* PATIENT TRUST SCORE */}
          <div style={{
            ...card,
            padding: '1.25rem 1rem',
            border: `1px solid ${trustBorder(trustStat)}`,
            background: trustBg(trustStat),
            transition: 'border-color 0.3s ease, background 0.3s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
              <Shield size={14} style={{ color: trustColor(trustStat) }} />
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>Patient Trust Score</span>
              <button className="ds-btn ds-btn-ghost ds-btn-sm" style={{ marginLeft: 'auto' }} onClick={loadTrust} title="Refresh">
                <RefreshCw size={11} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.625rem', marginBottom: '1.125rem' }}>
              <TrustGauge score={trust} status={trustStat} />
              <span style={{
                fontSize: '0.7rem', fontWeight: 700,
                padding: '0.22rem 0.65rem', borderRadius: 99,
                background: trustBg(trustStat),
                border: `1px solid ${trustBorder(trustStat)}`,
                color: trustColor(trustStat),
                display: 'flex', alignItems: 'center', gap: '0.3rem',
              }}>
                {patientTrust ? (
                  trustStat === 'safe'       ? <><CheckCircle size={10} />SAFE</>
                  : trustStat === 'suspicious' ? <><AlertTriangle size={10} />SUSPICIOUS</>
                  : <><XCircle size={10} />BLOCKED</>
                ) : 'Awaiting data…'}
              </span>
            </div>

            {patientTrust ? (
              <>
                <ScoreBar label="Face Verification"  value={Math.round(patientTrust.face_score      ?? 0)} />
                <ScoreBar label="Voice Match"         value={Math.round(patientTrust.voice_score     ?? 0)} />
                <ScoreBar label="Biometric Sync"      value={Math.round(patientTrust.biometric_score ?? 0)} />
              </>
            ) : (
              <p style={{ margin: 0, textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>
                Score updates every 8 seconds
              </p>
            )}
          </div>

          {/* SESSION STATUS */}
          <div style={{ ...card, padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.875rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
              <Clock size={14} style={{ color: 'var(--accent-blue)' }} />
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>Session Status</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginBottom: '1rem' }}>
              {([
                { label: 'Session ID', value: streamId ? `${streamId.slice(0, 13)}…` : '—', mono: true },
                { label: 'Duration',   value: elapsed, mono: true },
                { label: 'Doctor',     value: (user as any)?.name || '—' },
                { label: 'Status',     value: session?.status ?? 'active' },
              ] as { label: string; value: string; mono?: boolean }[]).map(({ label, value, mono }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{label}</span>
                  <span style={{
                    fontSize: '0.74rem',
                    fontFamily: mono ? 'monospace' : 'inherit',
                    fontWeight: 500,
                    color: label === 'Status'
                      ? (session?.status === 'active' ? 'var(--status-safe)' : 'var(--text-secondary)')
                      : 'var(--text-secondary)',
                  }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ padding: '0.6rem 0.75rem', background: 'var(--status-safe-dim)', border: '1px solid var(--status-safe-border)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '1rem' }}>
              <BadgeCheck size={13} style={{ color: 'var(--status-safe)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.7rem', color: 'var(--status-safe)', fontWeight: 600 }}>Identity verified before session</span>
            </div>

            <button
              className="ds-btn ds-btn-danger"
              style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              onClick={handleEnd}
              disabled={ending}
            >
              {ending
                ? <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} />
                : <PhoneOff size={13} />}
              End Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
