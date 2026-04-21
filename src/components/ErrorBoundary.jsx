// ─────────────────────────────────────────────────────────
//  Error Boundary — Catches JS errors in child components
//  and shows a recovery screen instead of a blank page
// ─────────────────────────────────────────────────────────

import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught error:', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          background: 'var(--bg-base, #0a0b0d)',
          gap: '16px',
          padding: '40px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '3rem' }}>⚠️</div>
          <div style={{ color: '#ff3b5c', fontSize: '1.1rem', fontWeight: 700 }}>
            Chart Error Detected
          </div>
          <div style={{
            color: '#8b8f98',
            fontSize: '0.85rem',
            maxWidth: '400px',
            lineHeight: 1.6,
          }}>
            {this.state.error?.message || 'An unexpected chart error occurred.'}
            <br />
            This usually self-resolves on refresh.
          </div>
          <button
            onClick={this.handleReset}
            style={{
              marginTop: '8px',
              padding: '10px 24px',
              background: 'rgba(0,200,255,0.1)',
              border: '1px solid rgba(0,200,255,0.4)',
              color: '#00c8ff',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: 600,
            }}
          >
            🔄 Recover & Resume
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
