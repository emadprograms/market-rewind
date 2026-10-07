/**
 * RED-GREEN budget tests — Time & Sales per-render element visits.
 *
 * Oracle classification: **derived**. The assertion derives from an independent cost
 * budget (elements touched per played-back frame must be bounded by what is *rendered*),
 * not from the current implementation's output. Any implementation that touches
 * O(buffer) elements per frame fails; any implementation that touches O(visible) passes,
 * so the test does not prescribe a particular optimization.
 *
 * Why element visits instead of elapsed time: wall-clock assertions are flaky under CI
 * load and would make this test a heisenbug. Element visits are deterministic.
 *
 * Why STEADY STATE: building a per-symbol index once when the buffer changes is O(N) and
 * is the same cost class the store already pays in `setBufferedTicks`. That is acceptable.
 * The defect is paying O(N) on every *frame* while the buffer is unchanged, which at 60fps
 * is what pins the CPU. So we warm the buffer, then measure re-renders that only advance
 * the playhead.
 *
 * Background (measured, REVIEW.md M1): the pre-fix implementation visits ~200,000 elements
 * per render at N=100,000 (a full `slice` + a full `filter`) to display the last 80 ticks.
 */
import React from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TimeAndSales } from '../../src/components/TimeAndSales';
import { usePlaybackStore } from '../../src/store/usePlaybackStore';
import type { MarketTick } from '../../src/types';

const SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMD', 'META', 'AMZN', 'GOOGL'];

interface Counter {
  visits: number;
}

/** Builds ticks where every indexed read is tallied. */
function countingTicks(n: number, counter: Counter): MarketTick[] {
  const real: MarketTick[] = [];
  const start = Date.UTC(2026, 8, 22, 13, 30, 0);
  for (let i = 0; i < n; i++) {
    const price = 500 + Math.sin(i / 97) * 8;
    real.push({
      time: new Date(start + i * 37).toISOString().replace('T', ' ').slice(0, 23),
      price: Number(price.toFixed(4)),
      volume: 1 + ((i * 7919) % 400),
      symbol: SYMBOLS[i % SYMBOLS.length],
      session: 'REG',
      bid: Number((price - 0.05).toFixed(4)),
      ask: Number((price + 0.05).toFixed(4)),
    });
  }
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /^[0-9]+$/.test(prop)) {
        counter.visits += 1;
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as MarketTick[];
}

/**
 * Measures elements touched per *frame* during playback over an `n`-tick buffer.
 *
 * Returns the median per-frame visits, which is robust against the one-off index build
 * and against React's occasional extra render.
 */
async function steadyStateFrameVisits(n: number): Promise<{ median: number; rows: number }> {
  const counter: Counter = { visits: 0 };
  const ticks = countingTicks(n, counter);

  // Inject directly: setBufferedTicks() would rebuild arrays and consume the proxy during
  // setup rather than during render.
  usePlaybackStore.setState({
    bufferedTicks: ticks,
    currentTickIndex: n - 1,
    currentTick: ticks[n - 1],
    totalTicks: n,
    latestTickBySymbol: { SPY: ticks[n - 1] },
  });

  const { container } = render(<TimeAndSales isOpen symbol="SPY" onClose={() => {}} />);

  // Advance the playhead backwards through the buffer (equivalent to scrub/step), which
  // forces re-renders without replacing the buffer itself.
  const samples: number[] = [];
  for (let f = 0; f < 12; f++) {
    const idx = n - 1 - f * 137;
    counter.visits = 0;
    await act(async () => {
      usePlaybackStore.setState({
        currentTickIndex: idx,
        currentTick: ticks[idx] ?? null,
      });
    });
    samples.push(counter.visits);
  }

  const rows = container.querySelectorAll('[data-testid="tape-row"]').length;
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  return { median, rows };
}

describe('TimeAndSales per-frame element budget', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      bufferedTicks: [],
      currentTickIndex: -1,
      currentTick: null,
      totalTicks: 0,
      latestTickBySymbol: {},
    });
  });

  afterEach(() => cleanup());

  it('renders at most the visible window of ticks (behavioural guard)', async () => {
    const { rows } = await steadyStateFrameVisits(10_000);
    // The panel is specified to show the trailing 80 executions.
    expect(rows).toBe(80);
  });

  it('touches O(visible) elements, not O(buffer), per frame', async () => {
    const N = 100_000;
    const { median } = await steadyStateFrameVisits(N);

    // Budget: the panel renders 80 rows. A generous allowance still fails an
    // implementation that copies or scans the whole buffer (~200,000 visits pre-fix).
    const BUDGET = 4_000;
    expect(
      median,
      `expected <= ${BUDGET} element visits per frame over a ${N}-tick buffer, got ${median}. ` +
        'This indicates each render copies or scans the full tick buffer.',
    ).toBeLessThanOrEqual(BUDGET);
  });

  it('per-frame cost does not scale with buffer size', async () => {
    const small = (await steadyStateFrameVisits(10_000)).median;
    cleanup();
    const large = (await steadyStateFrameVisits(100_000)).median;

    // Growing the buffer 10x must not grow per-frame work materially. Pre-fix this
    // ratio is ~10x; post-fix it is ~1x.
    const growth = large / Math.max(small, 1);
    expect(
      growth,
      `10x buffer growth increased per-frame work ${growth.toFixed(1)}x ` +
        `(small=${small}, large=${large}); per-frame cost must be independent of buffer size.`,
    ).toBeLessThanOrEqual(2);
  });
});
