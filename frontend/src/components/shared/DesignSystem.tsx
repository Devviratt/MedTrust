/**
 * MedTrust AI — Unified Design System
 * Uses CSS variables for full light/dark theme support.
 * No hardcoded hex colors — everything resolves from var(--*).
 */
import React from 'react';

// ── Design tokens — map to CSS variables defined in index.css ─────────────────
export const DS = {
  // Backgrounds
  bg:       'var(--bg-base)',
  bgSurface:'var(--bg-surface)',
  bgGrad:   'var(--page-gradient)',
  card:     'var(--glass-bg)',

  // Borders
  border:   'var(--border-subtle)',
  borderMd: 'var(--border-default)',

  // Status colours
  accent:   'var(--status-safe)',
  accentDim:'var(--status-safe-dim)',
  accentBdr:'var(--status-safe-border)',

  danger:   'var(--status-danger)',
  dangerDim:'var(--status-danger-dim)',
  dangerBdr:'var(--status-danger-border)',

  warn:     'var(--status-warn)',
  warnDim:  'var(--status-warn-dim)',
  warnBdr:  'var(--status-warn-border)',

  info:     'var(--accent-blue)',
  infoDim:  'var(--accent-blue-dim)',
  infoBdr:  'var(--accent-blue-border)',

  // Text
  text:     'var(--text-primary)',
  textSub:  'var(--text-secondary)',
  textMute: 'var(--text-muted)',

  // Shadows
  shadow:   'var(--shadow-lg)',

  // Misc
  radius:   16,
  mono:     "'JetBrains Mono', 'Fira Mono', monospace",
} as const;

// ── GlassCard ─────────────────────────────────────────────────────────────────
interface GlassCardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  hover?: boolean;
  alertBorder?: boolean;
  warnBorder?: boolean;
  accentBorder?: boolean;
  className?: string;
  onClick?: () => void;
}
export const GlassCard: React.FC<GlassCardProps> = ({
  children, style, hover = false, alertBorder, warnBorder, accentBorder,
  className, onClick,
}) => {
  const [hovered, setHovered] = React.useState(false);

  const borderColor = alertBorder  ? DS.dangerBdr
    : warnBorder  ? DS.warnBdr
    : accentBorder ? DS.accentBdr
    : hovered && hover ? DS.borderMd
    : DS.border;

  return (
    <div
      className={className}
      onClick={onClick}
      onMouseEnter={() => hover && setHovered(true)}
      onMouseLeave={() => hover && setHovered(false)}
      style={{
        background: DS.card,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${borderColor}`,
        borderRadius: DS.radius,
        boxShadow: hovered && hover
          ? '0 12px 32px rgba(0,0,0,0.5)'
          : DS.shadow,
        transition: 'all 0.25s ease',
        transform: hovered && hover ? 'translateY(-2px)' : 'translateY(0)',
        ...style,
      }}
    >
      {children}
    </div>
  );
};

// ── SectionHeader ─────────────────────────────────────────────────────────────
interface SectionHeaderProps {
  icon?: React.ReactNode;
  label: string;
  right?: React.ReactNode;
  accent?: string;
}
export const SectionHeader: React.FC<SectionHeaderProps> = ({ icon, label, right, accent }) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: '0.875rem',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      {icon && (
        <span style={{ color: accent || DS.accent, display: 'flex', alignItems: 'center' }}>
          {icon}
        </span>
      )}
      <span style={{
        fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: DS.textMute,
      }}>
        {label}
      </span>
    </div>
    {right && <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>{right}</div>}
  </div>
);

// ── StatusBadge ───────────────────────────────────────────────────────────────
type BadgeVariant = 'safe' | 'alert' | 'warn' | 'info' | 'muted' | 'admin' | 'doctor' | 'patient';
interface StatusBadgeProps {
  variant: BadgeVariant;
  label: string;
  dot?: boolean;
  pulse?: boolean;
}
const BADGE_MAP: Record<BadgeVariant, { color: string; bg: string; border: string }> = {
  safe:    { color: DS.accent,  bg: DS.accentDim, border: DS.accentBdr },
  alert:   { color: DS.danger,  bg: DS.dangerDim, border: DS.dangerBdr },
  warn:    { color: DS.warn,    bg: DS.warnDim,   border: DS.warnBdr   },
  info:    { color: DS.info,    bg: DS.infoDim,   border: DS.infoBdr   },
  muted:   { color: DS.textMute,bg: 'rgba(74,88,117,0.15)', border: 'rgba(74,88,117,0.25)' },
  admin:   { color: DS.warn,    bg: DS.warnDim,   border: DS.warnBdr   },
  doctor:  { color: DS.info,    bg: DS.infoDim,   border: DS.infoBdr   },
  patient: { color: DS.accent,  bg: DS.accentDim, border: DS.accentBdr },
};
export const StatusBadge: React.FC<StatusBadgeProps> = ({ variant, label, dot, pulse }) => {
  const m = BADGE_MAP[variant] || BADGE_MAP.muted;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
      fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.09em',
      textTransform: 'uppercase', padding: '0.18rem 0.55rem', borderRadius: 99,
      background: m.bg, color: m.color, border: `1px solid ${m.border}`,
      whiteSpace: 'nowrap',
    }}>
      {dot && (
        <span style={{
          width: 5, height: 5, borderRadius: '50%', background: m.color, flexShrink: 0,
          boxShadow: pulse ? `0 0 0 0 ${m.color}` : undefined,
          animation: pulse ? 'badgePulse 2s ease-in-out infinite' : undefined,
        }} />
      )}
      {label}
    </span>
  );
};

// ── ConfidenceBar ─────────────────────────────────────────────────────────────
interface ConfidenceBarProps {
  label: string;
  value: number;       // 0–100
  color?: string;
  showValue?: boolean;
  height?: number;
}
export const ConfidenceBar: React.FC<ConfidenceBarProps> = ({
  label, value, color, showValue = true, height = 3,
}) => {
  const c = color || (value >= 75 ? DS.accent : value >= 50 ? DS.warn : DS.danger);
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '0.25rem',
      }}>
        <span style={{ fontSize: '0.72rem', color: DS.textSub }}>{label}</span>
        {showValue && (
          <span style={{ fontSize: '0.68rem', fontFamily: DS.mono, color: c, fontWeight: 700 }}>
            {Math.round(value)}%
          </span>
        )}
      </div>
      <div style={{
        height, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.max(value, 0)}%`, height: '100%',
          background: `linear-gradient(90deg, ${c}aa, ${c})`,
          borderRadius: 99,
          transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: `0 0 6px ${c}55`,
        }} />
      </div>
    </div>
  );
};

// ── MetricTile ────────────────────────────────────────────────────────────────
interface MetricTileProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: string;
}
export const MetricTile: React.FC<MetricTileProps> = ({ label, value, sub, icon, accent = DS.accent }) => (
  <GlassCard style={{ padding: '1rem 1.125rem', display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
    <div style={{
      width: 40, height: 40, borderRadius: 10, flexShrink: 0,
      background: `${accent}18`,
      border: `1px solid ${accent}30`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: accent,
    }}>
      {icon}
    </div>
    <div>
      <div style={{
        fontSize: '1.45rem', fontWeight: 800, lineHeight: 1.1,
        color: DS.text, fontFamily: DS.mono, letterSpacing: '-0.02em',
      }}>
        {value}
      </div>
      <div style={{ fontSize: '0.7rem', color: DS.textMute, marginTop: '0.1rem' }}>{label}</div>
      {sub && <div style={{ fontSize: '0.62rem', color: accent, marginTop: '0.1rem' }}>{sub}</div>}
    </div>
  </GlassCard>
);

// ── GlassButton ───────────────────────────────────────────────────────────────
interface GlassButtonProps {
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'danger' | 'ghost' | 'warn';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: React.CSSProperties;
  type?: 'button' | 'submit';
}
const BTN_VARIANTS = {
  primary: { bg: DS.accentDim, border: DS.accentBdr, color: DS.accent,  hoverBg: 'rgba(22,199,132,0.18)' },
  danger:  { bg: DS.dangerDim, border: DS.dangerBdr, color: DS.danger,  hoverBg: 'rgba(255,77,79,0.18)'  },
  warn:    { bg: DS.warnDim,   border: DS.warnBdr,   color: DS.warn,    hoverBg: 'rgba(245,158,11,0.18)' },
  ghost:   { bg: 'rgba(255,255,255,0.04)', border: DS.border, color: DS.textSub, hoverBg: 'rgba(255,255,255,0.07)' },
};
const BTN_SIZES = {
  sm: { padding: '0.3rem 0.75rem', fontSize: '0.72rem' },
  md: { padding: '0.45rem 1rem',   fontSize: '0.78rem' },
  lg: { padding: '0.6rem 1.375rem',fontSize: '0.85rem' },
};
export const GlassButton: React.FC<GlassButtonProps> = ({
  children, onClick, variant = 'ghost', size = 'md', disabled, icon, style, type = 'button',
}) => {
  const [hovered, setHovered] = React.useState(false);
  const v = BTN_VARIANTS[variant];
  const s = BTN_SIZES[size];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
        background: hovered ? v.hoverBg : v.bg,
        border: `1px solid ${v.border}`,
        color: v.color, borderRadius: 8, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'all 0.25s ease',
        transform: hovered && !disabled ? 'translateY(-1px)' : 'translateY(0)',
        boxShadow: hovered && !disabled ? `0 4px 12px ${v.border}` : 'none',
        ...s, ...style,
      }}
    >
      {icon}
      {children}
    </button>
  );
};

// ── Pulse keyframes (injected once) ───────────────────────────────────────────
const KEYFRAMES = `
@keyframes badgePulse {
  0%,100% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
  50%      { box-shadow: 0 0 0 4px transparent; opacity: 0.7; }
}
@keyframes softPulse {
  0%,100% { opacity: 1; }
  50%      { opacity: 0.55; }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@keyframes pulse {
  0%,100% { opacity: 1; box-shadow: 0 0 0 0 currentColor; }
  50%      { opacity: 0.6; box-shadow: 0 0 6px 3px transparent; }
}`;
if (typeof document !== 'undefined' && !document.getElementById('mt-ds-keyframes')) {
  const s = document.createElement('style');
  s.id = 'mt-ds-keyframes';
  s.textContent = KEYFRAMES;
  document.head.appendChild(s);
}
