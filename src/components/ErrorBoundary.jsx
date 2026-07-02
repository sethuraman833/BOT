// ─────────────────────────────────────────────────────────
//  Error Boundary — Catches render errors in child tree
// ─────────────────────────────────────────────────────────

import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '16px 20px',
          margin: '8px',
          background: 'rgba(255, 68, 68, 0.06)',
          border: '1px solid rgba(255, 68, 68, 0.15)',
          borderRadius: '8px',
          color: '#ff9999',
          fontSize: '0.72rem',
          fontFamily: 'var(--font-mono)',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#ff6666' }}>
            ⚠ Component Error
          </div>
          <div style={{ opacity: 0.8, marginBottom: 8 }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#ddd',
              padding: '4px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.65rem',
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
