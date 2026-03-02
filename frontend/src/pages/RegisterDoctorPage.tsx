import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, AlertCircle, Stethoscope, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { authApi } from '../services/api';
import toast from 'react-hot-toast';

export const RegisterDoctorPage: React.FC = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '', email: '', password: '', confirmPassword: '',
    license_number: '', hospital_name: '', specialization: '',
  });
  const [showPw, setShowPw]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const f = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) { setError('Passwords do not match'); return; }
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (!form.license_number) { setError('License number is required'); return; }
    setLoading(true); setError('');
    try {
      await authApi.registerSelf({
        name:           form.name,
        email:          form.email,
        password:       form.password,
        role:           'doctor',
        license_number: form.license_number,
        hospital_name:  form.hospital_name,
        specialization: form.specialization,
      });
      toast.success('Doctor account created! An admin will verify your profile.');
      navigate('/login');
    } catch (err: any) {
      const status = err?.response?.status;
      const isBackendNotConfigured = err?.code === 'API_CONFIG_MISSING' || status === 404 || status === 405;
      setError(
        isBackendNotConfigured
          ? 'Backend API is not connected. Set VITE_API_URL / VITE_SOCKET_URL and backend CORS.'
          : (err.response?.data?.error || 'Registration failed. Please try again.')
      );
    } finally {
      setLoading(false);
    }
  };

  const inp: React.CSSProperties = {
    width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
    borderRadius: 8, padding: '0.6rem 0.875rem', color: 'var(--text-primary)', fontSize: '0.875rem',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  };
  const lbl: React.CSSProperties = { fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'block', fontWeight: 500 };

  return (
    <div className="login-page">
      <div className="page-bg" />
      <div className="login-wrapper fade-up" style={{ maxWidth: 520 }}>
        <div className="login-brand">
          <div className="login-brand-icon"><Shield size={20} strokeWidth={1.75} /></div>
          <div>
            <h1 className="login-brand-name">MedTrust AI</h1>
            <p className="login-brand-sub">Doctor Registration</p>
          </div>
        </div>

        <div className="login-card">
          <div className="login-card-header">
            <h2>Register as a doctor</h2>
            <p>Create your account — an admin will complete biometric enrollment</p>
          </div>

          {error && (
            <div className="ds-alert ds-alert-danger login-error">
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

              {/* Basic info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={lbl}>Full Name *</label>
                  <input style={inp} type="text" value={form.name} onChange={e => f('name', e.target.value)} placeholder="Dr. John Smith" required disabled={loading} />
                </div>
                <div>
                  <label style={lbl}>Email Address *</label>
                  <input style={inp} type="email" value={form.email} onChange={e => f('email', e.target.value)} placeholder="doctor@hospital.com" required disabled={loading} />
                </div>
              </div>

              {/* Password */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div style={{ position: 'relative' }}>
                  <label style={lbl}>Password *</label>
                  <input style={{ ...inp, paddingRight: '2.75rem' }} type={showPw ? 'text' : 'password'} value={form.password} onChange={e => f('password', e.target.value)} placeholder="Min. 6 characters" required disabled={loading} />
                  <button type="button" onClick={() => setShowPw(p => !p)} style={{ position: 'absolute', right: 10, bottom: 9, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}>
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <div>
                  <label style={lbl}>Confirm Password *</label>
                  <input style={inp} type="password" value={form.confirmPassword} onChange={e => f('confirmPassword', e.target.value)} placeholder="Repeat password" required disabled={loading} />
                </div>
              </div>

              {/* Divider */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>Professional Details</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={lbl}>License Number *</label>
                    <input style={inp} type="text" value={form.license_number} onChange={e => f('license_number', e.target.value)} placeholder="MD-123456" required disabled={loading} />
                  </div>
                  <div>
                    <label style={lbl}>Specialization</label>
                    <input style={inp} type="text" value={form.specialization} onChange={e => f('specialization', e.target.value)} placeholder="Critical Care" disabled={loading} />
                  </div>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={lbl}>Hospital / Institution</label>
                    <input style={inp} type="text" value={form.hospital_name} onChange={e => f('hospital_name', e.target.value)} placeholder="City General Hospital" disabled={loading} />
                  </div>
                </div>
              </div>

              <div style={{ padding: '0.625rem 0.75rem', background: 'var(--status-warn-dim)', border: '1px solid var(--status-warn-border)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Account starts as <strong style={{ color: 'var(--status-warn)' }}>Pending</strong>. An admin must complete biometric enrollment to activate your verified status.
              </div>

              <button type="submit" className="ds-btn ds-btn-primary ds-btn-lg login-submit" disabled={loading}>
                {loading
                  ? <><span className="login-spinner" />Registering…</>
                  : <><Stethoscope size={15} />Register Doctor Account</>
                }
              </button>
            </div>
          </form>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Already have an account? <Link to="/login" style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 500 }}>Sign in</Link>
          </p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Are you a patient? <Link to="/register" style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 500 }}>Patient registration →</Link>
          </p>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.25rem' }}>
            <ArrowLeft size={13} /> Back to home
          </button>
        </div>
      </div>
    </div>
  );
};
