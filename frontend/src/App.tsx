import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AppLayout } from './components/layout/AppLayout';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { RegisterDoctorPage } from './pages/RegisterDoctorPage';
import { DashboardPage } from './pages/DashboardPage';
import { DoctorDashboardPage } from './pages/DoctorDashboardPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { PatientDashboard } from './pages/PatientDashboard';
import { PatientDashboardPage } from './pages/PatientDashboardPage';
import { SessionHistoryPage } from './pages/SessionHistoryPage';
import { DoctorProfilePage } from './pages/DoctorProfilePage';
import { DoctorsPage } from './pages/DoctorsPage';
import { BlockchainPage } from './pages/BlockchainPage';
import { DetectionLabPage } from './pages/DetectionLabPage';

// ── Safe auth state reader (never throws) ─────────────────────────────────────
const readAuth = (): { token: string | null; role: string | null } => {
  try {
    const raw = localStorage.getItem('medtrust-auth');
    if (!raw) return { token: null, role: null };
    const state = JSON.parse(raw)?.state ?? null;
    const token = state?.token ?? null;
    const role  = state?.user?.role ?? null;
    // Basic expiry guard: JWT middle segment contains exp
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload?.exp && payload.exp * 1000 < Date.now()) {
          localStorage.removeItem('medtrust-auth');
          return { token: null, role: null };
        }
      } catch { /* non-standard token — leave it */ }
    }
    return { token, role };
  } catch {
    localStorage.removeItem('medtrust-auth');
    return { token: null, role: null };
  }
};

// ── Root route: show landing if guest, redirect to dashboard if logged in ─────
const RootRoute: React.FC = () => {
  const { token, role } = readAuth();
  if (!token) return <LandingPage />;
  if (role === 'admin')   return <Navigate to="/admin"            replace />;
  if (role === 'doctor')  return <Navigate to="/doctor-dashboard" replace />;
  if (role === 'patient') return <Navigate to="/patient-dashboard" replace />;
  return <LandingPage />;
};

// ── Auth guard: checks token + role, clears expired tokens ───────────────────
const RequireAuth: React.FC<{ children: React.ReactNode; roles?: string[] }> = ({ children, roles }) => {
  const location = useLocation();
  const { token, role: userRole } = readAuth();

  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;

  if (roles && roles.length > 0 && userRole && !roles.includes(userRole)) {
    if (userRole === 'admin')   return <Navigate to="/admin"            replace />;
    if (userRole === 'patient') return <Navigate to="/patient-dashboard" replace />;
    return <Navigate to="/doctor-dashboard" replace />;
  }
  return <>{children}</>;
};

const withLayout = (node: React.ReactNode) => <AppLayout>{node}</AppLayout>;

const App: React.FC = () => {
  // Only apply saved theme — no auth checks, no redirects
  useEffect(() => {
    const saved = localStorage.getItem('medtrust-theme');
    const theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
            fontSize: '0.875rem',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          },
          success: { iconTheme: { primary: '#22C55E', secondary: 'transparent' } },
          error:   { iconTheme: { primary: '#EF4444', secondary: 'transparent' } },
        }}
      />
      <Routes>
        {/* ── Root: landing for guests, dashboard redirect for logged-in users ── */}
        <Route path="/"              element={<RootRoute />} />
        <Route path="/login"         element={<LoginPage />} />
        <Route path="/register"      element={<RegisterPage />} />
        <Route path="/register-doctor" element={<RegisterDoctorPage />} />

        {/* ── Doctor / Admin shared routes ── */}
        <Route path="/doctor-dashboard" element={
          <RequireAuth roles={['doctor']}>
            {withLayout(<DoctorDashboardPage />)}
          </RequireAuth>
        } />
        {/* Live streaming session — accessed from doctor dashboard after verification */}
        <Route path="/dashboard" element={<Navigate to="/doctor-dashboard" replace />} />
        <Route path="/dashboard/:streamId" element={
          <RequireAuth roles={['doctor', 'admin']}>
            {withLayout(<DashboardPage />)}
          </RequireAuth>
        } />
        <Route path="/profile" element={
          <RequireAuth roles={['doctor', 'admin']}>
            {withLayout(<DoctorProfilePage />)}
          </RequireAuth>
        } />
        <Route path="/profile/:id" element={
          <RequireAuth roles={['doctor', 'admin']}>
            {withLayout(<DoctorProfilePage />)}
          </RequireAuth>
        } />
        <Route path="/detection-lab" element={
          <RequireAuth roles={['doctor', 'admin']}>
            {withLayout(<DetectionLabPage />)}
          </RequireAuth>
        } />
        <Route path="/blockchain" element={
          <RequireAuth roles={['doctor', 'admin']}>
            {withLayout(<BlockchainPage />)}
          </RequireAuth>
        } />

        {/* ── Admin only ── */}
        <Route path="/admin" element={
          <RequireAuth roles={['admin']}>
            {withLayout(<AdminDashboard />)}
          </RequireAuth>
        } />
        <Route path="/doctors" element={
          <RequireAuth roles={['admin']}>
            {withLayout(<DoctorsPage />)}
          </RequireAuth>
        } />

        {/* ── Patient only ── */}
        <Route path="/patient-dashboard" element={
          <RequireAuth roles={['patient']}>
            {withLayout(<PatientDashboardPage />)}
          </RequireAuth>
        } />
        <Route path="/patient/session-history" element={
          <RequireAuth roles={['patient']}>
            {withLayout(<SessionHistoryPage />)}
          </RequireAuth>
        } />
        {/* Legacy alias */}
        <Route path="/patient" element={<Navigate to="/patient-dashboard" replace />} />

        {/* ── Fallback → landing (no auto-redirect to admin) ── */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
};

export default App;
