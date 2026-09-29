import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from '../../src/App';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import { streamingClient } from '../../src/lib/streamingClient';

const ctx = vi.hoisted(() => ({ date: '2026-09-22' }));
vi.mock('../../src/hooks/useDatabase', () => ({
  useDatabase: () => ({ tickers: ['TSLA'], isLoading: false, isDbLoaded: true }),
}));
vi.mock('../../src/hooks/useSession', () => {
  const convert = (d: string, _t: string) => d + ' 13:20:00';
  return {
    useSession: () => ({
      selectedDate: ctx.date,
      sessionTicker: 'TSLA',
      entryTime: '09:20',
      isSessionStarted: true,
      getUtcTimeFromEt: convert,
    }),
  };
});
vi.mock('../../src/hooks/useMarketSimulator', () => ({
  useMarketSimulator: () => ({ handleResetToOpen: () => {} }),
}));
vi.mock('../../src/lib/streamingClient', () => ({
  streamingClient: { getTicks: vi.fn() },
}));
vi.mock('../../src/components/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../src/components/SessionConfig', () => ({ SessionConfig: () => null }));
vi.mock('../../src/components/ChartWorkspace', () => ({ ChartWorkspace: () => null }));
vi.mock('../../src/components/PlaybackBar', () => ({ PlaybackBar: () => null }));
vi.mock('../../src/components/PlaybackManager', () => ({ PlaybackManager: () => null }));
vi.mock('../../src/components/TimeAndSales', () => ({ TimeAndSales: () => null }));
vi.mock('../../src/components/ConnectionSetupCard', () => ({ ConnectionSetupCard: () => null }));

describe('Session Tick Loader Race Probe', () => {
  it('PROBE 7: stale tick response must not overwrite the newly selected date', async () => {
    usePlaybackStore.getState().reset();
    const pending: { date: string; resolve: any }[] = [];
    vi.mocked(streamingClient.getTicks).mockImplementation(
      (_sym, opts) =>
        new Promise((resolve) => pending.push({ date: opts!.startTime!.slice(0, 10), resolve }))
    );
    const h = render(<App />);
    ctx.date = '2026-09-15';
    h.rerender(<App />);
    await act(async () => {
      pending
        .filter((x) => x.date === '2026-09-15')
        .forEach((x) =>
          x.resolve([{ time: '2026-09-15 13:30:00', symbol: 'TSLA', price: 200, volume: 1 }])
        );
      await Promise.resolve();
    });
    expect(new Date(usePlaybackStore.getState().currentTime!).toISOString().slice(0, 10)).toBe('2026-09-15');
    await act(async () => {
      pending
        .filter((x) => x.date === '2026-09-22')
        .forEach((x) =>
          x.resolve([{ time: '2026-09-22 13:30:00', symbol: 'TSLA', price: 100, volume: 1 }])
        );
      await Promise.resolve();
    });
    const date = new Date(usePlaybackStore.getState().currentTime!).toISOString();
    expect(date.slice(0, 10)).toBe('2026-09-15');
  });
});
