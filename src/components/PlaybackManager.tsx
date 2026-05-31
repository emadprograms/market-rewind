import React, { useEffect, useRef } from 'react';
import { usePlaybackStore } from '../store/usePlaybackStore';

export function PlaybackManager() {
  const isPaused = usePlaybackStore((state) => state.isPaused);
  const playbackSpeed = usePlaybackStore((state) => state.playbackSpeed);
  const tick = usePlaybackStore((state) => state.tick);
  
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isPaused) {
      timerRef.current = setInterval(() => {
        tick();
      }, 1000 / playbackSpeed);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, playbackSpeed, tick]);

  return null;
}
