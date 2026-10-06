---
phase: 42-comprehensive-verification-regression-immunity
status: passed_with_documented_environment_block
verified_at: 2026-10-06
reverified: 2026-10-06 (round 3 — found and fixed one real defect + three coverage gaps)
must_haves:
  - id: LAKE-VERIFY-01
    status: passed
    description: 100% of backend pytest tests pass on `npm run backend:test`; no legacy streaming.duckdb or file-lock assumptions remain.
  - id: LAKE-VERIFY-02
    status: passed
    description: All 80 Vitest files (418+ tests) plus the new hygiene guards pass from a fresh clone with zero regressions; Vite build clean. The Playwright journey suite is env-blocked (no browser obtainable in this sandbox) but its harness is verified working.
---

# Phase 42 Verification: Comprehensive Verification & Regression Immunity

## 1. Test Verification Matrix

| Suite | Passed | Total | Skipped | Status |
|---|---|---|---|---|
| `test_tick_lake_reader.py` (Phase 39) | 80 | 80 | 1 | PASSED |
| `test_lake_resampling.py` (Phase 40) | 50 | 50 | 0 | PASSED |
| `test_order_flow_tape.py` (Phase 41) | 20 | 20 | 0 | PASSED |
| `test_duckdb_service.py` (Phase 41) | 27 | 27 | 0 | PASSED |
| `test_server.py` (Phase 41) | 20 | 20 | 0 | PASSED |
| `npm run backend:test` (whole backend) | **197** | 197 | 1 | **PASSED — zero failures** |
| `npm run test` (Vitest, dev tree) | **422** | 424 | 2 | **PASSED — 81/81 files** |
| `npm run build` (Vite production) | — | — | — | **PASSED** (459.67 kB JS / 141.62 kB gzip) |
| `npm run test:journey` (Playwright) | 0 | 73 | 0 | **ENV-BLOCKED — no browser binary (see §4)** |

The single backend skip is the intentional `TICK_LAKE_ROOT`-gated real-lake test; the two Vitest
skips are pre-existing `describe.skip`/`it.skip` markers unrelated to this phase.

## 2. Fresh-Clone Verification (independent of the working tree)

`/tmp/rev42` = `git clone --depth 1 --branch arena/10770ea5-market-rewind` of the pushed commit,
**no files copied**, run end-to-end with the plain commands a new contributor would use:

| Step | Command | Result |
|---|---|---|
| Install | `npm install --no-audit --no-fund` | **added 229 packages in 31s, no crash** (the committed `.npmrc` removes the need for `--legacy-peer-deps`) |
| Backend | `npm run backend:test` | **197 passed, 1 skipped, 0 failed** (6.58s) |
| Frontend | `npm run test` | **81 files passed / 422 tests passed, 2 skipped** (106s) |
| Build | `npm run build` | **clean**, `✓ built in 13.35s` |

Before this phase the same fresh clone produced 50 load-failed Vitest files, so the repair is
confirmed durable outside the author's machine.

## 3. Mutation Verification (do the guards actually guard?)

Each defect that broke the suite was re-injected into the working tree and the hygiene guard was
re-run; the tree was restored and re-checked after every mutation (`diff` against backups = clean).

| # | Mutation | Guard result |
|---|---|---|
| — | none (control) | `1 passed` |
| M1 | Re-introduce an absolute `/Users/emadarshadalam/...` import specifier | **FAILED (killed)** |
| M2 | Remove `@testing-library/dom` from `devDependencies` | **FAILED (killed)** |
| M3 | Remove `legacy-peer-deps=true` from `.npmrc` | **FAILED (killed)** |
| — | restored | `1 passed`, `git status` clean |

## 4. Playwright Journey Suite — Environment Block (disclosed, not hidden)

**Symptom.** `npm run test:journey` starts normally (Playwright boots the mock-only Vite dev server
on port 3000; the run registers 73 tests across 13 specs) and then every test fails identically:

```
Error: browserType.launch: Executable doesn't exist at
  /home/user/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
```

**Why it cannot be fixed here** (all attempted, all dead ends):

| Attempt | Outcome |
|---|---|
| `npx playwright install chromium` | `ECONNRESET` — `cdn.playwright.dev` unreachable |
| 3 alternate Playwright CDN mirrors (`PLAYWRIGHT_DOWNLOAD_HOST`) | unreachable |
| `@playwright/browser-chromium`, `playwright-chromium`, `puppeteer`-style npm packages | 15 KB downloader stubs pointing at the same blocked CDN |
| `@sparticuz/chromium` (real binary shipped via npm) | binary extracts to `/tmp/chromium` but needs `libnss3.so`, `libnspr4.so`, `libnssutil3.so` |
| `sudo apt-get install libnss3 libnspr4` | no package candidates (Debian mirrors unreachable, index empty) |
| Search entire filesystem for an existing browser / NSS libs | none (`find / -xdev`) |
| Host reachability audit | only `registry.npmjs.org`, `github.com`, `api.github.com`, `codeload.github.com`, `pypi.org`, `files.pythonhosted.org` answer; all browser distribution hosts are blocked |

**What is nonetheless verified about the journey suite:** its config is correct and current
(`testDir: ./tests/regression/journey`, 13 spec files / 73 tests, mocked API, dev server boots
successfully, base URL `http://localhost:3000`), it is untouched by this milestone, and the
browser-independent layer it exercises is covered green at jsdom level by the Vitest suite
(422 tests, including `tests/integration/*` chart/replay/Time-&-Sales flows and
`tests/unit/strictStreamingEngine.test.ts` for the `/api/status` + `/api/streaming/candles`
contract).

**To close it on a developer machine / CI with network access:**

```bash
npx playwright install chromium
npm run test:journey        # expects 73 passed
```

## 5. Accepted Deviations

| Item | Decision |
|---|---|
| `npm run test:journey` not executed here | Environment limitation (no browser obtainable); recorded with evidence and exact remediation command. Frontend regression immunity is demonstrated by 422 green Vitest tests + fresh-clone reproducibility instead. |
| `legacy-peer-deps=true` committed in `.npmrc` | Keeps the install working despite npm 10.9.8's arborist crash. Safe because the genuinely required peer (`@testing-library/dom`) is now declared explicitly and guarded by a test. |
| 1 backend skip, 2 Vitest skips | Pre-existing and intentional (real-lake gate; `skip` markers unrelated to v5.0). |

---

## 6. Re-Verification Round 3 (2026-10-06)

A third independent pass, this time driven by **line-coverage measurement** plus repeated execution
rather than by reading the code. It found one real defect and three test gaps.

### 6.1 Defect C (high) — candle volume was not actually deterministic

`sum()` over float64 in DuckDB runs in parallel, and floating-point addition is not associative, so
the reported volume depended on the thread schedule.

*Evidence.* An isolated probe (identical query, 14 float64 parquet files, `SET threads=4`) produced
**13 distinct sums over 300 runs** (`42364.49215303713` ×209, `…718` ×17, `…716` ×15, `…194` ×10).
In the suite, `test_timeframe_normalization_case_insensitive` (which compares two identical queries)
failed **4 of 25 runs**; the two queries answered `839.2199999999998` vs `839.2199999999999`.

*Fix.* `round(sum(volume), 6) AS volume` in the candle aggregation SQL
(`tick_lake_reader.py`), with a comment explaining why. Rounding to the 6-decimal grid the lake
promises removes the schedule dependence while keeping the exact total for representable inputs.

*Tests (written first, deterministically red).* The grid assertion fails on any off-grid value
(pre-fix: `10015.119999999997 != 10015.12`), so it does not depend on winning a race:

| Test | Kills |
|---|---|
| `test_candle_volume_is_reported_on_a_stable_decimal_grid` | every unrounded sum, deterministically |
| `test_candle_volume_equals_the_exact_tick_sum_on_the_grid` | lost precision (`math.fsum` reference) |
| `test_candle_volume_is_identical_across_repeated_queries_and_readers` | answer drift between queries/readers |

*Verification.* 0 failures in 40 targeted repeats (was 4/25) and **0 failures in 10 consecutive full
suite runs**.

### 6.2 Gap D — the WebSocket replay transport had zero coverage

`server.py` measured **66%**; `play`, `pause`, `seek`, `set_speed`, `step backward`, the error frame
and the CORS preflight were never executed. Twelve tests were added:

* play streams ticks in index order and reports completion; pause halts it (nothing arrives within
  1s); seek jumps to the requested timestamp and resyncs status; `set_speed` clamps to the 0.1×
  floor and is reported back; `step` walks backwards; a malformed action yields an `error` frame and
  the socket survives; `OPTIONS` preflight returns CORS headers; negative/non-integer limits 400.
* Testing the transport needed a **paced tape** (5s between ticks) because the shared mini-lake
  ticks are sub-second spaced, which makes `play_loop` skip every sleep (`delay > 0.001` gate) and
  turns any pause assertion into a race. At the 0.1× floor the paced tape sleeps 30s per tick, so
  the tests are deterministic.
* Frames are asserted **by type, never by position**: `step` answers `tick` *and* `status`, and
  `play` interleaves the two — the frontend itself dispatches by type
  (`src/lib/streamingClient.ts`). Assuming an order was the second flake source found this round.

Coverage: `server.py` **66% → 91%**.

### 6.3 Gap E — reader edges that no test touched

| Area | Test added | Why it matters |
|---|---|---|
| Hive layout without a `symbol` column | `test_files_without_a_symbol_column_report_the_partition_symbol` | the symbol then comes from the partition path — this is the code path that quotes the symbol into SQL |
| SQL-literal escaping | `test_symbol_with_a_quote_is_escaped_in_generated_sql` | symbol `O'BRIEN` must not produce broken/injectable SQL |
| `DATA_DIR` discovery candidate | `test_data_dir_env_candidate_is_discovered`, `test_data_dir_env_contributes_the_first_candidate` | operator-facing precedence documented in 39-RESEARCH |
| Bound normalization | `test_query_bounds_accept_dates_datetimes_and_strings`, `test_unsupported_bound_types_raise_type_error` | `date`, naive/aware `datetime` and ISO strings must agree (`09:00+03:00 == 06:00Z`) |
| Runner guards | `test_reader_rejects_invalid_thread_and_memory_settings` | `threads >= 1`, `max_memory` format |
| Corrupt lake over HTTP | `TestCorruptLakeSurface` (2 tests) | every endpoint (incl. `/api/status`) fails fast with a 503 metadata payload |
| Empty-buffer WS actions | `test_actions_before_load_are_noops_and_session_stays_usable` | seek/step before load answer nothing and must not wedge the session |

Coverage: `tick_lake_reader.py` **93% → 94%**, whole backend **94% → 97%**.

### 6.4 Gap F — pause cancellation was invisible to the wire protocol

Mutation M5 (removing the `play_task.cancel()` on pause) **survived** the frame-level pause test:
setting `is_playing = False` already stops the ticks, so the leaked task is not observable from the
client. Added `TestReplaySessionLifecycle::test_pause_cancels_the_play_task`, which inspects the
session's task directly (and documents that `play_loop` swallows `CancelledError`, so the guarantee
is *finished*, not *cancelled*). Re-running M5 → **KILLED**.

### 6.5 Mutation round 3

| # | Mutation | Result |
|---|---|---|
| M1 | un-rounded candle volume | **KILLED** (grid + fsum tests) |
| M2 | `_sql_literal` without quote escaping | **KILLED** |
| M3 | `threads >= 1` guard disabled | **KILLED** |
| M4 | `DATA_DIR` discovery candidate removed | **KILLED** |
| M5 | pause no longer cancels the play task | survived → lifecycle test added → **KILLED (M5b)** |
| — | all mutations reverted, tree diff verified clean | — |

### 6.6 Documentation rot found and fixed

* `README.md` still described the **retired** architecture (`streaming.duckdb`, `historical.duckdb`,
  SQLite/OPFS fallbacks) and stale test counts (95 tests / 10 backend tests). Rewritten for the tick
  lake, the real discovery precedence, and the current suites (81 Vitest files, 221 backend tests,
  journey command included).
* `src/lib/streamingClient.ts`, `src/types/index.ts` and one Vitest title/comment still named the
  retired database. Fixed (comments only — no runtime behaviour changed; the production bundle hash
  is byte-identical).
* `.gitignore` now ignores `.coverage`/`coverage.xml`/`htmlcov/`.

**Accepted follow-up (not changed on purpose).** The user-facing badge copy still says
“Streaming DuckDB Connected” / “DuckDB streaming service (is running|offline)”, and the Playwright
journey suite *asserts* those exact strings (`tests/regression/journey/01-boot.spec.ts:51,60`).
Renaming them is cosmetic and must be done together with those journey assertions, which cannot be
executed in this sandbox — so it is recorded here instead of changed blind.

### 6.7 Environment note

The sandbox was reset between rounds (the shim venv, mini-lake and `/tmp` clones were gone). The
repository was recovered safely: the working tree was proven byte-identical to the pushed commit
(empty `git diff --cached` against `origin/arena/10770ea5-market-rewind`) before moving the branch
pointer. The venv was rebuilt (`pytest`, `aiohttp`, `orjson`, `duckdb`, `pyarrow`, `httpx`,
`pytest-cov`) and the lake regenerates itself through the `sandbox_lake` fixture, so the suite is
self-healing in a fresh environment.

### 6.8 Fresh-clone verification of the round-3 commit

`/tmp/rev43` = `git clone --depth 1` of the pushed branch at `78179cd`, no files copied:

| Step | Result |
|---|---|
| `npm install` (plain) | 229 packages, no crash |
| `npm run backend:test` | **221 passed, 1 skipped** |
| `npm run test` | **81 files / 422 passed, 2 skipped** |
| `npm run build` | clean |
| sandbox lake | regenerated by the `sandbox_lake` fixture (15 parquet files) — the suite self-heals in a bare checkout |

### 6.9 Round-3 totals

| Metric | Before round 3 | After round 3 |
|---|---|---|
| Backend tests | 197 passed / 1 skipped | **221 passed / 1 skipped** (+24) |
| Backend line coverage | 94% (server 66%) | **97%** (server 91%, reader 94%) |
| Full-suite repeat runs | 1 flake per ~6 runs | **0 failures in 10 runs** |
| Vitest | 81 files / 422 passed | 81 files / 422 passed (reproduced) |
| `npm run build` | clean | clean (identical bundle hash) |
