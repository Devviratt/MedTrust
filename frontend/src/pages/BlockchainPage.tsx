import React, { useEffect, useState, useCallback } from 'react';
import { Hash, RefreshCw, CheckCircle, AlertTriangle, Clock, Database, ChevronLeft, ChevronRight, AlertCircle, Info } from 'lucide-react';
import { blockchainApi } from '../services/api';

// Matches actual audit_events table columns returned by getAllAuditEvents
interface AuditEvent {
  id: string;
  stream_id: string | null;
  event_type: string;
  severity: 'info' | 'warning' | 'critical' | string;
  details: Record<string, any> | string | null;
  created_at: string;
  doctor_name?: string | null;
  doctor_email?: string | null;
}

const SEVERITY_BADGE: Record<string, string> = {
  info:     'ds-badge ds-badge-info',
  warning:  'ds-badge ds-badge-warn',
  critical: 'ds-badge ds-badge-danger',
};

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  info:     <Info     size={13} style={{ color: 'var(--status-info)' }} />,
  warning:  <AlertTriangle size={13} style={{ color: 'var(--status-warn)' }} />,
  critical: <AlertCircle  size={13} style={{ color: 'var(--status-danger)' }} />,
};

const PAGE_SIZE = 20;

// Safe timestamp formatter — returns '—' for invalid/null dates
const fmtTs = (ts: string | null | undefined): string => {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString();
  } catch {
    return '—';
  }
};

// Safe details renderer
const fmtDetails = (details: Record<string, any> | string | null): string => {
  if (!details) return '—';
  if (typeof details === 'string') return details.slice(0, 60);
  try { return JSON.stringify(details).slice(0, 60); } catch { return '—'; }
};

export const BlockchainPage: React.FC = () => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchEvents = useCallback(async (p: number = 1) => {
    setLoading(true);
    setError('');
    try {
      const res = await blockchainApi.getAllAuditEvents({ page: p, limit: PAGE_SIZE });
      const data = res.data;
      // Response shape: { events: AuditEvent[], pagination: { total, page, limit } }
      const rows: AuditEvent[] = Array.isArray(data?.events) ? data.events
        : Array.isArray(data?.logs) ? data.logs
        : Array.isArray(data) ? data
        : [];
      const totalCount: number = data?.pagination?.total ?? data?.total ?? data?.count ?? rows.length;
      setEvents(rows);
      setTotal(totalCount);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 403) {
        setError('Access denied — Admin role required to view all audit events.');
      } else if (status === 404) {
        setEvents([]);
        setTotal(0);
      } else if (status !== 401) {
        // 401 already handled by global interceptor
        setError('Failed to load audit log.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEvents(page); }, [page, fetchEvents]);

  const totalPages = Math.max(1, Math.ceil((total || events.length) / PAGE_SIZE));

  return (
    <div className="page-container">
      {/* Page header */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-header-icon">
            <Hash size={16} strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="page-header-title">Blockchain Audit Log</h2>
            <p className="page-header-sub">Immutable tamper-proof event record</p>
          </div>
        </div>
        <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={() => fetchEvents(page)} disabled={loading}>
          <RefreshCw size={13} strokeWidth={1.75} style={{ animation: loading ? 'spin 0.8s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="ds-alert ds-alert-danger" style={{ alignItems: 'center' }}>
          <AlertCircle size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{error}</span>
          <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={() => fetchEvents(page)}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {/* Table card */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <Database size={14} strokeWidth={1.75} className="panel-title-icon" />
            Audit Events
          </div>
          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {events.length} records
          </span>
        </div>

        {/* Loading */}
        {loading && (
          <div className="empty-state" style={{ padding: '3rem' }}>
            <RefreshCw size={24} className="empty-state-icon" style={{ animation: 'spin 0.8s linear infinite' }} />
            <p>Loading audit log…</p>
          </div>
        )}

        {/* Empty */}
        {!loading && events.length === 0 && !error && (
          <div className="empty-state" style={{ padding: '3rem' }}>
            <Hash size={28} className="empty-state-icon" strokeWidth={1.5} />
            <p>No blockchain events recorded yet.</p>
            <p style={{ fontSize: '0.75rem', marginTop: 4 }}>Events are created when a stream processes chunks.</p>
          </div>
        )}

        {/* Table */}
        {!loading && events.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Event Type</th>
                  <th>Doctor</th>
                  <th>Stream</th>
                  <th>Details</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev, i) => (
                  <tr key={ev.id || i}>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {SEVERITY_ICON[ev.severity] ?? <Clock size={13} style={{ color: 'var(--text-muted)' }} />}
                        <span className={SEVERITY_BADGE[ev.severity] || 'ds-badge ds-badge-neutral'}>
                          {ev.severity || '—'}
                        </span>
                      </span>
                    </td>
                    <td>
                      <code className="audit-mono">{ev.event_type || '—'}</code>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {ev.doctor_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </span>
                    </td>
                    <td>
                      {ev.stream_id
                        ? <code className="audit-mono">{ev.stream_id.slice(0, 12)}…</code>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>
                      }
                    </td>
                    <td>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: 200, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fmtDetails(ev.details)}
                      </span>
                    </td>
                    <td>
                      <span className="audit-ts">{fmtTs(ev.created_at)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading && (total > PAGE_SIZE || page > 1) && (
        <div className="pagination">
          <button
            className="ds-btn ds-btn-ghost ds-btn-sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft size={14} /> Previous
          </button>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            Page {page} of {totalPages}
            {total > 0 && <> &nbsp;·&nbsp; {total} total</>}
          </span>
          <button
            className="ds-btn ds-btn-ghost ds-btn-sm"
            onClick={() => setPage(p => p + 1)}
            disabled={page >= totalPages}
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
};
