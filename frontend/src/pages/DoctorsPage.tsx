import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  Users, Search, RefreshCw, UserCheck, UserX, Stethoscope,
  AlertCircle, Shield, User, ChevronDown, Trash2, Ban,
  CheckCircle, Eye, Clock, Activity, Building, Hash,
} from 'lucide-react';
import { adminApi } from '../services/api';
import toast from 'react-hot-toast';

// ── Types ─────────────────────────────────────────────────────────────────────
interface DoctorRow {
  id: string; name: string; email: string; role: string;
  is_active: boolean; created_at: string; last_login: string | null;
  biometric_enrolled: boolean; enrollment_status: string;
  suspicious_session_count: number; verified_status: string | null;
  hospital_name: string | null; license_number: string | null;
  specialization: string | null; years_experience: number | null;
  total_sessions: number;
}
interface PatientRow {
  id: string; name: string; email: string; role: string;
  is_active: boolean; created_at: string; last_login: string | null;
  suspicious_session_count: number; assigned_doctor_name: string | null;
  total_sessions: number;
}
interface AdminRow {
  id: string; name: string; email: string; role: string;
  is_active: boolean; created_at: string; last_login: string | null;
}

type Tab = 'doctors' | 'patients' | 'admins';
type FilterStatus = 'all' | 'active' | 'pending' | 'blocked' | 'verified';

// ── Style constants ───────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: 'var(--glass-bg)',
  border: '1px solid var(--border-default)',
  borderRadius: 16,
  boxShadow: 'var(--shadow-md)',
};

// ── Status badge ──────────────────────────────────────────────────────────────
const StatusBadge: React.FC<{ isActive: boolean; enrollmentStatus?: string }> = ({ isActive, enrollmentStatus }) => {
  if (!isActive) return (
    <span style={{ fontSize: '0.62rem', padding: '0.15rem 0.5rem', borderRadius: 99, fontWeight: 700,
      background: 'var(--status-danger-dim)', border: '1px solid var(--status-danger-border)', color: 'var(--status-danger)' }}>
      Blocked
    </span>
  );
  if (enrollmentStatus === 'pending_enrollment' || enrollmentStatus === 'pending_admin_approval') return (
    <span style={{ fontSize: '0.62rem', padding: '0.15rem 0.5rem', borderRadius: 99, fontWeight: 700,
      background: 'var(--status-warn-dim)', border: '1px solid var(--status-warn-border)', color: 'var(--status-warn)' }}>
      Pending
    </span>
  );
  return (
    <span style={{ fontSize: '0.62rem', padding: '0.15rem 0.5rem', borderRadius: 99, fontWeight: 700,
      background: 'var(--status-safe-dim)', border: '1px solid var(--status-safe-border)', color: 'var(--status-safe)' }}>
      Active
    </span>
  );
};

const VerifiedBadge: React.FC<{ verified: boolean }> = ({ verified }) => (
  <span style={{ fontSize: '0.62rem', padding: '0.15rem 0.5rem', borderRadius: 99, fontWeight: 700,
    background: verified ? 'rgba(59,130,246,0.12)' : 'var(--bg-elevated)',
    border: `1px solid ${verified ? 'rgba(59,130,246,0.35)' : 'var(--border-default)'}`,
    color: verified ? '#60a5fa' : 'var(--text-muted)',
    display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
    {verified ? <UserCheck size={9} /> : <UserX size={9} />}
    {verified ? 'Verified' : 'Unverified'}
  </span>
);

// ── Avatar initials ───────────────────────────────────────────────────────────
const Avatar: React.FC<{ name: string; color?: string }> = ({ name, color = 'var(--accent-blue)' }) => {
  const initials = name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem',
      background: `${color}22`, border: `1.5px solid ${color}55`, color }}>
      {initials}
    </div>
  );
};

// ── Confirm-delete inline guard ───────────────────────────────────────────────
const DeleteBtn: React.FC<{ onConfirm: () => void; disabled?: boolean }> = ({ onConfirm, disabled }) => {
  const [confirming, setConfirming] = useState(false);
  if (confirming) return (
    <div style={{ display: 'flex', gap: '0.3rem' }}>
      <button className="ds-btn ds-btn-sm" style={{ background: 'var(--status-danger)', color: '#fff', border: 'none', padding: '0.2rem 0.5rem', borderRadius: 6, fontSize: '0.7rem', cursor: 'pointer' }}
        onClick={() => { setConfirming(false); onConfirm(); }}>Confirm</button>
      <button className="ds-btn ds-btn-ghost ds-btn-sm" style={{ fontSize: '0.7rem' }} onClick={() => setConfirming(false)}>Cancel</button>
    </div>
  );
  return (
    <button className="ds-btn ds-btn-ghost ds-btn-sm" title="Delete user" disabled={disabled}
      style={{ color: 'var(--status-danger)', padding: '0.25rem 0.4rem' }}
      onClick={() => setConfirming(true)}>
      <Trash2 size={12} />
    </button>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
export const DoctorsPage: React.FC = () => {
  const [tab, setTab]           = useState<Tab>('doctors');
  const [doctors, setDoctors]   = useState<DoctorRow[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [admins, setAdmins]     = useState<AdminRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState<FilterStatus>('all');
  const [busy, setBusy]         = useState<Record<string, boolean>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch all users grouped ─────────────────────────────────────────────────
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await adminApi.getUsersGrouped();
      setDoctors(res.data.doctors  ?? []);
      setPatients(res.data.patients ?? []);
      setAdmins(res.data.admins    ?? []);
    } catch {
      if (!silent) setError('Failed to load users. Check connection or permissions.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Phase 6: auto-refresh every 10s
    pollRef.current = setInterval(() => load(true), 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  // ── Action helpers ──────────────────────────────────────────────────────────
  const setBusyFor = (id: string, val: boolean) => setBusy(b => ({ ...b, [id]: val }));

  const handleApprove = async (userId: string) => {
    setBusyFor(userId, true);
    try {
      await adminApi.approveDoctor(userId);
      toast.success('Doctor approved');
      load(true);
    } catch { toast.error('Approve failed'); }
    finally { setBusyFor(userId, false); }
  };

  const handleBlock = async (userId: string, currentlyActive: boolean) => {
    setBusyFor(userId, true);
    try {
      await adminApi.blockUser(userId, currentlyActive);
      toast.success(currentlyActive ? 'User blocked' : 'User unblocked');
      load(true);
    } catch { toast.error('Action failed'); }
    finally { setBusyFor(userId, false); }
  };

  const handleDelete = async (userId: string) => {
    setBusyFor(userId, true);
    try {
      await adminApi.deleteUser(userId);
      toast.success('User deleted');
      load(true);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Delete failed');
    } finally { setBusyFor(userId, false); }
  };

  // ── Filter logic ────────────────────────────────────────────────────────────
  const matchSearch = (u: any) => {
    const q = search.toLowerCase();
    return !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) ||
      u.specialization?.toLowerCase().includes(q) || u.license_number?.toLowerCase().includes(q);
  };

  const matchFilter = (u: any) => {
    if (filter === 'all') return true;
    if (filter === 'active')   return u.is_active && u.enrollment_status !== 'pending_enrollment' && u.enrollment_status !== 'pending_admin_approval';
    if (filter === 'pending')  return u.enrollment_status === 'pending_enrollment' || u.enrollment_status === 'pending_admin_approval';
    if (filter === 'blocked')  return !u.is_active;
    if (filter === 'verified') return u.verified_status === 'verified' || u.biometric_enrolled;
    return true;
  };

  const filteredDoctors  = useMemo(() => doctors.filter(u  => matchSearch(u) && matchFilter(u)), [doctors,  search, filter]);
  const filteredPatients = useMemo(() => patients.filter(u => matchSearch(u) && matchFilter(u)), [patients, search, filter]);
  const filteredAdmins   = useMemo(() => admins.filter(u   => matchSearch(u)),                    [admins,   search]);

  const tabCount = { doctors: doctors.length, patients: patients.length, admins: admins.length };

  // ── Tab bar ─────────────────────────────────────────────────────────────────
  const TabBtn: React.FC<{ id: Tab; icon: React.ReactNode; label: string; count: number }> = ({ id, icon, label, count }) => (
    <button
      onClick={() => { setTab(id); setSearch(''); setFilter('all'); }}
      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 1.1rem',
        borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, transition: 'all 0.15s',
        background: tab === id ? 'var(--accent-blue)' : 'transparent',
        color: tab === id ? '#fff' : 'var(--text-muted)',
      }}>
      {icon}
      {label}
      <span style={{ fontSize: '0.66rem', padding: '0.1rem 0.4rem', borderRadius: 99, fontWeight: 700,
        background: tab === id ? 'rgba(255,255,255,0.2)' : 'var(--bg-elevated)',
        color: tab === id ? '#fff' : 'var(--text-muted)',
      }}>{count}</span>
    </button>
  );

  return (
    <div className="page-container" style={{ maxWidth: 1300 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>User Management</h1>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>
            {doctors.length + patients.length + admins.length} total users · auto-refreshes every 10s
          </p>
        </div>
        <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={() => load()} disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 0.8s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* ── Tab bar ── */}
      <div style={{ ...card, padding: '0.5rem', marginBottom: '1rem', display: 'inline-flex', gap: '0.25rem' }}>
        <TabBtn id="doctors"  icon={<Stethoscope size={14} />} label="Doctors"  count={tabCount.doctors}  />
        <TabBtn id="patients" icon={<User size={14} />}        label="Patients" count={tabCount.patients} />
        <TabBtn id="admins"   icon={<Shield size={14} />}      label="Admins"   count={tabCount.admins}   />
      </div>

      {/* ── Search + filter toolbar ── */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            className="ds-input"
            style={{ paddingLeft: 30, width: '100%' }}
            placeholder={`Search ${tab} by name, email${tab === 'doctors' ? ', specialization…' : '…'}`}
            value={search}
            onChange={e => { setSearch(e.target.value); }}
          />
        </div>
        {tab !== 'admins' && (
          <div style={{ position: 'relative' }}>
            <select
              className="ds-input"
              value={filter}
              onChange={e => setFilter(e.target.value as FilterStatus)}
              style={{ paddingRight: 28, appearance: 'none', minWidth: 140, cursor: 'pointer' }}>
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="blocked">Blocked</option>
              {tab === 'doctors' && <option value="verified">Verified</option>}
            </select>
            <ChevronDown size={12} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="ds-alert ds-alert-danger" style={{ alignItems: 'center', marginBottom: '1rem' }}>
          <AlertCircle size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{error}</span>
          <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={() => load()}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {/* ── Loading skeletons ── */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ ...card, padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div className="ds-skeleton" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="ds-skeleton" style={{ height: 13, width: '30%' }} />
                <div className="ds-skeleton" style={{ height: 11, width: '50%' }} />
              </div>
              <div className="ds-skeleton" style={{ height: 26, width: 100, borderRadius: 8 }} />
            </div>
          ))}
        </div>
      )}

      {/* ══ DOCTORS TAB ══ */}
      {!loading && tab === 'doctors' && (
        <>
          {filteredDoctors.length === 0 ? (
            <div style={{ ...card, padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Stethoscope size={32} style={{ marginBottom: '0.75rem', opacity: 0.35 }} />
              <p style={{ margin: 0, fontSize: '0.9rem' }}>{search || filter !== 'all' ? 'No doctors match your search/filter.' : 'No doctors registered yet.'}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {filteredDoctors.map(d => {
                const isPending = d.enrollment_status === 'pending_enrollment' || d.enrollment_status === 'pending_admin_approval';
                const isVerified = d.verified_status === 'verified';
                return (
                  <div key={d.id} style={{ ...card, padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
                    opacity: !d.is_active ? 0.7 : 1 }}>
                    <Avatar name={d.name} color={isVerified ? '#22c55e' : '#60a5fa'} />

                    {/* Main info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {d.name}
                        </span>
                        <StatusBadge isActive={d.is_active} enrollmentStatus={d.enrollment_status} />
                        <VerifiedBadge verified={isVerified} />
                      </div>
                      <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{d.email}</div>
                      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                        {d.specialization && <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Stethoscope size={10} />{d.specialization}</span>}
                        {d.license_number  && <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontFamily: 'monospace' }}><Hash size={10} />{d.license_number}</span>}
                        {d.hospital_name   && <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Building size={10} />{d.hospital_name}</span>}
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Activity size={10} />{d.total_sessions ?? 0} sessions</span>
                        {(d.suspicious_session_count || 0) > 0 && (
                          <span style={{ color: 'var(--status-danger)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <AlertCircle size={10} />{d.suspicious_session_count} risk incidents
                          </span>
                        )}
                        {d.last_login && <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Clock size={10} />Last: {new Date(d.last_login).toLocaleDateString()}</span>}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
                      {isPending && (
                        <button className="ds-btn ds-btn-sm" disabled={busy[d.id]}
                          style={{ background: 'var(--status-safe)', color: '#fff', border: 'none', padding: '0.3rem 0.75rem', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                          onClick={() => handleApprove(d.id)}>
                          <CheckCircle size={11} /> Approve
                        </button>
                      )}
                      <button className="ds-btn ds-btn-ghost ds-btn-sm" disabled={busy[d.id]}
                        style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem',
                          color: d.is_active ? 'var(--status-warn)' : 'var(--status-safe)' }}
                        onClick={() => handleBlock(d.id, d.is_active)}>
                        {d.is_active ? <><Ban size={11} /> Block</> : <><CheckCircle size={11} /> Unblock</>}
                      </button>
                      <button className="ds-btn ds-btn-ghost ds-btn-sm" disabled
                        style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)' }}>
                        <Eye size={11} /> View
                      </button>
                      <DeleteBtn onConfirm={() => handleDelete(d.id)} disabled={busy[d.id]} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ══ PATIENTS TAB ══ */}
      {!loading && tab === 'patients' && (
        <>
          {filteredPatients.length === 0 ? (
            <div style={{ ...card, padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <User size={32} style={{ marginBottom: '0.75rem', opacity: 0.35 }} />
              <p style={{ margin: 0, fontSize: '0.9rem' }}>{search || filter !== 'all' ? 'No patients match your search/filter.' : 'No patients registered yet.'}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {filteredPatients.map(p => (
                <div key={p.id} style={{ ...card, padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
                  opacity: !p.is_active ? 0.7 : 1 }}>
                  <Avatar name={p.name} color="#a78bfa" />

                  {/* Main info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{p.name}</span>
                      <StatusBadge isActive={p.is_active} />
                    </div>
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{p.email}</div>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Activity size={10} />{p.total_sessions ?? 0} sessions</span>
                      {p.assigned_doctor_name && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Stethoscope size={10} />Dr. {p.assigned_doctor_name}</span>
                      )}
                      {(p.suspicious_session_count || 0) > 0 && (
                        <span style={{ color: 'var(--status-danger)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <AlertCircle size={10} />{p.suspicious_session_count} risk flags
                        </span>
                      )}
                      {p.last_login && <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Clock size={10} />Last active: {new Date(p.last_login).toLocaleDateString()}</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, alignItems: 'center' }}>
                    <button className="ds-btn ds-btn-ghost ds-btn-sm" disabled={busy[p.id]}
                      style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem',
                        color: p.is_active ? 'var(--status-warn)' : 'var(--status-safe)' }}
                      onClick={() => handleBlock(p.id, p.is_active)}>
                      {p.is_active ? <><Ban size={11} /> Block</> : <><CheckCircle size={11} /> Unblock</>}
                    </button>
                    <button className="ds-btn ds-btn-ghost ds-btn-sm" disabled
                      style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)' }}>
                      <Eye size={11} /> History
                    </button>
                    <DeleteBtn onConfirm={() => handleDelete(p.id)} disabled={busy[p.id]} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ══ ADMINS TAB ══ */}
      {!loading && tab === 'admins' && (
        <>
          {filteredAdmins.length === 0 ? (
            <div style={{ ...card, padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Shield size={32} style={{ marginBottom: '0.75rem', opacity: 0.35 }} />
              <p style={{ margin: 0, fontSize: '0.9rem' }}>{search ? 'No admins match your search.' : 'No admins found.'}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {filteredAdmins.map(a => (
                <div key={a.id} style={{ ...card, padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <Avatar name={a.name} color="#f59e0b" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{a.name}</span>
                      <span style={{ fontSize: '0.62rem', padding: '0.15rem 0.5rem', borderRadius: 99, fontWeight: 700,
                        background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', color: '#f59e0b' }}>
                        Admin
                      </span>
                    </div>
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{a.email}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', gap: '1rem' }}>
                      {a.last_login && <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Clock size={10} />Last login: {new Date(a.last_login).toLocaleDateString()}</span>}
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Clock size={10} />Joined: {new Date(a.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Footer count ── */}
      {!loading && (
        <div style={{ marginTop: '1rem', fontSize: '0.74rem', color: 'var(--text-muted)', textAlign: 'right' }}>
          Showing {tab === 'doctors' ? filteredDoctors.length : tab === 'patients' ? filteredPatients.length : filteredAdmins.length}
          {' '}/ {tab === 'doctors' ? doctors.length : tab === 'patients' ? patients.length : admins.length} {tab}
        </div>
      )}
    </div>
  );
};
