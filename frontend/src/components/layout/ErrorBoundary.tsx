import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', gap: '1rem',
          backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)',
          padding: '2rem', textAlign: 'center',
        }}>
          <AlertTriangle size={36} style={{ color: 'var(--status-danger)', opacity: 0.8 }} strokeWidth={1.5} />
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>Something went wrong</h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: 0, maxWidth: 360 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.5rem 1.25rem', borderRadius: '8px',
              backgroundColor: 'var(--accent-blue)', color: '#fff',
              border: 'none', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500,
            }}
          >
            <RefreshCw size={14} strokeWidth={1.75} /> Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
