import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary isolates component-level crashes to prevent global application failure.
 * Specifically used to wrap ChartUnit instances in the layout grid.
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // You can also log the error to an error reporting service
    console.error('Uncaught error in ChartUnit:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div 
          className="chart-card error-boundary-fallback"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            textAlign: 'center',
            background: 'rgba(239, 83, 80, 0.05)',
            border: '1px solid var(--accent-red)',
          }}
        >
          <div 
            style={{ 
              color: 'var(--accent-red)', 
              fontSize: '1.2rem', 
              fontWeight: 'bold',
              marginBottom: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Chart Error
          </div>
          
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '20px', maxWidth: '300px' }}>
            {this.state.error?.message || 'An unexpected error occurred while rendering this chart.'}
          </p>
          
          <button 
            onClick={this.handleRetry}
            className="btn-outline"
            style={{ 
              borderColor: 'var(--accent-red)', 
              color: 'var(--accent-red)',
              padding: '6px 16px',
              fontSize: '0.85rem'
            }}
          >
            Retry Component
          </button>
          
          <div style={{ marginTop: '16px', fontSize: '0.7rem', color: 'var(--text-secondary)', opacity: 0.5 }}>
            Internal State: {this.state.hasError ? 'Crashed' : 'Stable'}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
