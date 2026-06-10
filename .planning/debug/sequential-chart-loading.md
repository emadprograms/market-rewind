---
status: resolved
trigger: "Why do the charts in the application load one by one (sequentially) rather than simultaneously?"
created: 2025-05-22T10:00:00Z
updated: 2025-05-22T10:15:00Z
---

## Current Focus

hypothesis: The sequential loading is caused by the single-threaded nature of the Web Worker and the synchronous execution of SQLite queries.
test: Code analysis of the data loading path from App -> ChartWorkspace -> ChartUnit -> useChartData -> db.worker.ts.
expecting: Confirmation that data requests are sent in parallel but processed sequentially in the worker.
next_action: "None - Root cause identified."

## Symptoms

expected: Charts load simultaneously.
actual: Charts load one by one (sequentially).
errors: none reported
reproduction: Load the application with multiple charts.
started: always broken

## Eliminated

## Evidence

- timestamp: 2025-05-22T10:05:00Z
  checked: App.tsx and ChartWorkspace.tsx
  found: ChartWorkspace renders multiple ChartUnit components using .map(). This is a parallel operation in React.
  implication: The sequential behavior is not caused by a loop in the UI rendering logic.

- timestamp: 2025-05-22T10:10:00Z
  checked: ChartUnit.tsx and useChartData.ts
  found: Each ChartUnit invokes useChartData, which triggers an async fetchMarketData call in a useEffect.
  implication: Requests are initiated almost simultaneously for all charts.

- timestamp: 2025-05-22T10:12:00Z
  checked: lib/db.ts and lib/workers/db.worker.ts
  found: All database requests are routed through a single DatabaseWorkerProxy to a single Web Worker. The worker uses sql.js and calls db.exec(), which is a synchronous, blocking operation.
  implication: Because the Web Worker is single-threaded, it must finish executing one synchronous SQL query before it can process the next message in its queue.

## Resolution

root_cause: The sequential loading is caused by the architectural bottleneck of using a single Web Worker with a synchronous database engine (sql.js). When multiple charts are loaded, they all send data requests to the worker. The worker processes these requests sequentially (one by one) because it is single-threaded and the SQL queries are blocking. Consequently, each chart's data arrives back at the main thread in the order it was requested, causing the charts to render one after another.
fix: N/A (Diagnostic inquiry only)
verification: Code analysis confirms the request-response chain: Parallel UI requests -> Single Worker Queue -> Sequential Synchronous Execution -> Sequential UI Updates.
files_changed: []
