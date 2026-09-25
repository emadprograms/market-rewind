import React from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw, ListFilter, Zap } from 'lucide-react';
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
  const stepMinutes = usePlaybackStore((state) => state.stepMinutes);
  const masterData = usePlaybackStore((state) => state.masterData);

  // Tick Replay Store State
  const replayMode = usePlaybackStore((state) => state.replayMode);
  const bufferedTicks = usePlaybackStore((state) => state.bufferedTicks);
  const currentTickIndex = usePlaybackStore((state) => state.currentTickIndex);
  const currentTick = usePlaybackStore((state) => state.currentTick);
  const totalTicks = usePlaybackStore((state) => state.totalTicks);

  const setPaused = usePlaybackStore((state) => state.setPaused);
  const setPlaybackSpeed = usePlaybackStore((state) => state.setPlaybackSpeed);
  const setStepMinutes = usePlaybackStore((state) => state.setStepMinutes);
  const setReplayMode = usePlaybackStore((state) => state.setReplayMode);
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

  const togglePlay = () => setPaused(!isPaused);

  const canPlay = replayMode === 'tick' ? bufferedTicks.length > 0 : (isDbLoaded && masterData.length > 0);

  return (
    <div className="playback-bar" style={{ paddingLeft: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
      
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

      {/* Mode Selector Pill: TICK vs BAR */}
      <div style={{
        display: 'flex',
        backgroundColor: 'rgba(0,0,0,0.3)',
        borderRadius: '4px',
        padding: '2px',
        border: '1px solid #2a2e39',
      }}>
        <button
          onClick={() => setReplayMode('tick')}
          style={{
            padding: '2px 8px',
            fontSize: '10px',
            fontWeight: 700,
            borderRadius: '2px',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: replayMode === 'tick' ? '#2962ff' : 'transparent',
            color: replayMode === 'tick' ? '#ffffff' : '#787b86',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
          }}
          title="Tick-by-tick streaming replay mode"
        >
          <Zap size={10} />
          TICK
        </button>
        <button
          onClick={() => setReplayMode('bar')}
          style={{
            padding: '2px 8px',
            fontSize: '10px',
            fontWeight: 700,
            borderRadius: '2px',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: replayMode === 'bar' ? '#2962ff' : 'transparent',
            color: replayMode === 'bar' ? '#ffffff' : '#787b86',
          }}
          title="Aggregated bar-by-bar replay mode"
        >
          BAR
        </button>
      </div>

      {/* Current Replay Time Display */}
      <div className="time-display" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', minWidth: '125px' }}>
        {formatDisplayTime(currentTime)}
      </div>

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
          title={replayMode === 'tick' ? 'Step 1 Tick Backward' : 'Step Backward'}
        >
          <SkipBack size={18} />
        </button>
        <button 
          className="btn-primary" 
          onClick={togglePlay} 
          disabled={!canPlay}
          style={{ padding: '4px 12px', fontSize: '11px', fontWeight: 700 }}
        >
          {!isPaused ? <Pause size={16} /> : <Play size={16} />}
          {!isPaused ? 'PAUSE' : 'PLAY'}
        </button>
        <button 
          className="btn-icon" 
          onClick={stepForward} 
          title={replayMode === 'tick' ? 'Step 1 Tick Forward' : 'Step Forward'}
        >
          <SkipForward size={18} />
        </button>
        <button className="btn-icon" onClick={onResetToOpen} title="Reset to Start"><RotateCcw size={18} /></button>
      </div>

      {/* Scrubber slider for Tick Replay */}
      {replayMode === 'tick' && totalTicks > 0 && (
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

      {/* Bar step size (when in bar mode) */}
      {replayMode === 'bar' && (
        <div style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
          <span style={{fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600}}>STEP</span>
          <select 
            value={stepMinutes} 
            onChange={(e) => setStepMinutes(parseInt(e.target.value))}
            style={{width: 'auto', padding: '2px 4px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-green)', background: 'rgba(0,0,0,0.2)'}}
          >
            <option value={minStepMinutes}>Auto ({minStepMinutes >= 1440 ? '1D' : minStepMinutes >= 60 ? `${minStepMinutes / 60}H` : `${minStepMinutes}m`})</option>
            <option value="1">1m</option>
            <option value="5">5m</option>
            <option value="15">15m</option>
            <option value="30">30m</option>
            <option value="60">1 H</option>
            <option value="1440">1 D</option>
          </select>
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
