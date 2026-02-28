import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Shield, LayoutDashboard, Settings, Users, Hash,
  LogOut, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useStreamStore } from '../../store/streamStore';
import { authApi } from '../../services/api';
import toast from 'react-hot-toast';

const NAV_ITEMS = [
  { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/admin',     icon: Settings,        label: 'Admin Panel',  adminOnly: true },
  { path: '/doctors',   icon: Users,           label: 'Doctors',      adminOnly: true },
  { path: '/blockchain',icon: Hash,            label: 'Blockchain' },
];

export const Sidebar: React.FC = () => {
  const { user, clearAuth } = useAuthStore();
  const { activeAlertCount } = useStreamStore();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* silent */ }
    clearAuth();
    toast.success('Signed out successfully');
    navigate('/login');
  };

  const isAdmin = user?.role === 'admin';
  const initials = user?.full_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2) || 'U';

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : 'sidebar-expanded'}`}>
      {/* Logo row */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <Shield size={15} strokeWidth={1.75} />
        </div>
        {!collapsed && (
          <div className="sidebar-logo-text">
            <span className="sidebar-logo-name">MedTrust AI</span>
            <span className="sidebar-logo-sub">ICU Security</span>
          </div>
        )}
        <button
          className="sidebar-collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ marginLeft: collapsed ? 0 : 'auto' }}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {!collapsed && <span className="sidebar-section-label">Navigation</span>}

        {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `sidebar-nav-item${isActive ? ' active' : ''}`
            }
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
              <div className="sidebar-user-name">{user?.full_name || 'User'}</div>
              <div className="sidebar-user-role">{user?.role}</div>
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
