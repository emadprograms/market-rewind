import React from 'react';
import { Activity, Database, UploadCloud, Calendar as CalendarIcon, RotateCcw, HardDrive, ExternalLink } from 'lucide-react';

interface SidebarProps {
  dbStatus: string;
  isDbLoaded: boolean;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  isSessionStarted: boolean;
  onEndSession: () => void;
  layoutMode: string;
  setLayoutMode: (mode: string) => void;
}

const LAYOUTS = [
  { id: '1', class: 'l1' },
  { id: '2v', class: 'l2v' },
  { id: '2h', class: 'l2h' },
  { id: '3', class: 'l3' },
  { id: '3b', class: 'l3b' },
  { id: '3l', class: 'l3l' },
  { id: '3r', class: 'l3r' },
  { id: '3h', class: 'l3h' },
  { id: '3v', class: 'l3v' },
  { id: '4', class: 'l4' }
];

export const Sidebar: React.FC<SidebarProps> = ({
  dbStatus,
  isDbLoaded,
  handleFileUpload,
  selectedDate,
  setSelectedDate,
  isSessionStarted,
  onEndSession,
  layoutMode,
  setLayoutMode
}) => {
  return (
    <aside className="sidebar">
      <div className="logo" title="Market Rewind">
        <Activity size={24} color="var(--accent-green)" />
      </div>

      <div className={`status-badge ${isDbLoaded ? 'status-online' : ''}`} title={dbStatus} style={{ padding: '6px', borderRadius: '50%' }}>
        <Database size={16} />
      </div>

      <label className="upload-zone" title="Load market_data.db" style={{ padding: '8px', cursor: 'pointer', border: 'none' }}>
        <UploadCloud size={20} className="file-icon" />
        <input type="file" accept=".db,.sqlite" onChange={handleFileUpload} style={{ display: 'none' }} />
      </label>

      <div style={{ position: 'relative', width: '24px', height: '24px', cursor: 'pointer' }} title="Target Date">
        <CalendarIcon size={20} style={{ position: 'absolute', top: 2, left: 2, color: 'var(--text-secondary)' }} />
        <input 
          type="date" 
          value={selectedDate} 
          onChange={(e) => setSelectedDate(e.target.value)} 
          disabled={!isSessionStarted} 
          style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} 
        />
      </div>

      {isSessionStarted && (
        <button className="btn-icon" onClick={onEndSession} title="Reset Session">
          <RotateCcw size={18} color="var(--accent-red)" />
        </button>
      )}

      <div style={{ flex: 1 }}></div>

      <div className="layout-selector" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 4px', marginBottom: 'auto', alignItems: 'center' }}>
        {LAYOUTS.map(l => (
          <div 
            key={l.id} 
            className={`layout-icon ${l.class} ${layoutMode === l.id ? 'active' : ''}`}
            onClick={() => setLayoutMode(l.id)}
            title={`Layout ${l.id.toUpperCase()}`}
          >
            {l.id === '1' && <div />}
            {l.id === '2v' && <><div/><div/></>}
            {l.id === '2h' && <><div/><div/></>}
            {l.id.startsWith('3') && <><div/><div/><div/></>}
            {l.id === '4' && <><div/><div/><div/><div/></>}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
        <a href="https://github.com/emadprograms/market-rewind/releases/tag/latest-data" target="_blank" rel="noopener noreferrer" title="Latest Market Data">
          <HardDrive size={16} color="var(--text-secondary)" />
        </a>
        <a href="https://github.com/emadprograms/market-rewind/releases/tag/latest-archive" target="_blank" rel="noopener noreferrer" title="Archive Historical Data">
          <Database size={16} color="var(--text-secondary)" />
        </a>
        <a href="https://github.com/emadprograms/market-rewind" target="_blank" rel="noopener noreferrer" title="Source Code">
          <ExternalLink size={16} color="var(--text-secondary)" />
        </a>
      </div>
    </aside>
  );
};
