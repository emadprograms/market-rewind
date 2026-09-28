import React, { useState, useEffect } from 'react';
import { X, Server, Database, CheckCircle2, AlertCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { streamingClient, getHostDefaultStreamingUrl, normalizeServiceUrl } from '../lib/streamingClient';

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUrl: string;
  isDbLoaded: boolean;
  dbStatus: string;
  onSave: (newUrl: string) => void;
  onReset: () => void;
}

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  isOpen,
  onClose,
  currentUrl,
  isDbLoaded,
  dbStatus,
  onSave,
  onReset,
}) => {
  const hostDefault = getHostDefaultStreamingUrl();
  const [urlInput, setUrlInput] = useState(currentUrl || hostDefault);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setUrlInput(currentUrl || hostDefault);
      setTestResult(null);
    }
  }, [isOpen, currentUrl, hostDefault]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    const normalized = normalizeServiceUrl(urlInput);
    try {
      const status = await streamingClient.checkStatus(normalized.httpUrl);
      const isHealthy = status && (
        status.streaming_db?.exists ||
        status.status?.toUpperCase() === 'HEALTHY' ||
        status.status?.toUpperCase() === 'OK'
      );

      if (isHealthy) {
        const tickCount = status.streaming_db?.tick_count;
        const countStr = tickCount ? ` (${(tickCount / 1_000_000).toFixed(1)}M ticks)` : '';
        setTestResult({
          success: true,
          message: `Connected successfully to ${normalized.httpUrl}${countStr}`,
        });
      } else {
        setTestResult({
          success: false,
          message: `Reachable, but status returned: ${status?.status || 'Unknown'}`,
        });
      }
    } catch {
      setTestResult({
        success: false,
        message: `Failed to reach ${normalized.httpUrl}/api/status. Check host IP and port 8420.`,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    const normalized = normalizeServiceUrl(urlInput);
    onSave(normalized.httpUrl);
    onClose();
  };

  const handleResetToHost = () => {
    onReset();
    setUrlInput(hostDefault);
    setTestResult(null);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="session-card"
        style={{
          maxWidth: '500px',
          width: '100%',
          padding: '24px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Server size={20} color="var(--accent-green)" />
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>DuckDB Streaming Backend</h3>
          </div>
          <button
            onClick={onClose}
            className="btn-icon"
            style={{ width: '28px', height: '28px' }}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            borderRadius: '6px',
            marginBottom: '16px',
            backgroundColor: isDbLoaded ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${isDbLoaded ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
            color: isDbLoaded ? 'var(--accent-green)' : 'var(--accent-red)',
            fontSize: '0.8rem',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {isDbLoaded ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {dbStatus}
          </span>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label
            htmlFor="connection-modal-url-input"
            style={{
              display: 'block',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: '6px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            DuckDB Service URL (Port 8420)
          </label>
          <input
            id="connection-modal-url-input"
            type="text"
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              setTestResult(null);
            }}
            placeholder="http://100.x.y.z:8420"
            style={{
              width: '100%',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '0.9rem',
              fontFamily: 'var(--font-mono)',
              padding: '8px 12px',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
            Quick Presets:
          </span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-outline"
              style={{ fontSize: '0.75rem', padding: '4px 8px' }}
              onClick={() => {
                setUrlInput('http://100.72.128.22:8420');
                setTestResult(null);
              }}
              title="Use direct Tailscale stream IP"
            >
              Tailscale IP (100.72.128.22:8420)
            </button>
            <button
              type="button"
              className="btn-outline"
              style={{ fontSize: '0.75rem', padding: '4px 8px' }}
              onClick={() => {
                setUrlInput('http://arshad-pc-1:8420');
                setTestResult(null);
              }}
              title="Use permanent Tailscale MagicDNS name"
            >
              MagicDNS (arshad-pc-1:8420)
            </button>
            {hostDefault !== 'http://100.72.128.22:8420' && hostDefault !== 'http://arshad-pc-1:8420' && (
              <button
                type="button"
                className="btn-outline"
                style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                onClick={() => {
                  setUrlInput(hostDefault);
                  setTestResult(null);
                }}
              >
                Current Host ({hostDefault.replace(/^https?:\/\//, '')})
              </button>
            )}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginTop: '6px', opacity: 0.8 }}>
            💡 Tailscale Tip: <strong>arshad-pc-1:8420</strong> is your permanent MagicDNS host, which persists even if Tailscale reassigns IP addresses.
          </span>
        </div>

        {testResult && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              marginBottom: '16px',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: testResult.success ? 'rgba(38, 166, 154, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              border: `1px solid ${testResult.success ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              color: testResult.success ? 'var(--accent-green)' : 'var(--accent-red)',
            }}
          >
            {testResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{testResult.message}</span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', gap: '8px' }}>
          <button
            type="button"
            className="btn-outline"
            onClick={handleResetToHost}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            title="Reset to default host configuration"
          >
            <RotateCcw size={14} />
            Reset
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-outline"
              onClick={handleTest}
              disabled={isTesting}
              style={{ fontSize: '0.8rem', padding: '6px 14px' }}
            >
              {isTesting ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
              Test
            </button>

            <button
              type="button"
              className="btn-primary"
              onClick={handleSave}
              style={{ fontSize: '0.8rem', padding: '6px 16px' }}
            >
              Save & Connect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
