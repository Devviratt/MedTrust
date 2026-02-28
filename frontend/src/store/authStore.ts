import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'doctor' | 'patient';
  // Doctor-specific
  full_name?: string;
  specialization?: string;
  license_number?: string;
  hospital_name?: string;
  years_experience?: number;
  verified_status?: 'pending' | 'verified' | 'suspended';
  risk_score?: number;
  photo_url?: string;
  // Patient-specific
  health_id?: string;
  condition_notes?: string;
  assigned_doctor_id?: string;
  doctor_name?: string;
}

interface AuthState {
  user: AppUser | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (user: AppUser, token: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setAuth: (user, token) => {
        set({ user, token, isAuthenticated: true });
      },
      clearAuth: () => {
        localStorage.removeItem('medtrust-auth');
        set({ user: null, token: null, isAuthenticated: false });
      },
    }),
    { name: 'medtrust-auth', partialize: (s) => ({ user: s.user, token: s.token, isAuthenticated: s.isAuthenticated }) }
  )
);
