import React from 'react';
import { Activity, Eye, Mic, Heart, Link2 } from 'lucide-react';
import { TrustGauge, ScoreBar } from './TrustGauge';
import type { TrustScore } from '../../services/api';

interface TrustScorePanelProps {
  trustScore: TrustScore | null;
  isLive: boolean;
}

const getStatus = (score: number): 'safe' | 'suspicious' | 'alert' => {
  if (score >= 75) return 'safe';
  if (score >= 50) return 'suspicious';
  return 'alert';
};

export const TrustScorePanel: React.FC<TrustScorePanelProps> = ({ trustScore, isLive }) => {
  const score = trustScore?.trust_score ?? 0;
  const status = trustScore?.status ?? 'safe';

  const componentScores = [
    { icon: Eye,   color: 'text-blue-400',   label: 'Video Authenticity',  weight: '40%', score: trustScore?.video_score ?? 0 },
    { icon: Mic,   color: 'text-purple-400', label: 'Voice Authenticity',  weight: '30%', score: trustScore?.voice_score ?? 0 },
    { icon: Heart, color: 'text-rose-400',   label: 'Biometric Sync',      weight: '20%', score: trustScore?.biometric_score ?? 0 },
    { icon: Link2, color: 'text-cyan-400',   label: 'Blockchain Integrity',weight: '10%', score: trustScore?.blockchain_score ?? 0 },
  ];

  return (
    <div className="panel">
      {/* Header */}
      <div className="panel-header">
        <div className="panel-title">
          <Activity size={14} className="panel-title-icon" strokeWidth={1.75} />
          Trust Score Engine
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span className={`status-dot ${isLive ? 'status-dot-live' : 'status-dot-off'}`} />
          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {isLive ? 'Live' : 'Standby'}
          </span>
        </div>
      </div>

      {/* Gauge */}
      <div className="trust-panel-gauge">
        <TrustGauge score={score} status={status} size="lg" />
      </div>

      {/* Component Scores */}
      <div className="trust-panel-scores">
        <span className="ds-section-title" style={{ marginBottom: '0.25rem' }}>Component Scores</span>
        {componentScores.map((item) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <item.icon size={13} strokeWidth={1.75} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <ScoreBar
              label={`${item.label} (${item.weight})`}
              score={item.score}
              status={getStatus(item.score)}
            />
          </div>
        ))}
      </div>

      {/* Sub-scores */}
      {trustScore?.detail && (
        <div style={{ padding: '0.75rem 1.125rem', borderTop: '1px solid var(--border-subtle)', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.5rem' }}>
          {[
            { key: 'spatial_score',  label: 'Spatial',  val: trustScore.detail.spatial_score },
            { key: 'temporal_score', label: 'Temporal', val: trustScore.detail.temporal_score },
            { key: 'gan_score',      label: 'GAN',      val: trustScore.detail.gan_score },
          ].filter((d) => d.val !== undefined).map((d) => (
            <div key={d.key} style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '0.5rem', textAlign: 'center' }}>
              <div className="ds-label" style={{ marginBottom: '0.125rem' }}>{d.label}</div>
              <div style={{ fontSize: '0.875rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)' }}>{((d.val ?? 0) * 100).toFixed(0)}</div>
            </div>
          ))}
        </div>
      )}

      {trustScore?.timestamp && (
        <div style={{ padding: '0.5rem 1.125rem', borderTop: '1px solid var(--border-subtle)', textAlign: 'center' }}>
          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            Updated {new Date(trustScore.timestamp).toLocaleTimeString()}
          </span>
        </div>
      )}
    </div>
  );
};
