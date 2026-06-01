# Testing Patterns

**Analysis Date:** 2026-06-01

## Test Framework

**Runner:**
- Vitest 4.1.7
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest `expect`
- `@testing-library/jest-dom` for DOM assertions.

**Run Commands:**
```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

## Test File Organization

**Location:**
- Separate `tests/` directory at the root.

**Naming:**
- Unit tests: `*.test.ts` or `*.test.tsx`
- Stress tests: `*.stress.test.ts`
- Performance tests: `*.perf.test.ts` or `*.perf.test.tsx`

**Structure:**
```
tests/
├── setup.ts               # Global test configuration and mocks
├── hooks/                 # Hook-specific tests (using renderHook)
├── integration/           # Multi-component/system flow tests
├── performance/           # Performance benchmarks and regression tests
└── unit/                  # Isolated function and component tests
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi } from 'vitest';
import { functionToTest } from '../../src/lib/module';

describe('functionToTest', () => {
  it('should do X when Y happens', () => {
    const result = functionToTest(mockInput);
    expect(result).toEqual(expectedOutput);
  });
});
```

**Patterns:**
- **Setup pattern:** Global mocks for Browser APIs (Canvas, ResizeObserver, matchMedia) are handled in `tests/setup.ts`.
- **Hook Testing:** Uses `@testing-library/react`'s `renderHook` and `act` to simulate state changes and effect triggers (e.g., `tests/hooks/useTradeManager.test.ts`).
- **Stress Testing:** Dedicated files (e.g., `resampling.stress.test.ts`) to verify stability under high load or large datasets.

## Mocking

**Framework:** Vitest `vi`

**Patterns:**
```typescript
// Mocking a function/method
const mockPlugin = { setTrade: vi.fn() };

// Mocking a browser API in setup.ts
window.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
```

**What to Mock:**
- Browser APIs not implemented in `jsdom` (Canvas, ResizeObserver).
- Complex external dependencies or plugins (e.g., `TradePlugin`).

**What NOT to Mock:**
- Pure utility functions (e.g., `resampling.ts`, `timezones.ts`).
- Core business logic used across multiple hooks.

## Fixtures and Factories

**Test Data:**
- Defined locally within `describe` blocks as constants (e.g., `mockData` in `tests/unit/resampling.test.ts`).

**Location:**
- Currently inline within test files.

## Coverage

**Requirements:** Not explicitly enforced in config.

**View Coverage:**
- Not configured in `package.json` scripts, but supported by Vitest.

## Test Types

**Unit Tests:**
- Focus on pure functions and isolated components.
- Examples: `tests/unit/resampling.test.ts`, `tests/unit/ChartHeader.test.tsx`.

**Integration Tests:**
- Focus on the interaction between hooks and the application lifecycle.
- Example: `tests/integration/lifecycle.test.ts`.

**Hook Tests:**
- Specialized unit tests for custom hooks using `renderHook`.
- Example: `tests/hooks/useTradeManager.test.ts`.

**Performance Tests:**
- Benchmarking specific critical paths (rendering, slicing, caching).
- Examples: `tests/performance/render.perf.test.tsx`, `tests/performance/cache.perf.test.ts`.

## Common Patterns

**Async Testing:**
- Standard Vitest `async/await` pattern.

**Error Testing:**
- Using `expect(() => ...).toThrow()` or checking for `console.error` calls in catch blocks.

---

*Testing analysis: 2026-06-01*
