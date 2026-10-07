/**
 * Guards the series-primitive contract that caused a permanent repaint loop.
 *
 * THE BUG
 *
 * Every plugin implemented the LWC primitive hook as:
 *
 *     updateAllViews() { this._requestUpdate(); }
 *
 * `updateAllViews()` is a *notification from* Lightweight Charts, not a request to it.
 * LWC calls it from inside its own draw path:
 *
 *     drawImpl -> updateGui -> syncGuiWithModel -> adjustSizeImpl
 *              -> model._internal_setWidth() -> _internal_updateAllSources()
 *              -> primitive.updateAllViews()
 *
 * `requestUpdate` resolves to `model._internal_fullUpdate()` ->
 * `invalidate(InvalidateMask.full())`. So asking for a redraw from inside a redraw
 * schedules another draw, which calls `updateAllViews()` again. The result is a
 * permanent repaint loop at display refresh rate with nothing changing on screen.
 *
 * Measured on the M4 with all charts idle and the simulator PAUSED: every chart canvas
 * repainted every frame, GPU process ~38%, M4 GPU ~40%, and hiding the chart container
 * collapsed it to ~22%. Removing the repaint request from all six plugins is what fixes it.
 *
 * This mattered because only 2 of the 6 plugins were fixed first, and the loop survived
 * through the other four -- SessionShadingPlugin is attached to every chart, so the
 * symptom was visible even with an idle, empty chart.
 *
 * WHAT IS TESTED HERE
 *   1. Behavioural: real LWC + all six real plugins must SETTLE when driven idle.
 *   2. Non-vacuous: a deliberately looping primitive must NOT settle, proving (1) can fail.
 *   3. Per-plugin: each plugin's updateAllViews must not invoke its requestUpdate.
 *   4. Each plugin must still request updates for genuine data changes.
 */
import { describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createChart } from 'lightweight-charts';
import { TradePlugin } from '../../src/lib/TradePlugin';
import { VolumeProfilePlugin } from '../../src/lib/VolumeProfilePlugin';
import { SessionShadingPlugin } from '../../src/lib/SessionShading';
import { HorizontalRayPlugin } from '../../src/lib/HorizontalRayPlugin';
import { RectanglePlugin } from '../../src/lib/RectanglePlugin';
import { BoundaryLinePlugin } from '../../src/lib/BoundaryLinePlugin';

// --------------------------------------------------------------------------- helpers

function makeContainer(w = 800, h = 400) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: h, configurable: true });
  el.getBoundingClientRect = () =>
    ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as any;
  document.body.appendChild(el);
  return el;
}

const BARS = Array.from({ length: 120 }, (_, i) => ({
  time: (1700000000 + i * 300) as any,
  open: 100 + (i % 20),
  high: 101 + (i % 20),
  low: 99 + (i % 20),
  close: 100.5 + (i % 20),
}));

/** Replaces rAF with a hand-cranked queue so frames can be driven deterministically. */
function installRafCounter() {
  const scheduled: FrameRequestCallback[] = [];
  let count = 0;
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    count++;
    scheduled.push(cb);
    return count;
  };
  (window as any).cancelAnimationFrame = () => {};
  return { scheduled };
}

/**
 * Drains the queue n times, returning how many repaints the chart requested on each
 * frame. A "1" on every frame means the chart is repainting itself forever.
 */
function driveFrames(n: number, scheduled: FrameRequestCallback[]): number[] {
  const perFrame: number[] = [];
  for (let f = 0; f < n; f++) {
    const pending = scheduled.slice();
    scheduled.length = 0;
    for (const cb of pending) {
      try {
        cb((f + 1) * 16.67);
      } catch {
        /* drawing can throw in jsdom edge cases; irrelevant to scheduling */
      }
    }
    perFrame.push(scheduled.length);
  }
  return perFrame;
}

/** Mirrors useChartPlugins: all six attach to every chart. */
function attachAllPlugins(series: any) {
  series.attachPrimitive(new SessionShadingPlugin('1H', false));
  series.attachPrimitive(new VolumeProfilePlugin());
  series.attachPrimitive(new HorizontalRayPlugin());
  series.attachPrimitive(new RectanglePlugin());
  series.attachPrimitive(new TradePlugin());
  series.attachPrimitive(new BoundaryLinePlugin(null));
}

/** Minimal stand-ins: `attached` only stores these. */
function attach(plugin: any, requestUpdate: () => void) {
  plugin.attached({
    chart: { timeScale: () => ({ timeToCoordinate: () => null }) },
    series: { priceToCoordinate: () => null },
    requestUpdate,
  } as any);
}

// ------------------------------------------------------------------------ behavioural

describe('series primitives must not repaint the chart from inside a draw', () => {
  it('real chart + all six real plugins settles when idle', () => {
    const { scheduled } = installRafCounter();
    const container = makeContainer();
    const chart = createChart(container, { timeScale: { timeVisible: true } });
    const series: any = chart.addCandlestickSeries();
    series.setData(BARS);
    attachAllPlugins(series);

    const frames = driveFrames(15, scheduled);

    // The first frames legitimately draw (initial layout). Anything that is still asking
    // for a repaint once settled is the loop.
    expect(frames.slice(-5)).toEqual([0, 0, 0, 0, 0]);

    chart.remove();
  });

  it('a looping primitive does NOT settle — proving the assertion above can fail', () => {
    const { scheduled } = installRafCounter();
    const container = makeContainer();
    const chart = createChart(container, { timeScale: { timeVisible: true } });
    const series: any = chart.addCandlestickSeries();
    series.setData(BARS);

    // Exactly the shape of the original bug.
    series.attachPrimitive({
      _requestUpdate: () => {},
      attached({ requestUpdate }: any) {
        this._requestUpdate = requestUpdate;
      },
      detached() {},
      paneViews: () => [{ renderer: () => ({ draw: () => {} }), zOrder: () => 'top' as const }],
      updateAllViews() {
        this._requestUpdate();
      },
    } as any);

    const frames = driveFrames(15, scheduled);

    // Every frame requests another repaint: the loop.
    expect(frames.every((n) => n === 1)).toBe(true);
    expect(frames.slice(-5)).not.toEqual([0, 0, 0, 0, 0]);

    chart.remove();
  });
});

// ------------------------------------------------------------------- per-plugin contract

describe('each plugin: updateAllViews is inert, real changes still invalidate', () => {
  it('SessionShadingPlugin', () => {
    const plugin = new SessionShadingPlugin('1H', false);
    const requestUpdate = vi.fn();
    attach(plugin, requestUpdate);

    plugin.updateAllViews();
    expect(requestUpdate).not.toHaveBeenCalled(); // the loop
    expect(plugin._cache).toBeNull(); // but the cached projections are still dropped

    plugin.setConfig('1H', true);
    expect(requestUpdate).toHaveBeenCalled(); // a real change still repaints
  });

  it('HorizontalRayPlugin', () => {
    const plugin = new HorizontalRayPlugin();
    const requestUpdate = vi.fn();
    attach(plugin, requestUpdate);

    plugin.updateAllViews();
    expect(requestUpdate).not.toHaveBeenCalled();
  });

  it('RectanglePlugin', () => {
    const plugin = new RectanglePlugin();
    const requestUpdate = vi.fn();
    attach(plugin, requestUpdate);

    plugin.updateAllViews();
    expect(requestUpdate).not.toHaveBeenCalled();
  });

  it('BoundaryLinePlugin', () => {
    const plugin = new BoundaryLinePlugin(null);
    const requestUpdate = vi.fn();
    attach(plugin, requestUpdate);

    plugin.updateAllViews();
    expect(requestUpdate).not.toHaveBeenCalled();

    plugin.setBoundaryTime('2026-09-08 14:00:00');
    expect(requestUpdate).toHaveBeenCalled();
  });

  it('TradePlugin', () => {
    const plugin = new TradePlugin();
    const requestUpdate = vi.fn();
    attach(plugin, requestUpdate);

    plugin.updateAllViews();
    expect(requestUpdate).not.toHaveBeenCalled();

    plugin.setItems([{ id: 'x', price: 100 } as any]);
    expect(requestUpdate).toHaveBeenCalled();
  });

  it('VolumeProfilePlugin', () => {
    const plugin = new VolumeProfilePlugin();
    const requestUpdate = vi.fn();
    attach(plugin, requestUpdate);

    plugin.updateAllViews();
    expect(requestUpdate).not.toHaveBeenCalled();

    plugin.setData([{ time: 1, open: 1, high: 2, low: 0, close: 1.5, volume: 10 } as any]);
    expect(requestUpdate).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------
// Enumeration guard.
//
// The original fix covered 2 of the 6 plugins and the loop survived, because
// useChartPlugins attaches ALL of them to every chart -- so one missed plugin is enough
// to pin an entire chart at 100% repaint. Every list in this file is written by hand,
// which means adding a seventh plugin would silently reopen the bug: the behavioural
// test above would still pass, because it only attaches the six it knows about.
//
// This test reads the source tree and fails if a new ISeriesPrimitive implementation
// appears that no test here covers. The fix for a failure is to add the plugin to the
// lists above AND make its updateAllViews inert -- not to add it to this array alone.
describe('enumeration guard: every ISeriesPrimitive implementation is covered above', () => {
  const COVERED = [
    'BoundaryLinePlugin',
    'HorizontalRayPlugin',
    'RectanglePlugin',
    'SessionShadingPlugin',
    'TradePlugin',
    'VolumeProfilePlugin',
  ];

  it('found the same six primitives in src/ that this file tests, and none extra', () => {
    const files = execSync('grep -rl "implements ISeriesPrimitive<" src/', {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    // The concrete series primitives are declared as `implements ISeriesPrimitive<Time>`.
    // The pane renderer / pane view / axis view sub-interfaces are different types and do
    // not have the updateAllViews hook, so the `<` is what separates the two.
    const found: string[] = [];
    for (const file of files) {
      for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
        const match = /^export class (\w+) implements ISeriesPrimitive</.exec(line.trim());
        if (match) found.push(match[1]);
      }
    }

    expect(found.sort()).toEqual([...COVERED].sort());
  });

  it('every covered primitive actually declares updateAllViews', () => {
    for (const name of COVERED) {
      const source = execSync(`grep -rl "export class ${name} " src/lib/`, {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf-8',
      });
      const file = source.trim().split('\n')[0];
      // Matches a real declaration, not the mention of the name in a comment.
      expect(fs.readFileSync(file, 'utf-8')).toMatch(/^\s*updateAllViews\(\)\s*\{/m);
    }
  });
});
