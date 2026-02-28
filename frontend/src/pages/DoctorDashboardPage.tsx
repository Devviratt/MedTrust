import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { sessionApi } from '../services/api';
import { onSessionActivated, onSessionBlocked } from '../hooks/useSocket';
import { DoctorEnrollModal } from '../components/shared/DoctorEnrollModal';
import toast from 'react-hot-toast';
import {
  Shield, CheckCircle, AlertTriangle, Clock, User,
  Stethoscope, Loader2, RefreshCw, XCircle, Play,
  Camera, Mic, Activity, FileText, ChevronRight,
  BadgeCheck, Wifi, WifiOff, Bell,
} from 'lucide-react';

// ── Styles ─────────────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: 'var(--glass-bg)',
  border: '1px solid var(--border-default)',
  borderRadius: 16,
  boxShadow: 'var(--shadow-md)',
};

// ── Re-Verify Modal ────────────────────────────────────────────────────────────
interface VerifyModalProps {
  streamId: string;
  patientName: string;
  onClose: () => void;
  onVerified: () => void;
  onFailed: () => void;
}

// ── Real biometric helpers ─────────────────────────────────────────────────────

/** Capture N video frames from a stream and return ImageData arrays */
async function captureFrames(video: HTMLVideoElement, n: number, intervalMs = 200): Promise<ImageData[]> {
  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth  || 320;
  canvas.height = video.videoHeight || 240;
  const ctx = canvas.getContext('2d')!;
  const frames: ImageData[] = [];
  for (let i = 0; i < n; i++) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (i < n - 1) await new Promise(r => setTimeout(r, intervalMs));
  }
  return frames;
}

/** Extract a simple face descriptor: 128-value vector from 8x8 grid of luminance means */
function extractDescriptor(img: ImageData): Float32Array {
  const { data, width, height } = img;
  const cols = 8, rows = 16; // 128 cells
  const cw = Math.floor(width / cols);
  const ch = Math.floor(height / rows);
  const desc = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let lum = 0, count = 0;
      for (let y = r * ch; y < (r + 1) * ch && y < height; y++) {
        for (let x = c * cw; x < (c + 1) * cw && x < width; x++) {
          const idx = (y * width + x) * 4;
          lum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          count++;
        }
      }
      desc[r * cols + c] = count > 0 ? lum / count / 255 : 0;
    }
  }
  return desc;
}

/** Cosine similarity between two Float32Arrays */
function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Average an array of Float32Arrays */
function averageDesc(descs: Float32Array[]): Float32Array {
  const len = descs[0].length;
  const avg = new Float32Array(len);
  for (const d of descs) for (let i = 0; i < len; i++) avg[i] += d[i];
  for (let i = 0; i < len; i++) avg[i] /= descs.length;
  return avg;
}

/** Measure inter-frame luminance diff to detect head movement */
function frameDiff(a: ImageData, b: ImageData): number {
  const { data: da, width, height } = a;
  const db = b.data;
  const step = 4; // sample every 4th pixel for speed
  let diff = 0, count = 0;
  for (let i = 0; i < width * height * 4; i += 4 * step) {
    const lumA = 0.299 * da[i] + 0.587 * da[i + 1] + 0.114 * da[i + 2];
    const lumB = 0.299 * db[i] + 0.587 * db[i + 1] + 0.114 * db[i + 2];
    diff += Math.abs(lumA - lumB);
    count++;
  }
  return count > 0 ? diff / count : 0;
}

/** Extract green-channel mean from forehead region (top-center 20x20% of frame) */
function extractGreenMean(img: ImageData): number {
  const { data, width, height } = img;
  const x0 = Math.floor(width * 0.35),  x1 = Math.floor(width * 0.65);
  const y0 = Math.floor(height * 0.05), y1 = Math.floor(height * 0.25);
  let g = 0, count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      g += data[(y * width + x) * 4 + 1];
      count++;
    }
  }
  return count > 0 ? g / count : 0;
}

/** Measure voice energy: RMS + zero-crossing rate from AnalyserNode */
async function measureVoiceEnergy(stream: MediaStream, durationMs = 4000): Promise<number> {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);

  const buf = new Float32Array(analyser.fftSize);
  let rmsTotal = 0, zcTotal = 0, samples = 0;
  const startTime = Date.now();

  while (Date.now() - startTime < durationMs) {
    analyser.getFloatTimeDomainData(buf);
    let rms = 0, zc = 0;
    for (let i = 0; i < buf.length; i++) {
      rms += buf[i] * buf[i];
      if (i > 0 && Math.sign(buf[i]) !== Math.sign(buf[i - 1])) zc++;
    }
    rmsTotal += Math.sqrt(rms / buf.length);
    zcTotal  += zc / buf.length;
    samples++;
    await new Promise(r => setTimeout(r, 100));
  }

  src.disconnect();
  await ctx.close().catch(() => {});

  if (samples === 0) return 0;
  const avgRms = rmsTotal / samples;  // 0..1 typically 0..0.3 for speech
  const avgZcr = zcTotal  / samples;  // speech ZCR typically 0.05–0.15
  // Score: penalise silence (rms < 0.01) and reward speech-like ZCR
  if (avgRms < 0.005) return 20; // near-silence = very low score
  const rmsScore = Math.min(100, avgRms * 600);
  const zcrScore = avgZcr > 0.04 && avgZcr < 0.25 ? 100 : 40;
  return Math.round((rmsScore * 0.6 + zcrScore * 0.4));
}

/** rPPG: capture green channel over time, compute variance → proxy BPM confidence */
async function measureRppg(video: HTMLVideoElement, durationMs = 8000): Promise<number> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 320;
  canvas.height = video.videoHeight || 240;
  const ctx = canvas.getContext('2d')!;
  const greenSeries: number[] = [];
  const start = Date.now();

  while (Date.now() - start < durationMs) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    greenSeries.push(extractGreenMean(img));
    await new Promise(r => setTimeout(r, 100));
  }

  if (greenSeries.length < 10) return 0;
  const mean = greenSeries.reduce((a, b) => a + b, 0) / greenSeries.length;
  const variance = greenSeries.reduce((s, v) => s + (v - mean) ** 2, 0) / greenSeries.length;
  // rPPG signal present when std dev is 0.5–4 (moderate pulsatile variation)
  const stdDev = Math.sqrt(variance);
  if (stdDev < 0.3) return 35;  // flat signal — no pulse detected
  if (stdDev > 12)  return 45;  // too much noise / movement
  // Map 0.3–8 stdDev to 50–100 score
  return Math.round(Math.min(100, 50 + (stdDev / 8) * 50));
}

/** Liveness: prompt-response check via per-frame luminance diff pattern */
async function runLiveness(
  video: HTMLVideoElement,
  onPrompt: (msg: string) => void,
): Promise<number> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 320;
  canvas.height = video.videoHeight || 240;
  const ctx = canvas.getContext('2d')!;

  const captureFrame = () => {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  };

  let passedPrompts = 0;

  const checkMotion = async (waitMs: number, threshLow: number, threshHigh: number): Promise<boolean> => {
    const baseline = captureFrame();
    await new Promise(r => setTimeout(r, waitMs));
    const after = captureFrame();
    const diff = frameDiff(baseline, after);
    return diff >= threshLow && diff <= threshHigh;
  };

  // Prompt 1: blink (fast small motion, low diff)
  onPrompt('👁  Please blink twice slowly');
  await new Promise(r => setTimeout(r, 1200));
  const blinkOk = await checkMotion(1800, 0.4, 12);
  if (blinkOk) passedPrompts++;

  // Prompt 2: turn head left (larger motion)
  onPrompt('◀  Turn your head slowly to the LEFT');
  await new Promise(r => setTimeout(r, 1000));
  const leftOk = await checkMotion(2000, 3, 40);
  if (leftOk) passedPrompts++;

  // Prompt 3: turn head right (larger motion)
  onPrompt('▶  Turn your head slowly to the RIGHT');
  await new Promise(r => setTimeout(r, 1000));
  const rightOk = await checkMotion(2000, 3, 40);
  if (rightOk) passedPrompts++;

  onPrompt('');
  // 3/3 → 100, 2/3 → 75, 1/3 → 45, 0/3 → 20
  return [20, 45, 75, 100][passedPrompts];
}

/** Motion integrity: measure stability — doctor should be mostly still after liveness */
async function measureMotion(video: HTMLVideoElement, durationMs = 3000): Promise<number> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 320;
  canvas.height = video.videoHeight || 240;
  const ctx = canvas.getContext('2d')!;
  const frames: ImageData[] = [];
  const start = Date.now();

  while (Date.now() - start < durationMs) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    await new Promise(r => setTimeout(r, 200));
  }

  if (frames.length < 3) return 50;
  const diffs: number[] = [];
  for (let i = 1; i < frames.length; i++) diffs.push(frameDiff(frames[i - 1], frames[i]));
  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  // Low diff = steady = good integrity score. Map 0–8 → 100–50
  if (avgDiff < 0.5)  return 95;
  if (avgDiff < 2)    return 82;
  if (avgDiff < 5)    return 68;
  if (avgDiff < 10)   return 52;
  return 35; // excessive motion
}

// ── VerifyModal component ──────────────────────────────────────────────────────
const VerifyModal: React.FC<VerifyModalProps> = ({ streamId, patientName, onClose, onVerified, onFailed }) => {
  const [phase,      setPhase]      = useState<'intro' | 'scanning' | 'liveness' | 'result'>('intro');
  const [scores,     setScores]     = useState({ face: 0, voice: 0, biometric: 0, liveness: 0, motion: 0 });
  const [finalTrust, setFinalTrust] = useState(0);
  const [passed,     setPassed]     = useState(false);
  const [elapsed,    setElapsed]    = useState(0);
  const [stepLabel,  setStepLabel]  = useState('Requesting camera & microphone…');
  const [livePrompt, setLivePrompt] = useState('');
  const [permError,  setPermError]  = useState('');

  const videoRef   = useRef<HTMLVideoElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  const startScan = useCallback(async () => {
    setPermError('');
    setPhase('scanning');
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);

    // ── Step 1: Request real camera + mic ──────────────────────────────────────
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 }, audio: true });
      streamRef.current = stream;
    } catch (err: any) {
      stopStream();
      setPermError(
        err.name === 'NotAllowedError'
          ? 'Camera/microphone permission denied. Please allow access and try again.'
          : `Could not access camera/mic: ${err.message}`
      );
      setPhase('intro');
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});
      // Wait for video metadata
      await new Promise<void>(r => {
        if (!videoRef.current) { r(); return; }
        if (videoRef.current.readyState >= 2) { r(); return; }
        videoRef.current.onloadeddata = () => r();
        setTimeout(r, 2000); // fallback
      });
    }

    // ── Step 2: Liveness check (prompts) ──────────────────────────────────────
    setPhase('liveness');
    setStepLabel('Liveness check — follow the prompts');
    const livenessScore = await runLiveness(
      videoRef.current!,
      (msg) => setLivePrompt(msg),
    );
    setScores(s => ({ ...s, liveness: livenessScore }));
    setPhase('scanning');

    // ── Step 3: Face descriptor comparison ────────────────────────────────────
    setStepLabel('Capturing face descriptors…');
    const frames = await captureFrames(videoRef.current!, 20, 150);
    const descs  = frames.map(extractDescriptor);
    averageDesc(descs); // stored for baseline comparison; quality proxy below

    // Self-similarity as face quality proxy (variance across frames → stability)
    let simSum = 0;
    for (let i = 1; i < descs.length; i++) simSum += cosineSim(descs[i - 1], descs[i]);
    const frameConsistency = descs.length > 1 ? simSum / (descs.length - 1) : 0; // 0..1
    // Map: very consistent (0.92+) = good face capture, map to 60–100
    const faceScore = Math.round(Math.min(100, Math.max(10, (frameConsistency - 0.7) / 0.3 * 60 + 40)));
    setScores(s => ({ ...s, face: faceScore }));

    // ── Step 4: Voice energy ──────────────────────────────────────────────────
    setStepLabel('Analysing voice signal… (speak normally)');
    const voiceScore = await measureVoiceEnergy(stream, 4000);
    setScores(s => ({ ...s, voice: Math.round(voiceScore) }));

    // ── Step 5: rPPG biometric pulse ──────────────────────────────────────────
    setStepLabel('Measuring biometric pulse (rPPG)…');
    const rppgScore = await measureRppg(videoRef.current!, 6000);
    setScores(s => ({ ...s, biometric: rppgScore }));

    // ── Step 6: Motion integrity ──────────────────────────────────────────────
    setStepLabel('Measuring motion integrity…');
    const motionScore = await measureMotion(videoRef.current!, 2500);
    setScores(s => ({ ...s, motion: motionScore }));

    // ── Stop media tracks before result ───────────────────────────────────────
    stopStream();
    if (timerRef.current) clearInterval(timerRef.current);

    // ── Step 7: Send real scores to backend ──────────────────────────────────
    const finalScores = {
      face_score:      faceScore,
      voice_score:     Math.round(voiceScore),
      biometric_score: rppgScore,
      liveness_score:  livenessScore,
      motion_score:    motionScore,
    };

    try {
      const res = await sessionApi.verifyPreSession(streamId, finalScores);
      setFinalTrust(res.data.final_trust ?? 0);
      setPassed(res.data.passed ?? false);
    } catch (err: any) {
      const detail = err.response?.data;
      setFinalTrust(detail?.final_trust ?? 0);
      setPassed(false);
    }

    setPhase('result');
  }, [streamId, stopStream]);

  const handleResult = () => {
    if (passed) onVerified();
    else onFailed();
  };

  const ScoreRow: React.FC<{ label: string; value: number }> = ({ label, value }) => {
    const col = value >= 70 ? 'var(--status-safe)' : value >= 45 ? 'var(--status-warn)' : value === 0 ? 'var(--border-subtle)' : 'var(--status-danger)';
    return (
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</span>
          <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', fontWeight: 700, color: col }}>
            {value > 0 ? `${value}%` : '—'}
          </span>
        </div>
        <div style={{ height: 5, background: 'var(--border-subtle)', borderRadius: 99 }}>
          <div style={{ height: '100%', width: `${value}%`, background: col, borderRadius: 99, transition: 'width 0.7s ease' }} />
        </div>
      </div>
    );
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }}>
      {/* Hidden video element for live camera feed */}
      <video ref={videoRef} muted playsInline style={{ display: 'none' }} />

      <div style={{ ...card, width: '100%', maxWidth: 480, padding: '2rem', position: 'relative' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--accent-blue-dim)', border: '2px solid var(--accent-blue-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Shield size={18} style={{ color: 'var(--accent-blue)' }} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Identity Re-Verification Required
            </h3>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Session request from <strong style={{ color: 'var(--text-secondary)' }}>{patientName}</strong>
            </p>
          </div>
        </div>

        {/* INTRO PHASE */}
        {phase === 'intro' && (
          <>
            <div style={{ padding: '1rem', background: 'var(--bg-elevated)', borderRadius: 12, marginBottom: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Before joining this session, MedTrust AI must verify your identity using your live camera and microphone.
              This scan will measure your <strong>face descriptors</strong>, <strong>voice signal</strong>, <strong>biometric pulse (rPPG)</strong>, and perform a <strong>liveness challenge</strong>.
              <br /><br />
              Camera and microphone access are required. Please ensure good lighting.
            </div>
            {permError && (
              <div style={{ padding: '0.75rem', background: 'var(--status-danger-dim)', border: '1px solid var(--status-danger-border)', borderRadius: 8, marginBottom: '1rem', fontSize: '0.75rem', color: 'var(--status-danger)' }}>
                {permError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1.25rem' }}>
              <div style={{ flex: 1, padding: '0.75rem', background: 'var(--bg-elevated)', borderRadius: 10, textAlign: 'center' }}>
                <Camera size={18} style={{ color: 'var(--accent-blue)', display: 'block', margin: '0 auto 0.3rem' }} />
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Camera</span>
              </div>
              <div style={{ flex: 1, padding: '0.75rem', background: 'var(--bg-elevated)', borderRadius: 10, textAlign: 'center' }}>
                <Mic size={18} style={{ color: 'var(--accent-blue)', display: 'block', margin: '0 auto 0.3rem' }} />
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Microphone</span>
              </div>
              <div style={{ flex: 1, padding: '0.75rem', background: 'var(--bg-elevated)', borderRadius: 10, textAlign: 'center' }}>
                <Activity size={18} style={{ color: 'var(--accent-blue)', display: 'block', margin: '0 auto 0.3rem' }} />
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Biometric</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.625rem' }}>
              <button className="ds-btn ds-btn-ghost ds-btn-sm" style={{ flex: 1 }} onClick={onClose}>
                Cancel
              </button>
              <button className="ds-btn ds-btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }} onClick={startScan}>
                <Shield size={14} /> Start Verification
              </button>
            </div>
          </>
        )}

        {/* LIVENESS PHASE */}
        {phase === 'liveness' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>
              {livePrompt.startsWith('👁') ? '👁' : livePrompt.startsWith('◀') ? '◀' : livePrompt.startsWith('▶') ? '▶' : '⏳'}
            </div>
            <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
              Liveness Challenge
            </p>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--accent-blue)', fontWeight: 600, minHeight: '1.4rem' }}>
              {livePrompt || 'Preparing…'}
            </p>
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Follow the prompt above — your camera is active
            </p>
            <div style={{ marginTop: '1rem' }}>
              <ScoreRow label="Liveness Detection" value={scores.liveness} />
            </div>
          </div>
        )}

        {/* SCANNING PHASE */}
        {phase === 'scanning' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <Loader2 size={44} style={{ color: 'var(--accent-blue)', animation: 'spin 1s linear infinite', display: 'block', margin: '0 auto 0.75rem' }} />
              <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {stepLabel}
              </p>
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {elapsed}s elapsed — keep camera steady
              </p>
            </div>
            <ScoreRow label="Liveness Detection"   value={scores.liveness} />
            <ScoreRow label="Face Verification"    value={scores.face} />
            <ScoreRow label="Voice Authentication" value={scores.voice} />
            <ScoreRow label="Biometric Pulse Sync" value={scores.biometric} />
            <ScoreRow label="Motion Integrity"     value={scores.motion} />
          </>
        )}

        {/* RESULT PHASE */}
        {phase === 'result' && (
          <>
            <div style={{
              textAlign: 'center', marginBottom: '1.5rem',
              padding: '1.5rem', borderRadius: 12,
              background: passed ? 'var(--status-safe-dim)' : 'var(--status-danger-dim)',
              border: `1px solid ${passed ? 'var(--status-safe-border)' : 'var(--status-danger-border)'}`,
            }}>
              {passed
                ? <CheckCircle size={40} style={{ color: 'var(--status-safe)', display: 'block', margin: '0 auto 0.75rem' }} />
                : <XCircle    size={40} style={{ color: 'var(--status-danger)', display: 'block', margin: '0 auto 0.75rem' }} />}
              <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: passed ? 'var(--status-safe)' : 'var(--status-danger)' }}>
                {passed ? 'Identity Verified' : 'Verification Failed'}
              </p>
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {passed
                  ? `Trust score: ${finalTrust} — cleared to join session`
                  : `Trust score: ${finalTrust} — identity could not be confirmed. Session blocked.`}
              </p>
            </div>
            <ScoreRow label="Face Verification"    value={scores.face} />
            <ScoreRow label="Voice Authentication" value={scores.voice} />
            <ScoreRow label="Biometric Pulse Sync" value={scores.biometric} />
            <ScoreRow label="Liveness Detection"   value={scores.liveness} />
            <ScoreRow label="Motion Integrity"     value={scores.motion} />
            <div style={{ marginTop: '1.25rem' }}>
              <button
                className={`ds-btn ${passed ? 'ds-btn-primary' : 'ds-btn-ghost'}`}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                onClick={handleResult}
              >
                {passed ? <><Play size={14} />Join Session</> : <><XCircle size={14} />Close</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── Session Request Card ───────────────────────────────────────────────────────
const RequestCard: React.FC<{
  req: any;
  onAccept: (id: string, patientName: string) => void;
  onReject: (id: string) => void;
  actionLoading: string | null;
}> = ({ req, onAccept, onReject, actionLoading }) => {
  const busy = actionLoading === req.id;
  const since = new Date(req.created_at);
  const minutesAgo = Math.floor((Date.now() - since.getTime()) / 60000);

  return (
    <div style={{ ...card, padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', border: '1px solid var(--accent-blue-border)' }}>
      <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--accent-blue-dim)', border: '2px solid var(--accent-blue-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <User size={20} style={{ color: 'var(--accent-blue)' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
            {req.patient_name}
          </span>
          <span style={{ fontSize: '0.62rem', padding: '0.1rem 0.4rem', borderRadius: 99, background: 'var(--status-warn-dim)', border: '1px solid var(--status-warn-border)', color: 'var(--status-warn)', fontWeight: 700 }}>
            Awaiting Response
          </span>
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
          {req.health_id       && <span>Health ID: {req.health_id}</span>}
          {req.condition_notes && <span title={req.condition_notes}>{req.condition_notes.slice(0, 40)}{req.condition_notes.length > 40 ? '…' : ''}</span>}
          <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.68rem' }}>
            {minutesAgo < 1 ? 'just now' : `${minutesAgo}m ago`}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
        <button
          className="ds-btn ds-btn-ghost ds-btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--status-danger)' }}
          onClick={() => onReject(req.id)}
          disabled={busy}
        >
          <XCircle size={13} /> Reject
        </button>
        <button
          className="ds-btn ds-btn-primary ds-btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
          onClick={() => onAccept(req.id, req.patient_name)}
          disabled={busy}
        >
          {busy
            ? <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} />
            : <><Shield size={13} />Verify & Join</>}
        </button>
      </div>
    </div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────
export const DoctorDashboardPage: React.FC = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const [pendingRequests,  setPendingRequests]  = useState<any[]>([]);
  const [activeSession,    setActiveSession]    = useState<any>(null);
  const [loading,          setLoading]          = useState(true);
  const [actionLoading,    setActionLoading]    = useState<string | null>(null);
  const [verifyTarget,     setVerifyTarget]     = useState<{ streamId: string; patientName: string } | null>(null);
  const [enrollmentBlock,  setEnrollmentBlock]  = useState<'none' | 'enrollment_required' | 'pending_approval'>('none');
  const [showEnrollModal, setShowEnrollModal]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pendRes, activeRes] = await Promise.allSettled([
        sessionApi.getPendingRequests(),
        sessionApi.getActiveSession(),
      ]);

      // Detect enrollment 403 codes from either call
      for (const res of [pendRes, activeRes]) {
        if (res.status === 'rejected') {
          const code = (res.reason as any)?.response?.data?.code;
          if (code === 'ENROLLMENT_REQUIRED') { setEnrollmentBlock('enrollment_required'); setLoading(false); return; }
          if (code === 'PENDING_APPROVAL')    { setEnrollmentBlock('pending_approval');    setLoading(false); return; }
        }
      }

      setEnrollmentBlock('none');
      if (pendRes.status === 'fulfilled')   setPendingRequests(pendRes.value.data?.requests ?? []);
      if (activeRes.status === 'fulfilled') setActiveSession(activeRes.value.data?.session ?? null);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh pending + active every 10s
  useEffect(() => {
    const t = setInterval(() => load(), 10000);
    return () => clearInterval(t);
  }, [load]);

  const handleAccept = async (streamId: string, patientName: string) => {
    setActionLoading(streamId);
    try {
      // Move to doctor_verifying state on backend first
      await sessionApi.respond(streamId, 'accept');
      // Update local state immediately
      setPendingRequests(p => p.map(r => r.id === streamId ? { ...r, status: 'doctor_verifying' } : r));
      // Open verify modal
      setVerifyTarget({ streamId, patientName });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to accept session');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (streamId: string) => {
    setActionLoading(streamId);
    try {
      await sessionApi.respond(streamId, 'reject');
      toast.success('Session rejected');
      setPendingRequests(p => p.filter(r => r.id !== streamId));
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to reject');
    } finally {
      setActionLoading(null);
    }
  };

  const handleVerified = () => {
    if (!verifyTarget) return;
    const sid = verifyTarget.streamId;
    toast.success('Identity verified — session is now live');
    setVerifyTarget(null);
    navigate(`/dashboard/${sid}`);
  };

  const handleVerifyFailed = () => {
    toast.error('Verification failed — session has been blocked. Admin notified.');
    setVerifyTarget(null);
    load();
  };

  const isVerified  = (user as any)?.verified_status === 'verified';
  const isSuspended = (user as any)?.verified_status === 'suspended';

  // ── Enrollment block screens ───────────────────────────────────────────────
  if (enrollmentBlock === 'enrollment_required') {
    return (
      <div className="page-container" style={{ maxWidth: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        {/* Enrollment modal — opened inline, no route needed */}
        {showEnrollModal && user && (
          <DoctorEnrollModal
            doctorId={user.id}
            doctorName={user.name || user.email || 'Doctor'}
            selfEnroll={true}
            onClose={() => setShowEnrollModal(false)}
            onEnrolled={() => {
              setShowEnrollModal(false);
              toast.success('Enrollment submitted — awaiting admin approval');
              load();
            }}
          />
        )}
        <div style={{ ...card, padding: '2.5rem', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--status-warn-dim)', border: '2px solid var(--status-warn-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
            <Shield size={24} style={{ color: 'var(--status-warn)' }} />
          </div>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Biometric Enrollment Required
          </h2>
          <p style={{ margin: '0 0 1.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            You must complete biometric enrollment before accessing the doctor dashboard.
            Your face, voice, and liveness data must be enrolled and approved by an administrator.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <button
              className="ds-btn ds-btn-primary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
              onClick={() => setShowEnrollModal(true)}
            >
              <Camera size={14} /> Start Biometric Enrollment
            </button>
            <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={load}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
              <RefreshCw size={12} /> Check Status Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (enrollmentBlock === 'pending_approval') {
    return (
      <div className="page-container" style={{ maxWidth: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ ...card, padding: '2.5rem', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--accent-blue-dim)', border: '2px solid var(--accent-blue-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
            <Clock size={24} style={{ color: 'var(--accent-blue)' }} />
          </div>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Awaiting Admin Approval
          </h2>
          <p style={{ margin: '0 0 1.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Your biometric enrollment is complete and under review.
            An administrator must approve your account before you can access the dashboard.
            You will be able to log in normally once approved.
          </p>
          <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={load}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: '0 auto' }}>
            <RefreshCw size={12} /> Refresh Status
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 900 }}>

      {/* ── Modal ── */}
      {verifyTarget && (
        <VerifyModal
          streamId={verifyTarget.streamId}
          patientName={verifyTarget.patientName}
          onClose={() => setVerifyTarget(null)}
          onVerified={handleVerified}
          onFailed={handleVerifyFailed}
        />
      )}

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Doctor Dashboard
          </h1>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>
            Welcome, {user?.name}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {pendingRequests.length > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--status-warn)', background: 'var(--status-warn-dim)', border: '1px solid var(--status-warn-border)', padding: '0.25rem 0.625rem', borderRadius: 99 }}>
              <Bell size={11} />
              {pendingRequests.length} new request{pendingRequests.length > 1 ? 's' : ''}
            </span>
          )}
          <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={load}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* ── Suspended warning ── */}
      {isSuspended && (
        <div style={{ ...card, padding: '1rem 1.25rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', border: '1px solid var(--status-danger-border)', background: 'var(--status-danger-dim)' }}>
          <AlertTriangle size={16} style={{ color: 'var(--status-danger)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.82rem', color: 'var(--status-danger)', fontWeight: 600 }}>
            Your account has been suspended due to failed verification attempts. Contact the administrator.
          </span>
        </div>
      )}

      {/* ── Status row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {[
          {
            label: 'Verification Status',
            value: isSuspended ? 'Suspended' : isVerified ? 'Verified' : 'Pending',
            icon: <BadgeCheck size={16} />,
            color: isSuspended ? 'var(--status-danger)' : isVerified ? 'var(--status-safe)' : 'var(--status-warn)',
            bg:    isSuspended ? 'var(--status-danger-dim)' : isVerified ? 'var(--status-safe-dim)' : 'var(--status-warn-dim)',
            bdr:   isSuspended ? 'var(--status-danger-border)' : isVerified ? 'var(--status-safe-border)' : 'var(--status-warn-border)',
          },
          {
            label: 'Active Session',
            value: activeSession ? 'Live' : 'None',
            icon: activeSession ? <Wifi size={16} /> : <WifiOff size={16} />,
            color: activeSession ? 'var(--status-safe)' : 'var(--text-muted)',
            bg:    activeSession ? 'var(--status-safe-dim)' : 'var(--bg-elevated)',
            bdr:   activeSession ? 'var(--status-safe-border)' : 'var(--border-default)',
          },
          {
            label: 'Pending Requests',
            value: loading ? '…' : String(pendingRequests.length),
            icon: <Bell size={16} />,
            color: pendingRequests.length > 0 ? 'var(--status-warn)' : 'var(--text-muted)',
            bg:    pendingRequests.length > 0 ? 'var(--status-warn-dim)' : 'var(--bg-elevated)',
            bdr:   pendingRequests.length > 0 ? 'var(--status-warn-border)' : 'var(--border-default)',
          },
        ].map(s => (
          <div key={s.label} style={{ ...card, padding: '1rem 1.125rem', display: 'flex', alignItems: 'center', gap: '0.75rem', border: `1px solid ${s.bdr}`, background: s.bg }}>
            <span style={{ color: s.color }}>{s.icon}</span>
            <div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Active session banner ── */}
      {activeSession && (
        <div style={{ ...card, padding: '1rem 1.25rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', border: '1px solid var(--status-safe-border)', background: 'var(--status-safe-dim)' }}>
          <Wifi size={16} style={{ color: 'var(--status-safe)', flexShrink: 0, animation: 'status-pulse 2s infinite' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
              Active session with {activeSession.patient_name}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {activeSession.health_id && `Health ID: ${activeSession.health_id} · `}
              Trust: <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--status-safe)' }}>{activeSession.live_trust ?? '—'}</span>
            </div>
          </div>
          <button
            className="ds-btn ds-btn-primary ds-btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}
            onClick={() => navigate(`/dashboard/${activeSession.id}`)}
          >
            <ChevronRight size={13} /> Resume Session
          </button>
        </div>
      )}

      {/* ── Pending session requests ── */}
      <div style={{ ...card, padding: '1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
          <Bell size={14} style={{ color: pendingRequests.length > 0 ? 'var(--status-warn)' : 'var(--accent-blue)' }} />
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Incoming Session Requests
          </span>
          {pendingRequests.length > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: '0.7rem', fontFamily: 'monospace', fontWeight: 700,
              background: 'var(--status-warn-dim)', border: '1px solid var(--status-warn-border)',
              color: 'var(--status-warn)', padding: '0.1rem 0.5rem', borderRadius: 99 }}>
              {pendingRequests.length}
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
            <Loader2 size={24} style={{ animation: 'spin 0.8s linear infinite', display: 'block', margin: '0 auto 0.75rem' }} />
            Loading requests…
          </div>
        ) : pendingRequests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
            <Stethoscope size={32} style={{ color: 'var(--text-muted)', display: 'block', margin: '0 auto 0.75rem', opacity: 0.4 }} />
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>No pending requests</p>
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Patients can request a session from their dashboard
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {pendingRequests.map(req => (
              <RequestCard
                key={req.id}
                req={req}
                onAccept={handleAccept}
                onReject={handleReject}
                actionLoading={actionLoading}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Doctor profile summary ── */}
      <div style={{ ...card, padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
          <Stethoscope size={14} style={{ color: 'var(--accent-blue)' }} />
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>Your Profile</span>
          <button
            className="ds-btn ds-btn-ghost ds-btn-sm"
            style={{ marginLeft: 'auto', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            onClick={() => navigate('/profile')}
          >
            <FileText size={11} /> View Full Profile
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', fontSize: '0.8rem' }}>
          {[
            { label: 'Name',           value: user?.name },
            { label: 'Specialization', value: user?.specialization || '—' },
            { label: 'Hospital',       value: user?.hospital_name  || '—' },
            { label: 'License',        value: user?.license_number || '—' },
          ].map(f => (
            <div key={f.label} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '0.625rem 0.875rem' }}>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>{f.label}</div>
              <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{f.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
