/**
 * replayJourney.ts
 * ---------------------------------------------------------------------------
 * High-level, intention-revealing helpers that model the EXACT steps a user
 * performs to replay a chart in Market Rewind, layered on top of the offline
 * API mock. Specs read like a script of the user journey:
 *
 *   openWebsite → enterReplayDate → chartShowsHistory → stopsAtNineTwenty
 *   → pressPlay → (time advances) → placeBuy / placeSell → live updates reflect
 *
 * Everything here is defensive (generous timeouts, attribute + store probes)
 * so the suite is stable even though it can't be executed in this sandbox.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { installApiMocks, type MockMarketHandle, type MockMarketOptions } from './apiMock';

export const ET = 'America/New_York';

/** The chart card root for a given layout index. */
export function chartCard(page: Page, index: number): Locator {
  return page.locator('.chart-card').nth(index);
}

export interface ReplayBarData {
  barsCount: number;
  firstBarTime: string | null;
  lastBarTime: string | null;
  lastBarOpen: string | null;
  lastBarClose: string | null;
  ticker: string | null;
}

export interface PlaybackState {
  currentTime: number | null;
  currentTickIndex: number;
  totalTicks: number;
  isPaused: boolean;
  playbackSpeed: number;
  currentTick: { time: string; price: number; symbol: string } | null;
  bufferedTicksLength: number;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/** Open the app with the offline market mock installed and wait for boot. */
export async function openWebsite(
  page: Page,
  options: MockMarketOptions = {},
): Promise<MockMarketHandle> {
  const handle = await installApiMocks(page, options);
  await page.goto('/');
  return handle;
}

/** Wait until the app has connected to the (mocked) streaming service. */
export async function waitForBackendConnected(page: Page): Promise<void> {
  // The session configuration overlay only renders once the DB is loaded.
  await expect(page.getByText('Configure Session')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.session-card select option')).not.toHaveCount(0, { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Session configuration (enter the date you want to replay)
// ---------------------------------------------------------------------------

export interface ReplayRequest {
  ticker?: string;
  date: string;
  entryTime?: string; // ET "HH:MM"; defaults to the app's 09:10 anchor
}

/** Fill the "Configure Session" card (ticker, target date, optional entry time). */
export async function enterReplayDate(page: Page, req: ReplayRequest): Promise<void> {
  const { ticker, date, entryTime } = req;
  if (ticker) {
    await page.locator('.session-card select').first().selectOption(ticker);
  }
  await page.locator('.session-card input[type="date"]').fill(date);
  if (entryTime) {
    await page.locator('.session-card input[type="time"]').fill(entryTime);
  }
}

/** Click "Initialize Market Simulator" and wait for the replay workspace. */
export async function startReplay(
  page: Page,
  opts: { ticker?: string; anchorEt?: string } = {},
): Promise<void> {
  await page.getByRole('button', { name: /Initialize Market Simulator/i }).click();

  // Two charts in the default '2v' layout.
  await expect(page.locator('.chart-card')).toHaveCount(2, { timeout: 30_000 });

  if (opts.ticker) {
    await expect(chartCard(page, 0)).toHaveAttribute('data-ticker', opts.ticker, { timeout: 30_000 });
  }

  // Tick buffer finished loading.
  await expect(page.locator('.playback-bar')).toHaveAttribute('data-ticks-loading', 'false', {
    timeout: 40_000,
  });

  // Replay clock anchored (defaults to the 09:10 ET entry point).
  const anchor = opts.anchorEt ?? '09:10:00';
  await expect(page.locator('.time-display')).toContainText(anchor, { timeout: 40_000 });
}

/** Full convenience: open → configure → start, then assert the anchor time. */
export async function beginReplay(
  page: Page,
  req: ReplayRequest,
  options: MockMarketOptions = {},
): Promise<MockMarketHandle> {
  const handle = await openWebsite(page, options);
  await waitForBackendConnected(page);
  await enterReplayDate(page, req);
  await startReplay(page, { ticker: req.ticker, anchorEt: req.entryTime ? `${req.entryTime}:00` : '09:10:00' });
  return handle;
}

// ---------------------------------------------------------------------------
// Chart introspection
// ---------------------------------------------------------------------------

export async function readBarData(card: Locator): Promise<ReplayBarData> {
  return card.evaluate((el) => {
    const e = el as HTMLElement;
    return {
      barsCount: parseInt(e.getAttribute('data-bars-count') || '0', 10),
      firstBarTime: e.getAttribute('data-first-bar-time'),
      lastBarTime: e.getAttribute('data-last-bar-time'),
      lastBarOpen: e.getAttribute('data-last-bar-open'),
      lastBarClose: e.getAttribute('data-last-bar-close'),
      ticker: e.getAttribute('data-ticker'),
    };
  });
}

/** Convert a bar UTC time string to an ET "HH:MM" clock for assertions. */
export function utcToEtClock(utcTimeStr: string): string {
  const ms = new Date(utcTimeStr.replace(' ', 'T') + (utcTimeStr.includes('Z') ? '' : 'Z')).getTime();
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

/** ET calendar date ("YYYY-MM-DD") for a bar UTC time string. */
export function utcToEtDate(utcTimeStr: string): string {
  const ms = new Date(utcTimeStr.replace(' ', 'T') + (utcTimeStr.includes('Z') ? '' : 'Z')).getTime();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

// ---------------------------------------------------------------------------
// Playback store (exposed on window as `usePlaybackStore`)
// ---------------------------------------------------------------------------

export async function readPlaybackState(page: Page): Promise<PlaybackState> {
  return page.evaluate(() => {
    const store = (window as any).usePlaybackStore;
    const s = store.getState();
    return {
      currentTime: s.currentTime,
      currentTickIndex: s.currentTickIndex,
      totalTicks: s.totalTicks,
      isPaused: s.isPaused,
      playbackSpeed: s.playbackSpeed,
      currentTick: s.currentTick
        ? { time: s.currentTick.time, price: s.currentTick.price, symbol: s.currentTick.symbol }
        : null,
      bufferedTicksLength: (s.bufferedTicks || []).length,
    };
  });
}

/** Current replay clock from the playback store, as an ET "HH:MM:SS.mmm" string. */
export async function readReplayClock(page: Page): Promise<string> {
  const { currentTime } = await readPlaybackState(page);
  if (currentTime == null) return '';
  const d = new Date(currentTime);
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d);
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${clock}.${ms}`;
}

// ---------------------------------------------------------------------------
// Transport controls
// ---------------------------------------------------------------------------

export function playButton(page: Page): Locator {
  // The transport button reads "PLAY" when paused (unique among transport buttons).
  return page.getByRole('button', { name: /PLAY/i });
}
export function pauseButton(page: Page): Locator {
  return page.getByRole('button', { name: /PAUSE/i });
}

export async function pressPlay(page: Page): Promise<void> {
  await playButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
}

export async function pressPause(page: Page): Promise<void> {
  await pauseButton(page).click();
  await expect(playButton(page)).toBeVisible();
}

export async function setSpeed(page: Page, value: string): Promise<void> {
  await page.getByTestId('playback-speed-select').selectOption(value);
}

export function scrubberCounter(page: Page): Locator {
  // "current/total" text next to the range slider inside the playback bar.
  return page.locator('.playback-bar').locator('text=/^\\d+\\/\\d+$/');
}

export async function readScrubber(page: Page): Promise<{ current: number; total: number }> {
  const text = await scrubberCounter(page).first().innerText();
  const [cur, tot] = text.split('/').map((n) => parseInt(n.trim(), 10));
  return { current: cur, total: tot };
}

/**
 * Drag the tick scrubber to a given index in a React-compatible way.
 * `fill()` is unreliable on controlled range inputs, so we set the value via the
 * native prototype setter (bypassing React's value tracker) and fire input+change.
 */
export async function seekScrubber(page: Page, indexOrTime: number): Promise<void> {
  const slider = page.locator('.playback-bar input[type="range"]');
  await slider.evaluate((el, val) => {
    const input = el as HTMLInputElement;
    const min = Number(input.min);
    const max = Number(input.max);
    let targetVal = val;
    // If val is a tick index (small integer) and slider is time-based (min is Unix ms > 1e11)
    if (min > 1e11 && val < 1e11) {
      const store = (window as any).usePlaybackStore;
      const ticks = store?.getState()?.bufferedTicks || [];
      if (ticks[val]) {
        const timeStr = ticks[val].time;
        const norm = timeStr.includes('T') ? timeStr : timeStr.replace(' ', 'T');
        targetVal = new Date(norm.includes('Z') ? norm : norm + 'Z').getTime();
      } else {
        targetVal = min + (val / Math.max(1, (store?.getState()?.totalTicks || 1))) * (max - min);
      }
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, String(targetVal));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, indexOrTime);
}

// ---------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------

export function buyButton(page: Page, cardIndex = 0): Locator {
  return chartCard(page, cardIndex).getByRole('button', { name: 'BUY' });
}
export function sellButton(page: Page, cardIndex = 0): Locator {
  return chartCard(page, cardIndex).getByRole('button', { name: 'SELL' });
}
export function tradeSizeInput(page: Page, cardIndex = 0): Locator {
  return chartCard(page, cardIndex).locator('.trade-controls input[type="number"]');
}
export function tradeBadge(page: Page, cardIndex = 0): Locator {
  return chartCard(page, cardIndex).locator('.trade-badge');
}

export async function setTradeSize(page: Page, cardIndex: number, size: number): Promise<void> {
  await tradeSizeInput(page, cardIndex).fill(String(size));
}

/** Parse the signed "+1.23" / "-4.50" PnL shown in a trade badge (always 2 dp). */
export async function readBadgePnL(page: Page, cardIndex = 0): Promise<number> {
  const text = await tradeBadge(page, cardIndex).innerText();
  // PnL is always rendered with decimals ("+0.00"); the size chip is an integer.
  const match = text.match(/([+-]?\d+\.\d+)/);
  return match ? parseFloat(match[1]) : NaN;
}

/** Parse the integer size chip shown in a trade badge. */
export async function readBadgeSize(page: Page, cardIndex = 0): Promise<number> {
  const text = await tradeBadge(page, cardIndex).innerText();
  const match = text.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : NaN;
}

/** Read the realized (R:) and unrealized (U:) totals from the playback bar. */
export async function readPlaybackPnL(page: Page): Promise<{ realized: number; unrealized: number }> {
  const bar = page.locator('.playback-bar');
  const text = await bar.innerText();
  const realized = parseMoney(text.match(/R:\s*([+-]?\d[\d,]*\.?\d*)/)?.[1]);
  const unrealized = parseMoney(text.match(/U:\s*([+-]?\d[\d,]*\.?\d*)/)?.[1]);
  return { realized, unrealized };
}

function parseMoney(raw: string | undefined): number {
  if (!raw) return NaN;
  return Number(raw.replace(/,/g, ''));
}

// ---------------------------------------------------------------------------
// Time & Sales tape
// ---------------------------------------------------------------------------

export function tapeButton(page: Page): Locator {
  return page.locator('button:has-text("TAPE")');
}
export function tapePanel(page: Page): Locator {
  return page.locator('.time-and-sales-panel');
}
export function tapeRows(page: Page): Locator {
  return page.locator('.tick-row');
}

export async function openTape(page: Page): Promise<void> {
  await tapeButton(page).click();
  await expect(tapePanel(page)).toBeVisible();
}

/** Attach a pageerror collector; assert it stays empty at test end. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
