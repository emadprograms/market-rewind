import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';
import { SEED_DB_DIR, SEED_DB_PATH, SEED_DATE, SEED_SYMBOLS } from './e2e-utils';

/**
 * Playwright globalSetup: deterministically (re)generate the seeded SQLite
 * fixture used by every E2E scenario, so CI never depends on a binary blob.
 *
 * Schema matches src/lib/workers/db.worker.ts:
 *   market_data(symbol, timestamp, open, high, low, close, volume, session)
 *
 * Data shape: 90 calendar days of weekday 1-minute bars (09:30–15:59, REG
 * session) ending on SEED_DATE. The seed intentionally spans MORE than the
 * 30-day initial fetch window so that scrolling far enough into the past
 * triggers a real FETCH_HISTORICAL_CHUNK prepend in the visual stability test.
 */

const BARS_PER_DAY = 390; // 09:30–15:59 inclusive
const DAYS_BACK = 90;

function isWeekday(d: Date): boolean {
  const day = d.getUTCDay();
  return day >= 1 && day <= 5;
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`
  );
}

async function generateSeedDb(): Promise<void> {
  fs.mkdirSync(SEED_DB_DIR, { recursive: true });
  if (fs.existsSync(SEED_DB_PATH)) fs.rmSync(SEED_DB_PATH);

  const SQL = await initSqlJs({
    locateFile: (file: string) => path.resolve(process.cwd(), 'node_modules/sql.js/dist', file),
  });
  const db = new SQL.Database();

  db.run(
    `CREATE TABLE market_data (
      symbol TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      open REAL, high REAL, low REAL, close REAL, volume REAL,
      session TEXT NOT NULL
    )`
  );

  const end = new Date(`${SEED_DATE}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - DAYS_BACK);

  const insert = db.prepare(
    'INSERT INTO market_data (symbol, timestamp, open, high, low, close, volume, session) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  db.run('BEGIN TRANSACTION');
  try {
    SEED_SYMBOLS.forEach((symbol, symbolIndex) => {
      const base = 100 * (symbolIndex + 1);
      let barIndex = 0;

      for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
        if (!isWeekday(day)) continue;

        for (let m = 0; m < BARS_PER_DAY; m++) {
          const barTime = new Date(Date.UTC(
            day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(),
            9, 30 + m, 0
          ));

          // Fully deterministic price series (no Math.random) so CI reruns
          // produce byte-identical data and stable screenshots.
          const wave = Math.sin(barIndex / 17 + symbolIndex) * 0.5;
          const drift = barIndex * 0.005;
          const open = base + wave + drift;
          const close = open + Math.sin(barIndex / 7) * 0.1;
          const high = Math.max(open, close) + 0.05;
          const low = Math.min(open, close) - 0.05;
          const volume = 1000 + (barIndex % 37) * 10;

          insert.run([symbol, formatTimestamp(barTime), open, high, low, close, volume, 'REG']);
          barIndex++;
        }
      }
    });

    insert.free();
    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }

  fs.writeFileSync(SEED_DB_PATH, Buffer.from(db.export()));
  db.close();
  console.log(`[global-setup] Seeded E2E fixture written to ${SEED_DB_PATH}`);
}

export default async function globalSetup(): Promise<void> {
  await generateSeedDb();
}
