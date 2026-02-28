'use client';
import React from 'react';
import { Link, CheckCircle, AlertTriangle, Hash } from 'lucide-react';

interface BlockchainLog {
  block_number: string | number;
  chunk_hash: string;
  chunk_type?: string;
  tx_id?: string;
  created_at?: string;
}

interface Props {
  logs: BlockchainLog[];
  chainIntact?: boolean;
  loading?: boolean;
}

const formatTime = (iso?: string) => {
  if (!iso) return '--';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return '--'; }
};

export const BlockchainPanel: React.FC<Props> = ({ logs, chainIntact = true, loading }) => {
  const latestBlock = logs[0];
  const totalBlocks = logs.length > 0 ? Number(logs[0]?.block_number) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
        <div style={{
          background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.18)',
          borderRadius: 7, padding: '0.625rem 0.75rem',
        }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Latest Block</div>
          <div style={{ fontSize: '1rem', fontFamily: 'monospace', fontWeight: 700, color: '#fbbf24' }}>
            #{latestBlock ? latestBlock.block_number : '—'}
          </div>
        </div>
        <div style={{
          background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.18)',
          borderRadius: 7, padding: '0.625rem 0.75rem',
        }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Total Blocks</div>
          <div style={{ fontSize: '1rem', fontFamily: 'monospace', fontWeight: 700, color: '#60a5fa' }}>
            {totalBlocks || '—'}
          </div>
        </div>
        <div style={{
          background: chainIntact ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)',
          border: `1px solid ${chainIntact ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
          borderRadius: 7, padding: '0.625rem 0.75rem',
          display: 'flex', flexDirection: 'column', gap: '0.2rem',
        }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Validation</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 700, color: chainIntact ? '#4ade80' : '#f87171' }}>
            {chainIntact
              ? <><CheckCircle size={13} /> VALID</>
              : <><AlertTriangle size={13} /> MISMATCH</>
            }
          </div>
        </div>
      </div>

      {/* Latest hash preview */}
      {latestBlock && (
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)',
          borderRadius: 7, padding: '0.625rem 0.75rem',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}>
          <Hash size={12} style={{ color: '#fbbf24', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>Latest hash</div>
            <div style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: '#fbbf24', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {latestBlock.chunk_hash}
            </div>
          </div>
        </div>
      )}

      {/* Block log */}
      <div style={{
        background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)',
        borderRadius: 7, overflow: 'hidden',
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '3rem 1fr 5rem',
          padding: '0.35rem 0.75rem', borderBottom: '1px solid var(--border-subtle)',
          fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>
          <span>Block</span><span>Hash</span><span style={{ textAlign: 'right' }}>Time</span>
        </div>
        {loading ? (
          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>Loading...</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>No blocks yet</div>
        ) : (
          logs.slice(0, 8).map((log, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '3rem 1fr 5rem',
              padding: '0.35rem 0.75rem',
              borderBottom: i < Math.min(logs.length, 8) - 1 ? '1px solid var(--border-subtle)' : undefined,
              fontSize: '0.7rem', fontFamily: 'monospace',
              background: i === 0 ? 'rgba(251,191,36,0.04)' : undefined,
            }}>
              <span style={{ color: '#fbbf24' }}>#{log.block_number}</span>
              <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '0.5rem' }}>
                {String(log.chunk_hash).slice(0, 24)}…
              </span>
              <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>{formatTime(log.created_at)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
