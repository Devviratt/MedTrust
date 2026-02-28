import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Shield, LayoutDashboard, Users,
  LogOut, ChevronLeft, ChevronRight, UserCircle,
  FlaskConical, BarChart3, GitBranch, History,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useStreamStore } from '../../store/streamStore';
import { authApi } from '../../services/api';
import toast from 'react-hot-toast';

const PATIENT_NAV = [
  { path: '/patient-dashboard',      icon: LayoutDashboard, label: 'My Dashboard'     },
  { path: '/patient/session-history', icon: History,         label: 'Session History'  },
];

const DOCTOR_NAV = [
  { path: '/doctor-dashboard', icon: LayoutDashboard, label: 'Live Verification' },
  { path: '/profile',          icon: UserCircle,      label: 'My Profile'        },
  { path: '/detection-lab',    icon: FlaskConical,    label: 'Detection Lab'     },
];

const ADMIN_NAV = [
  { path: '/admin',           icon: BarChart3,       label: 'Admin Panel'       },
  { path: '/doctors',         icon: Users,           label: 'User Management'   },
  { path: '/blockchain',      icon: GitBranch,       label: 'Blockchain Audit'  },
  { path: '/detection-lab',   icon: FlaskConical,    label: 'Detection Lab'     },
];

export const Sidebar: React.FC = () => {
  const { user, clearAuth } = useAuthStore();
  const { activeAlertCount } = useStreamStore();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* silent */ }
    clearAuth();
    toast.success('Signed out');
    navigate('/login');
  };

  const isAdmin   = user?.role === 'admin';
  const isPatient  = user?.role === 'patient';
  const navItems   = isAdmin ? ADMIN_NAV : isPatient ? PATIENT_NAV : DOCTOR_NAV;
  const displayName = user?.name || (user as any)?.full_name || 'User';
  const initials = displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || 'U';

  const roleLabel = isAdmin ? 'Admin' : isPatient ? 'Patient' : 'Doctor';

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : 'sidebar-expanded'}`}>
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <Shield size={15} strokeWidth={1.75} />
        </div>
        {!collapsed && (
          <div className="sidebar-logo-text">
            <span className="sidebar-logo-name">MedTrust AI</span>
            <span className="sidebar-logo-sub">{isAdmin ? 'Admin Control' : isPatient ? 'Patient Portal' : 'ICU Verification'}</span>
          </div>
        )}
        <button
          className="sidebar-collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{ marginLeft: collapsed ? 0 : 'auto' }}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {!collapsed && <span className="sidebar-section-label">{roleLabel} Menu</span>}
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/dashboard' || item.path === '/admin'}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) => `sidebar-nav-item${isActive ? ' active' : ''}`}
          >
            <span className="sidebar-nav-icon">
              <item.icon size={16} strokeWidth={1.75} />
            </span>
            {!collapsed && <span className="sidebar-nav-label">{item.label}</span>}
            {!collapsed && item.path === '/dashboard' && activeAlertCount > 0 && (
              <span className="sidebar-badge">{activeAlertCount}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar">{initials}</div>
          {!collapsed && (
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{displayName}</div>
              <div className="sidebar-user-role">{user?.role || 'viewer'}</div>
            </div>
          )}
        </div>
        <button
          className="sidebar-logout-btn"
          onClick={handleLogout}
          title="Sign out"
        >
          <LogOut size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
};
