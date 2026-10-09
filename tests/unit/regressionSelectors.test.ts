/**
 * Guard for the selector ambiguity behind the TEST-08 failures.
 *
 * PlaybackBar renders two <select> elements: the step size (playback-step-select) and the speed
 * multiplier (playback-speed-select). A locator such as `.playback-bar select` matches both. Playwright
 * then throws a strict-mode violation, and `.first()` silently drives the step size instead of the
 * speed. Specs must select the speed control by its test id.
 *
 * Mutation-tested: restoring `page.locator('.playback-bar select')` in any regression file fails the
 * first assertion below.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const REGRESSION_DIR = resolve(__dirname, '../regression');
const PLAYBACK_BAR = resolve(__dirname, '../../src/components/PlaybackBar.tsx');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
  });
}

describe('regression selectors are unambiguous', () => {
  const files = tsFiles(REGRESSION_DIR);

  it('no regression file selects by an unscoped ".playback-bar select" (matches two selects)', () => {
    const offenders = files.filter((f) => /\.playback-bar\s+select\b/.test(readFileSync(f, 'utf-8')));
    expect(offenders.map((f) => f.replace(REGRESSION_DIR, 'tests/regression'))).toEqual([]);
  });

  it('PlaybackBar exposes the speed and step selects by test id', () => {
    const source = readFileSync(PLAYBACK_BAR, 'utf-8');
    expect(source).toContain('data-testid="playback-speed-select"');
    expect(source).toContain('data-testid="playback-step-select"');
  });

  it('every speed-select test id used by a regression file exists in PlaybackBar', () => {
    const source = readFileSync(PLAYBACK_BAR, 'utf-8');
    const used = files.filter((f) => readFileSync(f, 'utf-8').includes("getByTestId('playback-speed-select')"));
    expect(used.length).toBeGreaterThan(0);
    expect(source).toContain('data-testid="playback-speed-select"');
  });
});
