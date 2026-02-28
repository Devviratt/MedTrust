import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Video, VideoOff, Wifi, WifiOff, Maximize2, CameraOff, Square, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStreamStore } from '../../store/streamStore';
import api from '../../services/api';

interface VideoPanelProps {
  streamId: string | null;
  doctorName?: string;
  icuRoom?: string;
}

// ── PHASE 5: HTTPS guard ──────────────────────────────────────────────────────
const isSecureContext = (): boolean => {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return window.location.protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1';
};

// ── Human-readable camera error messages ─────────────────────────────────────
const getCameraErrorMessage = (err: unknown): string => {
  if (err instanceof Error) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return 'Camera permission denied. Allow camera access in your browser settings.';
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return 'No camera found. Connect a camera and try again.';
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return 'Camera is in use by another application.';
    }
    if (err.name === 'OverconstrainedError') {
      return 'Camera does not support the requested resolution.';
    }
    if (err.name === 'NotSupportedError') {
      return 'Camera not supported in this browser.';
    }
    return err.message || 'Could not access camera.';
  }
  return 'Could not access camera.';
};

// ── Canvas helper: capture a JPEG frame from a video element ────────────────────
const captureFrame = (videoEl: HTMLVideoElement): string | null => {
  try {
    const canvas = document.createElement('canvas');
    canvas.width  = videoEl.videoWidth  || 320;
    canvas.height = videoEl.videoHeight || 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    // Return base64-encoded JPEG (strip the data-URL prefix)
    return canvas.toDataURL('image/jpeg', 0.6).split(',')[1] ?? null;
  } catch {
    return null;
  }
};

export const VideoPanel: React.FC<VideoPanelProps> = ({ streamId, doctorName, icuRoom }) => {
  const { isStreaming, trustScore } = useStreamStore();

  const [localStream, setLocalStream]     = useState<MediaStream | null>(null);
  const [cameraError, setCameraError]     = useState<string>('');
  const [cameraLoading, setCameraLoading] = useState(false);

  const localVideoRef    = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef   = useRef<HTMLVideoElement | null>(null);
  const frameTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const analyserRef      = useRef<AnalyserNode | null>(null);
  const offCanvasRef     = useRef<HTMLCanvasElement | null>(null);

  // Sync localStream → video element
  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  // ref so auto-start effect can call startCamera without stale closure
  const startCameraRef = useRef<() => Promise<void>>();

  // ── Production frame + biometric + voice pipeline ─────────────────────────────
  useEffect(() => {
    const active = localStream !== null && !!streamId && streamId.length >= 10;

    if (!active) {
      [frameTimerRef, pulseTimerRef, voiceTimerRef].forEach(r => {
        if (r.current) { clearInterval(r.current); r.current = null; }
      });
      return;
    }

    // ── Off-screen canvas for biometric ROI ──────────────────────────────
    if (!offCanvasRef.current) {
      offCanvasRef.current = document.createElement('canvas');
    }

    // ── Audio analyser for MFCC proxy ───────────────────────────────────
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack && !audioCtxRef.current) {
      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(localStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
      } catch { /* audio context unavailable */ }
    }

    // ── 1. Frame every 2s → POST /analyze/frame/:streamId ────────────────────
    const sendFrame = async () => {
      const videoEl = localVideoRef.current;
      if (!videoEl || videoEl.readyState < 2) return;
      const frameData = captureFrame(videoEl);
      if (!frameData) return;
      try {
        const res = await api.post(`/analyze/frame/${streamId}`, { frame: frameData });
        if (res.data) {
          useStreamStore.getState().updateTrustScore({
            ...res.data,
            stream_id: streamId!,
            timestamp: new Date().toISOString(),
          });
        }
      } catch { /* non-fatal — dashboard also polls */ }
    };

    // ── 2. Biometric pulse every 500ms → socket biometric:pulse ──────────────
    // Extract average luminance of face ROI from canvas (MediaPipe not required
    // — we use the central 30% of the frame as a face proxy for stability)
    const sendPulse = () => {
      const videoEl = localVideoRef.current;
      const canvas  = offCanvasRef.current;
      if (!videoEl || !canvas || videoEl.readyState < 2) return;
      try {
        const W = videoEl.videoWidth  || 320;
        const H = videoEl.videoHeight || 240;
        // Sample central 30% region (face proxy)
        const rx = Math.floor(W * 0.35), ry = Math.floor(H * 0.20);
        const rw = Math.floor(W * 0.30), rh = Math.floor(H * 0.40);
        canvas.width = rw; canvas.height = rh;
        const ctx2d = canvas.getContext('2d');
        if (!ctx2d) return;
        ctx2d.drawImage(videoEl, rx, ry, rw, rh, 0, 0, rw, rh);
        const px = ctx2d.getImageData(0, 0, rw, rh).data;
        // Average luminance over all pixels (Y = 0.299R + 0.587G + 0.114B)
        let lum = 0;
        const total = px.length / 4;
        for (let i = 0; i < px.length; i += 4)
          lum += 0.299 * px[i] + 0.587 * px[i+1] + 0.114 * px[i+2];
        const avgLum = lum / total;
        const socket = (window as any).__medtrustSocket;
        if (socket?.connected) {
          socket.emit('biometric:pulse', {
            stream_id: streamId,
            value: avgLum,
            timestamp: Date.now(),
          });
        }
      } catch { /* non-fatal */ }
    };

    // ── 3. Voice MFCC every 3s → socket voice:mfcc ───────────────────────
    // Use Web Audio FFT frequency bins as MFCC band energy proxy
    const sendVoice = () => {
      const analyser = analyserRef.current;
      if (!analyser) return;
      try {
        const bins = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(bins);
        // Convert dB values to linear energy, sample 13 mel-spaced bands
        const bandCount = 13;
        const bandSize = Math.floor(bins.length / bandCount);
        const features: number[] = [];
        for (let b = 0; b < bandCount; b++) {
          let energy = 0;
          for (let k = b * bandSize; k < (b + 1) * bandSize && k < bins.length; k++)
            energy += Math.pow(10, bins[k] / 10); // dB to linear
          features.push(energy / bandSize);
        }
        const socket = (window as any).__medtrustSocket;
        if (socket?.connected) {
          socket.emit('voice:mfcc', {
            stream_id: streamId,
            features,
            timestamp: Date.now(),
          });
        }
      } catch { /* non-fatal */ }
    };

    // Fire immediately then on interval
    sendFrame();
    sendPulse();
    frameTimerRef.current = setInterval(sendFrame, 5000);  // 5s — enough for AI analysis
    pulseTimerRef.current = setInterval(sendPulse,  1000);  // 1s — biometric pulse
    voiceTimerRef.current = setInterval(sendVoice, 5000);   // 5s — voice MFCC

    return () => {
      [frameTimerRef, pulseTimerRef, voiceTimerRef].forEach(r => {
        if (r.current) { clearInterval(r.current); r.current = null; }
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStream, streamId]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach(t => t.stop());
      audioCtxRef.current?.close().catch(() => {});
      [frameTimerRef, pulseTimerRef, voiceTimerRef].forEach(r => {
        if (r.current) clearInterval(r.current);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── PHASE 1 + 2: start camera ─────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    startCameraRef.current = startCamera as any; // keep ref in sync
    // PHASE 5: HTTPS check
    if (!isSecureContext()) {
      const msg = 'Camera requires a secure context (HTTPS or localhost).';
      setCameraError(msg);
      toast.error(msg, { id: 'https-required', duration: 6000 });
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = 'getUserMedia not supported in this browser.';
      setCameraError(msg);
      toast.error(msg, { id: 'no-getusermedia' });
      return;
    }

    setCameraLoading(true);
    setCameraError('');

    try {
      // PHASE 1: request camera + audio
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });

      // PHASE 1: assign to video element and force play (Safari requires this)
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }

      // PHASE 3: store in state — triggers re-render to show video
      setLocalStream(stream);
    } catch (err) {
      // PHASE 2: error handling with toast
      const msg = getCameraErrorMessage(err);
      setCameraError(msg);
      toast.error(msg, { id: 'camera-error', duration: 5000 });
    } finally {
      setCameraLoading(false);
    }
  }, []);

  // ── Stop camera ───────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    localStream?.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
    setCameraError('');
    [frameTimerRef, pulseTimerRef, voiceTimerRef].forEach(r => {
      if (r.current) { clearInterval(r.current); r.current = null; }
    });
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
  }, [localStream]);

  // Auto-start camera when a stream becomes active (placed after startCamera is defined)
  const streamIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      streamId && streamId.length >= 10 &&
      streamId !== streamIdRef.current &&
      !localStream && isSecureContext()
    ) {
      streamIdRef.current = streamId;
      startCamera();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId, localStream]);

  // ── Fullscreen ────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const handleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  // ── Trust score overlay styles ────────────────────────────────────────────
  const statusBorderColor = trustScore
    ? trustScore.status === 'safe'        ? 'rgba(34,197,94,0.35)'
      : trustScore.status === 'suspicious' ? 'rgba(245,158,11,0.35)'
      : 'rgba(239,68,68,0.55)'
    : 'var(--border-default)';

  const badgeStyle = trustScore ? ({
    safe:       { bg: 'rgba(34,197,94,0.15)',  color: '#4ade80', border: 'rgba(34,197,94,0.3)' },
    suspicious: { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: 'rgba(245,158,11,0.3)' },
    alert:      { bg: 'rgba(239,68,68,0.15)',  color: '#f87171', border: 'rgba(239,68,68,0.3)' },
  } as const)[trustScore.status as 'safe' | 'suspicious' | 'alert'] : null;

  const cameraActive = localStream !== null;

  return (
    <div className="panel">
      {/* ── Header ── */}
      <div className="panel-header">
        <div className="panel-title">
          <Video size={14} strokeWidth={1.75} className="panel-title-icon" />
          Live ICU Feed
          {icuRoom && (
            <span style={{
              fontSize: '0.6875rem', fontFamily: 'monospace',
              color: 'var(--text-muted)', background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)', borderRadius: 99,
              padding: '0.1rem 0.5rem',
            }}>
              {icuRoom}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Camera active indicator */}
          {cameraActive && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', color: 'var(--status-safe)', fontFamily: 'monospace' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-safe)', display: 'inline-block' }} />
              CAM
            </span>
          )}
          {/* WebRTC stream indicator */}
          {isStreaming ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', color: 'var(--status-safe)', fontFamily: 'monospace' }}>
              <Wifi size={13} /> LIVE
            </span>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              <WifiOff size={13} /> OFFLINE
            </span>
          )}
          <button
            className="ds-btn ds-btn-ghost ds-btn-sm"
            title="Fullscreen"
            style={{ padding: '0.25rem' }}
            onClick={handleFullscreen}
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      <div style={{ padding: '0 1.125rem 1rem' }}>

        {/* ── PHASE 5: HTTPS warning ── */}
        {!isSecureContext() && (
          <div className="ds-alert ds-alert-warn" style={{ marginBottom: '0.75rem', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, color: 'var(--status-warn)' }} />
            <span style={{ fontSize: '0.8125rem' }}>
              Camera requires a secure context (HTTPS). Camera access is unavailable on plain HTTP outside localhost.
            </span>
          </div>
        )}

        {/* ── Main video area ── */}
        <div
          ref={containerRef}
          className="video-container"
          style={{ border: `2px solid ${statusBorderColor}`, transition: 'border-color 0.5s ease' }}
        >
          <div style={{ position: 'relative', paddingTop: '56.25%', background: '#000', borderRadius: 'inherit', overflow: 'hidden' }}>

            {/* Remote WebRTC stream (behind local camera, shown only when real peer connects) */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted={false}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover',
                display: 'block',
                zIndex: 1,
              }}
            />

            {/* ── PHASE 3: local camera preview — always shown when cameraActive ── */}
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover',
                display: cameraActive ? 'block' : 'none',
                zIndex: 2,
              }}
            />

            {/* Scan line overlay — shown when camera or stream is active */}
            {(isStreaming || cameraActive) && <div className="scan-line" />}

            {/* ── PHASE 3: empty state — only when no camera AND no remote stream ── */}
            {!cameraActive && !isStreaming && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: '0.875rem', padding: '1rem',
              }}>
                {cameraError ? (
                  <>
                    <CameraOff size={32} style={{ color: 'rgba(239,68,68,0.6)' }} strokeWidth={1.5} />
                    <p style={{ fontSize: '0.8125rem', color: 'var(--status-danger)', textAlign: 'center', maxWidth: 260, lineHeight: 1.5 }}>
                      {cameraError}
                    </p>
                    {isSecureContext() && (
                      <button
                        onClick={startCamera}
                        className="ds-btn ds-btn-ghost ds-btn-sm"
                        disabled={cameraLoading}
                      >
                        {cameraLoading ? 'Requesting…' : 'Try Again'}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <VideoOff size={32} style={{ color: 'rgba(255,255,255,0.18)' }} strokeWidth={1.5} />
                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No active stream</p>
                    {/* ── PHASE 1: Start Camera button ── */}
                    {isSecureContext() && (
                      <button
                        onClick={startCamera}
                        className="ds-btn ds-btn-primary ds-btn-sm"
                        disabled={cameraLoading}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                      >
                        <Video size={13} strokeWidth={1.75} />
                        {cameraLoading ? 'Requesting camera…' : 'Start Camera Preview'}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Trust score badge */}
            {(isStreaming || cameraActive) && badgeStyle && trustScore && (
              <div style={{
                position: 'absolute', top: 10, right: 10,
                background: badgeStyle.bg, color: badgeStyle.color,
                border: `1px solid ${badgeStyle.border}`,
                borderRadius: 99, padding: '0.2rem 0.6rem',
                fontSize: '0.6875rem', fontWeight: 700, fontFamily: 'monospace',
                backdropFilter: 'blur(4px)',
              }}>
                {trustScore.status.toUpperCase()} · {trustScore.trust_score}
              </div>
            )}

            {/* Doctor name label */}
            {doctorName && (
              <div style={{
                position: 'absolute', bottom: 10, left: 10,
                background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                borderRadius: 'var(--radius-sm)', padding: '0.2rem 0.5rem',
              }}>
                <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{doctorName}</p>
              </div>
            )}

            {/* Stop camera button — bottom right when active */}
            {cameraActive && (
              <button
                onClick={stopCamera}
                style={{
                  position: 'absolute', bottom: 10, right: 10,
                  display: 'flex', alignItems: 'center', gap: '0.3rem',
                  background: 'rgba(239,68,68,0.85)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  padding: '0.25rem 0.6rem', fontSize: '0.6875rem',
                  fontWeight: 600, cursor: 'pointer', fontFamily: 'monospace',
                  backdropFilter: 'blur(4px)',
                }}
                title="Stop camera"
              >
                <Square size={10} fill="currentColor" /> STOP
              </button>
            )}
          </div>
        </div>

        {/* ── Controls row: show Start Camera whenever camera is off ── */}
        {!cameraActive && isSecureContext() && !cameraError && (
          <div style={{
            marginTop: '0.625rem',
            padding: '0.5rem 0.875rem',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.75rem',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)' }}>
              <Video size={12} strokeWidth={1.75} />
              Camera not started
            </span>
            <button
              onClick={startCamera}
              disabled={cameraLoading}
              className="ds-btn ds-btn-primary ds-btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Video size={12} strokeWidth={1.75} />
              {cameraLoading ? 'Starting…' : 'Start Camera'}
            </button>
          </div>
        )}

        {/* ── Camera active info bar ── */}
        {cameraActive && (
          <div style={{
            marginTop: '0.625rem',
            padding: '0.5rem 0.875rem',
            background: 'rgba(34,197,94,0.06)',
            border: '1px solid rgba(34,197,94,0.18)',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.75rem',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-safe)', display: 'inline-block', flexShrink: 0 }} />
            <span style={{ color: 'var(--status-safe)', fontFamily: 'monospace', fontWeight: 600 }}>Camera active</span>
            <span style={{ color: 'var(--text-muted)' }}>
              · {localStream?.getVideoTracks()[0]?.label || 'Camera'} · {localStream?.getAudioTracks().length ? 'Audio on' : 'No audio'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
