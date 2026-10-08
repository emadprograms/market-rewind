import React, { useMemo, useState, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, RotateCcw, ListFilter } from 'lucide-react';
import { usePlaybackStore, isoToMs } from '../store/usePlaybackStore';
import { getTzForTicker, getTzLabel, getUtcTimeFromEt } from '../lib/timezones';

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
  const totalTicks = usePlaybackStore((state) => state.totalTicks);

  const setPaused = usePlaybackStore((state) => state.setPaused);
  const setPlaybackSpeed = usePlaybackStore((state) => state.setPlaybackSpeed);
  const stepForward = usePlaybackStore((state) => state.stepForward);
  const stepBackward = usePlaybackStore((state) => state.stepBackward);
  const stepMinutes = usePlaybackStore((state) => state.stepMinutes);
  const setStepMinutes = usePlaybackStore((state) => state.setStepMinutes);
  const seekTickIndex = usePlaybackStore((state) => state.seekTickIndex);
  const seekTickTime = usePlaybackStore((state) => state.seekTickTime);

  // Persisted session bounds across seeks (REV-SCRUB-01 / PROBE 6)
  const sessionBoundsRef = useRef<{
    sessionKey: string;
    min: number | null;
    max: number | null;
  }>({ sessionKey: '', min: null, max: null });

  const { minTime, maxTime } = useMemo(() => {
    let min: number | null = null;
    let max: number | null = null;

    if (bufferedTicks.length > 0) {
      min = isoToMs(bufferedTicks[0].time);
      max = isoToMs(bufferedTicks[bufferedTicks.length - 1].time);
    } else if (masterData.length > 0) {
      min = isoToMs(masterData[0].time);
      max = isoToMs(masterData[masterData.length - 1].time);
    }

    if (currentTime !== null) {
      if (min !== null) min = Math.min(min, currentTime);
      else min = currentTime;

      if (max !== null) max = Math.max(max, currentTime);
      else max = currentTime;
    }

    const dataTime = bufferedTicks[0]?.time ?? masterData[0]?.time ?? (currentTime !== null ? new Date(currentTime).toISOString() : '');
    const dateStr = dataTime ? dataTime.replace('T', ' ').split(' ')[0] : '';
    const currentSessionKey = `${sessionTicker}_${dateStr}`;

    if (!dataTime && currentTime === null) {
      sessionBoundsRef.current = { sessionKey: '', min: null, max: null };
    } else if (currentSessionKey !== sessionBoundsRef.current.sessionKey) {
      sessionBoundsRef.current = {
        sessionKey: currentSessionKey,
        min: min !== null ? Math.floor(min / 1000) * 1000 : null,
        max: max !== null ? Math.floor(max / 1000) * 1000 : null,
      };
    } else {
      if (min !== null) {
        if (sessionBoundsRef.current.min !== null) {
          min = Math.min(min, sessionBoundsRef.current.min);
        }
        sessionBoundsRef.current.min = Math.floor(min / 1000) * 1000;
      }
      if (max !== null) {
        if (sessionBoundsRef.current.max !== null) {
          max = Math.max(max, sessionBoundsRef.current.max);
        }
        sessionBoundsRef.current.max = Math.floor(max / 1000) * 1000;
      }
    }

    if (min !== null && max !== null) {
      min = Math.floor(min / 1000) * 1000;
      max = Math.floor(max / 1000) * 1000;
      if (min >= max) {
        max = min + 60000;
      }
    }

    return { minTime: min, maxTime: max };
  }, [bufferedTicks, masterData, currentTime, sessionTicker]);

  const [jumpTimeText, setJumpTimeText] = useState('');

  const sliderValue = (minTime !== null && maxTime !== null && currentTime !== null)
    ? Math.max(minTime, Math.min(currentTime, maxTime))
    : (minTime ?? 0);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = parseInt(e.target.value, 10);
    const val = Math.floor(rawVal / 1000) * 1000;
    seekTickTime(val);
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = jumpTimeText.trim();
    if (!trimmed) return;
    const parts = trimmed.split(':');
    if (parts.length >= 2) {
      const hh = parts[0].padStart(2, '0');
      const mm = parts[1].padStart(2, '0');
      const ss = parts[2] ? parts[2].padStart(2, '0') : '00';
      const baseMs = currentTime || minTime || Date.now();
      const tz = getTzForTicker(sessionTicker);
      const dateStr = new Date(baseMs).toLocaleDateString('en-CA', { timeZone: tz });
      const targetUtcStr = getUtcTimeFromEt(dateStr, `${hh}:${mm}`);
      let targetMs = new Date(targetUtcStr.replace(' ', 'T') + 'Z').getTime();
      targetMs += parseInt(ss, 10) * 1000;
      if (!isNaN(targetMs)) {
        seekTickTime(targetMs);
        setJumpTimeText('');
      }
    }
  };

  const formatTimeOnly = (ms: number | null) => {
    if (!ms) return '--:--:--';
    const tz = getTzForTicker(sessionTicker);
    return new Date(ms).toLocaleString('en-US', { 
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

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
    if (isPaused && minTime !== null && maxTime !== null && currentTime !== null && currentTime >= maxTime) {
      seekTickTime(minTime);
      setPaused(false);
    } else if (isPaused && currentTickIndex >= totalTicks - 1 && totalTicks > 0) {
      seekTickIndex(0);
      setPaused(false);
    } else {
      setPaused(!isPaused);
    }
  };

  const currentDateStr = useMemo(() => {
    if (!currentTime) return '';
    const tz = getTzForTicker(sessionTicker);
    return new Date(currentTime).toLocaleDateString('en-CA', { timeZone: tz });
  }, [currentTime, sessionTicker]);

  const canPlay = bufferedTicks.length > 0 || (
    Boolean(currentDateStr) && masterData.some((b) => b.time.startsWith(currentDateStr))
  );

  return (
    <div 
      className="playback-bar" 
      data-ticks-loading={isLoadingTicks ? "true" : "false"}
      data-total-ticks={totalTicks}
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

      {/* Playback Transport Controls */}
      <div className="playback-controls" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <button 
          className="btn-icon" 
          onClick={stepBackward} 
          data-testid="step-backward-btn"
          title={stepMinutes === 0 ? "Step 1 Tick Backward" : `Step ${stepMinutes}m Backward`}
          aria-label={stepMinutes === 0 ? "Step 1 Tick Backward" : `Step ${stepMinutes}m Backward`}
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
          data-testid="step-forward-btn"
          title={stepMinutes === 0 ? "Step 1 Tick Forward" : `Step ${stepMinutes}m Forward`}
          aria-label={stepMinutes === 0 ? "Step 1 Tick Forward" : `Step ${stepMinutes}m Forward`}
        >
          <SkipForward size={18} />
        </button>
        <button className="btn-icon" onClick={onResetToOpen} title="Reset to Start"><RotateCcw size={18} /></button>

        {/* Step Size Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '4px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 600 }}>STEP</span>
          <select 
            data-testid="playback-step-select"
            aria-label="Playback step size"
            value={stepMinutes} 
            onChange={(e) => setStepMinutes(parseFloat(e.target.value))}
            style={{
              width: 'auto',
              padding: '2px 4px',
              fontSize: '11px',
              fontFamily: 'JetBrains Mono, monospace',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid #2a2e39',
              borderRadius: '3px',
              color: '#d1d4dc',
              cursor: 'pointer'
            }}
          >
            <option value={1}>1m</option>
            <option value={2}>2m</option>
            <option value={3}>3m</option>
            <option value={5}>5m</option>
            <option value={10}>10m</option>
            <option value={15}>15m</option>
            <option value={30}>30m</option>
            <option value={0}>1 tick</option>
          </select>
        </div>
      </div>

      {/* Time-based scrubber slider */}
      {canPlay && minTime !== null && maxTime !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '140px', maxWidth: '420px' }}>
          <input
            type="range"
            data-testid="playback-time-slider"
            aria-label="Time-based playback slider"
            min={minTime}
            max={maxTime}
            step={1000}
            value={sliderValue}
            onChange={handleSliderChange}
            title={`Replay Time: ${formatTimeOnly(sliderValue)} (${currentTickIndex >= 0 ? currentTickIndex + 1 : 0}/${totalTicks} ticks)`}
            style={{ width: '100%', accentColor: '#2962ff', cursor: 'pointer' }}
          />
          <span 
            data-testid="playback-time-label"
            title={`Current: ${formatTimeOnly(sliderValue)} | End: ${formatTimeOnly(maxTime)}`}
            style={{ fontSize: '11px', color: '#787b86', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}
          >
            {formatTimeOnly(sliderValue)} / {formatTimeOnly(maxTime)}
          </span>
          <form 
            onSubmit={handleJumpSubmit}
            style={{ display: 'flex', alignItems: 'center' }}
          >
            <input
              type="text"
              data-testid="time-jump-input"
              aria-label="Jump to time HH:MM:SS"
              placeholder="HH:MM:SS"
              value={jumpTimeText}
              onChange={(e) => setJumpTimeText(e.target.value)}
              style={{
                width: '64px',
                height: '20px',
                padding: '2px 4px',
                fontSize: '10px',
                fontFamily: 'JetBrains Mono, monospace',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid #2a2e39',
                borderRadius: '3px',
                color: '#d1d4dc',
                textAlign: 'center',
              }}
              title="Jump to specific time (e.g. 09:30:00 or 10:15)"
            />
          </form>
          {/* Subtle tick counter display */}
          <span 
            data-testid="tick-counter" 
            title="Current tick / total buffered ticks"
            style={{ fontSize: '9px', color: '#555865', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}
          >
            {currentTickIndex >= 0 ? currentTickIndex + 1 : 0}/{totalTicks}
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
