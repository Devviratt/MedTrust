import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { adminApi, authApi, type RegisterUserPayload } from '../services/api';
import {
  Users, Activity, Shield, AlertTriangle, Settings,
  CheckCircle, RefreshCw, Plus, Save, Loader2,
  Eye, EyeOff, BarChart3, Fingerprint, BadgeCheck, RotateCcw,
} from 'lucide-react';
import { DoctorEnrollModal } from '../components/shared/DoctorEnrollModal';
import toast from 'react-hot-toast';

// ── CSS-variable helpers ───────────────────────────────────────────────────────
const trustColor = (t: number | null) =>
  !t ? 'var(--text-muted)'
  : t >= 75 ? 'var(--status-safe)'
  : t >= 50 ? 'var(--status-warn)'
  : 'var(--status-danger)';

const card: React.CSSProperties = {
  background: 'var(--glass-bg)',
  border: '1px solid var(--border-default)',
  borderRadius: 16,
  boxShadow: 'var(--shadow-md)',
};

const TH: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <th style={{
    textAlign: 'left', padding: '0.4rem 0.75rem',
    color: 'var(--text-muted)', fontWeight: 700,
    fontSize: '0.62rem', letterSpacing: '0.08em', textTransform: 'uppercase',
    borderBottom: '1px solid var(--border-subtle)',
  }}>{children}</th>
);


// ─── Threshold editor ─────────────────────────────────────────────────────────
const ThresholdEditor: React.FC = () => {
  const [thresholds, setThresholds] = useState<Record<string, { value: number; description: string }>>({});
  const [edits, setEdits]   = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const LABELS: Record<string, string> = {
    min_safe_score:'Min Safe Score', suspicious_score:'Suspicious Threshold',
    alert_score:'Alert Trigger Score', video_drop_threshold:'Video Drop Limit',
    biometric_variance_limit:'Biometric Min Score', voice_flatness_limit:'Voice Min Score',
    video_weight:'Video Weight', voice_weight:'Voice Weight',
    biometric_weight:'Biometric Weight', blockchain_weight:'Blockchain Weight',
    impersonation_threshold:'Impersonation Threshold',
  };
  const GROUPS: Record<string,string[]> = {
    'Score Thresholds':['min_safe_score','suspicious_score','alert_score'],
    'Alert Triggers':['video_drop_threshold','biometric_variance_limit','voice_flatness_limit'],
    'Module Weights':['video_weight','voice_weight','biometric_weight','blockchain_weight'],
    'Security':['impersonation_threshold'],
  };

  useEffect(() => {
    adminApi.getThresholds().then(r => {
      setThresholds(r.data);
      const init: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.data)) init[k] = (v as any).value;
      setEdits(init);
    }).catch(() => toast.error('Failed to load thresholds')).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try { await adminApi.updateThresholds(edits); toast.success('Thresholds saved'); }
    catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  };

  if (loading) return (
    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem' }}>
      <Loader2 size={18} style={{ animation: 'spin 0.8s linear infinite', display: 'inline-block', marginRight: '0.5rem' }} />Loading…
    </div>
  );

  const isW = (k: string) => k.includes('weight');

  return (
    <div>
      {Object.entries(GROUPS).map(([group, keys]) => (
        <div key={group} style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--status-warn)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.75rem', fontWeight: 700 }}>{group}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '0.75rem' }}>
            {keys.filter(k => thresholds[k] !== undefined).map(k => {
              const val = edits[k] ?? thresholds[k]?.value ?? 0;
              const pct = isW(k) ? val * 100 : val;
              const col = pct >= 60 ? 'var(--status-safe)' : pct >= 40 ? 'var(--status-warn)' : 'var(--status-danger)';
              return (
                <div key={k} style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: '0.875rem', border: '1px solid var(--border-default)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{LABELS[k] || k}</label>
                    <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: col, fontWeight: 700 }}>{isW(k) ? val.toFixed(2) : Math.round(val)}</span>
                  </div>
                  <input type="range" min={0} max={isW(k) ? 1 : 100} step={isW(k) ? 0.01 : 1} value={val}
                    onChange={e => setEdits(p => ({ ...p, [k]: parseFloat(e.target.value) }))}
                    style={{ width: '100%', accentColor: col, cursor: 'pointer' }} />
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{thresholds[k]?.description || ''}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <button className="ds-btn ds-btn-primary" onClick={save} disabled={saving}
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {saving ? <Loader2 size={13} style={{ animation: 'spin 0.7s linear infinite' }} /> : <Save size={13} />}
        {saving ? 'Saving…' : 'Apply Thresholds'}
      </button>
    </div>
  );
};

// ─── Register user modal ───────────────────────────────────────────────────────
const RegisterModal: React.FC<{ onClose: () => void; onSuccess: (user?: any) => void; doctors: any[] }> = ({ onClose, onSuccess, doctors }) => {
  const [form, setForm] = useState<RegisterUserPayload>({ name: '', email: '', password: '', role: 'doctor' });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const f = (k: keyof RegisterUserPayload, v: string) => setForm(p => ({ ...p, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const res = await authApi.register(form);
      toast.success(`${form.role} registered`);
      onSuccess(res.data?.user);
      onClose();
    }
    catch (err: any) { toast.error(err.response?.data?.error || 'Registration failed'); }
    finally { setSaving(false); }
  };
  const inp: React.CSSProperties = {
    width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
    borderRadius: 8, padding: '0.5rem 0.75rem', color: 'var(--text-primary)', fontSize: '0.82rem',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  };
  const lbl: React.CSSProperties = { fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.3rem', display: 'block' };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
      <div style={{ ...card, padding: '1.5rem', width: 500, maxWidth: '95vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Register New User</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.25rem', lineHeight: 1 }}>×</button>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
            <div><label style={lbl}>Full Name *</label><input style={inp} value={form.name} onChange={e => f('name', e.target.value)} required /></div>
            <div><label style={lbl}>Email *</label><input style={inp} type="email" value={form.email} onChange={e => f('email', e.target.value)} required /></div>
          </div>
          <div style={{ position: 'relative' }}>
            <label style={lbl}>Password *</label>
            <input style={{ ...inp, paddingRight: '2.5rem' }} type={showPw ? 'text' : 'password'} value={form.password} onChange={e => f('password', e.target.value)} required />
            <button type="button" onClick={() => setShowPw(p => !p)} style={{ position: 'absolute', right: 10, bottom: 9, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}>
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div>
            <label style={lbl}>Role *</label>
            <select style={{ ...inp, appearance: 'none' }} value={form.role} onChange={e => f('role', e.target.value as any)}>
              <option value="doctor">Doctor</option><option value="patient">Patient</option><option value="admin">Admin</option>
            </select>
          </div>
          {(form.role === 'doctor' || form.role === 'admin') && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
              <div><label style={lbl}>Specialization</label><input style={inp} value={form.specialization || ''} onChange={e => f('specialization', e.target.value)} /></div>
              <div><label style={lbl}>License Number</label><input style={inp} value={form.license_number || ''} onChange={e => f('license_number', e.target.value)} /></div>
              <div><label style={lbl}>Hospital</label><input style={inp} value={form.hospital_name || ''} onChange={e => f('hospital_name', e.target.value)} /></div>
            </div>
          )}
          {form.role === 'patient' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
              <div>
                <label style={lbl}>Assign Doctor</label>
                <select style={{ ...inp, appearance: 'none' }} value={form.assigned_doctor_id || ''} onChange={e => f('assigned_doctor_id', e.target.value)}>
                  <option value="">— Select —</option>
                  {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Health ID</label><input style={inp} value={form.health_id || ''} onChange={e => f('health_id', e.target.value)} /></div>
              <div style={{ gridColumn: '1/-1' }}><label style={lbl}>Condition Notes</label><textarea style={{ ...inp, resize: 'vertical', minHeight: 56 }} value={form.condition_notes || ''} onChange={e => f('condition_notes', e.target.value)} /></div>
            </div>
          )}
          <button type="submit" className="ds-btn ds-btn-primary" disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
            {saving ? <Loader2 size={13} style={{ animation: 'spin 0.7s linear infinite' }} /> : <Plus size={13} />}
            {saving ? 'Registering…' : 'Register User'}
          </button>
        </form>
      </div>
    </div>
  );
};

// ─── Stat Tile ─────────────────────────────────────────────────────────────────
const StatTile: React.FC<{ label: string; value: any; sub: string; icon: React.ReactNode; accent: string }> = ({ label, value, sub, icon, accent }) => (
  <div style={{ ...card, padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</span>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: `color-mix(in srgb, ${accent} 15%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent }}>{icon}</div>
    </div>
    <div style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{sub}</div>
  </div>
);

// ─── Confidence bar ────────────────────────────────────────────────────────────
const ConfBar: React.FC<{ label: string; value: number; color?: string }> = ({ label, value, color = 'var(--status-safe)' }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 600, color }}>{value}%</span>
    </div>
    <div style={{ height: 4, background: 'var(--border-subtle)', borderRadius: 99 }}>
      <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 99, transition: 'width 0.6s ease' }} />
    </div>
  </div>
);

// ─── Main Admin Dashboard ─────────────────────────────────────────────────────
export const AdminDashboard: React.FC = () => {
  const { user } = useAuthStore();
  const [tab, setTab]           = useState<'overview'|'users'|'sessions'|'thresholds'>('overview');
  const [stats, setStats]       = useState<any>(null);
  const [users, setUsers]       = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading]   = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [enrollTarget, setEnrollTarget] = useState<{ id: string; name: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const doctors = users.filter(u => u.role === 'doctor' || u.role === 'admin');

  const fetchStats = useCallback(async () => {
    try { const r = await adminApi.getDashboardStats(); setStats(r.data); } catch {}
  }, []);
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try { const r = await adminApi.getUsers(roleFilter ? { role: roleFilter } : undefined); setUsers(r.data?.users || []); }
    catch { toast.error('Failed to load users'); }
    finally { setLoading(false); }
  }, [roleFilter]);

  const handleApprove = async (userId: string, name: string) => {
    setActionLoading(userId + ':approve');
    try {
      await adminApi.approveDoctor(userId);
      toast.success(`${name} approved — dashboard access granted`);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Approve failed');
    } finally { setActionLoading(null); }
  };

  const handleReEnroll = async (userId: string, name: string) => {
    setActionLoading(userId + ':reenroll');
    try {
      await adminApi.reEnrollDoctor(userId);
      toast.success(`${name} reset — biometrics cleared, re-enrollment required`);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Re-enroll reset failed');
    } finally { setActionLoading(null); }
  };
  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try { const r = await adminApi.getSessions(); setSessions(r.data?.sessions || []); }
    catch { toast.error('Failed to load sessions'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { if (tab === 'users')    fetchUsers();    }, [tab, fetchUsers]);
  useEffect(() => { if (tab === 'sessions') fetchSessions(); }, [tab, fetchSessions]);

  const statusBadge = (s: string) => {
    const col = s === 'active' ? 'var(--status-safe)' : 'var(--text-muted)';
    const bg  = s === 'active' ? 'var(--status-safe-dim)' : 'var(--bg-elevated)';
    const bdr = s === 'active' ? 'var(--status-safe-border)' : 'var(--border-default)';
    return <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: 99, background: bg, border: `1px solid ${bdr}`, color: col, fontWeight: 600 }}>{s}</span>;
  };

  const verifiedBadge = (v: string) => {
    const col = v === 'verified' ? 'var(--status-safe)' : v === 'pending' ? 'var(--status-warn)' : 'var(--status-danger)';
    const bg  = v === 'verified' ? 'var(--status-safe-dim)' : v === 'pending' ? 'var(--status-warn-dim)' : 'var(--status-danger-dim)';
    const bdr = v === 'verified' ? 'var(--status-safe-border)' : v === 'pending' ? 'var(--status-warn-border)' : 'var(--status-danger-border)';
    return <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: 99, background: bg, border: `1px solid ${bdr}`, color: col, fontWeight: 600 }}>{v}</span>;
  };

  const roleBadge = (r: string) => {
    const colors: Record<string, string> = { admin: 'var(--status-warn)', doctor: 'var(--accent-blue)', patient: 'var(--status-safe)' };
    return <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: 99, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: colors[r] || 'var(--text-muted)', fontWeight: 600, textTransform: 'capitalize' }}>{r}</span>;
  };

  const TABS = [
    { id: 'overview',    label: 'Overview',       icon: <BarChart3 size={13}/> },
    { id: 'users',       label: 'Users',           icon: <Users size={13}/> },
    { id: 'sessions',    label: 'Sessions',        icon: <Activity size={13}/> },
    { id: 'thresholds',  label: 'AI Thresholds',   icon: <Settings size={13}/> },
  ] as const;

  return (
    <div style={{ color: 'var(--text-primary)' }}>

      {/* Page header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <Shield size={16} style={{ color: 'var(--status-warn)' }} />
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Admin Panel</span>
          <span style={{ fontSize: '0.62rem', padding: '0.15rem 0.5rem', borderRadius: 99, background: 'var(--status-warn-dim)', border: '1px solid var(--status-warn-border)', color: 'var(--status-warn)', fontWeight: 700 }}>ADMIN</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{user?.name || user?.email}</span>
          <button className="ds-btn ds-btn-primary ds-btn-sm" onClick={() => setShowRegister(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Plus size={12} />Add User
          </button>
        </div>
      </div>

      {/* Page content */}
      <div>

        {/* Stat tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.875rem', marginBottom: '1.5rem' }}>
          <StatTile label="Total Doctors"   value={stats?.doctors?.total ?? '—'}  sub={`${stats?.doctors?.active ?? 0} active`} accent="var(--accent-blue)" icon={<Users size={14}/>}/>
          <StatTile label="Active Sessions" value={stats?.streams?.active ?? '—'} sub={`${stats?.streams?.total ?? 0} total`}   accent="var(--status-safe)" icon={<Activity size={14}/>}/>
          <StatTile label="Alerts (24h)"    value={stats?.alerts_24h ?? '—'}      sub="Critical events"                         accent="var(--status-danger)" icon={<AlertTriangle size={14}/>}/>
          <StatTile label="Avg Trust Score" value={stats?.trust_score_24h?.avg ? `${Math.round(stats.trust_score_24h.avg)}` : '—'} sub="Last 24 hours" accent="var(--status-safe)" icon={<Shield size={14}/>}/>
        </div>

        {/* Tab nav */}
        <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', background: 'var(--bg-surface)', borderRadius: 12, padding: '0.25rem', width: 'fit-content', border: '1px solid var(--border-default)' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: tab === t.id ? 'var(--accent-blue-dim)' : 'transparent',
              color: tab === t.id ? 'var(--accent-blue)' : 'var(--text-muted)',
              border: tab === t.id ? '1px solid var(--accent-blue-border)' : '1px solid transparent',
              borderRadius: 8, padding: '0.375rem 0.875rem', fontSize: '0.75rem', fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem', transition: 'all 0.2s ease',
            }}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ ...card, padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <Activity size={13} style={{ color: 'var(--accent-blue)' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Trust Distribution (24h)</span>
              </div>
              {stats?.trust_score_24h ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                  <ConfBar label="Average" value={Math.round(stats.trust_score_24h.avg)} color="var(--status-safe)" />
                  <ConfBar label="Maximum" value={Math.round(stats.trust_score_24h.max)} color="var(--accent-blue)" />
                  <ConfBar label="Minimum" value={Math.round(stats.trust_score_24h.min)} color="var(--status-danger)" />
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                    Alert events: <span style={{ color: 'var(--status-danger)', fontFamily: 'monospace', fontWeight: 700 }}>{stats.trust_score_24h.alert_count}</span>
                  </div>
                </div>
              ) : <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem 0' }}>No data yet</div>}
            </div>
            <div style={{ ...card, padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <Shield size={13} style={{ color: 'var(--accent-blue)' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>Platform Status</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {['AI Trust Engine', 'Blockchain Audit', 'Impersonation Detector', 'SMS Alert Queue', 'Zero-Trust RBAC'].map(item => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <CheckCircle size={13} style={{ color: 'var(--status-safe)', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', flex: 1 }}>{item}</span>
                    <span style={{ fontSize: '0.6rem', fontFamily: 'monospace', color: 'var(--status-safe)', letterSpacing: '0.06em' }}>OPERATIONAL</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── USERS ── */}
        {tab === 'users' && (
          <div style={{ ...card, padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Users size={13} style={{ color: 'var(--accent-blue)' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>All Users</span>
              </div>
              <div style={{ display: 'flex', gap: '0.25rem', marginLeft: 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
                {['', 'admin', 'doctor', 'patient'].map(r => (
                  <button key={r} onClick={() => setRoleFilter(r)} style={{
                    background: roleFilter === r ? 'var(--accent-blue-dim)' : 'transparent',
                    color: roleFilter === r ? 'var(--accent-blue)' : 'var(--text-muted)',
                    border: `1px solid ${roleFilter === r ? 'var(--accent-blue-border)' : 'var(--border-default)'}`,
                    borderRadius: 6, padding: '0.25rem 0.625rem', fontSize: '0.7rem',
                    fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize', transition: 'all 0.2s ease',
                  }}>{r || 'All'}</button>
                ))}
                <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={fetchUsers}>
                  <RefreshCw size={11} />
                </button>
              </div>
            </div>
            {loading
              ? <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}><Loader2 size={20} style={{ animation: 'spin 0.8s linear infinite', display: 'inline-block' }} /></div>
              : <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead><tr><TH>Name</TH><TH>Email</TH><TH>Role</TH><TH>Status</TH><TH>Hospital</TH><TH>Verified</TH><TH>Enrollment</TH><TH>Last Login</TH><TH>Actions</TH></tr></thead>
                    <tbody>
                      {users.map(u => {
                        const isDoc = u.role === 'doctor';
                        const enrollStatus: string = u.enrollment_status ?? 'pending_enrollment';
                        const bioEnrolled: boolean = u.biometric_enrolled ?? false;
                        const isApproving  = actionLoading === u.id + ':approve';
                        const isReEnrolling = actionLoading === u.id + ':reenroll';

                        const enrollBadge = () => {
                          if (!isDoc) return <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>—</span>;
                          if (enrollStatus === 'approved')
                            return <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: 99, background: 'var(--status-safe-dim)', border: '1px solid var(--status-safe-border)', color: 'var(--status-safe)', fontWeight: 600 }}>✓ Approved</span>;
                          if (enrollStatus === 'pending_admin_approval')
                            return <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: 99, background: 'var(--accent-blue-dim)', border: '1px solid var(--accent-blue-border)', color: 'var(--accent-blue)', fontWeight: 600 }}>⏳ Pending Approval</span>;
                          if (enrollStatus === 'suspended')
                            return <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: 99, background: 'var(--status-danger-dim)', border: '1px solid var(--status-danger-border)', color: 'var(--status-danger)', fontWeight: 600 }}>✕ Suspended</span>;
                          return <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: 99, background: 'var(--status-warn-dim)', border: '1px solid var(--status-warn-border)', color: 'var(--status-warn)', fontWeight: 600 }}>Not Enrolled</span>;
                        };

                        return (
                        <tr key={u.id} style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-primary)', fontWeight: 500 }}>{u.name}</td>
                          <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.7rem' }}>{u.email}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{roleBadge(u.role)}</td>
                          <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', color: u.is_active ? 'var(--status-safe)' : 'var(--status-danger)' }}>{u.is_active ? '● Active' : '○ Inactive'}</td>
                          <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.7rem' }}>{u.hospital_name || '—'}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{u.verified_status ? verifiedBadge(u.verified_status) : <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>—</span>}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{enrollBadge()}</td>
                          <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.65rem', fontFamily: 'monospace' }}>{u.last_login ? new Date(u.last_login).toLocaleDateString() : '—'}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>
                            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                              {/* Approve button — shown when doctor has enrolled but not yet approved */}
                              {isDoc && enrollStatus === 'pending_admin_approval' && (
                                <button
                                  onClick={() => handleApprove(u.id, u.name)}
                                  disabled={isApproving}
                                  title="Approve doctor — grant dashboard access"
                                  style={{ background: 'var(--status-safe-dim)', border: '1px solid var(--status-safe-border)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--status-safe)', fontSize: '0.68rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: 6 }}
                                >
                                  {isApproving
                                    ? <Loader2 size={11} style={{ animation: 'spin 0.8s linear infinite' }} />
                                    : <BadgeCheck size={11} />}
                                  Approve
                                </button>
                              )}
                              {/* Enroll / Re-enroll button */}
                              {isDoc && (
                                <button
                                  onClick={() => setEnrollTarget({ id: u.id, name: u.name })}
                                  title={bioEnrolled ? 'View / Re-enroll biometrics' : 'Enroll biometrics'}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', color: bioEnrolled ? 'var(--text-muted)' : 'var(--accent-blue)', fontSize: '0.68rem', fontWeight: 600, padding: '0.2rem 0.4rem', borderRadius: 6 }}
                                >
                                  <Fingerprint size={11} />{bioEnrolled ? 'Re-enroll' : 'Enroll'}
                                </button>
                              )}
                              {/* Reset biometrics */}
                              {isDoc && bioEnrolled && (
                                <button
                                  onClick={() => handleReEnroll(u.id, u.name)}
                                  disabled={isReEnrolling}
                                  title="Reset biometrics — force re-enrollment"
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--status-danger)', fontSize: '0.68rem', padding: '0.2rem 0.4rem', borderRadius: 6 }}
                                >
                                  {isReEnrolling
                                    ? <Loader2 size={11} style={{ animation: 'spin 0.8s linear infinite' }} />
                                    : <RotateCcw size={11} />}
                                  Reset
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {users.length === 0 && <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No users found</div>}
                </div>
            }
          </div>
        )}

        {/* ── SESSIONS ── */}
        {tab === 'sessions' && (
          <div style={{ ...card, padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Activity size={13} style={{ color: 'var(--accent-blue)' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>All Sessions</span>
              </div>
              <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={fetchSessions} style={{ marginLeft: 'auto' }}>
                <RefreshCw size={11} />
              </button>
            </div>
            {loading
              ? <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}><Loader2 size={20} style={{ animation: 'spin 0.8s linear infinite', display: 'inline-block' }} /></div>
              : <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead><tr><TH>Stream ID</TH><TH>Doctor</TH><TH>Patient</TH><TH>Status</TH><TH>Trust</TH><TH>ICU Room</TH><TH>Started</TH></tr></thead>
                    <tbody>
                      {sessions.map(s => (
                        <tr key={s.id} style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.66rem' }}>{String(s.id).slice(0, 12)}…</td>
                          <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-primary)' }}>{s.doctor_name || '—'}</td>
                          <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)' }}>{s.patient_name || '—'}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>{statusBadge(s.status || 'ended')}</td>
                          <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontWeight: 700, color: trustColor(s.last_trust) }}>{s.last_trust ?? '—'}</td>
                          <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.7rem' }}>{s.icu_room || '—'}</td>
                          <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.65rem', fontFamily: 'monospace' }}>{s.started_at ? new Date(s.started_at).toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sessions.length === 0 && <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No sessions found</div>}
                </div>
            }
          </div>
        )}

        {/* ── AI THRESHOLDS ── */}
        {tab === 'thresholds' && (
          <div style={{ ...card, padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <Settings size={13} style={{ color: 'var(--status-warn)' }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>AI Detection Thresholds</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 1.25rem', lineHeight: 1.55 }}>
              Changes persist to DB and invalidate Redis cache. All values are server-driven.
            </p>
            <ThresholdEditor />
          </div>
        )}

      </div>

      {showRegister && (
    <RegisterModal
      onClose={() => setShowRegister(false)}
      onSuccess={(newUser) => {
        fetchUsers(); fetchStats();
        if (newUser?.id && (newUser.role === 'doctor' || newUser.role === 'admin')) {
          setEnrollTarget({ id: newUser.id, name: newUser.name });
        }
      }}
      doctors={doctors}
    />
  )}
  {enrollTarget && (
    <DoctorEnrollModal
      doctorId={enrollTarget.id}
      doctorName={enrollTarget.name}
      onClose={() => setEnrollTarget(null)}
      onEnrolled={() => { fetchUsers(); setEnrollTarget(null); }}
    />
  )}
    </div>
  );
};
