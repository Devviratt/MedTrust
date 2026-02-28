'use client';
import React, { useEffect, useRef } from 'react';
import { Shield, Mic, Activity, Link, AlertTriangle, Eye, Cpu } from 'lucide-react';
import type { ThreadLog } from '../../store/streamStore';

interface Props {
  logs: ThreadLog[];
}

const MODULE_META: Record<string, { icon: React.ReactNode; color: string }> = {
  VIDEO:      { icon: <Eye size={11} />,           color: '#60a5fa' },
  VOICE:      { icon: <Mic size={11} />,           color: '#a78bfa' },
  BIOMETRIC:  { icon: <Activity size={11} />,      color: '#34d399' },
  BLOCKCHAIN: { icon: <Link size={11} />,          color: '#fbbf24' },
  ALERT:      { icon: <AlertTriangle size={11} />, color: '#f87171' },
  BEHAVIORAL: { icon: <Cpu size={11} />,           color: '#fb923c' },
  ENV:        { icon: <Shield size={11} />,        color: '#94a3b8' },
};

const LEVEL_COLORS: Record<string, string> = {
  info:     'rgba(96,165,250,0.12)',
  warn:     'rgba(251,191,36,0.12)',
  critical: 'rgba(239,68,68,0.15)',
};

const LEVEL_BORDER: Record<string, string> = {
  info:     'rgba(96,165,250,0.2)',
  warn:     'rgba(251,191,36,0.25)',
  critical: 'rgba(239,68,68,0.35)',
};

const formatTime = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return '--:--:--'; }
};

export const SecurityThreadLog: React.FC<Props> = ({ logs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0; // newest at top
    }
  }, [logs.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.625rem 0.875rem', borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          <Shield size={12} style={{ color: '#4ade80' }} />
          Security Thread Log
        </div>
        <span style={{
          fontSize: '0.65rem', fontFamily: 'monospace',
          color: '#4ade80', background: 'rgba(74,222,128,0.1)',
          border: '1px solid rgba(74,222,128,0.25)',
          borderRadius: 99, padding: '0.1rem 0.5rem',
        }}>
          {logs.length} events
        </span>
      </div>

      {/* Log feed */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto', padding: '0.5rem 0.625rem',
          display: 'flex', flexDirection: 'column', gap: '0.3rem',
        }}
      >
        {logs.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem', padding: '1.5rem 0' }}>
            Awaiting events...
          </div>
        ) : (
          logs.map((log, idx) => {
            const meta = MODULE_META[log.module?.toUpperCase()] ?? { icon: <Shield size={11} />, color: '#94a3b8' };
            const bg   = LEVEL_COLORS[log.level]  ?? LEVEL_COLORS.info;
            const bdr  = LEVEL_BORDER[log.level]  ?? LEVEL_BORDER.info;
            return (
              <div key={idx} style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                padding: '0.35rem 0.5rem',
                background: bg, border: `1px solid ${bdr}`,
                borderRadius: 5,
                animation: idx === 0 ? 'threadFadeIn 0.3s ease' : undefined,
              }}>
                <span style={{ color: meta.color, flexShrink: 0, marginTop: 1 }}>{meta.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.1rem' }}>
                    <span style={{ fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 700, color: meta.color, letterSpacing: '0.06em' }}>
                      [{log.module}]
                    </span>
                    <span style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>
                      {formatTime(log.timestamp)}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: log.level === 'critical' ? '#fca5a5' : 'var(--text-secondary)', lineHeight: 1.35, wordBreak: 'break-word' }}>
                    {log.message}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
