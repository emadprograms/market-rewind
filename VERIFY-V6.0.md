# Independent verification — market-rewind v6.0 (Offline Order Simulator)

You are an independent verifier. Another agent built milestone **v6.0** in this repository and claims
it works. Your job is to **try to falsify that claim with real numbers** and hand the raw results back.

Do not improve, refactor, or "fix" anything. If something fails, stop that step, capture the raw output,
and carry on with the next section. A failing step reported honestly is worth more than a passing step
quietly made to pass.

---

## 0. Ground rules (read before touching anything)

1. **Never run the data collector.** `tools/research/capital-demo-order-observer.mjs` sends **real
   trading mutations** when invoked as `--pilot`, which is its default. You may *read* it and you may
   run `node tools/research/test-observer-repairs.mjs` and `node tools/research/test-demo-guard.mjs`
   (both are offline test suites). You may **not** run the observer in any other way, even
   `--calibrate`, unless `CAPITAL_DEMO_OFFLINE=1` is set. Never put credentials in this repository.
2. **No network is needed** for anything in this document except `git` and `npm install`. If you find
   yourself authenticating to a broker, you have taken a wrong turn.
3. **Mutation patches are temporary.** Section 4 deliberately breaks the source to prove the tests
   catch it. Every patch must be reverted with `git checkout -- <file>`, and `git status --short` must
   be empty before you move on. Never commit a patch.
4. **Report what happened, not what you expected.** Copy full command output, including failures.
5. If this is not a scratch clone, work in one (`git clone` the repo fresh) so nothing you do touches
   a working copy someone cares about.

---

## 1. Target and provenance

```bash
cd market-rewind
node -v                       # expect v22.x
git rev-parse HEAD
git ls-remote origin refs/heads/arena/d6be95e4-market-rewind
git status --short            # expect EMPTY
```

**Requirement:** the first hash and the `ls-remote` hash must be **identical** (the working copy is at
the published branch tip), and `git status` must be clean. Record both hashes.

Provenance checks — record each result:

```bash
# 1. The milestone is tagged
git tag -l v6.0                                             # expect: v6.0

# 2. The evidence directory is TRACKED (it once was not) and holds exactly 11 bundles
git ls-files docs/research/capital-demo-order-data | wc -l   # expect: 42 files
ls docs/research/capital-demo-order-data | wc -l             # expect: 11
ls docs/research/capital-demo-order-data | sort             # expect 6 × 2026-10-11T11-*, 4 × 2026-10-11T23-42-*, 1 × 2026-10-12T01-00-22

# 3. The six original PILOT bundles are byte-identical to the commit that introduced them
git diff --stat b5aaa21 HEAD -- 'docs/research/capital-demo-order-data/2026-10-11T11-0*'
#    expect: NO OUTPUT. Any output means recorded evidence was rewritten — stop and report it.

# 4. The five clock-probe directories contain no evidence (they are test byproducts)
for d in 2026-10-11T23-42-* 2026-10-12T01-00-22-910Z; do
  echo "$d: $(wc -l < docs/research/capital-demo-order-data/$d/events.jsonl) event(s), \
$(wc -c < docs/research/capital-demo-order-data/$d/quotes.jsonl) bytes quotes, \
$(wc -c < docs/research/capital-demo-order-data/$d/mutation-ledger.jsonl) bytes ledger"
done
#    expect every one: 1 event, 0 bytes quotes, 0 bytes ledger.
#    1 event with `"status": null` and `"error_message": "fetch failed"` = no HTTP response was
#    received and nothing was traded. An empty mutation ledger is the proof that nothing was sent.
```

Also record: `git log --oneline | head -8` (the milestone's commits) and confirm `node_modules`
exists; if it does not, run `npm install --no-audit --no-fund` first (an `EBADENGINE` warning is
expected and harmless).

---

## 2. The full test suite

```bash
npx vitest run --reporter=json --outputFile=/tmp/vitest-full.json > /tmp/vitest-full.log 2>&1; echo "exit=$?"

python3 - <<'PY'
import json
d = json.load(open('/tmp/vitest-full.json'))
print('files  :', len(d['testResults']))
print('tests  :', d['numTotalTests'], 'passed:', d['numPassedTests'],
      'failed:', d['numFailedTests'], 'skipped:', d['numPendingTests'])
print('suites :', d['numPassedTestSuites'], 'passed /', d['numFailedTestSuites'], 'failed')
if d['numFailedTests']:
    for tr in d['testResults']:
        for a in tr['assertionResults']:
            if a['status'] == 'failed':
                print('FAIL:', tr['name'].split('/tests/')[-1], '::', a['title'])
PY
```

**Expected** (the builder's numbers — a small drift is acceptable, a failure is not):

| Metric | Expected |
|---|---|
| Test files | 119 |
| Tests | 982 total = **980 passed, 2 skipped, 0 failed** |
| Suite duration | roughly 150–260 s on a normal machine |

**The 2 skips must be explainable, not mysterious.** They are in
`tests/regression/chart/tslaHistoryData.test.ts` and skip themselves when the DuckDB streaming backend
is not running (`GET /health` fails). Confirm that is what the log shows. Any *other* skip is a finding.

Breakdown, to be reported as-is:

| Directory | Tests |
|---|---|
| `tests/unit` | 698 |
| `tests/regression` | 83 |
| `tests/integration` | 81 |
| `tests/codex` | 48 |
| `tests/performance` | 32 |
| `tests/hooks` | 26 |
| `tests/verification` | 9 |
| `tests/helpers` | 5 |

---

## 3. Independent probes (the important section)

`tests/verification/independentProbes.test.ts` is a small suite written so its expected values can be
**derived from the documented rules by hand**, not read out of the code. It prints one `PROBE …` JSON
line per observation.

```bash
npx vitest run tests/verification/independentProbes.test.ts 2>&1 | grep -E 'PROBE|Tests '
```

Then verify, for each probe, that the printed value matches the arithmetic below. A mismatch is a
finding — report it and do **not** adjust the expectation.

**Latency model used everywhere below** (the active profile is `training`):
instruction travel **100 ms**, broker acceptance **0 ms**, execution dispatch **50 ms**,
fill notification **100 ms**, quote freshness limit **2000 ms**. A BUY pays the **ask**, a SELL
receives the **bid**.

| Probe | What it asserts | Derivation you should check by hand |
|---|---|---|
| **P1** | A market order fills at the execution-time ask, not the submitted ask | Tape `100.00/100.50 @t=0`, `101.00/101.50 @t=1000`. Arrival `0+100=100`, eligible `100+0+50=150`. At t=150 the newest quote is the t=0 one → fill = its ask **100.50** at **t=150**, `notificationMs = 100` |
| **P2** | A BUY stop triggers on the **ask**, latches once, and reports slippage in ticks | Stop at `101.50`; at t=1000 the ask is `102.05 ≥ 101.50` → fill `102.05`; slippage `(102.05−101.50)/0.05` = **11 ticks**; exactly **1** `TRIGGERED` event |
| **P3** | A BUY limit triggers on the **ask**, equality included, and never pays through its level | Limit `99.50`; ask `99.50` at t=1000 satisfies it (equality) → fill `99.50`, movement `(99.50−100.50)/0.05` = **−20 ticks** (favourable), and fill ≤ level |
| **P4** | A position closes **exactly once**; the second request is refused; PnL is realised once | Entry `100.50` (from P1); exit at bid `105.00`; size `0.01` → realised `(105.00−100.50)×0.01` = **0.045**. Expect `secondOk:false` and **one** close fill |
| **P5** | An instruction is **not** judged against a price from its own future | A validly placed BUY stop at `102` is accepted and fills at `102.05` even though a t=300 quote was handed over before its arrival was processed. Control **P5b**: a BUY stop at `95` (below the market when placed) is refused outright with `accepted:false` and **0** orders created |
| **P6** | Two mounted views of one account cannot double-count | One order → **one** position id, identical in both views, `accountOpenCount:1`; unmounting one view does not change the account |
| **P7** | A stalled account says so instead of inventing a price, and recovers | **P7a**: no tape → `frozen:true`, `frozenReason:"MISSING_TAPE"`, **0** fills, `nowMs` did not advance. **P7b**: after data arrives, `frozen:false`, 1 fill at the newest quote it could see at the eligible instant = **100.50** at t=150 |
| **P8** | Determinism: batching is invisible, and no wall clock is read | Same tape fed as one frame vs 39 frames → **identical** digest |

Determinism across timezones (this is the check that would expose a hidden wall-clock read):

```bash
TZ=UTC        npx vitest run tests/verification/independentProbes.test.ts 2>&1 | grep 'PROBE P8'
TZ=Asia/Tokyo npx vitest run tests/verification/independentProbes.test.ts 2>&1 | grep 'PROBE P8'
# expect the SAME digest in both lines, and in both runs of the same line
```

---

## 4. Mutation testing — do the tests actually catch bugs?

These patches **deliberately break the engine**. Each one must be caught by at least one test. Run each
block exactly as written; each reverts itself at the end and prints how many tests failed.

> If any mutation reports `failed: 0`, that is a **serious finding**: it means a documented
> guarantee is not actually covered. Report it and continue.

```bash
cd market-rewind

run_mutation() {                     # $1 = label, $2 = test files, $3 = python patch
  NAME="$1"; TESTS="$2"; PATCH="$3"
  python3 -c "$PATCH"
  npx vitest run $TESTS --reporter=json --outputFile=/tmp/mut.json >/dev/null 2>&1
  python3 - <<'PY'
import json
d = json.load(open('/tmp/mut.json'))
fails = [a['title'] for tr in d['testResults'] for a in tr['assertionResults'] if a['status'] == 'failed']
print(f"  caught by {len(fails)} test(s); total in run: {d['numTotalTests']}")
for t in fails[:5]:
    print('    -', t[:90])
PY
  git checkout -- .
  echo "  reverted; dirty files now: $(git status --short | wc -l)  (must be 0)"
}

echo '--- M1: buy stop triggers on the bid instead of the ask (the classic broker bug)'
run_mutation M1 "tests/unit/orderSimulator/engine.test.ts tests/regression/behaviouralMatrix.test.ts" "
import pathlib
p=pathlib.Path('src/lib/orderSimulator/triggers.ts'); s=p.read_text()
old=\"    BUY: {\n      field: 'ask',\n      direction: '>=',\"
new=\"    BUY: {\n      field: 'bid',\n      direction: '>=',\"
assert old in s; p.write_text(s.replace(old,new,1)); print('  patch applied')
"

echo '--- M2: drop equality from every trigger comparison'
run_mutation M2 "tests/unit/orderSimulator/engine.test.ts tests/regression/behaviouralMatrix.test.ts" "
import pathlib
p=pathlib.Path('src/lib/orderSimulator/triggers.ts'); s=p.read_text()
old=\"return rule.direction === '<=' ? observed <= level : observed >= level;\"
new=\"return rule.direction === '<=' ? observed < level : observed > level;\"
assert old in s; p.write_text(s.replace(old,new,1)); print('  patch applied')
"

echo '--- M3: notification delay 100 ms -> 0 ms (the timeline must notice)'
run_mutation M3 "tests/unit/orderSimulator/uiViewModels.test.ts tests/integration/tradeDeskUi.test.tsx" "
import pathlib
p=pathlib.Path('src/lib/orderSimulator/profiles.ts'); s=p.read_text()
old=\"notificationMs: assumption(100, 'Illustrative fill-notification delay. No confirmation stream was captured.'),\"
new=\"notificationMs: assumption(0, 'Illustrative fill-notification delay. No confirmation stream was captured.'),\"
assert old in s; p.write_text(s.replace(old,new,1)); print('  patch applied')
"

echo '--- M4: accept an out-of-order quote (engine clock discipline)'
run_mutation M4 "tests/unit/orderSimulator/engine.test.ts tests/unit/orderSimulator/determinism.test.ts" "
import pathlib
p=pathlib.Path('src/lib/orderSimulator/engine.ts'); s=p.read_text()
old='if (quote.replayMs < this.nowMs) {'
new='if (false) {'
assert old in s; p.write_text(s.replace(old,new,1)); print('  patch applied')
"

echo '--- M5: judge an instruction against a later quote (the phase-48 bug must stay fixed)'
run_mutation M5 "tests/unit/orderSimulator/engine.test.ts tests/regression/behaviouralMatrix.test.ts" "
import pathlib
p=pathlib.Path('src/lib/orderSimulator/engine.ts'); s=p.read_text()
old='const quote = this.quoteAsOf(order.symbol, acceptedAtMs) ?? order.submittedQuote ?? null;'
new='const quote = this.lastQuoteBySymbol.get(order.symbol.toUpperCase()) ?? null;'
assert old in s; p.write_text(s.replace(old,new,1)); print('  patch applied')
"

echo '--- M6: fill / accept with no quote at all'
run_mutation M6 "tests/unit/orderSimulator/uiViewModels.test.ts tests/integration/tradeDeskUi.test.tsx" "
import pathlib
p=pathlib.Path('src/lib/orderSimulator/engine.ts'); s=p.read_text()
old='''    if (!quote) {
      order.state = 'REJECTED';
      order.terminalAt = this.nowMs;
      order.rejectReason = 'NO_VALID_QUOTE';'''
new='''    if (false) {
      order.state = 'REJECTED';
      order.terminalAt = this.nowMs;
      order.rejectReason = 'NO_VALID_QUOTE';'''
assert old in s; p.write_text(s.replace(old,new,1)); print('  patch applied')
"
```

Finally: `git status --short` must be empty, and `git diff --stat` must show nothing.

---

## 5. Performance numbers (report the raw lines)

```bash
npx vitest run tests/performance/replaySeek.perf.test.ts 2>&1 | grep -E 'PERF|Tests '
```

Each guard prints its own measurement. **Report the three `PERF` lines verbatim**, plus your CPU model
(`grep -m1 'model name' /proc/cpuinfo` on Linux, `sysctl -n machdep.cpu.brand_string` on macOS) and
Node version. The builder's baseline on an unknown cloud vCPU was:

| Measurement | Builder's number |
|---|---|
| 20,000 quotes fed in one batch | ~17 ms (~1.2 M quotes/s) |
| Rewind 20,000 quotes to the 25 % point, then re-advance | ~3 ms rewind, ~3 ms forward |
| 20,000-quote run with 3 live instructions | ~21 ms, 2 fills |

The assertions inside the guards allow 4 seconds, so time is not the pass condition — the point is to
see the real figure. **Report anything more than ~10× slower than the baseline above** as a
performance finding; anything in the same order of magnitude is fine.

---

## 6. Offline research tooling (no network)

```bash
node tools/research/analyze-capital-demo-observations.mjs --check 2>&1 | tail -3   # expect: 19/19 passed
node tools/research/test-observer-repairs.mjs 2>&1 | tail -3                        # expect: 39 passed, 0 failed
node tools/research/test-demo-guard.mjs 2>&1 | tail -3                              # expect: 16/16 passed
```

Then prove the test suite cannot pollute the recorded evidence:

```bash
before=$(ls docs/research/capital-demo-order-data | wc -l)
node tools/research/test-observer-repairs.mjs >/dev/null 2>&1
echo "bundles before=$before after=$(ls docs/research/capital-demo-order-data | wc -l)  (must be equal, 11)"
git status --short   # must be empty — no new bundle directories, no modified artifacts
```

This is a check on a defect that really happened: the collector's test suite used to issue clock probes,
and five bundle directories in the evidence path were created by them (four in the original build, one
more later). Inside those, the observer now enforces `CAPITAL_DEMO_OFFLINE=1` at the transport boundary
and spawns only from a throwaway working directory. Record (a) the three tallies, (b) that the bundle
count did not change, and (c) `grep -c OFFLINE_MODE` style evidence if a sub-test reports it.

Also confirm the kill switch really exists and really fires:

```bash
grep -n 'CAPITAL_DEMO_OFFLINE' tools/research/capital-demo-order-observer.mjs | head
CAPITAL_DEMO_OFFLINE=1 node tools/research/capital-demo-order-observer.mjs --calibrate 2>&1 | grep -i 'OFFLINE_MODE' | head -3
# expect a refusal naming CAPITAL_DEMO_OFFLINE=1. No connection may be attempted, and no bundle may appear.
ls docs/research/capital-demo-order-data | wc -l   # still 11
```

---

## 7. Typecheck and production build

```bash
npx tsc --noEmit          # expect: no output at all
npx vite build 2>&1 | tail -4
```

The build prints a pre-existing "chunks larger than 500 kB" advisory. That is expected and is not a
finding; a compile error would be.

---

## 8. Optional — browser journey suite

```bash
npx playwright test -c playwright.journey.config.ts --list   # expect: 80 tests in 15 files
npx playwright install chromium                              # may fail: no route to the CDN
npx playwright test -c playwright.journey.config.ts          # only if the browser installed
```

The builder could **not** run this (the browser binary was undownloadable in their environment), so
**no browser result is currently proven either way.** If your machine can run it, this is the single
most valuable thing you can add. Report:

- whether the browser installed;
- the pass/fail counts;
- the titles of every failure, verbatim.

Two things are already known and should not be mistaken for new bugs:

1. Four tests in `tests/regression/journey/07-trading.spec.ts` are marked `test.fixme` on purpose.
   They assert the **old netting behaviour** (buying twice accumulates one position; an opposite order
   closes or flips it), which v6.0 deliberately replaced with independent positions. They are disabled
   rather than left failing because their replacement cannot be verified without a browser.
2. The badge/PnL assertions in `07` and `08` may need re-baselining for the same reason: the badge now
   shows the most recent open position, and PnL is account-wide rather than per chart.

---

## 9. Known-true facts — do not report these as findings

| Observation | Status |
|---|---|
| 2 skipped tests | Expected: backend-dependent TSLA history tests |
| `EBADENGINE` warning on `npm install` | Warning only |
| Vite "chunks larger than 500 kB" | Pre-existing advisory |
| 11 bundle directories, 5 of them clock-probe-only | Documented in `docs/research/capital-demo-pilot-evidence-audit.md` §0 |
| 4 `test.fixme` browser tests | Intentional; see §8 |
| `Fill.priceChangeFromSubmitTicks` / `stopToFillDifferenceTicks` are **tick counts**, not currency | Documented naming rule (they were renamed from an ambiguous form) |
| A tick-independent quote in `playbackBridge` is marked `derived: true` | Derived spread is disclosed, not presented as observed |

---

## 10. Paste this back

Fill in and paste the whole block. Raw output beats summary; do not tidy failures away.

```
VERIFICATION REPORT — market-rewind v6.0
machine: <CPU> / <cores> / <RAM> / <OS>        node: <version>

1. PROVENANCE
   HEAD               = <hash>
   origin branch tip  = <hash>          identical? yes/no
   git status (before/after) = <?> / <?>
   v6.0 tag           = present/absent
   evidence bundles   = <n>   tracked files = <n>
   original 6 pilot bundles byte-identical? yes/no   (git diff output if no)
   probe directories: events/quotes/ledger per directory = <…>

2. FULL SUITE
   files/tests/passed/failed/skipped = <?>
   duration = <?> s        skips explained? <what the log said>
   failing test titles (if any): <…>
   per-directory counts: unit=? regression=? integration=? codex=? performance=? hooks=? verification=? helpers=?

3. INDEPENDENT PROBES
   PROBE P1 … (paste all PROBE lines verbatim)
   TZ=UTC    P8 digest = <…>
   TZ=Tokyo  P8 digest = <…>       identical? yes/no
   any probe whose value differs from the derivation in §3: <list or "none">

4. MUTATION TESTING
   M1 caught by <n> test(s)     M2 <n>   M3 <n>   M4 <n>   M5 <n>   M6 <n>
   any mutation with 0 failures: <list or "none">
   git status after reverting all patches = <must be empty>

5. PERFORMANCE (verbatim)
   PERF dense-batch …
   PERF dense-seek …
   PERF instruction-batch …

6. OFFLINE TOOLING
   analyzer = <?>/19     repair suite = <?> passed / <?> failed     demo guard = <?>/16
   bundles before/after the repair suite = <?> / <?>
   CAPITAL_DEMO_OFFLINE=1 probe refusal = <observed? yes/no + the line>

7. TYPECHECK / BUILD
   tsc --noEmit = clean / <errors>
   vite build   = ok / <errors>

8. BROWSER (optional)
   installed? yes/no        tests = <?> passed / <?> failed / <?> fixme
   failing titles: <…>

9. ANYTHING ELSE THAT LOOKED WRONG
   <free text — especially anything you could not explain>
```

---

## What "verified" means

The claim being tested is that v6.0's simulator is correct, deterministic, honest about what it does
not know, and unable to touch the network or a broker account. It is **verified** if, and only if:

1. every section above ran and produced the expected result, with no unexplained failures;
2. all nine probes match the hand-derivations in §3;
3. every one of the six mutations is caught by at least one test;
4. the recorded evidence is byte-unchanged, no new bundle appeared, and the offline switch refuses;
5. the full suite and the build are clean.

Anything less is a finding, and a finding is the most useful thing you can hand back.
