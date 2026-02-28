import React, { useState, useCallback, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { analysisApi } from '../services/api';
import {
  FlaskConical, Play, Square, Upload, Eye, Mic, Activity,
  Link, Brain, Shield, AlertTriangle, CheckCircle, Loader2,
  BarChart3, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── types ─────────────────────────────────────────────────────────────────────
interface AnalysisResult {
  trust_score: number;
  status: 'safe' | 'suspicious' | 'alert';
  modules?: Record<string, number>;
  video_score?: number;
  voice_score?: number;
  biometric_score?: number;
  blockchain_score?: number;
  anomaly_score?: number;
  processing_time_ms?: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: 'var(--glass-bg)',
  border: '1px solid var(--border-default)',
  borderRadius: 16,
  boxShadow: 'var(--shadow-md)',
  padding: '1.25rem',
};

const scoreCol = (v: number) =>
  v >= 70 ? 'var(--status-safe)' : v >= 45 ? 'var(--status-warn)' : 'var(--status-danger)';

const statusCol = (s: string) =>
  s === 'safe' ? 'var(--status-safe)' : s === 'suspicious' ? 'var(--status-warn)' : 'var(--status-danger)';

const statusDim = (s: string) =>
  s === 'safe' ? 'var(--status-safe-dim)' : s === 'suspicious' ? 'var(--status-warn-dim)' : 'var(--status-danger-dim)';

const statusBdr = (s: string) =>
  s === 'safe' ? 'var(--status-safe-border)' : s === 'suspicious' ? 'var(--status-warn-border)' : 'var(--status-danger-border)';

// ── sub-components ────────────────────────────────────────────────────────────
const ScoreBar: React.FC<{ label: string; value: number; icon: React.ReactNode }> = ({ label, value, icon }) => {
  const col = scoreCol(value);
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
          <span style={{ color: col }}>{icon}</span>{label}
        </div>
        <span style={{ fontSize: '0.78rem', fontFamily: 'monospace', fontWeight: 700, color: col }}>{value}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--border-subtle)', borderRadius: 99 }}>
        <div style={{ height: '100%', width: `${value}%`, background: col, borderRadius: 99, transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)', boxShadow: `0 0 6px ${col}44` }} />
      </div>
    </div>
  );
};

const TrustGauge: React.FC<{ score: number; status: string }> = ({ score, status }) => {
  const color = statusCol(status);
  const r = 56; const circ = 2 * Math.PI * r;
  const dash = circ * (Math.max(score, 0) / 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
      <svg width={140} height={140} viewBox="0 0 140 140">
        <circle cx={70} cy={70} r={r} fill="none" stroke="var(--border-subtle)" strokeWidth={10} />
        <circle cx={70} cy={70} r={r} fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 70 70)"
          style={{ transition: 'stroke-dasharray 1s cubic-bezier(0.4,0,0.2,1)', filter: `drop-shadow(0 0 8px ${color}66)` }} />
        <text x={70} y={64} textAnchor="middle" fill={color} fontSize={28} fontWeight={800} fontFamily="monospace">{score}</text>
        <text x={70} y={82} textAnchor="middle" fill="var(--text-muted)" fontSize={11} letterSpacing={2}>{status.toUpperCase()}</text>
      </svg>
      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Trust Score</span>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
export const DetectionLabPage: React.FC = () => {
  const { user } = useAuthStore();
  const [streamId, setStreamId] = useState('');
  const [running, setRunning]   = useState(false);
  const [result, setResult]     = useState<AnalysisResult | null>(null);
  const [history, setHistory]   = useState<Array<AnalysisResult & { ts: number }>>([]);
  const [tab, setTab]           = useState<'live'|'upload'>('live');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const extractScores = (data: any): AnalysisResult => {
    const m = data?.modules ?? {};
    return {
      trust_score:     Math.round(data?.trust_score ?? 0),
      status:          data?.status ?? 'safe',
      modules:         m,
      video_score:     m.video_integrity     != null ? Math.round(m.video_integrity     * 100) : Math.round(data?.video_score     ?? 0),
      voice_score:     m.voice_authenticity  != null ? Math.round(m.voice_authenticity  * 100) : Math.round(data?.voice_score     ?? 0),
      biometric_score: m.biometric_sync      != null ? Math.round(m.biometric_sync      * 100) : Math.round(data?.biometric_score ?? 0),
      blockchain_score:m.blockchain_integrity!= null ? Math.round(m.blockchain_integrity* 100) : Math.round(data?.blockchain_score?? 0),
      anomaly_score:   data?.anomaly_score,
      processing_time_ms: data?.processing_time_ms,
    };
  };

  const fetchOnce = useCallback(async (sid: string) => {
    try {
      const res = await analysisApi.getLiveTrustScore(sid);
      const parsed = extractScores(res.data);
      setResult(parsed);
      setHistory(h => [{ ...parsed, ts: Date.now() }, ...h.slice(0, 19)]);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        toast.error('Stream not found');
        stopMonitoring();
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startMonitoring = () => {
    const sid = streamId.trim();
    if (sid.length < 10) { toast.error('Stream ID must be at least 10 characters'); return; }
    setRunning(true);
    fetchOnce(sid);
    intervalRef.current = setInterval(() => fetchOnce(sid), 3000);
    toast.success('Monitoring started');
  };

  const stopMonitoring = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setRunning(false);
    toast('Monitoring stopped', { icon: '⏹' });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const sid = streamId.trim() || `lab-${Date.now()}`;
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        try {
          const res = await analysisApi.analyzeVideo({ stream_id: sid, chunk_data: base64, timestamp: Date.now() });
          const parsed = extractScores(res.data);
          setResult(parsed);
          setHistory(h => [{ ...parsed, ts: Date.now() }, ...h.slice(0, 19)]);
          toast.success('Frame analyzed');
        } catch { toast.error('Analysis failed'); }
        finally { setUploading(false); }
      };
      reader.readAsDataURL(file);
    } catch { setUploading(false); }
    e.target.value = '';
  };

  const clearHistory = () => { setHistory([]); setResult(null); };

  return (
    <div className="page-container" style={{ maxWidth: 1200 }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--accent-blue-dim)', border: '1px solid var(--accent-blue-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FlaskConical size={20} style={{ color: 'var(--accent-blue)' }} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, lineHeight: 1.2 }}>Detection Lab</h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Live trust score analysis · Frame upload · Module diagnostics</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{user?.name || user?.email}</span>
          <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: 99, background: user?.role === 'admin' ? 'var(--status-warn-dim)' : 'var(--accent-blue-dim)', border: `1px solid ${user?.role === 'admin' ? 'var(--status-warn-border)' : 'var(--accent-blue-border)'}`, color: user?.role === 'admin' ? 'var(--status-warn)' : 'var(--accent-blue)', fontWeight: 600, textTransform: 'uppercase' }}>{user?.role}</span>
        </div>
      </div>

      {/* ── Mode tabs ── */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', background: 'var(--bg-surface)', borderRadius: 12, padding: '0.25rem', width: 'fit-content', border: '1px solid var(--border-default)' }}>
        {(['live', 'upload'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: tab === t ? 'var(--accent-blue-dim)' : 'transparent',
            color: tab === t ? 'var(--accent-blue)' : 'var(--text-muted)',
            border: tab === t ? '1px solid var(--accent-blue-border)' : '1px solid transparent',
            borderRadius: 8, padding: '0.375rem 1rem', fontSize: '0.78rem', fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem', transition: 'all 0.2s',
          }}>
            {t === 'live' ? <><Activity size={13}/>Live Monitor</> : <><Upload size={13}/>Frame Upload</>}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '1rem', alignItems: 'start' }}>

        {/* ── Left panel: controls ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Stream ID input */}
          <div style={{ ...card }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.875rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
              <Shield size={13} style={{ color: 'var(--accent-blue)' }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Stream ID</span>
            </div>
            <input
              className="ds-input"
              placeholder="Enter stream ID (min 10 chars)"
              value={streamId}
              onChange={e => setStreamId(e.target.value)}
              disabled={running}
              style={{ width: '100%', marginBottom: '0.75rem', boxSizing: 'border-box' }}
            />

            {tab === 'live' ? (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {!running ? (
                  <button className="ds-btn ds-btn-primary" onClick={startMonitoring}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                    <Play size={13} />Start Monitoring
                  </button>
                ) : (
                  <button className="ds-btn ds-btn-danger" onClick={stopMonitoring}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', background: 'var(--status-danger-dim)', border: '1px solid var(--status-danger-border)', color: 'var(--status-danger)' }}>
                    <Square size={13} />Stop
                  </button>
                )}
              </div>
            ) : (
              <div>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
                <button className="ds-btn ds-btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                  {uploading ? <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Upload size={13} />}
                  {uploading ? 'Analyzing…' : 'Upload Frame'}
                </button>
              </div>
            )}
          </div>

          {/* Status indicator */}
          {running && (
            <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '0.75rem', border: '1px solid var(--status-safe-border)', background: 'var(--status-safe-dim)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--status-safe)', display: 'inline-block', animation: 'status-pulse 2s infinite' }} />
              <span style={{ fontSize: '0.78rem', color: 'var(--status-safe)', fontWeight: 600 }}>Live — polling every 3s</span>
            </div>
          )}

          {/* Trust gauge */}
          {result && (
            <div style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
              <TrustGauge score={result.trust_score} status={result.status} />
              <div style={{ width: '100%', display: 'flex', gap: '0.5rem', flexDirection: 'column', marginTop: '0.5rem' }}>
                {result.anomaly_score != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0.75rem', borderRadius: 8, background: result.anomaly_score > 0.5 ? 'var(--status-danger-dim)' : 'var(--bg-elevated)', border: `1px solid ${result.anomaly_score > 0.5 ? 'var(--status-danger-border)' : 'var(--border-subtle)'}` }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Impersonation Risk</span>
                    <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 700, color: result.anomaly_score > 0.5 ? 'var(--status-danger)' : 'var(--status-safe)' }}>{Math.round(result.anomaly_score * 100)}%</span>
                  </div>
                )}
                {result.processing_time_ms != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0.75rem', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Processing Time</span>
                    <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{result.processing_time_ms}ms</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Right panel: scores + history ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Module scores */}
          <div style={{ ...card }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
              <BarChart3 size={13} style={{ color: 'var(--accent-blue)' }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Detection Module Scores</span>
              {result && (
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: 99, background: statusDim(result.status), border: `1px solid ${statusBdr(result.status)}`, color: statusCol(result.status), fontWeight: 700 }}>
                  {result.status.toUpperCase()}
                </span>
              )}
            </div>
            {result ? (
              <div>
                <ScoreBar label="Video Integrity"      value={result.video_score      ?? 0} icon={<Eye size={12}/>} />
                <ScoreBar label="Voice Authenticity"   value={result.voice_score      ?? 0} icon={<Mic size={12}/>} />
                <ScoreBar label="Biometric Sync"       value={result.biometric_score  ?? 0} icon={<Activity size={12}/>} />
                <ScoreBar label="Blockchain Integrity" value={result.blockchain_score ?? 0} icon={<Link size={12}/>} />
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                <FlaskConical size={28} style={{ display: 'block', margin: '0 auto 0.75rem', opacity: 0.4 }} />
                {tab === 'live' ? 'Enter a stream ID and start monitoring' : 'Upload a video frame to analyze'}
              </div>
            )}
          </div>

          {/* Module detail cards */}
          {result?.modules && Object.keys(result.modules).length > 0 && (
            <div style={{ ...card }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <Brain size={13} style={{ color: 'var(--accent-blue)' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Raw Module Output</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem' }}>
                {Object.entries(result.modules).map(([key, val]) => {
                  const pct = Math.round(val * 100);
                  const col = scoreCol(pct);
                  return (
                    <div key={key} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '0.625rem 0.75rem', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{key.replace(/_/g, ' ')}</div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'monospace', color: col }}>{pct}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div style={{ ...card }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.875rem' }}>
                <RefreshCw size={13} style={{ color: 'var(--accent-blue)' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Analysis History</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 2 }}>({history.length})</span>
                <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={clearHistory} style={{ marginLeft: 'auto' }}>Clear</button>
              </div>
              <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                {history.map((h, i) => {
                  const col = statusCol(h.status);
                  return (
                    <div key={i} title={new Date(h.ts).toLocaleTimeString()} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.125rem',
                      padding: '0.375rem 0.5rem', borderRadius: 8, cursor: 'default',
                      background: i === 0 ? statusDim(h.status) : 'var(--bg-elevated)',
                      border: `1px solid ${i === 0 ? statusBdr(h.status) : 'var(--border-subtle)'}`,
                      minWidth: 44,
                    }}>
                      <span style={{ fontSize: '0.82rem', fontFamily: 'monospace', fontWeight: 700, color: col }}>{h.trust_score}</span>
                      <span style={{ fontSize: '0.52rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{h.status.slice(0, 3)}</span>
                    </div>
                  );
                })}
              </div>
              {/* Inline micro chart */}
              <div style={{ marginTop: '0.75rem', height: 36, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
                {[...history].reverse().map((h, i) => {
                  const col = statusCol(h.status);
                  return (
                    <div key={i} title={`${h.trust_score}`} style={{
                      flex: 1, background: col, opacity: 0.6 + (i / history.length) * 0.4,
                      borderRadius: '2px 2px 0 0', minWidth: 4,
                      height: `${Math.max(4, h.trust_score)}%`,
                      transition: 'height 0.3s ease',
                    }} />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Legend ── */}
      <div style={{ ...card, marginTop: '1rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { icon: <CheckCircle size={13}/>, label: 'Safe (≥70%)', col: 'var(--status-safe)' },
          { icon: <AlertTriangle size={13}/>, label: 'Suspicious (45–69%)', col: 'var(--status-warn)' },
          { icon: <AlertTriangle size={13}/>, label: 'Alert (<45%)', col: 'var(--status-danger)' },
        ].map(({ icon, label, col }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: col, fontSize: '0.75rem', fontWeight: 500 }}>
            {icon}{label}
          </div>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          Detection Lab — results are for diagnostic purposes only
        </span>
      </div>

    </div>
  );
};
