# Technology Stack

**Analysis Date:** 2026-06-01

## Languages

**Primary:**
- TypeScript 6.0.3 - Used for the entire frontend application and type definitions.
- Python 3.x - Used for backend data ingestion, archival, and synchronization tools.

**Secondary:**
- SQL - Used for data queries in both the frontend (SQLite/WASM) and backend (LibSQL).
- HTML/CSS - Used for the application shell and styling.

## Runtime

**Environment:**
- Node.js (via Vite) - Frontend development and build process.
- Python Runtime - Backend data processing scripts.

**Package Manager:**
- npm - Frontend dependencies.
- pip (via requirements.txt) - Python backend dependencies.
- Lockfile: `package-lock.json` (implied by npm).

## Frameworks

**Core:**
- React 18.3.1 - UI framework for the main application.
- Vite 5.4.10 - Build tool and development server.

**Testing:**
- Vitest 4.1.7 - Unit and integration testing framework.
- React Testing Library 16.3.2 - Testing React components.
- jsdom 29.1.1 - Browser environment simulation for tests.

**Build/Dev:**
- TypeScript 6.0.3 - Static typing and transpilation.

## Key Dependencies

**Critical:**
- `lightweight-charts` 4.2.1 - High-performance financial charting library used for rendering stock data.
- `sql.js` 1.10.3 - SQLite WASM implementation allowing the frontend to query a local database file directly in the browser.
- `zustand` 5.0.14 - Lightweight state management for application-wide state (e.g., playback, session).
- `lucide-react` 0.453.0 - Icon library.

**Infrastructure:**
- `libsql-client` / `libsql` - Client for Turso (LibSQL) used in backend synchronization.
- `polygon-api-client` - SDK for fetching historical stock data from Polygon.io.
- `infisical-sdk` - Secret management for API keys and database credentials.

## Configuration

**Environment:**
- Frontend: Managed via Vite and standard environment variable patterns.
- Backend: `.env` files (loaded via `python-dotenv`) for Infisical and Turso credentials.

**Build:**
- `tsconfig.json`, `tsconfig.node.json` - TypeScript configuration.
- `vite.config.ts` - Vite build and plugin configuration.
- `vitest.config.ts` - Vitest testing configuration.

## Platform Requirements

**Development:**
- Node.js (v18+ recommended for Vite 5)
- Python 3.x
- npm

**Production:**
- Vercel (as indicated by `vercel.json`) - Frontend hosting.
- Turso (LibSQL) - Backend data storage.

---

*Stack analysis: 2026-06-01*
