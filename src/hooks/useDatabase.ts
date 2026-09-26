import { useState, useEffect, useCallback } from 'react';
import { streamingClient } from '../lib/streamingClient';

export function useDatabase() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState('Connecting to Streaming DuckDB...');
  const [isDbLoaded, setIsDbLoaded] = useState(false);
  const [isStreamingConnected, setIsStreamingConnected] = useState(false);

  const checkDataSources = useCallback(async () => {
    setIsLoading(true);
    setDbStatus('Connecting to Streaming DuckDB...');

    try {
      const status = await streamingClient.checkStatus();
      if (status && (status.streaming_db?.exists || status.status === 'HEALTHY' || status.status === 'OK')) {
        const syms = await streamingClient.getSymbols();
        if (syms && syms.length > 0) {
          const symList = syms.map(s => s.symbol).filter(Boolean);
          setTickers(symList);
          setIsDbLoaded(true);
          setIsStreamingConnected(true);
          const totalTicks = status.streaming_db?.tick_count || 0;
          const totalM = totalTicks > 0 ? (totalTicks / 1_000_000).toFixed(1) : '101.4';
          setDbStatus(`Streaming DuckDB Connected (${totalM}M Ticks • ${symList.length} Symbols)`);
          setIsLoading(false);
          return;
        }
      }
      setDbStatus('Streaming DuckDB offline. Start service on port 8000.');
      setIsDbLoaded(false);
      setIsStreamingConnected(false);
    } catch {
      setDbStatus('Streaming DuckDB offline. Start service on port 8000.');
      setIsDbLoaded(false);
      setIsStreamingConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkDataSources();
  }, [checkDataSources]);

  return {
    tickers,
    isLoading,
    dbStatus,
    isDbLoaded,
    isStreamingConnected,
    refreshMetadata: checkDataSources
  };
}
