# External Integrations

**Analysis Date:** 2026-06-01

## APIs & External Services

**Market Data:**
- Polygon.io (Massive) - Primary source for historical 1-minute OHLCV stock data.
  - SDK/Client: `polygon-api-client` (Python)
  - Auth: Handled via Infisical secret manager.

**Secret Management:**
- Infisical - Centralized secret store for API keys and database credentials.
  - SDK/Client: `infisical-sdk` (Python)
  - Auth: `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`.

## Data Storage

**Databases:**
- Turso (LibSQL) - Cloud-native SQLite distribution used for long-term historical data storage.
  - Connection: `libsql://` URLs managed in Infisical.
  - Client: `libsql-client` (Python) for backend writers.

**Local Browser Storage:**
- OPFS (Origin Private File System) - Used by the frontend to cache the `.db` SQLite file for high-performance local queries.
  - Implementation: `src/lib/db.ts` using `navigator.storage.getDirectory()`.

**File Storage:**
- Local filesystem - Used by backend archival scripts to handle temporary processing.

**Caching:**
- None - The system relies on the local SQLite WASM database for near-instant data access in the frontend.

## Authentication & Identity

**Auth Provider:**
- Custom/None - The application appears to be a specialized tool with no user-facing authentication system detected.

## Monitoring & Observability

**Error Tracking:**
- Not detected - Basic `console.error` and Python `print` logs are used.

**Logs:**
- Standard output (stdout) - Backend scripts output detailed progress logs to the console.

## CI/CD & Deployment

**Hosting:**
- Vercel - Frontend deployment target as defined in `vercel.json`.

**CI Pipeline:**
- GitHub Actions - Workflows detected in `.github/workflows/` (e.g., `sync_app_db.yml`, `sync_archive_db.yml`).

## Environment Configuration

**Required env vars:**
- `INFISICAL_CLIENT_ID` - Client ID for Infisical auth.
- `INFISICAL_CLIENT_SECRET` - Client secret for Infisical auth.
- `INFISICAL_PROJECT_ID` - Project ID for Infisical secret retrieval.

**Secrets location:**
- Infisical - Primary secrets store.
- `.env` - Local development overrides for Infisical credentials.

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

---

*Integration audit: 2026-06-01*
