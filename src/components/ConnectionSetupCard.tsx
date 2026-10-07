import React, { useState } from 'react';
import { Database, WifiOff, RefreshCw, Server, CheckCircle2, AlertCircle } from 'lucide-react';
import { streamingClient, getHostDefaultStreamingUrl, normalizeServiceUrl } from '../lib/streamingClient';

interface ConnectionSetupCardProps {
  currentUrl: string;
  dbStatus: string;
  onConnect: (url: string) => void;
}

export const ConnectionSetupCard: React.FC<ConnectionSetupCardProps> = ({
  currentUrl,
  dbStatus,
  onConnect,
}) => {
  const hostDefault = getHostDefaultStreamingUrl();
  const [inputUrl, setInputUrl] = useState<string>(currentUrl || hostDefault);
  const [isTesting, setIsTesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleTestAndConnect = async (targetUrl?: string) => {
    const urlToTest = targetUrl || inputUrl;
    setIsTesting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const normalized = normalizeServiceUrl(urlToTest);

    try {
      const status = await streamingClient.checkStatus(normalized.httpUrl);
      const isHealthy = status && (
        status.streaming_db?.exists ||
        status.status?.toUpperCase() === 'HEALTHY' ||
        status.status?.toUpperCase() === 'OK'
      );

      if (isHealthy) {
        setSuccessMessage(`Successfully connected to ${normalized.httpUrl}`);
        setTimeout(() => {
          onConnect(normalized.httpUrl);
        }, 400);
      } else {
        setErrorMessage(
          `Connected to ${normalized.httpUrl}, but service returned non-healthy status (${status?.status || 'Unknown'}).`
        );
      }
    } catch (err: any) {
      setErrorMessage(
        `Failed to reach ${normalized.httpUrl}/api/status. Please verify that the data-harvester/streaming service is running and accessible over your network (e.g. Tailscale).`
      );
    } finally {
      setIsTesting(false);
    }
  };

  const handlePreset = (presetUrl: string) => {
    setInputUrl(presetUrl);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%',
        padding: '24px',
      }}
    >
      <div
        className="session-card"
        style={{
          maxWidth: '520px',
          width: '100%',
          borderColor: errorMessage ? 'rgba(239, 68, 68, 0.4)' : 'rgba(38, 166, 154, 0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div
            style={{
              padding: '10px',
              borderRadius: '10px',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              color: 'var(--accent-red)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <WifiOff size={24} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              DuckDB Streaming Service Offline
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
              Connect to your host machine's DuckDB replay engine.
            </p>
          </div>
        </div>

        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '16px' }}>
          Market Rewind requires the DuckDB streaming backend on port 8765 for high-frequency tick playback. When accessing from a remote device, use your host's network address.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleTestAndConnect();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
          <div>
            <label
              htmlFor="duckdb-service-url-input"
              style={{
                display: 'block',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Streaming Service URL
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Server
                size={16}
                style={{
                  position: 'absolute',
                  left: '12px',
                  color: 'var(--text-secondary)',
                  pointerEvents: 'none',
                }}
              />
              <input
                id="duckdb-service-url-input"
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="http://localhost:8765"
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '0.95rem',
                  fontFamily: 'var(--font-mono)',
                  padding: '10px 12px 10px 38px',
                  outline: 'none',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'var(--accent-green)';
                  e.target.style.boxShadow = '0 0 0 2px rgba(38, 166, 154, 0.2)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>
          </div>

          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
              Quick Presets:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button
                type="button"
                className="btn-outline"
                style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                onClick={() => handlePreset('http://localhost:8765')}
                title="Use local DuckDB streaming service (http://localhost:8765)"
              >
                Localhost (localhost:8765)
              </button>
              {hostDefault !== 'http://localhost:8765' && (
                <button
                  type="button"
                  className="btn-outline"
                  style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                  onClick={() => handlePreset(hostDefault)}
                  title={`Use current host address (${hostDefault})`}
                >
                  Current Host ({hostDefault.replace(/^https?:\/\//, '')})
                </button>
              )}
            </div>
          </div>

          {errorMessage && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: 'var(--accent-red)',
                fontSize: '0.825rem',
                lineHeight: '1.4',
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: 'rgba(38, 166, 154, 0.15)',
                border: '1px solid rgba(38, 166, 154, 0.3)',
                color: 'var(--accent-green)',
                fontSize: '0.825rem',
              }}
            >
              <CheckCircle2 size={16} />
              <span>{successMessage}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
            <button
              type="submit"
              className="btn-primary"
              disabled={isTesting}
              style={{
                width: '100%',
                justifyContent: 'center',
                padding: '10px 20px',
                opacity: isTesting ? 0.7 : 1,
                cursor: isTesting ? 'wait' : 'pointer',
              }}
            >
              {isTesting ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  Testing Connection...
                </>
              ) : (
                <>
                  <Database size={16} />
                  Connect to Service
                </>
              )}
            </button>
          </div>
        </form>

        <div
          style={{
            marginTop: '16px',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-color)',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Current status:</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-red)' }}>
            {dbStatus}
          </span>
        </div>
      </div>
    </div>
  );
};
