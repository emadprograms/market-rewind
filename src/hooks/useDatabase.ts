import { useState, useEffect, useCallback } from 'react';
import { initDB, fetchTickers, loadDatabaseFromFile } from '../lib/db';
import { streamingClient } from '../lib/streamingClient';

export function useDatabase() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState('Checking data sources...');
  const [isDbLoaded, setIsDbLoaded] = useState(false);
  const [isStreamingConnected, setIsStreamingConnected] = useState(false);

  const loadMetaData = useCallback(async () => {
    try {
      const t = await fetchTickers();
      if (t.length > 0) {
        setTickers(t);
        setIsDbLoaded(true);
        setDbStatus(`${t.length} Tickers active (Local SQLite)`);
      } else {
        setDbStatus('Database is empty (0 tickers found).');
        setIsDbLoaded(false);
      }
    } catch (e) {
      setDbStatus('Database error. Requires a valid file.');
      setIsDbLoaded(false);
    }
  }, []);

  const checkDataSources = useCallback(async () => {
    setIsLoading(true);
    setDbStatus('Connecting to Streaming DuckDB...');

    // 1. Try DuckDB Streaming Service first
    try {
      const status = await streamingClient.checkStatus();
      if (status && status.streaming_db.exists) {
        const syms = await streamingClient.getSymbols();
        if (syms && syms.length > 0) {
          const symList = syms.map(s => s.symbol);
          setTickers(symList);
          setIsDbLoaded(true);
          setIsStreamingConnected(true);
          const totalM = (status.streaming_db.tick_count / 1_000_000).toFixed(1);
          setDbStatus(`Streaming DuckDB Connected (${totalM}M Ticks • ${syms.length} Symbols)`);
          setIsLoading(false);
          return;
        }
      }
    } catch {
      // Fall through to local storage
    }

    // 2. Fallback to Local OPFS SQLite
    setDbStatus('Checking local storage...');
    try {
      const db = await initDB();
      if (db) {
        await loadMetaData();
      } else {
        setDbStatus('No data. Connect streaming service or upload market_data.db');
        setIsDbLoaded(false);
      }
    } catch (e) {
      setDbStatus('No data. Connect streaming service or upload market_data.db');
      setIsDbLoaded(false);
    } finally {
      setIsLoading(false);
    }
  }, [loadMetaData]);

  useEffect(() => {
    checkDataSources();
  }, [checkDataSources]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      setIsLoading(true);
      setDbStatus('Loading file into memory...');
      await loadDatabaseFromFile(file);
      await loadMetaData();
    } catch (err) {
      setDbStatus('Upload failed. Must be a valid SQLite file.');
      setIsDbLoaded(false);
    } finally {
      setIsLoading(false);
    }
  }, [loadMetaData]);

  return {
    tickers,
    isLoading,
    dbStatus,
    isDbLoaded,
    isStreamingConnected,
    handleFileUpload,
    refreshMetadata: checkDataSources
  };
}
