import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useSocket } from '../hooks/useSocket';
import { useStreamStore } from '../store/streamStore';
import { patientApi } from '../services/api';
import {
  Shield, CheckCircle, AlertTriangle, Activity, Clock,
  Building, FileText, Loader2, Bell, Download, RefreshCw,
} from 'lucide-react';

// ── helpers ───────────────────────────────────────────────────────────────────
const tCol = (t: number | null) =>
  !t ? 'var(--text-muted)' : t >= 75 ? 'var(--status-safe)' : t >= 50 ? 'var(--status-warn)' : 'var(--status-danger)';

const card: React.CSSProperties = {
  background: 'var(--glass-bg)',
  border: '1px solid var(--border-default)',
  borderRadius: 16,
  boxShadow: 'var(--shadow-md)',
};

// ── Trust Gauge ───────────────────────────────────────────────────────────────
const TrustGauge: React.FC<{ score: number; status: string }> = ({ score, status }) => {
  const color = status === 'safe' ? 'var(--status-safe)' : status === 'suspicious' ? 'var(--status-warn)' : 'var(--status-danger)';
  const r = 52; const circ = 2 * Math.PI * r;
  const dash = circ * (Math.max(score, 0) / 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.375rem' }}>
      <svg width={128} height={128} viewBox="0 0 128 128">
        <circle cx={64} cy={64} r={r} fill="none" stroke="var(--border-subtle)" strokeWidth={9} />
        <circle cx={64} cy={64} r={r} fill="none" stroke={color} strokeWidth={9}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 64 64)"
          style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1)' }} />
        <text x={64} y={58} textAnchor="middle" fill={color} fontSize={24} fontWeight={800} fontFamily="monospace">{score}</text>
        <text x={64} y={76} textAnchor="middle" fill="var(--text-muted)" fontSize={10} letterSpacing={2}>{status.toUpperCase()}</text>
      </svg>
      <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Live Trust Score</span>
    </div>
  );
};

// ── Confidence bar ────────────────────────────────────────────────────────────
const ConfBar: React.FC<{ label: string; value: number }> = ({ label, value }) => {
  const col = value >= 70 ? 'var(--status-safe)' : value >= 45 ? 'var(--status-warn)' : 'var(--status-danger)';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 600, color: col }}>{value}%</span>
      </div>
      <div style={{ height: 4, background: 'var(--border-subtle)', borderRadius: 99 }}>
        <div style={{ height: '100%', width: `${value}%`, background: col, borderRadius: 99, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
};

// ── Table header ─────────────────────────────────────────────────────────────
const TH: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.62rem', letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid var(--border-subtle)' }}>{children}</th>
);

export const PatientDashboard: React.FC = () => {
  const { user } = useAuthStore();
  const { trustScore } = useStreamStore();
  const { connect, joinStream } = useSocket();

  const [doctor, setDoctor]     = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [alerts, setAlerts]     = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [activeSession, setActiveSession] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [docRes, sesRes, alertRes] = await Promise.allSettled([
        patientApi.getDoctor(),
        patientApi.getSessions({ limit: 10 }),
        patientApi.getAlerts(),
      ]);
      if (docRes.status === 'fulfilled') setDoctor(docRes.value.data);
      if (sesRes.status === 'fulfilled') {
        const rows = sesRes.value.data?.sessions || [];
        setSessions(rows);
        const active = rows.find((s: any) => s.status === 'active');
        if (active) setActiveSession(active);
      }
      if (alertRes.status === 'fulfilled') setAlerts(alertRes.value.data?.alerts || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (activeSession?.id) { connect(); joinStream(activeSession.id); }
  }, [activeSession, connect, joinStream]);

  const criticals = alerts.filter((a: any) => a.severity === 'critical');
  const ts = trustScore;
  const verified = doctor?.verified_status === 'verified';
  const modules = (ts as any)?.modules ?? {};
  const videoConf  = modules.video_integrity    != null ? Math.round(modules.video_integrity    * 100) : ts?.video_score    ?? 0;
  const voiceConf  = modules.voice_authenticity != null ? Math.round(modules.voice_authenticity * 100) : ts?.voice_score    ?? 0;
  const bioConf    = modules.biometric_sync     != null ? Math.round(modules.biometric_sync     * 100) : ts?.biometric_score ?? 0;
  const blockConf  = modules.blockchain_integrity != null ? Math.round(modules.blockchain_integrity * 100) : ts?.blockchain_score ?? 0;

  if (loading) return (
    <div className="page-container" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader2 size={32} style={{ color: 'var(--status-safe)', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );

  return (
    <div className="page-container" style={{ maxWidth: 1200 }}>

      {/* ── Doctor Authenticity Banner ── */}
      {doctor ? (
        <div style={{
          ...card,
          padding: '1rem 1.25rem',
          display: 'flex', alignItems: 'center', gap: '1rem',
          marginBottom: '1rem',
          border: `1px solid ${verified ? 'var(--status-safe-border)' : 'var(--status-danger-border)'}`,
          background: verified ? 'var(--status-safe-dim)' : 'var(--status-danger-dim)',
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
            background: verified ? 'var(--status-safe-dim)' : 'var(--status-danger-dim)',
            border: `2px solid ${verified ? 'var(--status-safe-border)' : 'var(--status-danger-border)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {verified
              ? <CheckCircle size={22} style={{ color: 'var(--status-safe)' }} />
              : <AlertTriangle size={22} style={{ color: 'var(--status-danger)' }} />}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
              <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{doctor.name}</span>
              <span style={{
                fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: 99,
                background: verified ? 'var(--status-safe-dim)' : 'var(--status-danger-dim)',
                border: `1px solid ${verified ? 'var(--status-safe-border)' : 'var(--status-danger-border)'}`,
                color: verified ? 'var(--status-safe)' : 'var(--status-danger)', fontWeight: 700,
                animation: !verified ? 'badgePulse 1.2s ease-in-out infinite' : undefined,
              }}>
                {verified ? '✓ Identity Verified' : '⚠ Identity Risk Detected'}
              </span>
              {verified && (
                <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: 99, background: 'var(--accent-blue-dim)', border: '1px solid var(--accent-blue-border)', color: 'var(--accent-blue)', fontWeight: 600 }}>
                  Blockchain Verified
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {doctor.specialization && <span>{doctor.specialization}</span>}
              {doctor.hospital_name && <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Building size={11} />{doctor.hospital_name}</span>}
              {doctor.license_number && <span>Lic: {doctor.license_number}</span>}
            </div>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace', textAlign: 'right' }}>
            {verified ? 'AI-verified identity' : 'Manual review needed'}
          </div>
        </div>
      ) : (
        <div style={{ ...card, padding: '1rem', marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
          No doctor assigned yet.
        </div>
      )}

      {/* ── Alert banner if criticals ── */}
      {criticals.length > 0 && (
        <div style={{ ...card, padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', border: '1px solid var(--status-danger-border)', background: 'var(--status-danger-dim)', animation: 'trustAlert 1.2s ease-in-out infinite' }}>
          <AlertTriangle size={16} style={{ color: 'var(--status-danger)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.82rem', color: 'var(--status-danger)', fontWeight: 600 }}>{criticals.length} critical security event{criticals.length > 1 ? 's' : ''} detected in this session.</span>
        </div>
      )}

      {/* ── Main grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 260px', gap: '1rem', marginBottom: '1rem', alignItems: 'start' }}>

        {/* Trust Gauge */}
        <div style={{ ...card, padding: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.875rem' }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Trust Score</span>
          <TrustGauge score={ts?.trust_score ?? 0} status={ts?.status ?? 'safe'} />
          <span style={{
            fontSize: '0.65rem', padding: '0.2rem 0.6rem', borderRadius: 99,
            background: activeSession ? 'var(--status-safe-dim)' : 'var(--bg-elevated)',
            border: `1px solid ${activeSession ? 'var(--status-safe-border)' : 'var(--border-default)'}`,
            color: activeSession ? 'var(--status-safe)' : 'var(--text-muted)',
            fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem',
          }}>
            {activeSession && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-safe)', display: 'inline-block', animation: 'status-pulse 2s infinite' }} />}
            {activeSession ? 'Session Active' : 'No Session'}
          </span>
        </div>

        {/* AI detection scores */}
        <div style={{ ...card, padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <Shield size={13} style={{ color: 'var(--accent-blue)' }} />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Doctor Authenticity Signals</span>
          </div>
          {activeSession ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <ConfBar label="Face Verification" value={videoConf} />
              <ConfBar label="Voice Authentication" value={voiceConf} />
              <ConfBar label="Biometric Pulse Sync" value={bioConf} />
              <ConfBar label="Blockchain Integrity" value={blockConf} />
              {(ts as any)?.anomaly_score != null && (
                <div style={{ marginTop: '0.25rem', padding: '0.625rem', background: (ts as any).anomaly_score > 0.5 ? 'var(--status-danger-dim)' : 'var(--bg-elevated)', border: `1px solid ${(ts as any).anomaly_score > 0.5 ? 'var(--status-danger-border)' : 'var(--border-subtle)'}`, borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Impersonation Risk</span>
                  <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', fontWeight: 700, color: (ts as any).anomaly_score > 0.5 ? 'var(--status-danger)' : 'var(--status-safe)' }}>
                    {Math.round((ts as any).anomaly_score * 100)}%
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No active session
            </div>
          )}
        </div>

        {/* Security events */}
        <div style={{ ...card, padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.875rem' }}>
            <Bell size={13} style={{ color: criticals.length ? 'var(--status-danger)' : 'var(--accent-blue)' }} />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Security Events</span>
            {alerts.length > 0 && <span style={{ marginLeft: 'auto', fontSize: '0.65rem', fontFamily: 'monospace', color: 'var(--status-danger)', fontWeight: 700 }}>{alerts.length}</span>}
          </div>
          {alerts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1.25rem 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              <CheckCircle size={20} style={{ color: 'var(--status-safe)', display: 'block', margin: '0 auto 0.5rem' }} />
              Session secure
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', maxHeight: 240, overflowY: 'auto' }}>
              {alerts.slice(0, 10).map((a: any, i: number) => (
                <div key={i} style={{
                  display: 'flex', gap: '0.4rem', alignItems: 'flex-start',
                  background: a.severity === 'critical' ? 'var(--status-danger-dim)' : 'var(--status-warn-dim)',
                  border: `1px solid ${a.severity === 'critical' ? 'var(--status-danger-border)' : 'var(--status-warn-border)'}`,
                  borderRadius: 8, padding: '0.375rem 0.5rem',
                }}>
                  <AlertTriangle size={10} style={{ color: a.severity === 'critical' ? 'var(--status-danger)' : 'var(--status-warn)', marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', lineHeight: 1.35 }}>{a.event_type?.replace(/_/g, ' ')}</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{new Date(a.created_at).toLocaleTimeString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Session History ── */}
      <div style={{ ...card, padding: '1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
          <Clock size={13} style={{ color: 'var(--accent-blue)' }} />
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Session History</span>
          <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={load} style={{ marginLeft: 'auto' }}>
            <RefreshCw size={11} />
          </button>
        </div>
        {sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No sessions yet</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead><tr><TH>Session ID</TH><TH>Doctor</TH><TH>Trust</TH><TH>Alerts</TH><TH>Status</TH><TH>Report</TH></tr></thead>
              <tbody>
                {sessions.slice(0, 10).map((s: any) => {
                  const trust = s.avg_trust_score ? Math.round(s.avg_trust_score) : null;
                  const sStatus = s.status === 'active' ? 'active' : 'ended';
                  const sBg  = sStatus === 'active' ? 'var(--status-safe-dim)' : 'var(--bg-elevated)';
                  const sBdr = sStatus === 'active' ? 'var(--status-safe-border)' : 'var(--border-default)';
                  const sCol = sStatus === 'active' ? 'var(--status-safe)' : 'var(--text-muted)';
                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.66rem' }}>{String(s.id).slice(0, 12)}…</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-primary)' }}>{s.doctor_name || '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontWeight: 700, color: tCol(trust) }}>{trust ?? '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: (s.alert_count || 0) > 0 ? 'var(--status-danger)' : 'var(--text-muted)' }}>{s.alert_count ?? 0}</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: 99, background: sBg, border: `1px solid ${sBdr}`, color: sCol, fontWeight: 600 }}>{sStatus}</span>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        {s.avg_trust_score && (
                          <a href={`/patient/session/${s.id}/report`} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--accent-blue)', fontSize: '0.7rem', textDecoration: 'none' }}>
                            <FileText size={11} />View
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Blockchain footer ── */}
      <div style={{ ...card, padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flex: 1 }}>
          <Shield size={15} style={{ color: 'var(--status-safe)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
            All session data is cryptographically logged on an immutable blockchain ledger. Trust scores are computed server-side in real time.
            {verified && <span style={{ color: 'var(--status-safe)', marginLeft: '0.4rem' }}>Your doctor's identity has been AI-verified.</span>}
          </span>
        </div>
        <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={() => alert('Certificate download coming soon')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Download size={12} />Download Certificate
        </button>
      </div>

    </div>
  );
};
