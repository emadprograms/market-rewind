# Phase 04: Systemic Hardening & Audit - Validation

**Phase Goal**: Map architectural fragility and resolve systemic technical debt to ensure long-term maintainability.

## Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Expected Outcome |
|--------|----------|-----------|-------------------|------------------|
| HARD-01 | Decomposed Hooks | unit | `npm test` | `useChartInit`, `useChartPlugins`, `useChartDrawings`, `useChartViewport` all pass their unit tests. |
| HARD-02 | Removed `as any` | static | `npm run build` | TypeScript compilation succeeds without new `any` types in plugin renderers. |
| HARD-03 | Viewport Stability | integration | `npm test` | `tests/integration/viewport.test.ts` passes, verifying no collisions between Auto-Reveal and Prepend History. |
| HARD-04 | No Main-Thread DB Block | perf | `npm test` | `tests/performance/db.perf.test.ts` demonstrates that large DB queries do not block the main thread. |

## Validation Architecture

### Primary Tooling
- **Vitest**: Used for all unit, integration, and performance tests.
- **TypeScript Compiler**: Used for static analysis to verify the removal of `as any`.

### Test Implementation Strategy
1. **Unit Tests**: Create focused tests for each new decomposed hook in `tests/unit/hooks/chart/`.
2. **Integration Tests**: Update existing `viewport.test.ts` to include specific cases for concurrent Prepend and Auto-Reveal updates.
3. **Performance Tests**: Create a benchmark test in `tests/performance/db.perf.test.ts` that measures UI responsiveness (using `requestAnimationFrame` or similar) during a large `sql.js` fetch.

## Sampling Rate
- **Per task commit**: `npm test`
- **Phase gate**: Full suite green before `/gsd:verify-work`.
