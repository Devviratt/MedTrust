import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useStreamStore } from '../store/streamStore';
import { useSocket } from '../hooks/useSocket';
import { patientApi, sessionApi } from '../services/api';
import { onSessionActivated, onSessionBlocked, onIdentityFlagged, onDoctorVerified } from '../hooks/useSocket';
import toast from 'react-hot-toast';
import {
  Shield, CheckCircle, AlertTriangle, Activity, Clock,
  Building, Loader2, RefreshCw, UserCircle,
  Stethoscope, ArrowRight, XCircle, Wifi, WifiOff,
  Award, Hash, Calendar, TrendingUp,
} from 'lucide-react';

// ── Style helpers ─────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: 'var(--glass-bg)',
  border: '1px solid var(--border-default)',
  borderRadius: 16,
  boxShadow: 'var(--shadow-md)',
};

const tCol = (t: number | null) =>
  !t ? 'var(--text-muted)' : t >= 75 ? 'var(--status-safe)' : t >= 50 ? 'var(--status-warn)' : 'var(--status-danger)';

// ── Trust gauge (real backend data only) ─────────────────────────────────────
const TrustGauge: React.FC<{ score: number; status: string; label?: string }> = ({ score, status, label = 'Doctor Trust Score' }) => {
  const color = status === 'safe' ? 'var(--status-safe)' : status === 'suspicious' ? 'var(--status-warn)' : 'var(--status-danger)';
  const r = 52; const circ = 2 * Math.PI * r;
  const dash = circ * (Math.max(score, 0) / 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
      <svg width={128} height={128} viewBox="0 0 128 128">
        <circle cx={64} cy={64} r={r} fill="none" stroke="var(--border-subtle)" strokeWidth={10} />
        <circle cx={64} cy={64} r={r} fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 64 64)"
          style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1)' }} />
        <text x={64} y={59} textAnchor="middle" fill={color} fontSize={26} fontWeight={800} fontFamily="monospace">{score}</text>
        <text x={64} y={76} textAnchor="middle" fill="var(--text-muted)" fontSize={10} letterSpacing={2}>{status.toUpperCase()}</text>
      </svg>
      <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
    </div>
  );
};

// ── Doctor card in the browse list ────────────────────────────────────────────
const DoctorCard: React.FC<{
  doctor: any;
  onConnect: (id: string, name: string) => void;
  connecting: boolean;
}> = ({ doctor, onConnect, connecting }) => (
  <div style={{
    ...card,
    padding: '1rem 1.25rem',
    display: 'flex', alignItems: 'center', gap: '1rem',
    border: '1px solid var(--border-default)',
  }}>
    <div style={{
      width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
      background: 'var(--status-safe-dim)', border: '2px solid var(--status-safe-border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <UserCircle size={24} style={{ color: 'var(--status-safe)' }} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{doctor.name}</span>
        <span style={{
          fontSize: '0.62rem', padding: '0.12rem 0.45rem', borderRadius: 99,
          background: 'var(--status-safe-dim)', border: '1px solid var(--status-safe-border)',
          color: 'var(--status-safe)', fontWeight: 700,
        }}>✓ Verified</span>
      </div>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
        {doctor.specialization && <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Stethoscope size={11} />{doctor.specialization}</span>}
        {doctor.hospital_name  && <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Building size={11} />{doctor.hospital_name}</span>}
        {doctor.license_number && <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'var(--text-muted)' }}>Lic: {doctor.license_number}</span>}
      </div>
    </div>
    <button
      className="ds-btn ds-btn-primary ds-btn-sm"
      style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
      onClick={() => onConnect(doctor.id, doctor.name)}
      disabled={connecting}
    >
      {connecting ? <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> : <ArrowRight size={13} />}
      Connect
    </button>
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────
export const PatientDashboardPage: React.FC = () => {
  const { user } = useAuthStore();
  const { trustScore } = useStreamStore();
  const { connect, joinStream } = useSocket();

  const [view, setView]             = useState<'session' | 'browse'>('session');
  const [doctors, setDoctors]       = useState<any[]>([]);
  const [session, setSession]       = useState<any>(null);
  const [doctorDetails, setDoctorDetails] = useState<any>(null);
  const [liveTrust, setLiveTrust]   = useState<{ score: number; status: string } | null>(null);
  const [loading, setLoading]       = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [terminated, setTerminated] = useState<string | null>(null);
  const [highRiskBanner, setHighRiskBanner] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const trustPollRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Stop camera tracks (called on block/imposter) ──────────────────────────
  const stopCamera = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
  }, []);

  // ── Load session + doctor details ──────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sesRes = await sessionApi.getMySession().catch(() => null);
      const s = sesRes?.data?.session ?? null;
      setSession(s);
      if (s?.doctor_id) {
        const dRes = await patientApi.getDoctor().catch(() => null);
        setDoctorDetails(dRes?.data ?? null);
      } else {
        setDoctorDetails(null);
      }
    } finally { setLoading(false); }
  }, []);

  const loadDoctors = useCallback(async () => {
    try {
      const res = await sessionApi.getVerifiedDoctors();
      setDoctors(res.data?.doctors ?? []);
    } catch { toast.error('Failed to load doctors'); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (view === 'browse') loadDoctors(); }, [view, loadDoctors]);

  // ── Join socket room as soon as any session exists (critical: must be in room
  //    before doctor_verified / session_activated fires) ─────────────────────
  useEffect(() => {
    if (session?.id) {
      connect();
      joinStream(session.id);
    }
  }, [session?.id, connect, joinStream]);

  // ── Poll real trust score from backend while session is active ─────────────
  useEffect(() => {
    if (session?.id && session.status === 'active') {

      trustPollRef.current = setInterval(async () => {
        try {
          const res = await sessionApi.getSessionTrust(session.id);
          const data = res.data;
          if (data?.trust_score != null) {
            const score  = Math.round(data.trust_score);
            const status = score >= 75 ? 'safe' : score >= 45 ? 'suspicious' : 'blocked';
            setLiveTrust({ score, status });
            if (score < 45) {
              setHighRiskBanner(true);
              clearInterval(trustPollRef.current!);
              stopCamera();
            }
          }
        } catch { /* silent */ }
      }, 4000);
    }
    return () => { if (trustPollRef.current) clearInterval(trustPollRef.current); };
  }, [session?.id, session?.status, stopCamera]);

  // Seed live trust from stream store on first socket update
  useEffect(() => {
    if (trustScore && session?.status === 'active') {
      const score  = Math.round(trustScore.trust_score ?? 0);
      const status = score >= 75 ? 'safe' : score >= 45 ? 'suspicious' : 'blocked';
      setLiveTrust({ score, status });
      if (score < 45) setHighRiskBanner(true);
    }
  }, [trustScore, session?.status]);

  // ── Socket events ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Optimistically activate session in local state — do NOT wait for DB re-fetch
    const activateSession = () => {
      setSession((prev: any) => prev ? { ...prev, status: 'active' } : prev);
      setTerminated(null);
      setHighRiskBanner(false);
      toast.success('Doctor verified — session is now live!');
      // Reload in background to sync started_at and other fields
      load();
    };

    const unsubVerified  = onDoctorVerified(activateSession);
    const unsubActivated = onSessionActivated(activateSession);

    const unsubBlocked = onSessionBlocked((data) => {
      setSession((prev: any) => prev ? { ...prev, status: 'blocked' } : prev);
      setTerminated(data.reason || 'Session terminated — identity risk detected');
      stopCamera();
      load();
      toast.error('Session blocked — doctor identity verification failed', { duration: 8000 });
    });
    const unsubFlagged = onIdentityFlagged((data: any) => {
      setHighRiskBanner(true);
      stopCamera();
      toast.error(`Identity flagged: ${data.message || 'Imposter detected — session terminated'}`, { duration: 10000 });
      load();
    });
    return () => { unsubVerified(); unsubActivated(); unsubBlocked(); unsubFlagged(); };
  }, [load, stopCamera]);

  // ── Connect to doctor ──────────────────────────────────────────────────────
  const handleConnect = async (doctorId: string, doctorName: string) => {
    setConnecting(true);
    setConnectingId(doctorId);
    try {
      await sessionApi.requestSession(doctorId);
      toast.success(`Connection request sent to ${doctorName}`);
      setView('session');
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to connect');
    } finally { setConnecting(false); setConnectingId(null); }
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const hasSession  = !!session;
  const isActive    = session?.status === 'active';
  const isVerifying = session?.status === 'pending' || session?.status === 'doctor_verifying' || session?.status === 'patient_verifying' || session?.status === 'mutual_verified';
  const isBlocked   = session?.status === 'blocked';
  const ts          = liveTrust ?? (trustScore ? { score: Math.round(trustScore.trust_score ?? 0), status: trustScore.status ?? 'safe' } : null);

  const sessionStatusLabel = () => {
    if (isActive)    return { label: 'Live', color: 'var(--status-safe)', icon: <Wifi size={9} /> };
    if (isVerifying) return { label: 'Awaiting Doctor', color: 'var(--status-warn)', icon: <Clock size={9} /> };
    if (isBlocked)   return { label: 'Blocked', color: 'var(--status-danger)', icon: <XCircle size={9} /> };
    return { label: 'Pending', color: 'var(--text-muted)', icon: <Clock size={9} /> };
  };
  const sStatus = sessionStatusLabel();

  if (loading) return (
    <div className="page-container" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader2 size={32} style={{ color: 'var(--status-safe)', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );

  return (
    <div className="page-container" style={{ maxWidth: 1200 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Patient Dashboard
          </h1>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>
            Welcome back, {user?.name}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className={`ds-btn ds-btn-sm ${view === 'session' ? 'ds-btn-primary' : 'ds-btn-ghost'}`} onClick={() => setView('session')}>
            <Activity size={13} /> My Session
          </button>
          <button className={`ds-btn ds-btn-sm ${view === 'browse' ? 'ds-btn-primary' : 'ds-btn-ghost'}`} onClick={() => setView('browse')}>
            <Stethoscope size={13} /> Find a Doctor
          </button>
          <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={load}><RefreshCw size={12} /></button>
        </div>
      </div>

      {/* ── High-risk alert banner (Section 11) ── */}
      {highRiskBanner && (
        <div style={{ ...card, padding: '0.875rem 1.25rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', border: '1px solid var(--status-danger-border)', background: 'var(--status-danger-dim)', animation: 'trustAlert 1.2s ease-in-out infinite' }}>
          <AlertTriangle size={18} style={{ color: 'var(--status-danger)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.88rem', color: 'var(--status-danger)', fontWeight: 700 }}>
            High Risk Identity Behavior Detected — Session Terminated
          </span>
          <button className="ds-btn ds-btn-ghost ds-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setHighRiskBanner(false); load(); }}>Dismiss</button>
        </div>
      )}

      {/* ── Termination banner ── */}
      {terminated && !highRiskBanner && (
        <div style={{ ...card, padding: '0.875rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', border: '1px solid var(--status-danger-border)', background: 'var(--status-danger-dim)' }}>
          <XCircle size={16} style={{ color: 'var(--status-danger)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.82rem', color: 'var(--status-danger)', fontWeight: 600 }}>{terminated}</span>
          <button className="ds-btn ds-btn-ghost ds-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setTerminated(null)}>Dismiss</button>
        </div>
      )}

      {/* ══════════════════ BROWSE VIEW ══════════════════ */}
      {view === 'browse' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <Stethoscope size={14} style={{ color: 'var(--accent-blue)' }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Verified Doctors Available</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{doctors.length} available</span>
          </div>
          {doctors.length === 0 ? (
            <div style={{ ...card, padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Stethoscope size={32} style={{ marginBottom: '0.75rem', opacity: 0.4 }} />
              <p style={{ margin: 0, fontSize: '0.9rem' }}>No verified doctors available</p>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem' }}>Check back soon or contact support</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {doctors.map((d: any) => (
                <DoctorCard key={d.id} doctor={d} onConnect={handleConnect} connecting={connecting && connectingId === d.id} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ SESSION VIEW ══════════════════ */}
      {view === 'session' && (
        <>
          {/* ── No session ── */}
          {!hasSession && (
            <div style={{ ...card, padding: '2.5rem', marginBottom: '1rem', textAlign: 'center', border: '1px dashed var(--border-default)' }}>
              <WifiOff size={36} style={{ color: 'var(--text-muted)', marginBottom: '0.875rem' }} />
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>No doctor connected yet</p>
              <p style={{ margin: '0.4rem 0 1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Browse verified doctors and request a secure consultation</p>
              <button className="ds-btn ds-btn-primary ds-btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }} onClick={() => setView('browse')}>
                <Stethoscope size={13} /> Find a Doctor
              </button>
            </div>
          )}

          {/* ── Session active — main 70/30 grid ── */}
          {hasSession && (
            <>
              {/* Session header bar */}
              <div style={{ ...card, padding: '1rem 1.25rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
                border: `1px solid ${isActive ? 'var(--status-safe-border)' : isBlocked ? 'var(--status-danger-border)' : 'var(--status-warn-border)'}`,
                background: isActive ? 'var(--status-safe-dim)' : isBlocked ? 'var(--status-danger-dim)' : 'var(--status-warn-dim)',
              }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isActive ? 'var(--status-safe-dim)' : 'var(--status-warn-dim)',
                  border: `2px solid ${isActive ? 'var(--status-safe-border)' : 'var(--status-warn-border)'}`,
                }}>
                  {isActive ? <CheckCircle size={20} style={{ color: 'var(--status-safe)' }} /> : <Clock size={20} style={{ color: 'var(--status-warn)' }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{session.doctor_name || 'Assigned Doctor'}</span>
                    <span style={{ fontSize: '0.62rem', padding: '0.12rem 0.45rem', borderRadius: 99, fontWeight: 600,
                      background: isActive ? 'var(--status-safe-dim)' : 'var(--bg-elevated)',
                      border: `1px solid ${isActive ? 'var(--status-safe-border)' : 'var(--border-default)'}`,
                      color: sStatus.color, display: 'flex', alignItems: 'center', gap: '0.3rem',
                    }}>
                      {sStatus.icon}{sStatus.label}
                    </span>
                    {isActive && <span style={{ fontSize: '0.62rem', padding: '0.12rem 0.45rem', borderRadius: 99, background: 'var(--status-safe-dim)', border: '1px solid var(--status-safe-border)', color: 'var(--status-safe)', fontWeight: 700 }}>✓ Identity Verified</span>}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    {session.specialization && <span><Stethoscope size={10} style={{ marginRight: 3 }} />{session.specialization}</span>}
                    {session.hospital_name  && <span><Building size={10} style={{ marginRight: 3 }} />{session.hospital_name}</span>}
                    {session.license_number && <span style={{ fontFamily: 'monospace' }}>Lic: {session.license_number}</span>}
                  </div>
                </div>
                <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={() => setView('browse')} style={{ flexShrink: 0 }}>
                  <Stethoscope size={12} /> Change Doctor
                </button>
              </div>

              {/* Pending / verifying state — dynamic, no static message */}
              {isVerifying && (
                <div style={{ ...card, padding: '2rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                  <Loader2 size={26} style={{ color: 'var(--accent-blue)', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
                      {session?.status === 'pending' ? 'Waiting for doctor to accept…' :
                       session?.status === 'doctor_verifying' ? 'Doctor is completing identity verification…' :
                       'Finalising session…'}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      Session will activate automatically — no refresh needed
                    </div>
                  </div>
                  <span style={{ marginLeft: 'auto', fontSize: '0.62rem', padding: '0.15rem 0.5rem', borderRadius: 99, fontWeight: 600,
                    background: 'var(--status-warn-dim)', border: '1px solid var(--status-warn-border)', color: 'var(--status-warn)', whiteSpace: 'nowrap' }}>
                    {session?.status ?? 'pending'}
                  </span>
                </div>
              )}

              {/* Active session — 70/30 layout */}
              {isActive && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '1rem', alignItems: 'start', marginBottom: '1rem' }}>

                  {/* LEFT 70% — session status + info */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Session live indicator */}
                    <div style={{ ...card, padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--status-safe)', display: 'inline-block', animation: 'status-pulse 2s infinite', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Secure Consultation Active</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Session ID: <span style={{ fontFamily: 'monospace' }}>{String(session.id).slice(0, 16)}…</span></div>
                      </div>
                      <div style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {session.started_at ? new Date(session.started_at).toLocaleTimeString() : '—'}
                      </div>
                    </div>

                    {/* Risk status indicator */}
                    <div style={{ ...card, padding: '1.25rem' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Risk Status</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ flex: 1, padding: '0.875rem', borderRadius: 12, textAlign: 'center',
                          background: ts?.status === 'safe' ? 'var(--status-safe-dim)' : ts?.status === 'suspicious' ? 'var(--status-warn-dim)' : 'var(--status-danger-dim)',
                          border: `1px solid ${ts?.status === 'safe' ? 'var(--status-safe-border)' : ts?.status === 'suspicious' ? 'var(--status-warn-border)' : 'var(--status-danger-border)'}`,
                        }}>
                          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: tCol(ts?.score ?? null) }}>{ts?.status?.toUpperCase() ?? '—'}</div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Current Risk Level</div>
                        </div>
                        {(ts as any)?.impersonation_risk && (
                          <div style={{ flex: 1, padding: '0.875rem', borderRadius: 12, textAlign: 'center',
                            background: (ts as any).impersonation_risk !== 'LOW' ? 'var(--status-danger-dim)' : 'var(--bg-elevated)',
                            border: `1px solid ${(ts as any).impersonation_risk !== 'LOW' ? 'var(--status-danger-border)' : 'var(--border-subtle)'}`,
                          }}>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: (ts as any).impersonation_risk !== 'LOW' ? 'var(--status-danger)' : 'var(--status-safe)' }}>
                              {(ts as any).impersonation_risk}
                            </div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Impersonation Risk</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* RIGHT 30% — Doctor trust score + doctor details */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Trust gauge — backend data only */}
                    <div style={{ ...card, padding: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.875rem' }}>
                      <TrustGauge score={ts?.score ?? 0} status={ts?.status ?? 'safe'} />
                      <span style={{ fontSize: '0.62rem', padding: '0.2rem 0.7rem', borderRadius: 99, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem',
                        background: 'var(--status-safe-dim)', border: '1px solid var(--status-safe-border)', color: 'var(--status-safe)',
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-safe)', display: 'inline-block', animation: 'status-pulse 2s infinite' }} />
                        Session Live
                      </span>
                    </div>

                    {/* Doctor details panel (Section 7) */}
                    {doctorDetails && (
                      <div style={{ ...card, padding: '1.25rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
                          <UserCircle size={13} style={{ color: 'var(--accent-blue)' }} />
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Doctor Details</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {[
                            { icon: <UserCircle size={11} />, label: 'Name',          val: doctorDetails.name },
                            { icon: <Award size={11} />,      label: 'License',       val: doctorDetails.license_number },
                            { icon: <Building size={11} />,   label: 'Hospital',      val: doctorDetails.hospital_name },
                            { icon: <Stethoscope size={11} />,label: 'Specialization',val: doctorDetails.specialization },
                            { icon: <TrendingUp size={11} />, label: 'Experience',    val: doctorDetails.years_experience ? `${doctorDetails.years_experience} yrs` : null },
                            { icon: <Hash size={11} />,       label: 'Risk Incidents',val: doctorDetails.suspicious_session_count != null ? String(doctorDetails.suspicious_session_count) : '0' },
                            { icon: <Calendar size={11} />,   label: 'Last Verified', val: doctorDetails.last_login ? new Date(doctorDetails.last_login).toLocaleDateString() : null },
                          ].filter(r => r.val).map(({ icon, label, val }) => (
                            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>{icon}{label}</span>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-primary)', fontWeight: 600, textAlign: 'right', maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Bottom: security footer ── */}
          <div style={{ ...card, padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Shield size={14} style={{ color: 'var(--status-safe)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
              Zero-trust session. Trust scores are computed server-side in real time. All events are cryptographically logged.
              {isActive && <span style={{ color: 'var(--status-safe)', marginLeft: '0.4rem' }}>Doctor identity has been AI-verified.</span>}
            </span>
          </div>
        </>
      )}
    </div>
  );
};
