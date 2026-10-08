import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as ts from 'typescript';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  heapUsedBytes,
  installFreezeProbe,
  isPlaying,
  measureStoreSeekBy,
  measureStoreSeekTo,
  readFreezeProbe,
  seekToMs,
  seriesBarTimes,
} from '../regression/chart/freezeProbeInPage';

/**
 * The freeze probe's in-page functions run inside the browser after Playwright serializes them, so
 * a closed-over variable becomes `ReferenceError: X is not defined` **only at E2E runtime** — on a
 * machine with a browser and a tick lake. That cost a full verification cycle once already
 * (`readProbe` closed over its own `reset` parameter instead of passing it).
 *
 * Part 1 exercises the functions here in jsdom, which catches the logic bugs. Part 2 lints their
 * ASTs for free variables and the spec for in-page closure bodies, which catches the
 * serialization bugs — neither needs a browser.
 */

const IN_PAGE_MODULE = resolve(__dirname, '../regression/chart/freezeProbeInPage.ts');
const SPEC_FILE = resolve(__dirname, '../regression/chart/seekWhilePlayingFreeze.spec.ts');

// --------------------------------------------------------------------------- jsdom harness

interface FakeChart {
  el: HTMLElement;
  calls: { update: any[]; setData: any[][] };
  bars: any[];
}

function mountCharts(count: number, barsPerChart?: any[][]): FakeChart[] {
  document.body.innerHTML = '';
  const charts: FakeChart[] = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.setAttribute('data-testid', 'chart-container');
    const calls = { update: [] as any[], setData: [] as any[][] };
    const bars = barsPerChart ? barsPerChart[i] || [] : [];
    (el as any).__priceSeries = {
      update: (bar: any) => calls.update.push(bar),
      setData: (data: any[]) => calls.setData.push(data),
      data: () => bars,
    };
    document.body.appendChild(el);
    charts.push({ el, calls, bars });
  }
  return charts;
}

/** Minimal zustand-shaped store: getState() returns a fresh object after every set(). */
function mountStore(initial: Record<string, any>) {
  let current: Record<string, any> = { ...initial };
  (window as any).usePlaybackStore = {
    getState: () => current,
    setState: (patch: Record<string, any>) => {
      current = { ...current, ...patch };
    },
  };
  return {
    /** Emulates an action: mutate state, as a real store action would. */
    apply(patch: Record<string, any>) {
      current = { ...current, ...patch };
    },
    get current() {
      return current;
    },
  };
}

let rafStub: ((cb: FrameRequestCallback) => number) | null = null;
let originalRaf: typeof requestAnimationFrame | undefined;

beforeEach(() => {
  delete (window as any).__freezeProbe;
  delete (window as any).usePlaybackStore;
  originalRaf = window.requestAnimationFrame;
  rafStub = null;
  // Capture the heartbeat callback instead of letting jsdom schedule frames forever.
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    rafStub = cb;
    return 1;
  };
});

afterEach(() => {
  if (originalRaf !== undefined) (window as any).requestAnimationFrame = originalRaf;
  vi.restoreAllMocks();
});

// --------------------------------------------------------------------------- 1. behaviour

describe('freezeProbeInPage — installation and counters', () => {
  it('installs a probe with one counter record per chart container', () => {
    mountCharts(2);
    installFreezeProbe();

    const probe = (window as any).__freezeProbe;
    expect(probe).toBeTruthy();
    expect(probe.heartbeatSupported).toBe(true);
    expect(probe.charts).toHaveLength(2);
    expect(probe.charts.map((c: any) => c.index)).toEqual([0, 1]);
    expect(probe.charts[0]).toMatchObject({ updateCalls: 0, setDataCalls: 0, barsWritten: 0 });
  });

  it('counts update() as one bar and setData() as the number of bars it carries', () => {
    const charts = mountCharts(1);
    installFreezeProbe();

    // Call through the element so we hit the wrapped methods, not the originals.
    const series = (charts[0].el as any).__priceSeries;
    series.update({ time: 100, close: 1 });
    series.update({ time: 100, close: 2 });
    series.setData([{ time: 1 }, { time: 2 }, { time: 3 }, { time: 4 }, { time: 5 }]);

    const snapshot = readFreezeProbe(false);
    expect(snapshot.probe!.charts[0]).toEqual({
      index: 0,
      updateCalls: 2,
      setDataCalls: 1,
      barsWritten: 7, // 2 updates + 5 bars from setData
    });
    // The wrapped methods must still reach the real series, or the chart would stop rendering.
    expect(charts[0].calls.update).toHaveLength(2);
    expect(charts[0].calls.setData).toHaveLength(1);
  });

  it('reset=true returns the accumulated totals and then zeroes them', () => {
    mountCharts(1);
    installFreezeProbe();
    const series = (document.querySelector('[data-testid="chart-container"]') as any).__priceSeries;
    series.update({ time: 1 });
    series.update({ time: 2 });
    series.update({ time: 3 });

    // This is the exact call that blew up in the browser with "reset is not defined".
    const withTotals = readFreezeProbe(true);
    expect(withTotals.probe!.charts[0].updateCalls).toBe(3);

    const afterReset = readFreezeProbe(false);
    expect(afterReset.probe!.charts[0]).toMatchObject({ updateCalls: 0, setDataCalls: 0, barsWritten: 0 });
  });

  it('reset=false leaves the counters accumulated across reads', () => {
    mountCharts(1);
    installFreezeProbe();
    const series = (document.querySelector('[data-testid="chart-container"]') as any).__priceSeries;
    series.update({ time: 1 });
    expect(readFreezeProbe(false).probe!.charts[0].updateCalls).toBe(1);
    series.update({ time: 2 });
    expect(readFreezeProbe(false).probe!.charts[0].updateCalls).toBe(2);
  });

  it('records the largest gap between animation frames', () => {
    mountCharts(1);
    // install reads performance.now() once to seed `last`; the first beat reads it again.
    vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2750);
    installFreezeProbe();

    expect(rafStub).toBeTypeOf('function');
    rafStub!(2750);

    expect(readFreezeProbe(false).probe!.heartbeatMaxGapMs).toBe(1750);
  });

  it('tolerates a missing chart container and a missing PerformanceObserver', () => {
    document.body.innerHTML = '';
    expect(() => installFreezeProbe()).not.toThrow();
    const snapshot = readFreezeProbe(false);
    expect(snapshot.probe!.charts).toEqual([]);
    // jsdom has no longtask entry type, so support must be reported as false rather than thrown.
    expect(typeof snapshot.probe!.longTasks.supported).toBe('boolean');
  });

  it('reports probe: null before installation instead of throwing', () => {
    mountStore({});
    expect(readFreezeProbe(false).probe).toBeNull();
  });
});

describe('freezeProbeInPage — playback context', () => {
  it('maps the store into the report context', () => {
    mountCharts(1);
    mountStore({
      totalTicks: 7200,
      isPaused: false,
      playbackSpeed: 1,
      stepMinutes: 3,
      currentTime: 1790343000000,
      masterData: [1, 2, 3],
      bufferedTicks: [{ time: '2026-09-25 13:30:00.000' }, { time: '2026-09-25 14:00:00.000' }],
    });
    installFreezeProbe();

    const ctx = readFreezeProbe(false).context;
    expect(ctx.totalTicks).toBe(7200);
    expect(ctx.isPaused).toBe(false);
    expect(ctx.playbackSpeed).toBe(1);
    expect(ctx.stepMinutes).toBe(3);
    expect(ctx.masterDataBars).toBe(3);
    // 'YYYY-MM-DD HH:MM:SS.mmm' is interpreted as UTC, matching the spec's original behaviour.
    expect(ctx.firstTickMs).toBe(Date.parse('2026-09-25T13:30:00.000Z'));
    expect(ctx.lastTickMs).toBe(Date.parse('2026-09-25T14:00:00.000Z'));
  });

  it('accepts numeric tick times in seconds and in milliseconds', () => {
    mountStore({ bufferedTicks: [{ time: 1790343000 }, { time: 1790346600000 }] });
    const ctx = readFreezeProbe(false).context;
    expect(ctx.firstTickMs).toBe(1790343000000); // seconds -> ms
    expect(ctx.lastTickMs).toBe(1790346600000); // already ms
  });

  it('survives an absent or empty store', () => {
    const ctx = readFreezeProbe(false).context;
    expect(ctx).toMatchObject({
      totalTicks: 0,
      isPaused: null,
      playbackSpeed: null,
      stepMinutes: null,
      currentTime: null,
      firstTickMs: null,
      lastTickMs: null,
      masterDataBars: 0,
    });
    expect(isPlaying()).toBe(false);
  });

  it('isPlaying tracks isPaused === false exactly', () => {
    const store = mountStore({ isPaused: true });
    expect(isPlaying()).toBe(false);
    store.apply({ isPaused: false });
    expect(isPlaying()).toBe(true);
    store.apply({ isPaused: true });
    expect(isPlaying()).toBe(false);
  });

  it('seekToMs forwards the absolute target to the store action', () => {
    const seekTickTime = vi.fn();
    (window as any).usePlaybackStore = { getState: () => ({ seekTickTime }) };
    seekToMs(1790343000000);
    expect(seekTickTime).toHaveBeenCalledWith(1790343000000);
    expect(seekTickTime).toHaveBeenCalledTimes(1);
  });
});

describe('freezeProbeInPage — store-side seek timing', () => {
  it('measureStoreSeekBy offsets from the current playhead and reports post-seek pause state', () => {
    const seekTickTime = vi.fn((target: number) => {
      // A real seek replaces state; emulate the auto-pause that end-of-session data triggers.
      (window as any).usePlaybackStore.setState({ currentTime: target, isPaused: target > 1790346000000 });
    });
    mountStore({ currentTime: 1790343000000, totalTicks: 7200, isPaused: false, seekTickTime });

    const m = measureStoreSeekBy(180000);
    expect(m.targetMs).toBe(1790343180000);
    expect(m.currentTimeBefore).toBe(1790343000000);
    expect(m.bufferedTicks).toBe(7200);
    expect(typeof m.storeSeekMs).toBe('number');
    expect(m.storeSeekMs).toBeGreaterThanOrEqual(0);
    expect(m.isPausedAfter).toBe(false);
    expect(seekTickTime).toHaveBeenCalledWith(1790343180000);
  });

  it('re-reads the store after seeking so a pause caused by the seek is visible', () => {
    const seekTickTime = vi.fn(() => {
      (window as any).usePlaybackStore.setState({ isPaused: true });
    });
    mountStore({ currentTime: 1790343000000, totalTicks: 7200, isPaused: false, seekTickTime });

    // Regression: the diagnostic used to read isPaused off the pre-seek snapshot, which can never
    // observe a pause the seek itself caused.
    expect(measureStoreSeekTo(1790346600000).isPausedAfter).toBe(true);
  });

  it('measureStoreSeekTo seeks to the absolute target unchanged', () => {
    const seekTickTime = vi.fn();
    mountStore({ currentTime: 1790343000000, totalTicks: 10, isPaused: false, seekTickTime });
    const m = measureStoreSeekTo(1790345999999);
    expect(seekTickTime).toHaveBeenCalledWith(1790345999999);
    expect(m.targetMs).toBe(1790345999999);
    expect(m.bufferedTicks).toBe(10);
  });

  it('tolerates a store whose currentTime is not a number', () => {
    const seekTickTime = vi.fn();
    mountStore({ currentTime: null, totalTicks: 0, isPaused: false, seekTickTime });
    const m = measureStoreSeekBy(60000);
    expect(m.currentTimeBefore).toBeNull();
    expect(m.targetMs).toBe(60000);
  });
});

describe('freezeProbeInPage — series and heap readers', () => {
  it('seriesBarTimes returns UNIX seconds, parsing business-day objects and dropping junk', () => {
    mountCharts(1, [
      [
        { time: 1790343000 },
        { time: '2026-09-25T13:35:00.000Z' },
        { time: { year: 2026, month: 9, day: 25 } }, // business day -> not finite -> dropped
        { time: 1790343300 },
      ],
    ]);
    expect(seriesBarTimes(0)).toEqual([1790343000, Date.parse('2026-09-25T13:35:00.000Z') / 1000, 1790343300]);
  });

  it('seriesBarTimes is empty for an out-of-range index or a chart with no series', () => {
    mountCharts(1, [[{ time: 1 }]]);
    expect(seriesBarTimes(9)).toEqual([]);
    const bare = document.createElement('div');
    bare.setAttribute('data-testid', 'chart-container');
    document.body.appendChild(bare);
    expect(seriesBarTimes(1)).toEqual([]);
  });

  it('heapUsedBytes is null where performance.memory is unavailable', () => {
    expect(heapUsedBytes()).toBeNull();
    Object.defineProperty(performance, 'memory', {
      configurable: true,
      value: { usedJSHeapSize: 12345678 },
    });
    expect(heapUsedBytes()).toBe(12345678);
  });
});

// --------------------------------------------------------------------------- 2. serialization lint

/** Globals a serialized function may legitimately touch in the browser. */
const BROWSER_GLOBALS = new Set([
  'window', 'document', 'performance', 'navigator', 'location', 'history', 'console',
  'requestAnimationFrame', 'cancelAnimationFrame', 'PerformanceObserver', 'MutationObserver',
  'ResizeObserver', 'IntersectionObserver', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'queueMicrotask', 'structuredClone', 'fetch', 'URL', 'URLSearchParams',
  'Math', 'Number', 'String', 'Date', 'JSON', 'Array', 'Object', 'Map', 'Set', 'WeakMap',
  'WeakSet', 'Boolean', 'Error', 'TypeError', 'RangeError', 'Promise', 'Symbol', 'RegExp',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'undefined', 'NaN', 'Infinity', 'globalThis',
  'localStorage', 'sessionStorage', 'customElements', 'devicePixelRatio', 'innerWidth',
  'innerHeight', 'getComputedStyle', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent',
  'TextEncoder', 'TextDecoder', 'ArrayBuffer', 'Uint8Array', 'Float64Array', 'Intl',
]);

/** Every identifier bound by a declaration inside a function body. */
function boundNames(fn: ts.FunctionDeclaration): Set<string> {
  const bound = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) bound.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) bound.add(node.name.text);
    if (ts.isFunctionDeclaration(node) && node.name) bound.add(node.name.text);
    if (ts.isFunctionExpression(node) && node.name) bound.add(node.name.text);
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) bound.add(node.name.text);
    if (
      ts.isCatchClause(node) &&
      node.variableDeclaration &&
      ts.isIdentifier(node.variableDeclaration.name)
    ) {
      bound.add(node.variableDeclaration.name.text);
    }
    if (ts.isTypeParameterDeclaration(node)) bound.add(node.name.text);
    // A binding pattern's elements are visited above; keep descending for initializers.
    node.forEachChild(visit);
  };
  (fn.parameters || []).forEach((p) => {
    if (ts.isIdentifier(p.name)) bound.add(p.name.text);
    else p.name.forEachChild((n) => { if (ts.isIdentifier(n)) bound.add(n.text); });
  });
  fn.body?.forEachChild(visit);
  return bound;
}

/** Identifiers the function *reads* but does not declare — i.e. what must exist in the browser. */
function freeVariables(fn: ts.FunctionDeclaration): Array<{ name: string; line: number }> {
  const bound = boundNames(fn);
  const free: Array<{ name: string; line: number }> = [];
  const seen = new Set<string>();

  const visit = (node: ts.Node) => {
    // Types are erased before serialization; a type reference is never a runtime free variable.
    if (ts.isTypeNode(node)) return;

    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isPropertyName =
        parent &&
        ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node) ||
          (ts.isPropertySignature(parent) && parent.name === node) ||
          (ts.isMethodDeclaration(parent) && parent.name === node) ||
          (ts.isPropertyDeclaration(parent) && parent.name === node) ||
          (ts.isBindingElement(parent) && parent.propertyName === node) ||
          (ts.isQualifiedName(parent) && parent.right === node));
      const isDeclarationName =
        parent &&
        ((ts.isVariableDeclaration(parent) && parent.name === node) ||
          (ts.isFunctionDeclaration(parent) && parent.name === node) ||
          (ts.isParameter(parent) && parent.name === node) ||
          (ts.isCatchClause(parent) &&
            parent.variableDeclaration !== undefined &&
            parent.variableDeclaration.name === node));
      // Shorthand assignments ({ reset }) read a real binding, so they are covered by `bound`.
      if (!isPropertyName && !isDeclarationName && !bound.has(node.text)) {
        if (!BROWSER_GLOBALS.has(node.text) && !seen.has(node.text)) {
          seen.add(node.text);
          const { line } = fn.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
          free.push({ name: node.text, line: line + 1 });
        }
      }
    }
    node.forEachChild(visit);
  };

  fn.body?.forEachChild(visit);
  return free;
}

function exportedFunctions(file: string): ts.FunctionDeclaration[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.ES2020, true);
  const fns: ts.FunctionDeclaration[] = [];
  source.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name) fns.push(node);
  });
  return fns;
}

describe('freezeProbeInPage — Playwright serialization contract', () => {
  it('every in-page function is free of variables that cannot survive serialization', () => {
    const fns = exportedFunctions(IN_PAGE_MODULE);
    expect(fns.length).toBeGreaterThanOrEqual(8);

    const offenders = fns
      .map((fn) => ({ name: fn.name!.text, free: freeVariables(fn) }))
      .filter((f) => f.free.length > 0);

    expect(
      offenders.map((o) => `${o.name}: ${o.free.map((f) => `${f.name} (line ${f.line})`).join(', ')}`),
      'a free variable inside a page.evaluate function is a browser-only ReferenceError'
    ).toEqual([]);
  });

  it('the lint actually detects a closed-over variable (self-test)', () => {
    // Without this, the lint above could pass by simply never finding anything.
    const broken = ts.createSourceFile(
      'broken.ts',
      'export function broken(reset: boolean) { const w = window as any; if (reset && leaked) { w.x = 1; } }',
      ts.ScriptTarget.ES2020,
      true
    );
    let fn: ts.FunctionDeclaration | undefined;
    broken.forEachChild((n) => { if (ts.isFunctionDeclaration(n)) fn = n; });
    const free = freeVariables(fn!).map((f) => f.name);
    expect(free).toContain('leaked');
    expect(free).not.toContain('reset'); // a parameter is bound, not free
    expect(free).not.toContain('window');
  });

  it('the spec passes functions, never closure bodies, to page.evaluate/waitForFunction', () => {
    const spec = readFileSync(SPEC_FILE, 'utf-8');

    // ANY zero-arg closure is the shape that hides a closed-over variable -- brace body or
    // expression body alike. The only permitted one is `() => undefined`, the dispatch-latency
    // ping, which by definition captures nothing.
    const zeroArgEvaluates = spec.match(/page\.evaluate\(\s*\(\s*\)\s*=>/g) || [];
    const allowedPings = spec.match(/page\.evaluate\(\s*\(\s*\)\s*=>\s*undefined\s*\)/g) || [];
    expect(allowedPings.length, 'the dispatch-latency ping should still be present').toBeGreaterThan(0);
    expect(
      zeroArgEvaluates.length - allowedPings.length,
      'page.evaluate(() => ...) cannot capture spec scope; pass an imported in-page function instead'
    ).toBe(0);

    const waitClosures = spec.match(/waitForFunction\(\s*\(\s*\)\s*=>/g) || [];
    expect(waitClosures, 'waitForFunction(() => ...) cannot capture spec scope').toEqual([]);
  });

  it('the spec imports the in-page functions it evaluates', () => {
    const spec = readFileSync(SPEC_FILE, 'utf-8');
    for (const fn of [
      'installFreezeProbe',
      'readFreezeProbe',
      'seriesBarTimes',
      'seekToMs',
      'measureStoreSeekBy',
      'measureStoreSeekTo',
      'heapUsedBytes',
    ]) {
      expect(spec, `${fn} must be passed by reference, not re-inlined as a closure`).toContain(
        `page.evaluate(${fn}`
      );
    }
    expect(spec).toContain('page.waitForFunction(isPlaying');
  });
});
