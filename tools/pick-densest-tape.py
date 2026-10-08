#!/usr/bin/env python3
"""Pick the densest tape in the tick lake for the seek-freeze probe.

The probe's assertions are only meaningful on a tape dense enough to buffer thousands of ticks,
and which symbol that is depends entirely on what is in the local lake. Rather than hard-code a
symbol that may not exist, this asks the streaming service for its inventory (GET /api/symbols,
already sorted by tick_count descending), writes the inventory into the report, and emits shell
assignments for the densest usable session.

Usage:
    python3 tools/pick-densest-tape.py --out /tmp/tape.env --report /tmp/report.txt

Always exits 0: a missing backend must never break the verification harness. An empty --out file
means "no tape could be chosen"; the caller then falls back to its own defaults.
"""

import argparse
import json
import sys
import urllib.request

REGULAR_OPEN = "09:30"


def fetch_symbols(base_url: str, timeout: int):
    url = base_url.rstrip("/") + "/api/symbols"
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def split_stamp(stamp):
    """'2026-09-25T09:30:00.123' | '2026-09-25 09:30:00.123' -> ('2026-09-25', '09:30')."""
    if stamp is None:
        return None, None
    text = str(stamp).replace("T", " ").strip()
    date = text[:10]
    time_hhmm = text[11:16]
    if len(date) != 10 or date[4] != "-":
        return None, None
    return date, (time_hhmm if len(time_hhmm) == 5 else None)


def choose_entry(first_time):
    """Enter at the regular open when the tape starts earlier, else at the tape's own first tick.

    Starting before the first tick leaves the session with no data at t0 and the probe would skip
    itself; starting at 04:00 on an ETH tape drags premarket into every assertion.
    """
    if not first_time:
        return REGULAR_OPEN
    return REGULAR_OPEN if first_time < REGULAR_OPEN else first_time


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="file to write SEEK_* shell assignments to")
    ap.add_argument("--report", required=True, help="report file to append the inventory to")
    ap.add_argument("--base-url", default="http://localhost:8765")
    ap.add_argument("--timeout", type=int, default=120)
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

    def ticks(row):
        try:
            return int(row.get("tick_count") or 0)
        except (TypeError, ValueError):
            return 0

    # /api/symbols is documented as sorted by tick_count descending; sort anyway so the table is
    # honest even if a build returns them unordered.
    ordered = sorted(rows, key=ticks, reverse=True)

    emit("--- tick lake inventory (densest first, top %d of %d) ---" % (args.top, len(rows)))
    emit("    %-8s %12s  %-19s  %-19s" % ("SYMBOL", "TICKS", "FIRST", "LAST"))
    for row in ordered[: args.top]:
        emit(
            "    %-8s %12s  %-19s  %-19s"
            % (
                row.get("symbol"),
                row.get("tick_count"),
                str(row.get("first_tick"))[:19],
                str(row.get("last_tick"))[:19],
            )
        )

    # Densest symbol that actually has a parseable date.
    chosen = None
    for row in ordered:
        date, first_time = split_stamp(row.get("first_tick"))
        if row.get("symbol") and date:
            chosen = (row, date, first_time)
            break

    if chosen is None:
        open(args.out, "w", encoding="utf-8").write("")
        emit("    no symbol with a parseable first_tick; using probe defaults")
        note.close()
        return 0

    row, date, first_time = chosen
    symbol = row["symbol"]
    entry = choose_entry(first_time)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("SEEK_SYMBOL=%s\n" % symbol)
        fh.write("SEEK_DATE=%s\n" % date)
        fh.write("SEEK_ENTRY=%s\n" % entry)
    emit(
        "    chosen tape: %s %s entry %s (%s ticks, first tick %s)"
        % (symbol, date, entry, ticks(row), str(row.get("first_tick"))[:19])
    )
    note.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
