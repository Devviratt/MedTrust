import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
  allowedRoles?: Array<'admin' | 'doctor' | 'patient'>;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, adminOnly = false, allowedRoles }) => {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (adminOnly && user?.role !== 'admin') {
    const fallback = user?.role === 'patient' ? '/patient' : '/dashboard';
    return <Navigate to={fallback} replace />;
  }

  if (allowedRoles && user?.role && !allowedRoles.includes(user.role as any)) {
    const fallback = user.role === 'admin' ? '/admin' : user.role === 'patient' ? '/patient' : '/dashboard';
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
};
