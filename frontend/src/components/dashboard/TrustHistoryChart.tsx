import React from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import type { TrustScore } from '../../services/api';
import { format } from 'date-fns';

interface TrustHistoryChartProps {
  history: TrustScore[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: '0.5rem 0.75rem',
      fontSize: '0.75rem',
      minWidth: 160,
      boxShadow: 'var(--shadow-md)',
    }}>
      <p style={{ color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: '0.25rem' }}>{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

const TrustHistoryChartInner: React.FC<TrustHistoryChartProps> = ({ history }) => {
  const data = history.map((h) => ({
    time: format(new Date((h as any).created_at || h.timestamp || Date.now()), 'HH:mm:ss'),
    Trust: h.trust_score,
    Video: h.video_score,
    Voice: h.voice_score,
    Biometric: h.biometric_score,
  }));

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">
          <TrendingUp size={14} strokeWidth={1.75} className="panel-title-icon" />
          Trust Score History
        </div>
        <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{data.length} pts</span>
      </div>
      <div style={{ padding: '0.75rem 1.125rem 1rem' }}>
      <div style={{ height: 208 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="trustGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="videoGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#818cf8" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="time"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: '#6b7280', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              ticks={[0, 25, 50, 75, 100]}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              iconType="circle" iconSize={8}
            />
            {/* Threshold reference lines */}
            <ReferenceLine y={75} stroke="#22c55e" strokeDasharray="4 2" strokeOpacity={0.4} label={{ value: 'SAFE', fill: '#22c55e', fontSize: 9, position: 'insideTopRight' }} />
            <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="4 2" strokeOpacity={0.4} label={{ value: 'SUSPICIOUS', fill: '#f59e0b', fontSize: 9, position: 'insideTopRight' }} />

            <Area type="monotone" dataKey="Trust" stroke="#06b6d4" strokeWidth={2} fill="url(#trustGrad)" dot={false} activeDot={{ r: 4 }} />
            <Area type="monotone" dataKey="Video" stroke="#818cf8" strokeWidth={1.5} fill="url(#videoGrad)" dot={false} activeDot={{ r: 3 }} />
            <Area type="monotone" dataKey="Voice" stroke="#a78bfa" strokeWidth={1.5} fill="none" dot={false} activeDot={{ r: 3 }} />
            <Area type="monotone" dataKey="Biometric" stroke="#f472b6" strokeWidth={1.5} fill="none" dot={false} activeDot={{ r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      </div>
    </div>
  );
};

export const TrustHistoryChart = React.memo(TrustHistoryChartInner);
