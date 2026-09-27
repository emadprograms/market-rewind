import React from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw, ListFilter } from 'lucide-react';
import { usePlaybackStore } from '../store/usePlaybackStore';
import { getTzForTicker, getTzLabel } from '../lib/timezones';

interface PlaybackBarProps {
  totalRealized: number;
  totalUnrealized: number;
  isDbLoaded: boolean;
  sessionTicker: string;
  onResetToOpen: () => void;
  minStepMinutes: number;
  isTapeOpen?: boolean;
  onToggleTape?: () => void;
}

export function PlaybackBar({
  totalRealized,
  totalUnrealized,
  isDbLoaded,
  sessionTicker,
  onResetToOpen,
  minStepMinutes,
  isTapeOpen = false,
  onToggleTape,
}: PlaybackBarProps) {
  const currentTime = usePlaybackStore((state) => state.currentTime);
  const isPaused = usePlaybackStore((state) => state.isPaused);
  const playbackSpeed = usePlaybackStore((state) => state.playbackSpeed);
  const masterData = usePlaybackStore((state) => state.masterData);

  // Tick Replay Store State
  const isLoadingTicks = usePlaybackStore((state) => state.isLoadingTicks);
  const bufferedTicks = usePlaybackStore((state) => state.bufferedTicks);
  const currentTickIndex = usePlaybackStore((state) => state.currentTickIndex);
  const currentTick = usePlaybackStore((state) => state.currentTick);
  const totalTicks = usePlaybackStore((state) => state.totalTicks);

  const setPaused = usePlaybackStore((state) => state.setPaused);
  const setPlaybackSpeed = usePlaybackStore((state) => state.setPlaybackSpeed);
  const stepForward = usePlaybackStore((state) => state.stepForward);
  const stepBackward = usePlaybackStore((state) => state.stepBackward);
  const seekTickIndex = usePlaybackStore((state) => state.seekTickIndex);

  const formatDisplayTime = (ms: number | null) => {
    if (!ms) return '--:--:--';
    const tz = getTzForTicker(sessionTicker);
    const label = getTzLabel(tz);

    const date = new Date(ms);
    const timeStr = date.toLocaleString('en-US', { 
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const msDigits = String(date.getMilliseconds()).padStart(3, '0');
    return `${timeStr}.${msDigits} ${label}`;
  };

  const togglePlay = () => {
    if (isPaused && currentTickIndex >= totalTicks - 1 && totalTicks > 0) {
      seekTickIndex(0);
      setPaused(false);
    } else {
      setPaused(!isPaused);
    }
  };

  const canPlay = bufferedTicks.length > 0 || masterData.length > 0;

  return (
    <div 
      className="playback-bar" 
      data-ticks-loading={isLoadingTicks ? "true" : "false"}
      style={{ paddingLeft: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}
    >
      
      {/* PnL metrics */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px', 
        fontSize: '0.75rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
        marginRight: '12px', paddingRight: '12px', borderRight: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>R:</span>
          <span style={{ color: totalRealized >= 0 ? '#26a69a' : '#ef5350' }}>
            {totalRealized >= 0 ? '+' : ''}{totalRealized.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>U:</span>
          <span style={{ color: totalUnrealized >= 0 ? '#26a69a' : '#ef5350' }}>
            {totalUnrealized >= 0 ? '+' : ''}{totalUnrealized.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Current Replay Time Display */}
      <div className="time-display" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', minWidth: '125px' }}>
        {formatDisplayTime(currentTime)}
      </div>

      {/* Market Closed Warning badge when 0 ticks buffered and no master data */}
      {bufferedTicks.length === 0 && masterData.length === 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '11px',
          padding: '2px 8px',
          backgroundColor: 'rgba(239, 83, 80, 0.15)',
          color: '#ef5350',
          borderRadius: '4px',
          border: '1px solid rgba(239, 83, 80, 0.3)',
          whiteSpace: 'nowrap'
        }}>
          Market Closed / No Data
        </div>
      )}

      {/* Price & Spread Badge */}
      {currentTick && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '11px',
          padding: '2px 8px',
          backgroundColor: 'rgba(41, 98, 255, 0.1)',
          borderRadius: '4px',
          border: '1px solid rgba(41, 98, 255, 0.2)',
        }}>
          <span style={{ color: '#2962ff', fontWeight: 700 }}>${currentTick.price.toFixed(2)}</span>
          {currentTick.bid && currentTick.ask && (
            <span style={{ color: '#787b86', fontSize: '10px' }}>
              ({currentTick.bid.toFixed(2)} / {currentTick.ask.toFixed(2)})
            </span>
          )}
        </div>
      )}

      {/* Playback Transport Controls */}
      <div className="playback-controls" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <button 
          className="btn-icon" 
          onClick={stepBackward} 
          title="Step 1 Tick Backward"
        >
          <SkipBack size={18} />
        </button>
        <button 
          className="btn-primary" 
          onClick={togglePlay} 
          disabled={!canPlay || isLoadingTicks}
          title={!canPlay ? "Market Closed: No data recorded for this date" : undefined}
          style={{ padding: '4px 12px', fontSize: '11px', fontWeight: 700 }}
        >
          {isLoadingTicks ? 'LOADING...' : (!isPaused ? <Pause size={16} /> : <Play size={16} />)}
          {isLoadingTicks ? '' : (!isPaused ? 'PAUSE' : 'PLAY')}
        </button>
        <button 
          className="btn-icon" 
          onClick={stepForward} 
          title="Step 1 Tick Forward"
        >
          <SkipForward size={18} />
        </button>
        <button className="btn-icon" onClick={onResetToOpen} title="Reset to Start"><RotateCcw size={18} /></button>
      </div>

      {/* Scrubber slider for Tick Replay */}
      {totalTicks > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '120px', maxWidth: '300px' }}>
          <input
            type="range"
            min={0}
            max={totalTicks - 1}
            value={currentTickIndex}
            onChange={(e) => seekTickIndex(parseInt(e.target.value, 10))}
            style={{ width: '100%', accentColor: '#2962ff', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '10px', color: '#787b86', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
            {currentTickIndex + 1}/{totalTicks}
          </span>
        </div>
      )}

      {/* Speed Multiplier */}
      <div style={{display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto'}}>
        <span style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>SPEED</span>
        <select 
          value={playbackSpeed} 
          onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))} 
          style={{width: 'auto', padding: '2px 6px', fontSize: '11px', background: 'rgba(0,0,0,0.2)', border: '1px solid #2a2e39'}}
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1.0x</option>
          <option value={2}>2.0x</option>
          <option value={5}>5.0x</option>
          <option value={10}>10.0x</option>
          <option value={25}>25.0x</option>
          <option value={50}>50.0x</option>
          <option value={100}>100.0x</option>
        </select>

        {/* Time & Sales Toggle Button */}
        {onToggleTape && (
          <button
            onClick={onToggleTape}
            className={`btn-icon ${isTapeOpen ? 'active' : ''}`}
            style={{
              padding: '4px 8px',
              backgroundColor: isTapeOpen ? '#2962ff' : 'rgba(0,0,0,0.2)',
              color: isTapeOpen ? '#ffffff' : '#787b86',
              border: '1px solid #2a2e39',
              borderRadius: '4px',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
            }}
            title="Toggle Time & Sales Order Flow Tape"
          >
            <ListFilter size={14} />
            <span>TAPE</span>
          </button>
        )}
      </div>
    </div>
  );
}
