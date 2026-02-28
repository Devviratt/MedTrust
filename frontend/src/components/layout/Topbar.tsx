import React from 'react';
import { useLocation } from 'react-router-dom';
import { Shield, Activity, Sun, Moon } from 'lucide-react';
import { useStreamStore } from '../../store/streamStore';
import { useTheme } from '../../hooks/useTheme';

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  '/doctor-dashboard':  { title: 'Doctor Dashboard',   subtitle: 'Real-time deepfake detection & zero-trust scoring' },
  '/dashboard':         { title: 'Doctor Dashboard',   subtitle: 'Real-time deepfake detection & zero-trust scoring' },
  '/patient-dashboard': { title: 'Patient Dashboard',  subtitle: 'Monitor your session and doctor verification status' },
  '/admin':             { title: 'Admin Panel',         subtitle: 'Manage users, AI thresholds & compliance' },
  '/doctors':           { title: 'Doctor Registry',    subtitle: 'All registered medical staff' },
  '/blockchain':        { title: 'Blockchain Audit',   subtitle: 'Immutable tamper-proof event log' },
  '/detection-lab':     { title: 'Detection Lab',      subtitle: 'Test AI pipeline against any stream or frame' },
  '/profile':           { title: 'My Profile',         subtitle: 'Doctor profile and biometric status' },
};

export const Topbar: React.FC = () => {
  const { pathname } = useLocation();
  const { isStreaming } = useStreamStore();
  const { theme, toggleTheme } = useTheme();

  const base = '/' + pathname.split('/')[1];
  const meta = PAGE_TITLES[base] ?? { title: 'MedTrust AI', subtitle: '' };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Shield size={15} strokeWidth={1.75} className="topbar-icon" />
        <div>
          <h1 className="topbar-title">{meta.title}</h1>
          {meta.subtitle && <p className="topbar-sub">{meta.subtitle}</p>}
        </div>
      </div>
      <div className="topbar-right">
        <span className="topbar-status">
          <span className={`status-dot ${isStreaming ? 'status-dot-live' : 'status-dot-off'}`} />
          {isStreaming ? 'Streaming' : 'Idle'}
        </span>
        <button
          className="topbar-theme-btn"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark'
            ? <Sun size={14} strokeWidth={1.75} />
            : <Moon size={14} strokeWidth={1.75} />}
        </button>
        <span className="topbar-version">
          <Activity size={11} strokeWidth={1.75} />
          v1.0
        </span>
      </div>
    </header>
  );
};
