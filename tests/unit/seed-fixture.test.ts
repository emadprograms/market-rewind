import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';

/**
 * Guardrail for the Playwright seed generator. The E2E suite depends on the
 * fixture having (a) the schema the DB worker queries, (b) all three symbols,
 * and (c) more history than the 30-day initial fetch window so the prepend
 * scenario actually exercises FETCH_HISTORICAL_CHUNK.
 */
describe('E2E seed fixture generator', () => {
  it('produces a schema-valid, prepend-capable seed database', async () => {
    const { SEED_DB_PATH, SEED_SYMBOLS, SEED_DATE } = await import('../regression/e2e-utils');
    const { default: globalSetup } = await import('../regression/global-setup');

    await globalSetup();
    expect(fs.existsSync(SEED_DB_PATH)).toBe(true);

    const SQL = await initSqlJs({
      locateFile: (file: string) => path.resolve(process.cwd(), 'node_modules/sql.js/dist', file),
    });
    const db = new SQL.Database(fs.readFileSync(SEED_DB_PATH));
    const q = (sql: string, params: unknown[] = []) => {
      const r = db.exec(sql, params);
      return r.length ? r[0].values : [];
    };

    // Schema the worker queries against
    expect(q(`SELECT name FROM sqlite_master WHERE type='table' AND name='market_data'`)).toHaveLength(1);
    expect(q('PRAGMA table_info(market_data)').map((c) => c[1])).toEqual(
      ['symbol', 'timestamp', 'open', 'high', 'low', 'close', 'volume', 'session']
    );

    // All expected symbols present
    const symbols = q('SELECT DISTINCT symbol FROM market_data ORDER BY symbol').map((r) => r[0]);
    expect(symbols).toEqual([...SEED_SYMBOLS].sort());

    // Session marker matches the app's 'REG' filter (useChartData)
    expect(q('SELECT DISTINCT session FROM market_data').map((r) => r[0])).toEqual(['REG']);

    // History must exceed the 30-day initial fetch window (prepend-capable)
    const range = q('SELECT MIN(timestamp), MAX(timestamp), COUNT(*) FROM market_data')[0];
    expect(range[2]).toBeGreaterThan(30_000);
    expect(String(range[0])).not.toContain(SEED_DATE); // starts well before SEED_DATE
    expect(String(range[1])).toContain(SEED_DATE);

    // Rows exist ON the seed date for every symbol (session would render data)
    const onDate = q(
      `SELECT symbol, COUNT(*) FROM market_data WHERE timestamp LIKE ? GROUP BY symbol`,
      [`${SEED_DATE}%`]
    );
    expect(onDate.map((r) => r[0])).toEqual([...SEED_SYMBOLS].sort());
    onDate.forEach((r) => expect(r[1]).toBe(390));

    db.close();
  });
});
