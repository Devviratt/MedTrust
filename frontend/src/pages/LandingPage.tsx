import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, Brain, Link2, ArrowRight, ChevronRight,
  Activity, Lock, CheckCircle,
  AlertTriangle, BarChart3, Users, FlaskConical,
  GitBranch, Settings, Fingerprint, Eye, Sun, Moon,
  Stethoscope,
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

// ── Nav section definitions ───────────────────────────────────────────────────
const NAV_SECTIONS = [
  { id: 'features',         label: 'Features' },
  { id: 'how-it-works',    label: 'How It Works' },
  { id: 'doctor-registry', label: 'Doctor Registry' },
  { id: 'detection-lab',   label: 'Detection Lab' },
  { id: 'blockchain',      label: 'Blockchain' },
  { id: 'admin',           label: 'Admin' },
];

const SECTION_REDIRECT: Record<string, string> = {
  'doctor-registry': '/doctors',
  'detection-lab':   '/detection-lab',
  'blockchain':      '/blockchain',
  'admin':           '/admin',
};

const FEATURES = [
  { icon: Brain,        title: 'AI Deepfake Detection',  description: 'Multi-modal analysis across video, voice, and biometric signals. Detects synthetic media in real-time with sub-100ms latency.',          accent: '#2563EB', accentBg: 'rgba(37,99,235,0.09)' },
  { icon: BarChart3,    title: 'Trust Score Engine',     description: 'Zero-trust composite scoring across four signal layers. Continuous identity verification on every frame of the ICU stream.',           accent: '#0891B2', accentBg: 'rgba(8,145,178,0.09)' },
  { icon: Link2,        title: 'Blockchain Audit Layer', description: 'Every trust event is cryptographically signed and recorded immutably. HIPAA-compliant audit trail with one-click export.',              accent: '#7C3AED', accentBg: 'rgba(124,58,237,0.09)' },
  { icon: Fingerprint,  title: 'Biometric Enrollment',   description: 'Doctors are registered with face and voice baselines. Every session verifies the live biometric against the stored profile.',          accent: '#059669', accentBg: 'rgba(5,150,105,0.09)' },
  { icon: Shield,       title: 'Zero-Trust RBAC',        description: 'Role-based access control for admin, doctor, and patient roles. Every API call is authenticated and permission-checked.',               accent: '#D97706', accentBg: 'rgba(217,119,6,0.09)' },
  { icon: Activity,     title: 'Real-Time Alerts',       description: 'Instant dashboard alerts when trust score drops or impersonation risk is detected. Configurable thresholds per deployment.',            accent: '#DC2626', accentBg: 'rgba(220,38,38,0.09)' },
];

const HOW_IT_WORKS = [
  { step: '01', icon: Fingerprint, title: 'Register & Enroll Biometrics', accent: '#2563EB', accentBg: 'rgba(37,99,235,0.10)', desc: 'Doctors register with credentials and complete face + voice biometric enrollment. Patients create an account and select a verified doctor for their consultation.' },
  { step: '02', icon: Brain,       title: 'AI Verifies Both Parties',     accent: '#7C3AED', accentBg: 'rgba(124,58,237,0.10)', desc: 'Before every session, the doctor completes real-time identity re-verification. Multi-modal AI compares live face, voice, and biometric signals against the enrolled baseline.' },
  { step: '03', icon: Shield,      title: 'Secure Session Starts',        accent: '#059669', accentBg: 'rgba(5,150,105,0.10)',  desc: 'Once identity is confirmed, the session activates automatically. Trust scores are computed every frame and logged immutably to the blockchain audit trail.' },
];

const STATS = [
  { value: '<100ms', label: 'Detection latency' },
  { value: '99.7%',  label: 'Detection accuracy' },
  { value: 'HIPAA',  label: 'Compliant audit trail' },
  { value: '24/7',   label: 'Continuous monitoring' },
];

const REGISTRY_FEATURES = [
  { icon: Users,       title: 'Unified Doctor Profiles', desc: 'Each doctor account includes specialization, license number, hospital affiliation, and years of experience — all admin-managed.' },
  { icon: Fingerprint, title: 'Biometric Enrollment',    desc: 'Admins capture a face snapshot and optional voice sample during registration. Stored as a cryptographic hash — no raw biometrics ever saved.' },
  { icon: CheckCircle, title: 'Live Identity Verify',    desc: 'Submit a new frame to compare against the enrolled baseline. Hamming similarity returns face + voice scores and impersonation risk.' },
  { icon: Shield,      title: 'Verified Status Badges',  desc: 'Doctors show Pending / Verified / Suspended status. Only biometric-enrolled doctors reach Verified status on the platform.' },
];

const LAB_FEATURES = [
  { icon: Eye,          title: 'Live Stream Monitor',  desc: 'Enter any active stream ID and poll the trust score every 3 seconds. View real-time breakdowns of video, voice, biometric and blockchain modules.' },
  { icon: FlaskConical, title: 'Frame Upload Analysis', desc: 'Upload a still JPEG from any video source. The AI pipeline returns a full trust analysis with anomaly score and per-module confidence values.' },
  { icon: BarChart3,    title: 'Score History',         desc: 'Rolling 20-entry history with inline micro bar chart. Track score drift over time during a session or test run.' },
  { icon: AlertTriangle,title: 'Anomaly Detection',    desc: 'Separate anomaly score surface alongside the trust score. Flags motion anomalies, env inconsistencies, and biometric drift.' },
];

const CHAIN_FEATURES = [
  { icon: GitBranch,   title: 'Immutable Event Log',  desc: 'Every trust score, alert, and session boundary is hashed and chained. SHA-256 linked records cannot be altered retroactively.' },
  { icon: Lock,        title: 'Chain Integrity Check', desc: "One-click validation of any stream's audit chain. Returns block-by-block hash verification with tamper detection." },
  { icon: GitBranch,   title: 'Full Audit Export',     desc: 'Admin-accessible audit export for all events across all streams. Filter by date range, severity, and event type.' },
  { icon: CheckCircle, title: 'HIPAA-Grade Trail',     desc: 'Every login, registration, threshold change, and impersonation event is recorded with actor ID, timestamp and severity level.' },
];

const ADMIN_FEATURES = [
  { icon: BarChart3, title: 'Control Center Overview', desc: 'Live stats for active sessions, trust score distribution, alert count, and platform service health across all modules.' },
  { icon: Users,     title: 'User Management',         desc: 'Register, list, and manage admin, doctor, and patient accounts. Filter by role. Biometric status visible per doctor row.' },
  { icon: Settings,  title: 'AI Threshold Editor',     desc: 'Adjust all trust engine weights and score thresholds directly from the dashboard. Changes persist to DB and invalidate Redis cache instantly.' },
  { icon: Activity,  title: 'Session Monitor',         desc: 'View all active and past ICU sessions with live trust scores, doctor/patient assignments, ICU room, and duration.' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const scrollTo = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

// ── SectionGrid — premium glass cards ────────────────────────────────────────
const SectionGrid: React.FC<{ items: { icon: React.ElementType; title: string; desc: string }[] }> = ({ items }) => (
  <div className="landing-features-grid">
    {items.map(item => (
      <div key={item.title} className="landing-feature-card">
        <div className="landing-feature-icon" style={{ background: 'rgba(37,99,235,0.09)', color: '#2563EB' }}>
          <item.icon size={20} strokeWidth={1.75} />
        </div>
        <h3 className="landing-feature-title">{item.title}</h3>
        <p className="landing-feature-desc">{item.desc}</p>
      </div>
    ))}
  </div>
);

// ── Section eyebrow chip ──────────────────────────────────────────────────────
const SectionChip: React.FC<{ icon: React.ElementType; label: string; color: string; bg: string; border: string }> = ({ icon: Icon, label, color, bg, border }) => (
  <div className="lp-chip" style={{ background: bg, border: `1px solid ${border}`, color, marginBottom: '1rem' }}>
    <Icon size={14} strokeWidth={1.75} />
    <span>{label}</span>
  </div>
);

// ── Main component ─────────────────────────────────────────────────────────────
export const LandingPage: React.FC = () => {
  const navigate  = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [visible, setVisible]           = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) setActiveSection(e.target.id); }),
      { rootMargin: '-30% 0px -60% 0px' }
    );
    NAV_SECTIONS.forEach(s => { const el = document.getElementById(s.id); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);

  const goToLogin = (redirect?: string) =>
    navigate(redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login');

  return (
    <div className="landing" data-theme={theme}>

      {/* ── Sticky Nav ───────────────────────────────────────────────────── */}
      <nav className="landing-nav" ref={navRef}>
        <div className="landing-nav-inner">
          <div className="landing-logo">
            <div className="landing-logo-icon"><Shield size={16} strokeWidth={2.5} /></div>
            <span className="landing-logo-text">MedTrust AI</span>
          </div>

          <div className="lp-nav-links">
            {NAV_SECTIONS.map(s => (
              <button
                key={s.id}
                className={`lp-nav-link${activeSection === s.id ? ' lp-nav-link-active' : ''}`}
                onClick={() => scrollTo(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="landing-nav-actions">
            <button className="landing-theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === 'dark' ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
            </button>
            <button className="landing-btn-ghost" onClick={() => goToLogin()}>Sign In</button>
            <button className="landing-btn-primary" onClick={() => navigate('/register')}>
              Get Started <ArrowRight size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section id="hero" className={`landing-hero${visible ? ' landing-visible' : ''}`}>
        <div className="landing-hero-mesh" aria-hidden="true" />
        <div className="landing-container">
          <div className="landing-badge">
            <Activity size={12} strokeWidth={2} />
            <span>Enterprise Healthcare Security Platform</span>
          </div>
          <h1 className="landing-h1">
            Real-Time Deepfake Protection<br />
            <span className="landing-h1-accent">for ICU Telemedicine</span>
          </h1>
          <p className="landing-hero-sub">
            MedTrust AI continuously verifies both doctor and patient identity using multi-modal
            AI — video, voice, and biometrics — delivering a zero-trust composite score every
            frame of the session.
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
            {['HIPAA Compliant', 'SOC 2 Ready', 'Zero-Trust Architecture', 'Real-Time AI'].map(b => (
              <span key={b} className="landing-trust-badge">
                <CheckCircle size={12} strokeWidth={2.5} /> {b}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats strip ──────────────────────────────────────────────────── */}
      <div className="landing-stats-strip">
        <div className="landing-container landing-stats-grid">
          {STATS.map(s => (
            <div key={s.label} className="landing-stat">
              <div className="landing-stat-value">{s.value}</div>
              <div className="landing-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="landing-section">
        <div className="landing-container">
          <div className="landing-section-header">
            <h2 className="landing-h2">Enterprise-grade protection</h2>
            <p className="landing-section-sub">Six integrated layers working together to protect every patient interaction in real time.</p>
          </div>
          <div className="landing-features-grid">
            {FEATURES.map(f => (
              <div key={f.title} className="landing-feature-card">
                <div className="landing-feature-icon" style={{ background: f.accentBg, color: f.accent }}>
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
          <div className="landing-features-grid">
            {HOW_IT_WORKS.map(s => (
              <div key={s.step} className="landing-feature-card lp-hiw-card">
                <div className="lp-hiw-step-num" style={{ color: `${s.accent}20` }}>{s.step}</div>
                <div className="landing-feature-icon" style={{ background: s.accentBg, color: s.accent }}>
                  <s.icon size={22} strokeWidth={1.75} />
                </div>
                <div className="lp-hiw-label" style={{ color: s.accent }}>Step {s.step}</div>
                <h3 className="landing-feature-title">{s.title}</h3>
                <p className="landing-feature-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Doctor Registry ──────────────────────────────────────────────── */}
      <section id="doctor-registry" className="landing-section">
        <div className="landing-container">
          <div className="landing-section-header">
            <SectionChip icon={Users} label="Doctor Registry" color="#2563EB" bg="rgba(37,99,235,0.08)" border="rgba(37,99,235,0.20)" />
            <h2 className="landing-h2">Biometric doctor registration</h2>
            <p className="landing-section-sub">
              Doctors are enrolled with a face and voice baseline. Every ICU session verifies
              the live doctor against their stored biometric profile in real time.
            </p>
          </div>
          <SectionGrid items={REGISTRY_FEATURES} />
          <div className="lp-section-cta">
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
            <SectionChip icon={FlaskConical} label="Detection Lab" color="#0891B2" bg="rgba(8,145,178,0.08)" border="rgba(8,145,178,0.20)" />
            <h2 className="landing-h2">Test and analyse any stream or frame</h2>
            <p className="landing-section-sub">
              A sandbox environment to test the AI pipeline against any active stream or uploaded
              video frame — live trust scores, anomaly detection, and module breakdown.
            </p>
          </div>
          <SectionGrid items={LAB_FEATURES} />
          <div className="lp-section-cta">
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
            <SectionChip icon={GitBranch} label="Blockchain Audit" color="#7C3AED" bg="rgba(124,58,237,0.08)" border="rgba(124,58,237,0.20)" />
            <h2 className="landing-h2">Immutable audit trail for every event</h2>
            <p className="landing-section-sub">
              Every trust score, session boundary, alert, and configuration change is
              cryptographically chained. One-click chain validation and full export for compliance.
            </p>
          </div>
          <SectionGrid items={CHAIN_FEATURES} />
          <div className="lp-section-cta">
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
            <SectionChip icon={Settings} label="Admin Control Center" color="#D97706" bg="rgba(217,119,6,0.08)" border="rgba(217,119,6,0.20)" />
            <h2 className="landing-h2">Full platform control in one place</h2>
            <p className="landing-section-sub">
              Admins get a unified dashboard to manage users, monitor sessions live, tune AI
              detection thresholds, and review platform-wide compliance — all role-protected.
            </p>
          </div>
          <SectionGrid items={ADMIN_FEATURES} />
          <div className="lp-section-cta">
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
          <button className="landing-btn-primary landing-btn-lg" onClick={() => navigate('/register')}>
            Get Started <ArrowRight size={15} strokeWidth={2} />
          </button>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="landing-container">
          <div className="lp-footer-grid">

            {/* Col 1 — Brand */}
            <div className="lp-footer-col">
              <div className="landing-logo" style={{ marginBottom: '0.875rem' }}>
                <div className="landing-logo-icon"><Shield size={14} strokeWidth={2.5} /></div>
                <span className="lp-footer-brand">MedTrust AI</span>
              </div>
              <p className="lp-footer-tagline">
                Zero-trust telemedicine security. Real-time AI identity verification for ICU consultations.
              </p>
              <span className="lp-footer-version">v1.0.0 · HIPAA Compliant</span>
            </div>

            {/* Col 2 — Platform */}
            <div className="lp-footer-col">
              <div className="lp-footer-heading">Platform</div>
              {NAV_SECTIONS.map(s => (
                <button key={s.id} className="landing-footer-link"
                  onClick={() => { const r = SECTION_REDIRECT[s.id]; r ? goToLogin(r) : scrollTo(s.id); }}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Col 3 — Legal */}
            <div className="lp-footer-col">
              <div className="lp-footer-heading">Legal</div>
              {['About Us', 'Privacy Policy', 'Terms of Use', 'HIPAA Notice'].map(l => (
                <button key={l} className="landing-footer-link">{l}</button>
              ))}
            </div>

            {/* Col 4 — Account + Contact */}
            <div className="lp-footer-col">
              <div className="lp-footer-heading">Account</div>
              <button className="landing-footer-link" onClick={() => navigate('/login')}>Sign In</button>
              <button className="landing-footer-link" onClick={() => navigate('/register')}>Register as Patient</button>
              <button className="landing-footer-link" onClick={() => navigate('/register-doctor')}>Register as Doctor</button>
              <div className="lp-footer-heading" style={{ marginTop: '1rem' }}>Contact</div>
              <a className="lp-footer-email" href="mailto:support@medtrust.ai">support@medtrust.ai</a>
            </div>
          </div>

          <div className="lp-footer-bottom">
            <span className="landing-footer-copy">© 2025 MedTrust AI. All rights reserved.</span>
            <span className="lp-footer-meta">Zero-Trust ICU Security &nbsp;·&nbsp; SOC 2 Ready &nbsp;·&nbsp; HIPAA Compliant</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
