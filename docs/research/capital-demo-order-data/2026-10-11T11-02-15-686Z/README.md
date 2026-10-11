# Capital.com Demo Order Observation Run 2026-10-11T11-02-15-686Z

## Artifact Description
- `manifest.json`: Run settings, clock calibration, account alias, and integrity outcomes.
- `events.jsonl`: Full REST and WebSocket confirmation timeline with monotonic stamps.
- `quotes.jsonl`: Continuous streaming tick tape captured during the run.
- `mutation-ledger.jsonl`: Durable, synchronously flushed mutation ledger.
- `orders.csv`: Tabular experiment entries and metrics.
- `baseline.json`: Pre-run account and order snapshot.
- `final-state.json`: Post-run account and order snapshot.

## Execution Guard Proof
All network communications strictly locked to:
- REST: `https://demo-api-capital.backend-capital.com`
- Streaming: `wss://api-streaming-capital.backend-capital.com/connect`
All credentials and account IDs sanitized and pseudonymized.
