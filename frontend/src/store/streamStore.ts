import { create } from 'zustand';
import type { TrustScore } from '../services/api';

interface StreamState {
  streamId: string | null;
  isStreaming: boolean;
  trustScore: TrustScore | null;
  trustHistory: TrustScore[];
  rppgWaveform: number[];
  alerts: Alert[];
  activeAlertCount: number;
  threadLogs: ThreadLog[];

  setStreamId: (id: string | null) => void;
  setStreaming: (v: boolean) => void;
  clearStream: () => void;
  updateTrustScore: (score: TrustScore) => void;
  setTrustHistory: (history: TrustScore[]) => void;
  pushRppgData: (waveform: number[]) => void;
  addAlert: (alert: Alert) => void;
  clearAlerts: () => void;
  pushThreadLog: (log: ThreadLog) => void;
}

interface Alert {
  id: string;
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
  streamId?: string;
}

export interface ThreadLog {
  module: string;
  message: string;
  level: 'info' | 'warn' | 'critical';
  timestamp: string;
}

export const useStreamStore = create<StreamState>((set, get) => ({
  streamId: null,
  isStreaming: false,
  trustScore: null,
  trustHistory: [],
  rppgWaveform: [],
  alerts: [],
  activeAlertCount: 0,
  threadLogs: [],

  setStreamId: (id) => set({ streamId: id }),
  setStreaming: (v) => set({ isStreaming: v }),
  clearStream: () => set({
    streamId: null,
    isStreaming: false,
    trustScore: null,
    trustHistory: [],
    rppgWaveform: [],
    alerts: [],
    activeAlertCount: 0,
    threadLogs: [],
  }),

  updateTrustScore: (score) => {
    const history = [...get().trustHistory, score].slice(-120);
    set({ trustScore: score, trustHistory: history });
  },

  setTrustHistory: (history) => {
    const latest = history.length > 0 ? history[history.length - 1] : get().trustScore;
    set({ trustHistory: history.slice(-120), ...(latest ? { trustScore: latest } : {}) });
  },

  pushRppgData: (waveform) => {
    const current = get().rppgWaveform;
    const merged = [...current, ...waveform].slice(-150); // Rolling 150-point window
    set({ rppgWaveform: merged });
  },

  addAlert: (alert) => {
    const alerts = [alert, ...get().alerts].slice(0, 50);
    const activeAlertCount = alerts.filter((a) => a.severity === 'critical').length;
    set({ alerts, activeAlertCount });
  },

  clearAlerts: () => set({ alerts: [], activeAlertCount: 0 }),

  pushThreadLog: (log) => {
    const logs = [log, ...get().threadLogs].slice(0, 100); // keep last 100
    set({ threadLogs: logs });
  },
}));
