# Phase 42 Research — Comprehensive Verification & Regression Immunity

**Phase:** 42-comprehensive-verification-regression-immunity
**Milestone:** v5.0 Partitioned Parquet Tick Lake Integration (Repo B Contract Compliance)
**Requirements:** LAKE-VERIFY-01, LAKE-VERIFY-02
**Researched:** 2026-10-06
**Sources:** `42-01-PLAN.md`, `.planning/research/SUMMARY.md`, live runs of both test suites in this sandbox.

---

## 1. Scope

Phase 42 is a verification phase, but in this repository it must first repair the frontend test
harness, which cannot currently load 62% of its files. Deliverables: 100% green backend suite,
100% green Vitest suite, green Playwright journey suite, clean production build.

## 2. Baseline Measurements (before any Phase 42 change)

| Suite | Command | Result |
|---|---|---|
| Backend pytest | `npm run backend:test` | **197 passed, 1 skipped, 0 failed** (Phases 39–41) |
| Vitest | `npm run test` | **30 files passed, 50 files FAILED to load**, 187 tests passed |
| Production build | `npm run build` | not yet measured |
| Playwright journey | `npm run test:journey` | not yet measured (needs a browser download) |
| Dependency install | `npm install` | **crashes** in npm's arborist (`Cannot read properties of null (reading 'edgesOut')`) resolving `vitest`'s peer set; `--legacy-peer-deps` installs 221 packages |

## 3. Root Causes of the Vitest Failures

1. **49 suites: `Cannot find module '@testing-library/dom'`.**
   `@testing-library/react@16` declares `@testing-library/dom` as a **peer dependency**, but
   `package.json` never lists it. A plain `npm install` would normally auto-install peers, except
   that npm 10.9.8 crashes on this graph, and the `--legacy-peer-deps` workaround (required to
   install at all) intentionally skips peers — so the peer is simply absent.

2. **1 suite: absolute developer-machine paths.**
   `tests/codex/convergence/5e0b776-review.test.ts` imports
   `/Users/emadarshadalam/Documents/GitHub/market-rewind/...` in 10 places (including `vi.mock`
   specifiers). It can only ever run on the author's Mac.

3. **`npm install` crash (environment/repo defect).**
   npm's `#loadPeerSet` fails while resolving `vitest` ⇄ `jsdom` ⇄ optional `canvas` peers.
   Every other contributor hits this, so the repo needs a durable `npm install` story.

## 4. Fix Strategy

| Defect | Fix |
|---|---|
| Missing RTL peer | Add `@testing-library/dom` to `devDependencies` (it is already an implicit runtime requirement of the suite via RTL) |
| Absolute machine paths | Rewrite to the repository convention used by sibling codex tests: bare `@testing-library/react` and `../../../src/...` relative specifiers |
| npm arborist crash | Add a committed `.npmrc` with `legacy-peer-deps=true` (documented) so `npm install` works without ad-hoc flags for every contributor |
| Regression risk (this class of defect recurs) | Add a hygiene test that fails if any test/src file contains an absolute machine path in an import/mock specifier |

## 5. Test Plan

* **Backend (LAKE-VERIFY-01):** run `npm run backend:test` and record the exact counts; no code
  changes expected (Phases 39–41 already closed their gaps).
* **Vitest (LAKE-VERIFY-02):** 80 files, 418+ tests expected green after the two repairs; new
  hygiene test included.
* **Playwright journey:** `npm run test:journey` — the suite is fully mocked and only needs the
  Vite dev server (`playwright.journey.config.ts` boots it on port 3000); a Chromium download is
  required. If the sandbox cannot download a browser, the phase documents the exact command for
  the developer's machine and reports the suite as environment-blocked rather than passing.
* **Build:** `npm run build` must compile cleanly.

## 6. Risks

| Risk | Mitigation |
|------|-----------|
| Fixing imports could alter test semantics | Only module specifiers change; no assertions touched; byte-diff reviewed |
| `legacy-peer-deps=true` masks genuine peer conflicts | Documented in the phase summary; the missing peer is now an explicit devDependency, so the flag only suppresses npm's arborist crash |
| Browser download blocked in sandbox | Report honestly as blocked; provide `npx playwright install chromium` for the dev machine |
| Vitest runtime (90s) and Playwright (90s/test) exceed command timeouts | Run long suites via background process with log tailing |
