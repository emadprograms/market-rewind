import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * Nothing else in this repository parses the Playwright journey specs.
 *
 * `vitest` does not collect them (they are Playwright tests, not vitest tests) and `tsc` accepts them
 * because they are ordinary TypeScript. That left a real hole: one unescaped apostrophe inside a
 * single-quoted test title broke `15-simulated-terminal.spec.ts` at parse time, which made Playwright
 * abandon *discovery entirely* — all fifteen files, all eighty tests, gone — while vitest, tsc and the
 * production build all stayed green. The breakage was invisible until a browser run.
 *
 * This guard is cheap (discovery needs no browser) and it fails on the condition that actually
 * matters: the suite must still parse, and must still contain the tests it is supposed to.
 */
describe('the browser journey suite parses, and still contains its tests', () => {
  it('discovers the full journey suite without a syntax error', () => {
    const cli = path.join('node_modules', '@playwright', 'test', 'cli.js');
    const res = spawnSync(
      process.execPath,
      [cli, 'test', '-c', 'playwright.journey.config.ts', '--list'],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000 },
    );
    const out = `${res.stdout || ''}${res.stderr || ''}`;

    // A parse failure prints the offending line and reports zero files; check the message directly,
    // because "0 tests in 0 files" would otherwise look like a legitimate empty result.
    expect(out).not.toMatch(/SyntaxError|Unexpected token/);

    const summary = out.match(/Total: (\d+) tests in (\d+) files/);
    expect(summary, `no discovery summary in output:\n${out.slice(-600)}`).not.toBeNull();

    const [, tests, files] = summary!;
    expect(Number(files)).toBeGreaterThanOrEqual(15);
    expect(Number(tests)).toBeGreaterThanOrEqual(80);
  });
});

describe('the journey suite tests the server it actually starts', () => {
  it('points baseURL at the same origin as its own web server', async () => {
    // Both were once correct in isolation and wrong together: the server was moved to 3100 to stop
    // the suite reusing a stale `vite preview` daemon on 3000, while `baseURL` stayed on 3000. So a
    // fresh server was booted on 3100 and the browser was then sent to 3000 anyway, which is the
    // exact hazard the move was meant to remove. Nothing caught it, because Playwright reports
    // nothing when the two disagree — it simply tests somewhere else.
    const { default: config } = await import('../../playwright.journey.config');
    const resolved = typeof config === 'function' ? config({} as never) : config;

    const baseURL = resolved.use?.baseURL;
    const serverURL = resolved.webServer && !Array.isArray(resolved.webServer)
      ? resolved.webServer.url
      : undefined;

    expect(baseURL, 'baseURL is not configured').toBeTruthy();
    expect(serverURL, 'webServer.url is not configured').toBeTruthy();
    expect(new URL(baseURL!).origin).toBe(new URL(serverURL!).origin);

    // And it must not be the port the reporting environment had a stale server on.
    expect(new URL(baseURL!).port).not.toBe('3000');
  });
});
