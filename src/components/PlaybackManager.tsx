import React, { useEffect, useRef } from 'react';
import { usePlaybackStore } from '../store/usePlaybackStore';

const scheduleFrame = (cb: FrameRequestCallback): number => {
  if (typeof requestAnimationFrame !== 'undefined') {
    return requestAnimationFrame(cb);
  }
  return setTimeout(() => cb(performance.now()), 16) as unknown as number;
};

const cancelFrame = (id: number) => {
  if (typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(id);
  } else {
    clearTimeout(id);
  }
};

export function PlaybackManager() {
  const isPaused = usePlaybackStore((state) => state.isPaused);
  const playbackSpeed = usePlaybackStore((state) => state.playbackSpeed);
  const advanceSimulationTime = usePlaybackStore((state) => state.advanceSimulationTime);

  const lastWallTimeRef = useRef<number | null>(null);
  const frameIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (isPaused) {
      lastWallTimeRef.current = null;
      if (frameIdRef.current !== null) {
        cancelFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
      return;
    }

    lastWallTimeRef.current = performance.now();

    const loop = (wallNow: number) => {
      if (lastWallTimeRef.current !== null) {
        const dtWallMs = wallNow - lastWallTimeRef.current;
        lastWallTimeRef.current = wallNow;

        // Cap dt to prevent huge jumps when browser tab is backgrounded/restored (max 250ms per frame)
        const clampedDt = Math.max(0, Math.min(dtWallMs, 250));
        const dtMarketMs = clampedDt * playbackSpeed;

        const currentMarketMs = usePlaybackStore.getState().currentTime;
        if (currentMarketMs !== null) {
          advanceSimulationTime(currentMarketMs + dtMarketMs);
        }
      } else {
        lastWallTimeRef.current = wallNow;
      }

      if (!usePlaybackStore.getState().isPaused) {
        frameIdRef.current = scheduleFrame(loop);
      }
    };

    frameIdRef.current = scheduleFrame(loop);

    return () => {
      if (frameIdRef.current !== null) {
        cancelFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
    };
  }, [isPaused, playbackSpeed, advanceSimulationTime]);

  return null;
}
