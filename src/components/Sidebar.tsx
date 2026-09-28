import React, { useState } from 'react';
import { Activity, Database, Calendar as CalendarIcon, RotateCcw, ExternalLink, Zap } from 'lucide-react';
import { ConnectionModal } from './ConnectionModal';

interface SidebarProps {
  dbStatus: string;
  isDbLoaded: boolean;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  isSessionStarted: boolean;
  onEndSession: () => void;
  layoutMode: string;
  setLayoutMode: (mode: string) => void;
  serviceUrl?: string;
  onUpdateServiceUrl?: (url: string) => void;
  onResetServiceUrl?: () => void;
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
  selectedDate,
  setSelectedDate,
  isSessionStarted,
  onEndSession,
  layoutMode,
  setLayoutMode,
  serviceUrl,
  onUpdateServiceUrl,
  onResetServiceUrl
}) => {
  const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);

  return (
    <>
      <aside className="sidebar">
        <div className="logo" title="Market Rewind">
          <Activity size={24} color="var(--accent-green)" />
        </div>

        <button 
          type="button"
          className={`status-badge ${isDbLoaded ? 'status-online' : ''}`} 
          title={`${dbStatus}\nClick to configure DuckDB service connection`}
          onClick={() => setIsConnectionModalOpen(true)}
          style={{ 
            padding: '8px', 
            borderRadius: '50%', 
            border: 'none',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            backgroundColor: isDbLoaded ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            color: isDbLoaded ? 'var(--accent-green)' : 'var(--accent-red)',
            cursor: 'pointer',
            transition: 'transform 0.15s, background-color 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          {isDbLoaded ? <Zap size={18} /> : <Database size={18} />}
        </button>

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
          <a href="https://github.com/emadprograms/market-rewind" target="_blank" rel="noopener noreferrer" title="Source Code">
            <ExternalLink size={16} color="var(--text-secondary)" />
          </a>
        </div>
      </aside>

      <ConnectionModal
        isOpen={isConnectionModalOpen}
        onClose={() => setIsConnectionModalOpen(false)}
        currentUrl={serviceUrl || ''}
        isDbLoaded={isDbLoaded}
        dbStatus={dbStatus}
        onSave={(newUrl) => onUpdateServiceUrl?.(newUrl)}
        onReset={() => onResetServiceUrl?.()}
      />
    </>
  );
};
