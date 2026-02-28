import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts';
import { Heart } from 'lucide-react';

interface RPPGWaveformProps {
  waveform: number[];
  heartRate?: number;
  confidence?: number;
  isLive?: boolean;
}

const RPPGWaveformInner: React.FC<RPPGWaveformProps> = ({
  waveform,
  heartRate,
  confidence = 0,
  isLive = false,
}) => {
  const data = useMemo(() => {
    const pts = waveform.slice(-120);
    return pts.map((v, i) => ({ t: i, v: parseFloat(v.toFixed(3)) }));
  }, [waveform]);

  const hasSignal = waveform.length > 10;

  const heartColor = '#f43f5e';

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">
          <Heart
            size={14}
            strokeWidth={1.75}
            className="panel-title-icon"
            style={{ color: isLive && hasSignal ? heartColor : 'var(--text-muted)' }}
          />
          rPPG Pulse Waveform
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          {heartRate && heartRate > 0 && (
            <span style={{
              fontSize: '0.75rem', fontFamily: 'monospace', fontWeight: 700,
              color: heartColor,
              background: 'rgba(244,63,94,0.08)',
              border: '1px solid rgba(244,63,94,0.2)',
              borderRadius: 99, padding: '0.125rem 0.625rem',
            }}>
              {heartRate.toFixed(0)} BPM
            </span>
          )}
          {confidence > 0 && (
            <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              Conf: {(confidence * 100).toFixed(0)}%
            </span>
          )}
          <span className={`status-dot ${isLive && hasSignal ? 'status-dot-live' : 'status-dot-off'}`} />
        </div>
      </div>

      <div style={{ padding: '0.5rem 1.125rem 1rem' }}>
        {hasSignal ? (
          <div style={{ height: 112 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
                <XAxis dataKey="t" hide />
                <YAxis domain={[-1, 1]} hide ticks={[-1, 0, 1]} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                <Tooltip
                  formatter={(v: number) => [v.toFixed(3), 'rPPG']}
                  contentStyle={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 8, fontSize: 11,
                  }}
                  labelStyle={{ display: 'none' }}
                />
                <Line
                  type="monotoneX"
                  dataKey="v"
                  stroke={heartColor}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="empty-state" style={{ height: 112 }}>
            <Heart size={22} className="empty-state-icon" strokeWidth={1.5} />
            <p style={{ fontSize: '0.75rem' }}>
              {isLive ? 'Extracting rPPG signal…' : 'No signal — start stream to detect pulse'}
            </p>
          </div>
        )}
        <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          Remote photoplethysmography via ICA/PCA decomposition of facial RGB channels
        </p>
      </div>
    </div>
  );
};

export const RPPGWaveform = React.memo(RPPGWaveformInner);
