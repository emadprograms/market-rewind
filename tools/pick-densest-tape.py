#!/usr/bin/env python3
"""Report the tick lake's inventory and name its densest symbol.

The freeze probe needs a tape dense enough to buffer thousands of ticks in one session. Which
symbol that is depends entirely on the local lake, so it is discovered through
`GET /api/symbols` rather than hard-coded.

IMPORTANT: `/api/symbols` aggregates over the **whole lake**, not per session. A real lake reports
e.g. `NVDA 16,896,676 ticks, first 2025-03-21T13:00:27, last 2026-10-08T09:10:04` — 19 months of
sessions rolled into one row. So `first_tick` says nothing about which *day* is dense, and an
earlier version of this tool that derived the session date from `first_tick` selected the lake's
oldest partial day (13:00 on the very first partition). The date therefore comes from the repo's
own E2E convention (SEED_DATE in tests/regression/e2e-utils.ts), which the live regression suite
already proves works; this tool contributes the symbol and the inventory only.

Usage:
    python3 tools/pick-densest-tape.py --out /tmp/tape.env --report /tmp/report.txt

Always exits 0: a missing backend must never break the verification harness. An empty --out file
means "no symbol could be chosen"; the caller then runs the spec's built-in defaults only.
"""

import argparse
import json
import sys
import urllib.request


def fetch_symbols(base_url: str, timeout: int):
    url = base_url.rstrip("/") + "/api/symbols"
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def tick_count(row) -> int:
    try:
        return int(row.get("tick_count") or 0)
    except (TypeError, ValueError):
        return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="file to write DENSE_SYMBOL=<sym> to")
    ap.add_argument("--report", required=True, help="report file to append the inventory to")
    ap.add_argument("--base-url", default="http://localhost:8765")
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--top", type=int, default=10, help="how many symbols to list in the report")
    args = ap.parse_args()

    note = open(args.report, "a", encoding="utf-8")

    def emit(line=""):
        print(line)
        note.write(line + "\n")

    try:
        rows = fetch_symbols(args.base_url, args.timeout)
    except Exception as exc:  # noqa: BLE001 - never break the harness
        open(args.out, "w", encoding="utf-8").write("")
        emit("--- tick lake inventory ---")
        emit("    /api/symbols unavailable: %r" % (exc,))
        emit("    probe falls back to its built-in defaults (AAPL / SEED_DATE / 09:30)")
        note.close()
        return 0

    if not isinstance(rows, list) or not rows:
        open(args.out, "w", encoding="utf-8").write("")
        emit("--- tick lake inventory ---")
        emit("    empty or unexpected response: %r" % (rows,))
        note.close()
        return 0

    # Sorted defensively: the endpoint documents descending tick_count, but do not rely on it.
    ordered = sorted(rows, key=tick_count, reverse=True)

    emit("--- tick lake inventory (densest first, top %d of %d) ---" % (args.top, len(rows)))
    emit("    counts are WHOLE-LAKE aggregates across every session, not a single day")
    emit("    %-8s %12s  %-19s  %-19s" % ("SYMBOL", "TICKS", "FIRST", "LAST"))
    for row in ordered[: args.top]:
        emit(
            "    %-8s %12s  %-19s  %-19s"
            % (
                row.get("symbol"),
                tick_count(row),
                str(row.get("first_tick"))[:19],
                str(row.get("last_tick"))[:19],
            )
        )

    dense = next((r for r in ordered if r.get("symbol")), None)
    if dense is None:
        open(args.out, "w", encoding="utf-8").write("")
        emit("    no usable symbol; probe runs on its built-in defaults only")
        note.close()
        return 0

    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("DENSE_SYMBOL=%s\n" % dense["symbol"])
    emit(
        "    densest symbol: %s (%s ticks across the whole lake)"
        % (dense["symbol"], tick_count(dense))
    )
    note.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
