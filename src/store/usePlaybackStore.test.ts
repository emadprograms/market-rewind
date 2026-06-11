import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaybackStore } from './usePlaybackStore';
import type { RawBar } from '../types';

describe('usePlaybackStore boundaries', () => {
  const mockData: RawBar[] = Array.from({ length: 60 }, (_, i) => ({
    time: `2024-01-01 10:${String(i).padStart(2, '0')}:00`,
    open: 100, high: 100, low: 100, close: 100, volume: 100, session: 'REG'
  }));

  beforeEach(() => {
    usePlaybackStore.setState({
      currentTime: new Date('2024-01-01 10:00:00Z').getTime(),
      stepMinutes: 5,
      masterData: mockData,
      isPaused: true
    });
  });

  it('stepForward jumps to the next stepMinutes boundary', () => {
    const store = usePlaybackStore.getState();
    
    // 10:00 -> 10:05
    store.stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(new Date('2024-01-01 10:05:00Z').getTime());

    // 10:05 -> 10:10
    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(new Date('2024-01-01 10:10:00Z').getTime());
  });

  it('stepForward from non-boundary time aligns to next boundary', () => {
    usePlaybackStore.setState({ currentTime: new Date('2024-01-01 10:02:00Z').getTime() });
    
    // 10:02 with 5m step should go to 10:05
    usePlaybackStore.getState().stepForward();
    expect(usePlaybackStore.getState().currentTime).toBe(new Date('2024-01-01 10:05:00Z').getTime());
  });

  it('stepBackward jumps to the previous stepMinutes boundary', () => {
    usePlaybackStore.setState({ currentTime: new Date('2024-01-01 10:10:00Z').getTime() });
    
    // 10:10 -> 10:05
    usePlaybackStore.getState().stepBackward();
    expect(usePlaybackStore.getState().currentTime).toBe(new Date('2024-01-01 10:05:00Z').getTime());
  });

  it('stepBackward from non-boundary time aligns to previous boundary', () => {
    usePlaybackStore.setState({ currentTime: new Date('2024-01-01 10:07:00Z').getTime() });
    
    // 10:07 with 5m step should go to 10:05
    usePlaybackStore.getState().stepBackward();
    expect(usePlaybackStore.getState().currentTime).toBe(new Date('2024-01-01 10:05:00Z').getTime());
  });
});
