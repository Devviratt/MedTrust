import React, { useState, useEffect } from 'react';
import { Settings, UserPlus, FileText, Sliders, Loader2, CheckCircle, AlertCircle, Users, Activity, Bell, TrendingUp } from 'lucide-react';
import { adminApi, doctorApi } from '../services/api';

type Tab = 'config' | 'register' | 'voice' | 'report' | 'stats';

export const AdminPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('stats');
  const [config, setConfig] = useState<Record<string, any>>({});
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // Register doctor form state
  const [regForm, setRegForm] = useState({
    email: '', password: '', full_name: '', department: '',
    specialization: '', license_number: '', role: 'doctor',
  });

  // Config form state
  const [configForm, setConfigForm] = useState({
    video_weight: 0.40, voice_weight: 0.30,
    biometric_weight: 0.20, blockchain_weight: 0.10,
    safe_threshold: 75, suspicious_threshold: 50,
  });

  useEffect(() => {
    fetchStats();
    fetchConfig();
  }, []);

  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState(false);

  const fetchStats = async () => {
    setStatsLoading(true);
    setStatsError(false);
    try {
      const res = await adminApi.getDashboardStats();
      setStats(res.data);
    } catch {
      setStatsError(true);
    } finally {
      setStatsLoading(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await adminApi.getConfig();
      setConfig(res.data);
      const cfg = res.data;
      setConfigForm({
        video_weight: cfg.video_weight?.value ?? 0.40,
        voice_weight: cfg.voice_weight?.value ?? 0.30,
        biometric_weight: cfg.biometric_weight?.value ?? 0.20,
        blockchain_weight: cfg.blockchain_weight?.value ?? 0.10,
        safe_threshold: cfg.safe_threshold?.value ?? 75,
        suspicious_threshold: cfg.suspicious_threshold?.value ?? 50,
      });
    } catch { /* silent */ }
  };

  const notify = (msg: string, isError = false) => {
    if (isError) { setError(msg); setSuccess(''); }
    else { setSuccess(msg); setError(''); }
    setTimeout(() => { setSuccess(''); setError(''); }, 4000);
  };

  const handleRegisterDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await doctorApi.register(regForm as any);
      notify('Doctor registered successfully');
      setRegForm({ email: '', password: '', full_name: '', department: '', specialization: '', license_number: '', role: 'doctor' });
    } catch (err: any) {
      notify(err.response?.data?.error || 'Registration failed', true);
    } finally { setLoading(false); }
  };

  const handleUpdateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await adminApi.updateConfig(configForm as any);
      notify('Configuration updated successfully');
    } catch (err: any) {
      notify(err.response?.data?.error || 'Update failed', true);
    } finally { setLoading(false); }
  };

  const handleExportReport = async (format: 'json' | 'csv') => {
    setLoading(true);
    try {
      const res = await adminApi.getComplianceReport({ format });
      if (format === 'csv') {
        const blob = new Blob([res.data], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `medtrust-report-${Date.now()}.csv`; a.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `medtrust-report-${Date.now()}.json`; a.click();
        URL.revokeObjectURL(url);
      }
      notify('Report exported successfully');
    } catch (err: any) {
      notify('Export failed', true);
    } finally { setLoading(false); }
  };

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'stats', label: 'Dashboard', icon: Settings },
    { id: 'register', label: 'Register Doctor', icon: UserPlus },
    { id: 'config', label: 'AI Thresholds', icon: Sliders },
    { id: 'report', label: 'Compliance Report', icon: FileText },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-header-icon">
            <Settings size={16} strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="page-header-title">Admin Control Panel</h2>
            <p className="page-header-sub">Manage doctors, AI configuration, and compliance</p>
          </div>
        </div>
      </div>

          {/* Status Messages */}
          {success && (
            <div className="ds-alert ds-alert-safe">
              <CheckCircle size={15} style={{ flexShrink: 0 }} />
              <span>{success}</span>
            </div>
          )}
          {error && (
            <div className="ds-alert ds-alert-danger">
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* Tab Navigation */}
          <div className="admin-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`admin-tab${activeTab === tab.id ? ' active' : ''}`}
              >
                <tab.icon size={14} strokeWidth={1.75} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Stats Tab */}
          {activeTab === 'stats' && (
            <div>
              {statsError && (
                <div className="ds-alert ds-alert-danger" style={{ alignItems: 'center', marginBottom: '1rem' }}>
                  <AlertCircle size={14} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>Could not load dashboard stats.</span>
                  <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={fetchStats}>
                    <Loader2 size={12} /> Retry
                  </button>
                </div>
              )}
              <div className="stat-grid">
                {([
                  { label: 'Total Doctors',   value: statsLoading ? '…' : (stats?.doctors?.total ?? '—'),                   sub: `${stats?.doctors?.active ?? 0} active`,  iconColor: 'var(--accent-blue)',    iconBg: 'var(--accent-blue-dim)',    Icon: Users },
                  { label: 'Active Streams',  value: statsLoading ? '…' : (stats?.streams?.active ?? '—'),                  sub: `${stats?.streams?.total ?? 0} total`,    iconColor: 'var(--status-safe)',    iconBg: 'var(--status-safe-dim)',    Icon: Activity },
                  { label: 'Alerts (24h)',    value: statsLoading ? '…' : (stats?.alerts_24h ?? '—'),                       sub: 'Critical events',                        iconColor: 'var(--status-danger)',  iconBg: 'var(--status-danger-dim)', Icon: Bell },
                  { label: 'Avg Trust Score', value: statsLoading ? '…' : (stats?.trust_score_24h?.avg?.toFixed(0) ?? '—'), sub: 'Last 24 hours',                          iconColor: 'var(--status-info)',    iconBg: 'var(--status-info-dim)',   Icon: TrendingUp },
                ] as const).map((item) => (
                  <div key={item.label} className="stat-card">
                    <div className="stat-card-header">
                      <span className="stat-card-label">{item.label}</span>
                      <div className="stat-card-icon" style={{ backgroundColor: item.iconBg }}>
                        <item.Icon size={13} strokeWidth={1.75} style={{ color: item.iconColor }} />
                      </div>
                    </div>
                    <div className="stat-card-value" style={{ color: item.iconColor }}>{item.value}</div>
                    <div className="stat-card-sub">{item.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Register Doctor Tab */}
          {activeTab === 'register' && (
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title"><UserPlus size={14} strokeWidth={1.75} className="panel-title-icon" /> Register New Doctor</div>
              </div>
              <div className="panel-body">
              <form onSubmit={handleRegisterDoctor} className="admin-form-grid">
                {[
                  { key: 'email',          label: 'Email',           type: 'email',    placeholder: 'doctor@hospital.com' },
                  { key: 'password',       label: 'Password',        type: 'password', placeholder: '••••••••' },
                  { key: 'full_name',      label: 'Full Name',       type: 'text',     placeholder: 'Dr. Jane Smith' },
                  { key: 'department',     label: 'Department',      type: 'text',     placeholder: 'Intensive Care Unit' },
                  { key: 'specialization', label: 'Specialization',  type: 'text',     placeholder: 'Critical Care Medicine' },
                  { key: 'license_number', label: 'License Number',  type: 'text',     placeholder: 'MD-12345' },
                ].map((field) => (
                  <div key={field.key} className="admin-field">
                    <label className="admin-label">{field.label}</label>
                    <input
                      type={field.type}
                      placeholder={field.placeholder}
                      value={(regForm as any)[field.key]}
                      onChange={(e) => setRegForm({ ...regForm, [field.key]: e.target.value })}
                      required={field.key !== 'specialization'}
                      className="ds-input"
                    />
                  </div>
                ))}
                <div className="admin-field">
                  <label className="admin-label">Role</label>
                  <select
                    value={regForm.role}
                    onChange={(e) => setRegForm({ ...regForm, role: e.target.value })}
                    className="ds-input"
                  >
                    {['admin', 'doctor', 'nurse', 'viewer'].map((r) => (
                      <option key={r} value={r} style={{ backgroundColor: 'var(--bg-surface)' }}>
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="admin-form-submit">
                  <button type="submit" disabled={loading} className="ds-btn ds-btn-primary ds-btn-lg" style={{ width: '100%', justifyContent: 'center' }}>
                    {loading ? <Loader2 size={15} style={{ animation: 'spin 0.6s linear infinite' }} /> : <UserPlus size={15} />}
                    {loading ? 'Registering…' : 'Register Doctor'}
                  </button>
                </div>
              </form>
              </div>
            </div>
          )}

          {/* AI Config Tab */}
          {activeTab === 'config' && (
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title"><Sliders size={14} strokeWidth={1.75} className="panel-title-icon" /> AI Detection Thresholds</div>
              </div>
              <div className="panel-body">
              <form onSubmit={handleUpdateConfig} className="admin-config-form">
                <div className="admin-config-section">
                  <p className="ds-section-title" style={{ marginBottom: 12 }}>Score Weights (must sum to 1.0)</p>
                  <div className="admin-form-grid">
                    {[
                      { key: 'video_weight',      label: 'Video Weight',      hint: 'Default: 0.40' },
                      { key: 'voice_weight',      label: 'Voice Weight',      hint: 'Default: 0.30' },
                      { key: 'biometric_weight',  label: 'Biometric Weight',  hint: 'Default: 0.20' },
                      { key: 'blockchain_weight', label: 'Blockchain Weight', hint: 'Default: 0.10' },
                    ].map((f) => (
                      <div key={f.key} className="admin-field">
                        <div className="admin-range-header">
                          <label className="admin-label">{f.label}</label>
                          <span className="admin-range-value">{(configForm as any)[f.key]}</span>
                        </div>
                        <input type="range" min="0" max="1" step="0.05"
                          value={(configForm as any)[f.key]}
                          onChange={(e) => setConfigForm({ ...configForm, [f.key]: parseFloat(e.target.value) })}
                          className="admin-range"
                        />
                        <span className="admin-hint">{f.hint}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="admin-config-section">
                  <p className="ds-section-title" style={{ marginBottom: 12 }}>Status Thresholds</p>
                  <div className="admin-form-grid">
                    {[
                      { key: 'safe_threshold',        label: 'Safe Threshold',        min: 50, max: 100 },
                      { key: 'suspicious_threshold',  label: 'Suspicious Threshold',  min: 0,  max: 75  },
                    ].map((f) => (
                      <div key={f.key} className="admin-field">
                        <div className="admin-range-header">
                          <label className="admin-label">{f.label}</label>
                          <span className="admin-range-value">{(configForm as any)[f.key]}</span>
                        </div>
                        <input type="range" min={f.min} max={f.max} step="5"
                          value={(configForm as any)[f.key]}
                          onChange={(e) => setConfigForm({ ...configForm, [f.key]: parseInt(e.target.value) })}
                          className="admin-range"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <button type="submit" disabled={loading} className="ds-btn ds-btn-primary ds-btn-lg" style={{ justifyContent: 'center' }}>
                  {loading ? <Loader2 size={15} style={{ animation: 'spin 0.6s linear infinite' }} /> : <Sliders size={15} />}
                  {loading ? 'Saving…' : 'Save Configuration'}
                </button>
              </form>
              </div>
            </div>
          )}

          {/* Report Tab */}
          {activeTab === 'report' && (
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title"><FileText size={14} strokeWidth={1.75} className="panel-title-icon" /> Export Compliance Report</div>
              </div>
              <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: 0 }}>
                  Generate HIPAA-compliant audit reports covering all security events, trust scores, and blockchain integrity logs.
                </p>
                <div className="report-grid">
                  <button onClick={() => handleExportReport('json')} disabled={loading} className="report-card ds-card-hover">
                    <FileText size={18} strokeWidth={1.75} style={{ color: 'var(--accent-blue)', marginBottom: 8 }} />
                    <p className="report-card-title">JSON Report</p>
                    <p className="report-card-sub">Full structured data for API integration</p>
                  </button>
                  <button onClick={() => handleExportReport('csv')} disabled={loading} className="report-card ds-card-hover">
                    <FileText size={18} strokeWidth={1.75} style={{ color: 'var(--status-safe)', marginBottom: 8 }} />
                    <p className="report-card-title">CSV Report</p>
                    <p className="report-card-sub">Spreadsheet-ready audit log export</p>
                  </button>
                </div>
                {loading && (
                  <div className="empty-state" style={{ padding: '1rem' }}>
                    <Loader2 size={18} className="empty-state-icon" style={{ animation: 'spin 0.6s linear infinite' }} />
                    <p>Generating report…</p>
                  </div>
                )}
              </div>
            </div>
          )}
    </div>
  );
};
