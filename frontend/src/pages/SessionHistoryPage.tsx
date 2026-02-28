import React, { useEffect, useState, useCallback } from 'react';
import { patientApi } from '../services/api';
import { FileText, Clock, RefreshCw, Loader2, Download } from 'lucide-react';

const card: React.CSSProperties = {
  background: 'var(--glass-bg)',
  border: '1px solid var(--border-default)',
  borderRadius: 16,
  boxShadow: 'var(--shadow-md)',
};

const TH: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.62rem', letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid var(--border-subtle)' }}>
    {children}
  </th>
);

const tCol = (t: number | null) =>
  !t ? 'var(--text-muted)' : t >= 75 ? 'var(--status-safe)' : t >= 50 ? 'var(--status-warn)' : 'var(--status-danger)';

export const SessionHistoryPage: React.FC = () => {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await patientApi.getSessions({ limit: 50 });
      setSessions(res.data?.sessions ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page-container" style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Session History</h1>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>All past consultations and security events</p>
        </div>
        <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={load} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div style={{ ...card, padding: '1.25rem' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <Loader2 size={28} style={{ color: 'var(--status-safe)', animation: 'spin 0.8s linear infinite' }} />
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            <Clock size={36} style={{ marginBottom: '0.875rem', opacity: 0.35 }} />
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>No sessions yet</p>
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem' }}>Your consultation history will appear here</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr>
                  <TH>Session ID</TH>
                  <TH>Doctor</TH>
                  <TH>Final Trust Score</TH>
                  <TH>Alerts</TH>
                  <TH>Status</TH>
                  <TH>Date</TH>
                  <TH>Report</TH>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s: any) => {
                  const trust  = s.avg_trust_score != null ? Math.round(s.avg_trust_score) : null;
                  const isActive  = s.status === 'active';
                  const isBlocked = s.status === 'blocked';
                  const statusColor = isActive ? 'var(--status-safe)' : isBlocked ? 'var(--status-danger)' : 'var(--text-muted)';
                  const statusBg    = isActive ? 'var(--status-safe-dim)' : isBlocked ? 'var(--status-danger-dim)' : 'var(--bg-elevated)';
                  const statusBdr   = isActive ? 'var(--status-safe-border)' : isBlocked ? 'var(--status-danger-border)' : 'var(--border-default)';
                  return (
                    <tr key={s.id}
                      style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.66rem' }}>
                        {String(s.id).slice(0, 12)}…
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                        {s.doctor_name || '—'}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontWeight: 700, color: tCol(trust) }}>
                        {trust ?? '—'}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', color: (s.alert_count || 0) > 0 ? 'var(--status-danger)' : 'var(--text-muted)', fontWeight: (s.alert_count || 0) > 0 ? 700 : 400 }}>
                        {s.alert_count ?? 0}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <span style={{ fontSize: '0.62rem', padding: '0.12rem 0.45rem', borderRadius: 99, fontWeight: 600, background: statusBg, border: `1px solid ${statusBdr}`, color: statusColor }}>
                          {s.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.68rem' }}>
                        {s.started_at ? new Date(s.started_at).toLocaleDateString() : s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        {trust != null ? (
                          <a
                            href={`/patient/session/${s.id}/report`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--accent-blue)', fontSize: '0.7rem', textDecoration: 'none', fontWeight: 600 }}
                          >
                            <Download size={11} /> Download
                          </a>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>—</span>
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
    </div>
  );
};
