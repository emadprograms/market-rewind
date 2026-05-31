import React from 'react';
import { Play } from 'lucide-react';
import { getTzForTicker, getTzLabel } from '../lib/timezones';

interface SessionConfigProps {
  tickers: string[];
  sessionTicker: string;
  setSessionTicker: (ticker: string) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  entryTime: string;
  setEntryTime: (time: string) => void;
  onStartSession: () => void;
}

export const SessionConfig: React.FC<SessionConfigProps> = ({
  tickers,
  sessionTicker,
  setSessionTicker,
  selectedDate,
  setSelectedDate,
  entryTime,
  setEntryTime,
  onStartSession
}) => {
  return (
    <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="session-card">
        <div style={{ marginBottom: '24px', textAlign: 'center' }}>
          <h2 style={{ color: 'var(--accent-green)', marginBottom: '8px' }}>Configure Session</h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Set your starting parameters to prevent look-ahead bias.</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Trade Ticker</label>
            <select value={sessionTicker} onChange={(e) => setSessionTicker(e.target.value)} style={{ fontSize: '1rem', padding: '10px' }}>
              {tickers.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Target Date</label>
            <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={{ fontSize: '1rem', padding: '10px' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Start Time ({getTzLabel(getTzForTicker(sessionTicker))})
            </label>
            <input type="time" value={entryTime} onChange={(e) => setEntryTime(e.target.value)} style={{ fontSize: '1rem', padding: '10px' }} />
          </div>
          <button className="btn-primary" onClick={onStartSession} style={{ padding: '12px', fontSize: '1rem', marginTop: '8px', justifyContent: 'center' }}>
            <Play size={20} fill="currentColor" /> Initialize Market Simulator
          </button>
        </div>
      </div>
    </div>
  );
};
