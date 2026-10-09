/**
 * Static guard for the canonical 09:10 ET replay anchor.
 *
 * The app starts replay at 09:10 ET (commit e57efe8). The journey suite and dateReset.spec.ts
 * were moved to that anchor in this PR, after they asserted a stale 09:20 start. These checks
 * read the source files, so a future edit that moves the default back to 09:20, or that
 * reintroduces a 09:20 expectation in an e2e spec, fails `npm test` without needing a browser
 * or the tick lake.
 *
 * Mutation-tested: setting the session default to 09:20, or adding a 09:20 expectation to
 * dateReset.spec.ts or a journey spec, makes the matching test below fail.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const JOURNEY_DIR = join(ROOT, 'tests', 'regression', 'journey');
const journeySpecs = readdirSync(JOURNEY_DIR)
  .filter((f) => f.endsWith('.spec.ts'))
  .map((f) => ({ name: `journey/${f}`, text: readFileSync(join(JOURNEY_DIR, f), 'utf8') }));
const dateReset = { name: 'replay/dateReset.spec.ts', text: read('tests/regression/replay/dateReset.spec.ts') };

describe('canonical 09:10 ET anchor: the app default is 09:10', () => {
  it('the session entry time defaults to 09:10', () => {
    expect(read('src/hooks/useSession.ts')).toMatch(/const \[entryTime, setEntryTime\] = useState\('09:10'\);/);
  });

  it('the chart data fetch starts at 09:10 ET when no entry time is given', () => {
    expect(read('src/hooks/useChartData.ts')).toContain("getUtcTimeFromEt(selectedDate, '09:10')");
  });
});

describe('canonical 09:10 ET anchor: no e2e spec asserts the stale 09:20 start', () => {
  it('no journey spec mentions 09:20', () => {
    const offenders = journeySpecs.filter((s) => s.text.includes('09:20')).map((s) => s.name);
    expect(offenders).toEqual([]);
  });

  it('dateReset.spec.ts does not mention 09:20', () => {
    expect(dateReset.text.includes('09:20')).toBe(false);
  });

  it('every clock assertion in dateReset.spec.ts expects 09:10:00', () => {
    const clockAssertions = [...dateReset.text.matchAll(/toContainText\('(\d{2}:\d{2}:\d{2})'\)/g)].map((m) => m[1]);
    expect(clockAssertions.length).toBeGreaterThan(0);
    expect(new Set(clockAssertions)).toEqual(new Set(['09:10:00']));
  });

  it('journey 01-boot asserts the 09:10 default entry time', () => {
    const boot = journeySpecs.find((s) => s.name === 'journey/01-boot.spec.ts');
    expect(boot, 'journey/01-boot.spec.ts must exist').toBeDefined();
    expect(boot!.text).toContain("toHaveValue('09:10')");
  });
});
