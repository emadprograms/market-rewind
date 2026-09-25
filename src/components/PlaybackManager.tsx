import React, { useEffect, useRef } from 'react';
import { usePlaybackStore } from '../store/usePlaybackStore';

export function PlaybackManager() {
  const isPaused = usePlaybackStore((state) => state.isPaused);
  const playbackSpeed = usePlaybackStore((state) => state.playbackSpeed);
  const tick = usePlaybackStore((state) => state.tick);
  
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isPaused) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    let intervalMs = 1000 / playbackSpeed;
    let ticksPerStep = 1;

    // At high speeds (e.g. 50x, 100x), cap interval at ~30ms (~33fps) and batch ticks per frame
    if (intervalMs < 30) {
      intervalMs = 30;
      ticksPerStep = Math.max(1, Math.round(playbackSpeed / 33));
    }

    timerRef.current = setInterval(() => {
      tick(ticksPerStep);
    }, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, playbackSpeed, tick]);

  return null;
}
