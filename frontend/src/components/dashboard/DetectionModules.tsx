'use client';
import React from 'react';
import { Shield, Mic, Activity, Brain, Link, Eye } from 'lucide-react';
import type { TrustScore } from '../../services/api';

interface Module {
  key: string;
  label: string;
  icon: React.ReactNode;
  score: number;
  description: string;
}

const scoreToState = (score: number): 'safe' | 'suspicious' | 'alert' => {
  if (score >= 75) return 'safe';
  if (score >= 50) return 'suspicious';
  return 'alert';
};

const STATE_COLORS = {
  safe:       { bar: '#22c55e', text: '#4ade80', bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.2)'  },
  suspicious: { bar: '#f59e0b', text: '#fbbf24', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)' },
  alert:      { bar: '#ef4444', text: '#f87171', bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.2)'  },
};

interface Props {
  trustScore: TrustScore | null;
}

export const DetectionModules: React.FC<Props> = ({ trustScore }) => {
  const s = trustScore;

  const modules: Module[] = [
    {
      key: 'video',
      label: 'Video Integrity',
      icon: <Eye size={14} />,
      score: s?.video_score ?? 0,
      description: 'Brightness · Edge variance · Sobel detection',
    },
    {
      key: 'voice',
      label: 'Voice Authenticity',
      icon: <Mic size={14} />,
      score: s?.voice_score ?? 0,
      description: 'Spectral flatness · FFT band analysis',
    },
    {
      key: 'biometric',
      label: 'Biometric Sync',
      icon: <Activity size={14} />,
      score: s?.biometric_score ?? 0,
      description: 'Pulse variance · Zero-crossing rate',
    },
    {
      key: 'behavioral',
      label: 'Behavioral Dynamics',
      icon: <Brain size={14} />,
      score: (s as any)?.behavioral_score ?? 0,
      description: 'Motion delta · Frame consistency',
    },
    {
      key: 'blockchain',
      label: 'Blockchain Integrity',
      icon: <Link size={14} />,
      score: s?.blockchain_score ?? 0,
      description: 'SHA-256 chain · Hash verification',
    },
    {
      key: 'env',
      label: 'Environmental Context',
      icon: <Shield size={14} />,
      score: (s as any)?.env_score ?? 0,
      description: 'Lighting stability · ICU environment',
    },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem' }}>
      {modules.map((mod) => {
        const state = scoreToState(mod.score);
        const col   = STATE_COLORS[state];
        const anomaly = Math.max(0, 100 - mod.score);
        return (
          <div key={mod.key} style={{
            background: col.bg,
            border: `1px solid ${col.border}`,
            borderRadius: 8,
            padding: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: col.text, fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.04em' }}>
                {mod.icon}
                {mod.label}
              </div>
              <span style={{
                fontSize: '0.65rem', fontFamily: 'monospace',
                padding: '0.1rem 0.4rem', borderRadius: 99,
                background: col.bg, border: `1px solid ${col.border}`,
                color: col.text, textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                {state}
              </span>
            </div>

            {/* Score bar */}
            <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${mod.score}%`,
                background: col.bar, borderRadius: 99,
                transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
              }} />
            </div>

            {/* Metrics row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
              <span style={{ color: col.text }}>{mod.score > 0 ? `${mod.score}% conf` : '-- conf'}</span>
              <span style={{ color: anomaly > 50 ? '#f87171' : 'var(--text-muted)' }}>{mod.score > 0 ? `${anomaly}% anomaly` : '--'}</span>
            </div>

            {/* Description */}
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              {mod.description}
            </div>
          </div>
        );
      })}
    </div>
  );
};
