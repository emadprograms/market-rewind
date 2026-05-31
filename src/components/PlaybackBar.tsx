import React from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw } from 'lucide-react';
import { usePlaybackStore } from '../store/usePlaybackStore';
import { getTzForTicker, getTzLabel } from '../lib/timezones';

interface PlaybackBarProps {
  totalRealized: number;
  totalUnrealized: number;
  isDbLoaded: boolean;
  sessionTicker: string;
  onResetToOpen: () => void;
  minStepMinutes: number;
}

export function PlaybackBar({
  totalRealized,
  totalUnrealized,
  isDbLoaded,
  sessionTicker,
  onResetToOpen,
  minStepMinutes,
}: PlaybackBarProps) {
  const currentTime = usePlaybackStore((state) => state.currentTime);
  const isPaused = usePlaybackStore((state) => state.isPaused);
  const playbackSpeed = usePlaybackStore((state) => state.playbackSpeed);
  const stepMinutes = usePlaybackStore((state) => state.stepMinutes);
  const masterData = usePlaybackStore((state) => state.masterData);

  const setPaused = usePlaybackStore((state) => state.setPaused);
  const setPlaybackSpeed = usePlaybackStore((state) => state.setPlaybackSpeed);
  const setStepMinutes = usePlaybackStore((state) => state.setStepMinutes);
  const stepForward = usePlaybackStore((state) => state.stepForward);
  const stepBackward = usePlaybackStore((state) => state.stepBackward);

  const formatDisplayTime = (ms: number | null) => {
    if (!ms) return '--:--:--';
    const tz = getTzForTicker(sessionTicker);
    const label = getTzLabel(tz);

    const date = new Date(ms);
    return date.toLocaleString('en-US', { 
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }) + ` ${label}`;
  };

  const togglePlay = () => setPaused(!isPaused);

  return (
    <div className="playback-bar" style={{ paddingLeft: '16px' }}>
      
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px', 
        fontSize: '0.75rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
        marginRight: '20px', paddingRight: '20px', borderRight: '1px solid rgba(255,255,255,0.1)'
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

      <div className="time-display">
        {formatDisplayTime(currentTime)}
      </div>

      <div className="playback-controls">
        <button className="btn-icon" onClick={stepBackward}><SkipBack size={20} /></button>
        <button className="btn-primary" onClick={togglePlay} disabled={!isDbLoaded || masterData.length === 0}>
          {!isPaused ? <Pause size={20} /> : <Play size={20} />}
          {!isPaused ? 'PAUSE' : 'PLAY'}
        </button>
        <button className="btn-icon" onClick={stepForward}><SkipForward size={20} /></button>
        <button className="btn-icon" onClick={onResetToOpen} title="Reset to Market Open"><RotateCcw size={20} /></button>
      </div>

       <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
        <span style={{fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.05em'}}>STEP</span>
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


      <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
        <span style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>SPEED</span>
        <select value={playbackSpeed} onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))} style={{width: 'auto'}}>
          <option value={0.5}>0.5x</option>
          <option value={1}>1.0x</option>
          <option value={2}>2.0x</option>
          <option value={5}>5.0x</option>
          <option value={10}>10.0x</option>
        </select>
      </div>
    </div>
  );
}
