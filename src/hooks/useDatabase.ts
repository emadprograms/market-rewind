import { useState, useEffect, useCallback } from 'react';
import { initDB, fetchTickers, loadDatabaseFromFile } from '../lib/db';

export function useDatabase() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState('Checking storage...');
  const [isDbLoaded, setIsDbLoaded] = useState(false);

  const loadMetaData = useCallback(async () => {
    try {
      const t = await fetchTickers();
      if (t.length > 0) {
        setTickers(t);
        setIsDbLoaded(true);
        setDbStatus(`${t.length} Tickers active`);
      } else {
        setDbStatus('Database is empty (0 tickers found).');
        setIsDbLoaded(false);
      }
    } catch (e) {
      setDbStatus('Database error. Requires a valid file.');
      setIsDbLoaded(false);
    }
  }, []);

  const checkLocalDatabase = useCallback(async () => {
    setIsLoading(true);
    setDbStatus('Checking local storage...');
    try {
      const db = await initDB();
      if (db) {
        await loadMetaData();
      } else {
        setDbStatus('No data. Please upload market_data.db');
        setIsDbLoaded(false);
      }
    } catch (e) {
      setDbStatus('No data. Please upload market_data.db');
      setIsDbLoaded(false);
    } finally {
      setIsLoading(false);
    }
  }, [loadMetaData]);

  useEffect(() => {
    checkLocalDatabase();
  }, [checkLocalDatabase]);

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
    handleFileUpload,
    refreshMetadata: loadMetaData
  };
}
