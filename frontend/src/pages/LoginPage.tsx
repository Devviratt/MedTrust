import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, Shield, AlertCircle, Lock } from 'lucide-react';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';

const roleDest = (role: string) =>
  role === 'admin' ? '/admin' : role === 'patient' ? '/patient-dashboard' : '/doctor-dashboard';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Email and password are required'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await authApi.login(email, password);
      const { token, user } = res.data;
      if (!token || !user?.role) throw new Error('Invalid server response');
      setAuth(user, token);
      toast.success(`Welcome back, ${user.name}`, { duration: 2500 });
      navigate(roleDest(user.role), { replace: true });
    } catch (err: any) {
      const isNetworkError = err?.code === 'ERR_NETWORK' || err?.message === 'Network Error';
      const msg = isNetworkError
        ? 'Cannot reach server. Configure VITE_API_URL / VITE_SOCKET_URL for deployed frontend.'
        : (err.response?.data?.error || err.message || 'Login failed. Check your credentials.');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="page-bg" />

      <div className="login-wrapper fade-up">
        {/* Brand header */}
        <div className="login-brand">
          <div className="login-brand-icon">
            <Shield size={20} strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="login-brand-name">MedTrust AI</h1>
            <p className="login-brand-sub">ICU Security Platform</p>
          </div>
        </div>

        {/* Card */}
        <div className="login-card">
          <div className="login-card-header">
            <h2>Sign in to your account</h2>
            <p>Enter your credentials to access the monitoring dashboard</p>
          </div>

          {error && (
            <div className="ds-alert ds-alert-danger login-error">
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="login-form">
            <div className="login-field">
              <label htmlFor="email" className="login-label">Email address</label>
              <div className="login-input-wrap">
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="doctor@hospital.com"
                  className="ds-input"
                  autoComplete="email"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="login-field">
              <label htmlFor="password" className="login-label">Password</label>
              <div className="login-input-wrap" style={{ position: 'relative' }}>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="ds-input"
                  style={{ paddingRight: '2.75rem' }}
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="login-eye-btn"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="ds-btn ds-btn-primary ds-btn-lg login-submit"
            >
              {loading ? (
                <>
                  <span className="login-spinner" />
                  Authenticating…
                </>
              ) : (
                <>
                  <Lock size={15} />
                  Sign in securely
                </>
              )}
            </button>
          </form>

        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'center' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            No account? <Link to="/register" style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 500 }}>Register as Patient</Link>
            &nbsp;·&nbsp;
            <Link to="/register-doctor" style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 500 }}>Register as Doctor</Link>
          </p>
          <Link to="/" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textDecoration: 'none' }}>← Back to home</Link>
        </div>
        <p className="login-legal">
          Protected by Zero-Trust Security Architecture &nbsp;·&nbsp; MedTrust AI v1.0
        </p>
      </div>
    </div>
  );
};
