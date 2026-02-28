import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, Brain, Link2, ArrowRight, ChevronRight,
  Activity, Lock, CheckCircle,
  AlertTriangle, BarChart3, Users, FlaskConical,
  GitBranch, Settings, Fingerprint, Eye, Sun, Moon,
  ChevronDown, Stethoscope,
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

// ── Nav section definitions ───────────────────────────────────────────────────
const NAV_SECTIONS = [
  { id: 'features',        label: 'Features' },
  { id: 'how-it-works',   label: 'How It Works' },
  { id: 'doctor-registry', label: 'Doctor Registry' },
  { id: 'detection-lab',  label: 'Detection Lab' },
  { id: 'blockchain',     label: 'Blockchain' },
  { id: 'admin',          label: 'Admin Control' },
];

// redirect destinations per section (for post-login routing)
const SECTION_REDIRECT: Record<string, string> = {
  'doctor-registry': '/doctors',
  'detection-lab':   '/detection-lab',
  'blockchain':      '/blockchain',
  'admin':           '/admin',
};

const FEATURES = [
  { icon: Brain,       title: 'AI Deepfake Detection',  description: 'Multi-modal analysis across video, voice, and biometric signals. Detects synthetic media in real-time with sub-100ms latency.', accent: '#2563EB', accentBg: 'rgba(37,99,235,0.08)' },
  { icon: BarChart3,   title: 'Trust Score Engine',     description: 'Zero-trust composite scoring across four signal layers. Continuous patient identity verification every frame of the stream.', accent: '#0891B2', accentBg: 'rgba(8,145,178,0.08)' },
  { icon: Link2,       title: 'Blockchain Audit Layer', description: 'Every trust event is cryptographically signed and recorded immutably. HIPAA-compliant audit trail with one-click export.', accent: '#7C3AED', accentBg: 'rgba(124,58,237,0.08)' },
  { icon: Fingerprint, title: 'Biometric Enrollment',   description: 'Doctors are registered with face and voice baselines. Every session verifies the live biometric against the stored profile.', accent: '#059669', accentBg: 'rgba(5,150,105,0.08)' },
  { icon: Shield,      title: 'Zero-Trust RBAC',        description: 'Role-based access control for admin, doctor, and patient roles. Every API call is authenticated and permission-checked.', accent: '#D97706', accentBg: 'rgba(217,119,6,0.08)' },
  { icon: Activity,    title: 'Real-Time Alerts',       description: 'Instant SMS and dashboard alerts when trust score drops or impersonation risk is detected. Configurable thresholds per deployment.', accent: '#DC2626', accentBg: 'rgba(220,38,38,0.08)' },
];

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: Fingerprint,
    title: 'Register & Enroll Biometrics',
    desc: 'Doctors register with credentials and complete face + voice biometric enrollment. Patients create an account and select a verified doctor for their consultation.',
    accent: '#2563EB',
    accentBg: 'rgba(37,99,235,0.10)',
  },
  {
    step: '02',
    icon: Brain,
    title: 'AI Verifies Both Parties',
    desc: 'Before every session, the doctor completes a real-time identity re-verification. Multi-modal AI compares live face, voice, and biometric signals against the enrolled baseline.',
    accent: '#7C3AED',
    accentBg: 'rgba(124,58,237,0.10)',
  },
  {
    step: '03',
    icon: Shield,
    title: 'Secure Session Starts',
    desc: 'Once identity is confirmed, the session activates automatically. Trust scores are computed every frame and logged immutably to the blockchain audit trail.',
    accent: '#059669',
    accentBg: 'rgba(5,150,105,0.10)',
  },
];

const STATS = [
  { value: '<100ms', label: 'Detection latency' },
  { value: '99.7%',  label: 'Detection accuracy' },
  { value: 'HIPAA',  label: 'Compliant audit trail' },
  { value: '24/7',   label: 'Continuous monitoring' },
];

// ── Doctor Registry section data ──────────────────────────────────────────────
const REGISTRY_FEATURES = [
  { icon: Users,       title: 'Unified Doctor Profiles', desc: 'Each doctor account includes specialization, license number, hospital affiliation, and years of experience — all admin-managed.' },
  { icon: Fingerprint, title: 'Biometric Enrollment',    desc: 'Admins capture a face snapshot and optional voice sample during registration. Stored as a cryptographic hash — no raw biometrics ever saved.' },
  { icon: CheckCircle, title: 'Live Identity Verify',    desc: 'At any time, submit a new frame to compare against the enrolled baseline. Hamming similarity returns face + voice similarity scores and impersonation risk.' },
  { icon: Shield,      title: 'Verified Status Badges',  desc: 'Doctors show Pending / Verified / Suspended status. Only biometric-enrolled doctors reach Verified status on the platform.' },
];

// ── Detection Lab section data ─────────────────────────────────────────────────
const LAB_FEATURES = [
  { icon: Eye,         title: 'Live Stream Monitor',  desc: 'Enter any active stream ID and poll the trust score every 3 seconds. View real-time breakdowns of video, voice, biometric and blockchain modules.' },
  { icon: FlaskConical,title: 'Frame Upload Analysis', desc: 'Upload a still JPEG from any video source. The AI pipeline returns a full trust analysis with anomaly score and per-module confidence values.' },
  { icon: BarChart3,   title: 'Score History',        desc: 'Rolling 20-entry history with inline micro bar chart. Track score drift over time during a session or test run.' },
  { icon: AlertTriangle,title: 'Anomaly Detection',   desc: 'Separate anomaly score surface alongside the trust score. Flags motion anomalies, env inconsistencies, and biometric drift.' },
];

// ── Blockchain section data ────────────────────────────────────────────────────
const CHAIN_FEATURES = [
  { icon: GitBranch,   title: 'Immutable Event Log',   desc: 'Every trust score, alert, and session boundary is hashed and chained. SHA-256 linked records cannot be altered retroactively.' },
  { icon: Lock,        title: 'Chain Integrity Check',  desc: 'One-click validation of any stream\'s audit chain. Returns block-by-block hash verification with tamper detection.' },
  { icon: GitBranch,   title: 'Full Audit Export',      desc: 'Admin-accessible audit export for all events across all streams. Filter by date range, severity, and event type.' },
  { icon: CheckCircle, title: 'HIPAA-Grade Trail',      desc: 'Every login, registration, threshold change, and impersonation event is recorded with actor ID, timestamp and severity level.' },
];

// ── Admin section data ─────────────────────────────────────────────────────────
const ADMIN_FEATURES = [
  { icon: BarChart3, title: 'Control Center Overview', desc: 'Live stats for active sessions, trust score distribution, alert count, and platform service health across all modules.' },
  { icon: Users,     title: 'User Management',        desc: 'Register, list, and manage admin, doctor, and patient accounts. Filter by role. Biometric status visible per doctor row.' },
  { icon: Settings,  title: 'AI Threshold Editor',    desc: 'Adjust all trust engine weights and score thresholds directly from the dashboard. Changes persist to DB and invalidate Redis cache instantly.' },
  { icon: Activity,  title: 'Session Monitor',        desc: 'View all active and past ICU sessions with live trust scores, doctor/patient assignments, ICU room, and duration.' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const scrollTo = (id: string) => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const SectionGrid: React.FC<{ items: { icon: React.ElementType; title: string; desc: string }[] }> = ({ items }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem', marginTop: '2rem' }}>
    {items.map(item => (
      <div key={item.title} style={{
        background: 'var(--glass-bg)', border: '1px solid var(--border-default)',
        borderRadius: 16, padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.625rem',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-blue-border)'; (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
      >
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-blue-dim)', border: '1px solid var(--accent-blue-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <item.icon size={17} style={{ color: 'var(--accent-blue)' }} strokeWidth={1.75} />
        </div>
        <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-primary)' }}>{item.title}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{item.desc}</div>
      </div>
    ))}
  </div>
);

// ── Main component ─────────────────────────────────────────────────────────────
export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [visible, setVisible] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  // Track which section is in view for nav highlight
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { rootMargin: '-30% 0px -60% 0px' }
    );
    NAV_SECTIONS.forEach(s => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const goToLogin = (redirect?: string) => {
    const url = redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login';
    navigate(url);
  };

  const handleSectionClick = (sectionId: string) => {
    setMobileMenuOpen(false);
    const redirect = SECTION_REDIRECT[sectionId];
    if (redirect) {
      // Scroll to section first, then show sign-in CTA
      scrollTo(sectionId);
    } else {
      scrollTo(sectionId);
    }
  };

  return (
    <div className="landing" data-theme={theme}>

      {/* ── Sticky Nav ───────────────────────────────────────────────────── */}
      <nav className="landing-nav" ref={navRef}>
        <div className="landing-nav-inner" style={{ maxWidth: 1200, gap: '0.5rem' }}>
          {/* Logo */}
          <div className="landing-logo" style={{ flexShrink: 0 }}>
            <div className="landing-logo-icon"><Shield size={16} strokeWidth={2} /></div>
            <span className="landing-logo-text">MedTrust AI</span>
          </div>

          {/* Section links — desktop */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem', flex: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
            {NAV_SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => handleSectionClick(s.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '0.35rem 0.7rem', borderRadius: 8,
                  fontSize: '0.78rem', fontWeight: activeSection === s.id ? 700 : 500,
                  color: activeSection === s.id ? 'var(--accent-blue)' : 'var(--text-secondary)',
                  transition: 'color 0.2s ease, background 0.2s ease',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { if (activeSection !== s.id) (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
                onMouseLeave={e => { if (activeSection !== s.id) (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="landing-nav-actions" style={{ flexShrink: 0 }}>
            <button className="landing-theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === 'dark' ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
            </button>
            <button className="landing-btn-ghost" onClick={() => navigate('/register')}>Register</button>
            <button className="landing-btn-ghost" onClick={() => goToLogin()}>Login</button>
            <button className="landing-btn-primary" onClick={() => navigate('/register-doctor')}>
              Doctor Sign-up <ArrowRight size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section id="hero" className={`landing-hero ${visible ? 'landing-visible' : ''}`}>
        <div className="landing-hero-mesh" aria-hidden="true" />
        <div className="landing-container">
          <div className="landing-badge">
            <Activity size={12} strokeWidth={2} />
            <span>Enterprise Healthcare Security</span>
          </div>
          <h1 className="landing-h1">
            Real-Time Deepfake Protection<br />
            <span className="landing-h1-accent">for ICU Monitoring</span>
          </h1>
          <p className="landing-hero-sub">
            MedTrust AI continuously verifies patient identity using multi-modal AI analysis—
            video, voice, and biometric signals—delivering a zero-trust composite trust score
            every frame of the ICU stream.
          </p>
          <div className="landing-hero-cta">
            <button className="landing-btn-primary landing-btn-lg" onClick={() => navigate('/register')}>
              Register as Patient <ArrowRight size={15} strokeWidth={2} />
            </button>
            <button className="landing-btn-ghost landing-btn-lg" onClick={() => navigate('/register-doctor')}>
              Register as Doctor <Stethoscope size={15} strokeWidth={2} />
            </button>
            <button className="landing-btn-ghost landing-btn-lg" onClick={() => goToLogin()}>
              Sign In <ChevronRight size={15} strokeWidth={2} />
            </button>
          </div>
          <div className="landing-trust-badges">
            {['HIPAA Compliant', 'SOC 2 Ready', 'Zero-Trust Architecture', 'Real-Time'].map(b => (
              <span key={b} className="landing-trust-badge">
                <CheckCircle size={12} strokeWidth={2} /> {b}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats strip ──────────────────────────────────────────────────── */}
      <section className="landing-stats-strip">
        <div className="landing-container landing-stats-grid">
          {STATS.map(s => (
            <div key={s.label} className="landing-stat">
              <div className="landing-stat-value">{s.value}</div>
              <div className="landing-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="landing-section">
        <div className="landing-container">
          <div className="landing-section-header">
            <h2 className="landing-h2">Enterprise-grade protection</h2>
            <p className="landing-section-sub">Six integrated layers working together to protect every patient interaction.</p>
          </div>
          <div className="landing-features-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {FEATURES.map(f => (
              <div key={f.title} className="landing-feature-card">
                <div className="landing-feature-icon" style={{ backgroundColor: f.accentBg, color: f.accent }}>
                  <f.icon size={20} strokeWidth={1.75} />
                </div>
                <h3 className="landing-feature-title">{f.title}</h3>
                <p className="landing-feature-desc">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="landing-section landing-section-alt">
        <div className="landing-container">
          <div className="landing-section-header">
            <h2 className="landing-h2">How it works</h2>
            <p className="landing-section-sub">Three steps from registration to a fully verified, real-time secure consultation.</p>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '1.5rem',
            marginTop: '2.5rem',
            position: 'relative',
          }}>
            {HOW_IT_WORKS.map((s, i) => (
              <div key={s.step} style={{
                background: 'var(--glass-bg)',
                border: `1px solid ${s.accent}33`,
                borderRadius: 20,
                padding: '1.75rem 1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                position: 'relative',
                transition: 'box-shadow 0.2s ease, transform 0.2s ease',
              }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 32px ${s.accent}22`;
                  (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                  (e.currentTarget as HTMLElement).style.transform = 'none';
                }}
              >
                {/* Step number */}
                <div style={{
                  position: 'absolute', top: '1.25rem', right: '1.25rem',
                  fontSize: '2rem', fontWeight: 900, lineHeight: 1,
                  color: `${s.accent}18`, fontFamily: 'monospace', userSelect: 'none',
                }}>{s.step}</div>
                {/* Icon */}
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: s.accentBg,
                  border: `1.5px solid ${s.accent}40`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <s.icon size={22} strokeWidth={1.75} style={{ color: s.accent }} />
                </div>
                {/* Step connector arrow (desktop) */}
                {i < HOW_IT_WORKS.length - 1 && (
                  <div style={{
                    display: 'none',
                  }} aria-hidden="true" />
                )}
                <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: s.accent }}>Step {s.step}</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', lineHeight: 1.3 }}>{s.title}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Doctor Registry ──────────────────────────────────────────────── */}
      <section id="doctor-registry" className="landing-section">
        <div className="landing-container">
          <div className="landing-section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'center', marginBottom: '0.5rem' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Users size={20} style={{ color: '#2563EB' }} strokeWidth={1.75} />
              </div>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#2563EB' }}>Doctor Registry</span>
            </div>
            <h2 className="landing-h2">Biometric doctor registration</h2>
            <p className="landing-section-sub">
              Doctors are not just registered with credentials — they are enrolled with a face and voice baseline.
              Every ICU session verifies the live doctor against their stored biometric profile in real time.
            </p>
          </div>
          <SectionGrid items={REGISTRY_FEATURES} />
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2rem' }}>
            <button className="landing-btn-primary landing-btn-lg" onClick={() => goToLogin('/doctors')}>
              Open Doctor Registry <ArrowRight size={15} strokeWidth={2} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Detection Lab ────────────────────────────────────────────────── */}
      <section id="detection-lab" className="landing-section landing-section-alt">
        <div className="landing-container">
          <div className="landing-section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'center', marginBottom: '0.5rem' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(8,145,178,0.1)', border: '1px solid rgba(8,145,178,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FlaskConical size={20} style={{ color: '#0891B2' }} strokeWidth={1.75} />
              </div>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#0891B2' }}>Detection Lab</span>
            </div>
            <h2 className="landing-h2">Test and analyse any stream or frame</h2>
            <p className="landing-section-sub">
              The Detection Lab gives doctors and admins a sandbox environment to test the AI pipeline
              against any active stream or uploaded video frame — live trust scores, anomaly detection, and module breakdown.
            </p>
          </div>
          <SectionGrid items={LAB_FEATURES} />
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2rem' }}>
            <button className="landing-btn-primary landing-btn-lg" onClick={() => goToLogin('/detection-lab')}>
              Open Detection Lab <ArrowRight size={15} strokeWidth={2} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Blockchain ───────────────────────────────────────────────────── */}
      <section id="blockchain" className="landing-section">
        <div className="landing-container">
          <div className="landing-section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'center', marginBottom: '0.5rem' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <GitBranch size={20} style={{ color: '#7C3AED' }} strokeWidth={1.75} />
              </div>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7C3AED' }}>Blockchain Audit</span>
            </div>
            <h2 className="landing-h2">Immutable audit trail for every event</h2>
            <p className="landing-section-sub">
              Every trust score, session boundary, alert, and configuration change is cryptographically chained.
              One-click chain validation and full export for compliance reviews.
            </p>
          </div>
          <SectionGrid items={CHAIN_FEATURES} />
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2rem' }}>
            <button className="landing-btn-primary landing-btn-lg" onClick={() => goToLogin('/blockchain')}>
              View Blockchain Audit <ArrowRight size={15} strokeWidth={2} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Admin Control ────────────────────────────────────────────────── */}
      <section id="admin" className="landing-section landing-section-alt">
        <div className="landing-container">
          <div className="landing-section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'center', marginBottom: '0.5rem' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Settings size={20} style={{ color: '#D97706' }} strokeWidth={1.75} />
              </div>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#D97706' }}>Admin Control Center</span>
            </div>
            <h2 className="landing-h2">Full platform control in one place</h2>
            <p className="landing-section-sub">
              Admins get a unified dashboard to manage users, monitor all sessions live, tune AI detection thresholds,
              and review platform-wide compliance — all with role-protected access.
            </p>
          </div>
          <SectionGrid items={ADMIN_FEATURES} />
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2rem' }}>
            <button className="landing-btn-primary landing-btn-lg" onClick={() => goToLogin('/admin')}>
              Open Admin Dashboard <ArrowRight size={15} strokeWidth={2} />
            </button>
          </div>
        </div>
      </section>

      {/* ── CTA Banner ───────────────────────────────────────────────────── */}
      <section className="landing-cta-banner">
        <div className="landing-container landing-cta-inner">
          <div>
            <h2 className="landing-cta-title">Ready to secure your ICU?</h2>
            <p className="landing-cta-sub">Deploy MedTrust AI in minutes. HIPAA-compliant from day one.</p>
          </div>
          <button className="landing-btn-primary landing-btn-lg" onClick={() => goToLogin()}>
            Get Started <ArrowRight size={15} strokeWidth={2} />
          </button>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="landing-container" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

          {/* Top grid: 4 columns */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '2rem',
          }}>

            {/* Col 1 — Brand */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="landing-logo">
                <div className="landing-logo-icon"><Shield size={14} strokeWidth={2} /></div>
                <span className="landing-logo-text">MedTrust AI</span>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.65, margin: 0 }}>
                Zero-trust telemedicine security platform. Real-time AI identity verification for ICU consultations.
              </p>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', opacity: 0.6 }}>v1.0.0 · HIPAA Compliant</span>
            </div>

            {/* Col 2 — Navigation */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Platform</div>
              {NAV_SECTIONS.map(s => (
                <button key={s.id} className="landing-footer-link" style={{ textAlign: 'left' }}
                  onClick={() => {
                    const redirect = SECTION_REDIRECT[s.id];
                    if (redirect) { goToLogin(redirect); } else { scrollTo(s.id); }
                  }}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Col 3 — Legal */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Legal</div>
              {[
                { label: 'About Us',       href: '#about' },
                { label: 'Privacy Policy', href: '#privacy' },
                { label: 'Terms of Use',   href: '#terms' },
                { label: 'HIPAA Notice',   href: '#hipaa' },
              ].map(l => (
                <button key={l.label} className="landing-footer-link" style={{ textAlign: 'left' }}
                  onClick={() => scrollTo(l.href.replace('#', ''))}>
                  {l.label}
                </button>
              ))}
            </div>

            {/* Col 4 — Account + Contact */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Account</div>
              <button className="landing-footer-link" style={{ textAlign: 'left' }} onClick={() => navigate('/login')}>Login</button>
              <button className="landing-footer-link" style={{ textAlign: 'left' }} onClick={() => navigate('/register')}>Register as Patient</button>
              <button className="landing-footer-link" style={{ textAlign: 'left' }} onClick={() => navigate('/register-doctor')}>Register as Doctor</button>
              <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Contact</div>
              <a href="mailto:support@medtrust.ai" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', textDecoration: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-blue)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}>
                support@medtrust.ai
              </a>
            </div>
          </div>

          {/* Bottom bar */}
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span className="landing-footer-copy">© 2025 MedTrust AI. All rights reserved.</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: '1rem' }}>
              <span>Zero-Trust ICU Security Platform</span>
              <span>·</span>
              <span>SOC 2 Ready</span>
              <span>·</span>
              <span>HIPAA Compliant</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};
