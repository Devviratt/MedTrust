import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X, ShieldAlert, Info } from 'lucide-react';
import { useStreamStore } from '../../store/streamStore';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';

export const AlertBanner: React.FC = () => {
  const { alerts, clearAlerts } = useStreamStore();
  const criticalAlerts = alerts.filter((a) => a.severity === 'critical');
  const prevCountRef = useRef(0);

  useEffect(() => {
    const newCount = criticalAlerts.length;
    if (newCount > prevCountRef.current) {
      const latest = criticalAlerts[0];
      toast.error(latest?.message || 'Deepfake alert detected', {
        duration: 5000,
        id: `alert-${latest?.id || Date.now()}`,
      });
    }
    prevCountRef.current = newCount;
  }, [criticalAlerts.length]);

  useEffect(() => {
    if (criticalAlerts.length === 0) return;
    const timer = setTimeout(() => clearAlerts(), 5000);
    return () => clearTimeout(timer);
  }, [criticalAlerts.length, clearAlerts]);

  if (criticalAlerts.length === 0) return null;

  const latest = criticalAlerts[0];

  return (
    <div className="ds-alert ds-alert-danger" style={{ borderRadius: 'var(--radius-lg)' }}>
      <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>Deepfake Alert Detected</span>
          {criticalAlerts.length > 1 && (
            <span className="ds-badge ds-badge-danger">
              +{criticalAlerts.length - 1} more
            </span>
          )}
          <span style={{ fontSize: '0.6875rem', color: 'inherit', opacity: 0.6, fontFamily: 'monospace', marginLeft: 'auto' }}>
            {formatDistanceToNow(new Date(latest.timestamp), { addSuffix: true })}
          </span>
        </div>
        <p style={{ fontSize: '0.8125rem', opacity: 0.8, marginTop: '0.125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {latest.message}
        </p>
      </div>
      <button
        onClick={clearAlerts}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, padding: '0.125rem', borderRadius: '4px', flexShrink: 0 }}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
};

interface AlertFeedProps {
  maxVisible?: number;
}

export const AlertFeed: React.FC<AlertFeedProps> = ({ maxVisible = 20 }) => {
  const { alerts } = useStreamStore();

  const getItemClass = (s: string) =>
    s === 'critical' ? 'alert-item alert-item-danger'
    : s === 'warning' ? 'alert-item alert-item-warn'
    : 'alert-item alert-item-info';

  const getIcon = (s: string) => {
    if (s === 'critical') return <ShieldAlert size={13} style={{ color: 'var(--status-danger)', flexShrink: 0, marginTop: 1 }} />;
    if (s === 'warning')  return <AlertTriangle size={13} style={{ color: 'var(--status-warn)', flexShrink: 0, marginTop: 1 }} />;
    return <Info size={13} style={{ color: 'var(--accent-blue)', flexShrink: 0, marginTop: 1 }} />;
  };

  if (alerts.length === 0) {
    return (
      <div className="empty-state">
        <ShieldAlert size={28} className="empty-state-icon" />
        <p>No alerts — system secure</p>
      </div>
    );
  }

  return (
    <div className="alert-feed">
      {alerts.slice(0, maxVisible).map((alert) => (
        <div key={alert.id} className={getItemClass(alert.severity)}>
          {getIcon(alert.severity)}
          <div className="alert-item-body">
            <div className="alert-item-type">{alert.type}</div>
            <div className="alert-item-msg">{alert.message}</div>
          </div>
          <div className="alert-item-time">
            {formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}
          </div>
        </div>
      ))}
    </div>
  );
};
