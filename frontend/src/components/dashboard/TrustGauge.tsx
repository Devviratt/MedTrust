import React, { useEffect, useRef, useState } from 'react';
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';

interface TrustGaugeProps {
  score: number;
  status: 'safe' | 'suspicious' | 'alert';
  size?: 'sm' | 'md' | 'lg';
}

const STATUS_CONFIG = {
  safe:       { color: 'var(--status-safe)',   icon: ShieldCheck, label: 'Secure',     track: 'rgba(16,185,129,0.12)' },
  suspicious: { color: 'var(--status-warn)',   icon: Shield,      label: 'Suspicious', track: 'rgba(245,158,11,0.12)' },
  alert:      { color: 'var(--status-danger)', icon: ShieldAlert, label: 'Alert',      track: 'rgba(239,68,68,0.12)'  },
};

const SIZE_CONFIG = {
  sm: { radius: 44, stroke: 5,  size: 108, fontSize: 22, labelSize: 10 },
  md: { radius: 58, stroke: 6,  size: 144, fontSize: 30, labelSize: 11 },
  lg: { radius: 78, stroke: 7,  size: 192, fontSize: 40, labelSize: 12 },
};

export const TrustGauge: React.FC<TrustGaugeProps> = ({ score, status, size = 'md' }) => {
  const cfg = STATUS_CONFIG[status];
  const sz = SIZE_CONFIG[size];
  const Icon = cfg.icon;
  const circumference = 2 * Math.PI * sz.radius;
  const offset = circumference - (score / 100) * circumference;
  const center = sz.size / 2;

  const [display, setDisplay] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const start = display;
    const end = score;
    const duration = 900;
    const startTime = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [score]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: sz.size, height: sz.size }}>
        <svg width={sz.size} height={sz.size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
          {/* Track */}
          <circle
            cx={center} cy={center} r={sz.radius}
            fill="none"
            stroke={cfg.track}
            strokeWidth={sz.stroke}
          />
          {/* Arc */}
          <circle
            className="trust-gauge-arc"
            cx={center} cy={center} r={sz.radius}
            fill="none"
            stroke={cfg.color}
            strokeWidth={sz.stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>

        {/* Center content */}
        <div className="trust-gauge-center" style={{
          position: 'absolute',
          inset: sz.stroke + 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          border: '1px solid var(--border-subtle)',
        }}>
          <Icon size={sz.fontSize * 0.42} style={{ color: cfg.color, marginBottom: 3 }} strokeWidth={1.5} />
          <span style={{
            fontSize: sz.fontSize,
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            color: cfg.color,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {display}
          </span>
          <span style={{
            fontSize: sz.labelSize,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginTop: 3,
          }}>
            {cfg.label}
          </span>
        </div>
      </div>
    </div>
  );
};

interface ScoreBarProps {
  label: string;
  score: number;
  status: 'safe' | 'suspicious' | 'alert';
}

export const ScoreBar: React.FC<ScoreBarProps> = ({ label, score, status }) => {
  const fillClass = status === 'safe' ? 'ds-score-fill-safe' : status === 'suspicious' ? 'ds-score-fill-warn' : 'ds-score-fill-danger';
  const textColor = status === 'safe' ? 'var(--status-safe)' : status === 'suspicious' ? 'var(--status-warn)' : 'var(--status-danger)';
  return (
    <div className="score-row" style={{ flex: 1, minWidth: 0 }}>
      <div className="score-row-header">
        <span className="score-row-label">{label}</span>
        <span className="score-row-value" style={{ color: textColor }}>{score}</span>
      </div>
      <div className="ds-score-track">
        <div className={`ds-score-fill ${fillClass}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
};
