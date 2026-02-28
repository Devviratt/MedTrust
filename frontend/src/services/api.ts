import axios, { AxiosInstance, AxiosError } from 'axios';
import toast from 'react-hot-toast';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';

const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Read JWT from Zustand persisted store (key: medtrust-auth)
const getToken = (): string | null => {
  try {
    const raw = localStorage.getItem('medtrust-auth');
    if (!raw) return null;
    return JSON.parse(raw)?.state?.token ?? null;
  } catch { return null; }
};

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle errors globally
api.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    const status = err.response?.status;
    const url    = (err.config as any)?.url ?? '';

    // Auth endpoints (login/register) — let the component handle errors directly, no global toast/redirect
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register');
    // Enrollment 403s — handled by DoctorDashboardPage with proper UI, suppress global toast
    const responseCode = (err.response?.data as any)?.code;
    const isEnrollmentCode = responseCode === 'ENROLLMENT_REQUIRED' || responseCode === 'PENDING_APPROVAL';

    if (status === 401 && !isAuthEndpoint) {
      // Token expired or invalid on a protected route — clear and redirect
      try { localStorage.removeItem('medtrust-auth'); } catch { /**/ }
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(err);
    }

    // Surface errors as toasts — skip 401 on auth endpoints (handled inline)
    // skip 404 (expected empty states), 400 (handled inline), 401 on auth, enrollment 403s
    const skipToast = status === 404 || status === 400 || (status === 401 && isAuthEndpoint) || isEnrollmentCode;
    if (!skipToast) {
      const msg = (err.response?.data as any)?.error
        || (err.response?.data as any)?.message
        || err.message
        || 'Network error';
      toast.error(msg, { id: msg.slice(0, 60), duration: 4000 });
    }
    return Promise.reject(err);
  }
);

// ─── Unified Auth (RBAC) ─────────────────────────────────────────────────────
export const authApi = {
  login:        (email: string, password: string) => api.post('/auth/login', { email, password }),
  logout:       () => api.post('/auth/logout'),
  me:           () => api.get('/auth/me'),
  register:     (payload: RegisterUserPayload) => api.post('/auth/register', payload),
  // Public self-registration (no auth required)
  registerSelf: (payload: RegisterUserPayload) => api.post('/auth/register-self', payload),
  // Legacy login (backward compat)
  legacyLogin:  (email: string, password: string) => api.post('/doctor/login', { email, password }),
};

// ─── Doctor ───────────────────────────────────────────────────────────────────
export const doctorApi = {
  register: (data: RegisterDoctorPayload) => api.post('/doctor/register', data),
  getProfile: (id: string) => api.get(`/doctor/profile/${id}`),
  list: (params?: { page?: number; department?: string; role?: string }) =>
    api.get('/doctor/list', { params }),
  trainVoice: (formData: FormData) =>
    api.post('/doctor/train-voice', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

// ─── Analysis ─────────────────────────────────────────────────────────────────
export const analysisApi = {
  analyzeVideo: (payload: AnalyzeVideoPayload) => api.post('/analyze/video', payload),
  analyzeAudio: (payload: AnalyzeAudioPayload) => api.post('/analyze/audio', payload),
  getLiveTrustScore: (streamId: string) => api.get(`/trustscore/live/${streamId}`),
  getTrustHistory: (streamId: string, limit = 60) =>
    api.get(`/trustscore/history/${streamId}`, { params: { limit } }),
};

// ─── Blockchain ───────────────────────────────────────────────────────────────
export const blockchainApi = {
  getAudit: (streamId: string, limit = 50) =>
    api.get(`/blockchain/audit/${streamId}`, { params: { limit } }),
  getAllAuditEvents: (params?: { page?: number; limit?: number; severity?: string }) =>
    api.get('/blockchain/audit', { params }),
  validateChunk: (payload: { stream_id: string; chunk_data: string; chunk_type: string }) =>
    api.post('/blockchain/validate', payload),
};

// ─── Streams ─────────────────────────────────────────────────────────────────
export const streamsApi = {
  create:    (payload?: { doctor_id?: string; patient_id?: string; icu_room?: string }) =>
    api.post('/streams/create', payload || {}),
  start:     (payload?: { doctor_id?: string; patient_id?: string; icu_room?: string }) =>
    api.post('/streams/start', payload || {}),
  end:       (streamId: string) => api.post(`/streams/end/${streamId}`),
  getActive: () => api.get('/streams/active'),
  getStream: (streamId: string) => api.get(`/streams/${streamId}`),
};

// ─── Patient ──────────────────────────────────────────────────────────────────
export const patientApi = {
  getProfile:       () => api.get('/patient/profile'),
  getDoctor:        () => api.get('/patient/doctor'),
  getSessions:      (params?: { page?: number; limit?: number }) => api.get('/patient/sessions', { params }),
  getSessionTrust:  (streamId: string) => api.get(`/patient/session/${streamId}/trust`),
  getSessionReport: (streamId: string) => api.get(`/patient/session/${streamId}/report`),
  getAlerts:        () => api.get('/patient/alerts'),
};

// ─── Sessions ─────────────────────────────────────────────────────────────────
export const sessionApi = {
  getVerifiedDoctors: () => api.get('/doctors/verified'),
  requestSession:     (doctor_id: string) => api.post('/sessions/request', { doctor_id }),
  getMySession:       () => api.get('/sessions/my'),
  // Doctor endpoints
  getPendingRequests: () => api.get('/sessions/pending'),
  getActiveSession:   () => api.get('/sessions/active'),
  respond:            (streamId: string, action: 'accept' | 'reject') =>
    api.post(`/sessions/${streamId}/respond`, { action }),
  verifyPreSession:   (streamId: string, scores: {
    face_score?: number; voice_score?: number;
    biometric_score?: number; liveness_score?: number; motion_score?: number;
  }) => api.post(`/sessions/${streamId}/verify`, scores),
  // Session detail + trust
  getDetail:          (streamId: string) => api.get(`/sessions/${streamId}`),
  getPatientTrust:    (streamId: string) => api.get(`/sessions/${streamId}/trust`),
  getSessionTrust:    (streamId: string) => api.get(`/sessions/${streamId}/trust`),
  // Patient
  cancelSession:      (streamId: string) => api.post(`/sessions/${streamId}/cancel`),
};

// ─── Biometric ────────────────────────────────────────────────────────────────
export const biometricApi = {
  enroll:    (doctorId: string, payload: { face_frame: string; mfcc?: number[] }) =>
    api.post(`/doctor/enroll/${doctorId}`, payload),
  verify:    (doctorId: string, payload: { face_frame: string; mfcc?: number[] }) =>
    api.post(`/doctor/verify/${doctorId}`, payload),
  getStatus: (doctorId: string) => api.get(`/doctor/biometric-status/${doctorId}`),
};

// ─── Admin ────────────────────────────────────────────────────────────────────
export const adminApi = {
  getConfig:        () => api.get('/admin/config'),
  updateConfig:     (config: AdminConfigPayload) => api.put('/admin/config', config),
  getDashboardStats:() => api.get('/admin/dashboard'),
  getComplianceReport: (params: { from?: string; to?: string; format?: string }) =>
    api.get('/admin/compliance/report', { params, responseType: params.format === 'csv' ? 'blob' : 'json' }),
  startStream:      (payload: { doctor_id: string; patient_id: string; icu_room: string }) =>
    api.post('/admin/stream/start', payload),
  stopStream:       (streamId: string) => api.put(`/admin/stream/${streamId}/stop`),
  // RBAC platform additions
  getThresholds:    () => api.get('/admin/thresholds'),
  updateThresholds: (payload: Record<string, number>) => api.put('/admin/thresholds', payload),
  getUsers:         (params?: { role?: string; page?: number; limit?: number }) => api.get('/admin/users', { params }),
  getSessions:      () => api.get('/admin/sessions'),
  // User management
  setUserStatus:    (userId: string, status: 'active' | 'inactive' | 'suspended') =>
    api.patch(`/admin/users/${userId}/status`, { status }),
  forceReverify:    (userId: string) => api.post(`/admin/users/${userId}/force-reverify`),
  // Enhanced registry
  getRegistry:      (role?: string) => api.get('/admin/registry', { params: role ? { role } : {} }),
  getAllSessions:    () => api.get('/admin/sessions/all'),
  approveDoctor:    (userId: string) => api.post(`/admin/doctors/${userId}/approve`),
  revokeDoctor:     (userId: string) => api.post(`/admin/doctors/${userId}/revoke`),
  reEnrollDoctor:   (userId: string) => api.post(`/admin/doctors/${userId}/re-enroll`),
  getUsersGrouped:  () => api.get('/admin/users/grouped'),
  blockUser:        (userId: string, block: boolean) => api.post(`/admin/users/${userId}/block`, { block }),
  deleteUser:       (userId: string) => api.delete(`/admin/users/${userId}`),
  // Fully dynamic stats endpoints
  getAdminStats:           () => api.get('/admin/stats'),
  getThreatActivity:       () => api.get('/admin/threat-activity'),
  getRecentVerifications:  () => api.get('/admin/recent-verifications'),
};

// ─── Types ────────────────────────────────────────────────────────────────────
export interface RegisterDoctorPayload {
  email: string;
  password: string;
  full_name: string;
  department: string;
  specialization?: string;
  license_number: string;
  role?: string;
}

export interface AnalyzeVideoPayload {
  stream_id: string;
  chunk_data: string;
  timestamp: number;
  frame_rate?: number;
}

export interface AnalyzeAudioPayload {
  stream_id: string;
  audio_data: string;
  timestamp: number;
  sample_rate?: number;
}

export interface AdminConfigPayload {
  video_weight?: number;
  voice_weight?: number;
  biometric_weight?: number;
  blockchain_weight?: number;
  alert_threshold?: number;
  suspicious_threshold?: number;
}

export interface TrustScore {
  trust_score: number;
  video_score: number;
  voice_score: number;
  biometric_score: number;
  blockchain_score: number;
  behavioral_score?: number;
  env_score?: number;
  status: 'safe' | 'suspicious' | 'alert';
  timestamp: string;
  stream_id: string;
  chain_intact?: boolean;
  impersonation_risk?: 'LOW' | 'MEDIUM' | 'HIGH';
  similarity_score?: number;
  detail?: {
    spatial_score?: number;
    temporal_score?: number;
    gan_score?: number;
    rppg_waveform?: number[];
  };
}

export interface RegisterUserPayload {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'doctor' | 'patient';
  specialization?: string;
  license_number?: string;
  hospital_name?: string;
  years_experience?: number;
  assigned_doctor_id?: string;
  health_id?: string;
  condition_notes?: string;
}

export default api;
