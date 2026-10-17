#!/usr/bin/env python3
"""Data-side probe for the 1D daily-candle defects.

The frontend half of the bug is proven and fixed in tests/regression/chart/dailyCandleCanvasFormation.test.tsx:
the 1D chart aggregated the day's constituent 1-minute bars with `isRthBar(bar, ticker, '1D')`, which
classified every constituent as an already-aggregated daily bar and exempted it from the RTH test, so
overnight / pre-market / post-market minutes set the daily open, high, low and volume.

This probe answers the questions that need REAL data — i.e. whether the backend's own daily bar is
trustworthy, or whether the same wrongness is baked into the lake:

  C1  the exact query the frontend issues (`tf=1d`, no start_time, limit 1500) — status, timing, and
      the target date's bar
  C2  a bounded `tf=1d` query for just that day, with session=REG and session=ALL
  C3  tick-level RTH ground truth for that day, aggregated here and compared against C1/C2
  C4  the lake's own `session` labelling: per-session tick counts and the UTC time range of each
  C5  whether `tf=1m` serves extended-hours minutes to the frontend at all
  C6  contention timing: the 1d query while a 1m query and a 100k-tick query run concurrently
      (the frontend aborts any candle fetch above 15s and silently returns [])

Usage:
    python3 tools/probe-daily-candle.py --symbol TSLA --date 2026-10-14
    python3 tools/probe-daily-candle.py --symbol TSLA --date 2026-10-14 --base http://127.0.0.1:8080
    python3 tools/probe-daily-candle.py --symbol TSLA --date 2026-10-14 --report /tmp/daily-probe.md

Always exits 0 unless --strict: an unreachable backend must not break the verification harness.
Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
DEFAULT_BASE = "http://127.0.0.1:8765"


def fetch(base: str, path: str, params: dict, timeout: float = 60.0):
    """Return (status, payload, seconds, error). Never raises."""
    url = f"{base.rstrip('/')}{path}?{urllib.parse.urlencode(params)}"
    started = time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            body = resp.read()
            elapsed = time.monotonic() - started
            try:
                return resp.status, json.loads(body), elapsed, None
            except json.JSONDecodeError:
                return resp.status, None, elapsed, f"non-JSON body: {body[:200]!r}"
    except urllib.error.HTTPError as exc:
        elapsed = time.monotonic() - started
        detail = ""
        try:
            detail = exc.read()[:400].decode("utf-8", "replace")
        except Exception:
            pass
        return exc.code, None, elapsed, detail or str(exc)
    except Exception as exc:  # timeout, refused, DNS
        return 0, None, time.monotonic() - started, f"{type(exc).__name__}: {exc}"


def rth_window_utc(date_str: str) -> tuple[datetime, datetime]:
    """The RTH window for a date, expressed in the naive-UTC timestamps the lake serves."""
    day = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=ET)
    open_et = day.replace(hour=9, minute=30, second=0, microsecond=0)
    close_et = day.replace(hour=16, minute=0, second=0, microsecond=0)
    return open_et.astimezone(ZoneInfo("UTC")).replace(tzinfo=None), close_et.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)


def parse_ts(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "").replace(" ", "T"))
    except ValueError:
        return None


def fmt_bar(bar: dict) -> str:
    if not bar:
        return "(none)"
    keys = ("time", "open", "high", "low", "close", "volume", "session")
    return " ".join(f"{k}={bar.get(k)}" for k in keys if k in bar)


class Report:
    def __init__(self) -> None:
        self.lines: list[str] = []
        self.verdicts: list[tuple[str, str]] = []

    def h(self, text: str) -> None:
        self.lines.append(f"\n## {text}")

    def p(self, text: str = "") -> None:
        self.lines.append(text)

    def verdict(self, mark: str, text: str) -> None:
        self.verdicts.append((mark, text))
        self.lines.append(f"{mark} {text}")

    def finish(self, report_path: str = "") -> None:
        self.h("VERDICTS")
        for mark, text in self.verdicts:
            self.lines.append(f"- {mark} {text}")
        fails = sum(1 for m, _ in self.verdicts if m == "FAIL")
        warns = sum(1 for m, _ in self.verdicts if m == "WARN")
        self.lines.append(f"\n{fails} FAIL, {warns} WARN, {len(self.verdicts) - fails - warns} PASS")
        text = "\n".join(self.lines)
        print(text)
        if report_path:
            with open(report_path, "w", encoding="utf-8") as fh:
                fh.write(text + "\n")
            print(f"\n[probe] report written to {report_path}", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--symbol", required=True)
    ap.add_argument("--date", required=True, help="the date whose daily candle is wrong, YYYY-MM-DD")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--report", default="", help="also write the report to this path")
    ap.add_argument("--tick-limit", type=int, default=200000)
    ap.add_argument("--strict", action="store_true", help="exit non-zero if any check FAILs")
    args = ap.parse_args()

    r = Report()
    r.p(f"# Daily-candle data probe — {args.symbol} on {args.date}")
    r.p(f"backend: {args.base}   generated: {datetime.now(ET).isoformat(timespec='seconds')}")
    open_utc, close_utc = rth_window_utc(args.date)
    r.p(f"RTH window (naive UTC as served): {open_utc} .. {close_utc}")

    # ---------------------------------------------------------------- C0 status
    status, payload, secs, err = fetch(args.base, "/api/status", {})
    r.h("C0 — backend reachable")
    if status != 200:
        r.verdict("FAIL", f"/api/status -> {status} ({err}) — start the streaming service and re-run")
        r.finish(args.report)
        return 1 if args.strict else 0
    r.verdict("PASS", f"/api/status 200 in {secs:.2f}s — lake root: {payload.get('lake', {}).get('root')}")

    day_start = f"{args.date} 00:00:00"
    day_end = f"{args.date} 23:59:59"

    # ------------------------------------------- C1 the frontend's exact query
    r.h("C1 — the query the frontend actually issues (tf=1d, no start_time, limit 1500)")
    params = {"symbol": args.symbol, "tf": "1d", "session": "REG",
              "end_time": day_end, "direction": "asc", "limit": 1500}
    status, candles, secs, err = fetch(args.base, "/api/streaming/candles", params, timeout=90)
    c1_bar = None
    if status != 200 or not isinstance(candles, list):
        r.verdict("FAIL", f"HTTP {status} in {secs:.2f}s — {err or 'unexpected body'}")
        r.p("A LakeIncompatibleSchema here means some resolved parquet partition has no `session`")
        r.p("column; the common-column intersection then drops it and query_candles raises.")
    else:
        r.p(f"200 in {secs:.2f}s — {len(candles)} daily bars; first {candles[0].get('time') if candles else '-'}, "
            f"last {candles[-1].get('time') if candles else '-'}")
        c1_bar = next((c for c in candles if str(c.get("time", "")).startswith(args.date)), None)
        r.p(f"bar for {args.date}: {fmt_bar(c1_bar) if c1_bar else '(MISSING from the response)'}")
        if not c1_bar:
            r.verdict("FAIL", f"no daily bar for {args.date} in a 1500-bar asc response — the date the "
                              f"frontend thinks is 'previous day' is not served at all")
        elif secs > 15:
            r.verdict("FAIL", f"{secs:.1f}s > the frontend's 15s AbortSignal.timeout — the 1D chart would "
                              f"receive [] and render no history (two charts double the load)")
        else:
            r.verdict("PASS", f"daily bar served in {secs:.2f}s, under the 15s client timeout")

    # ------------------------------------------------- C2 bounded REG vs ALL
    r.h("C2 — bounded tf=1d for that day, session=REG vs session=ALL")
    bounded = {}
    for label, session in (("REG", "REG"), ("ALL", "ALL")):
        st, bars, secs, err = fetch(args.base, "/api/streaming/candles", {
            "symbol": args.symbol, "tf": "1d", "session": session,
            "start_time": day_start, "end_time": day_end, "direction": "asc", "limit": 50})
        bar = bars[0] if (st == 200 and isinstance(bars, list) and bars) else None
        bounded[label] = bar
        r.p(f"session={session}: HTTP {st} in {secs:.2f}s — {fmt_bar(bar) if bar else (err or '(no bar)')}")
    if bounded["REG"] and bounded["ALL"]:
        same = all(bounded["REG"].get(k) == bounded["ALL"].get(k) for k in ("open", "high", "low", "close", "volume"))
        if same:
            r.verdict("WARN", "REG and ALL produce the IDENTICAL daily bar — the lake's `session` column is "
                              "not discriminating (every tick labelled REG?), so the backend's own daily bar "
                              "includes extended hours")
        else:
            r.verdict("PASS", "REG and ALL differ — the session column is doing real RTH filtering server-side")

    # --------------------------------------------- C3 tick-level ground truth
    r.h("C3 — tick-level RTH ground truth for that day (aggregated by this probe)")
    st, ticks, secs, err = fetch(args.base, "/api/ticks", {
        "symbol": args.symbol, "start_time": f"{open_utc:%Y-%m-%d %H:%M:%S}",
        "end_time": f"{close_utc:%Y-%m-%d %H:%M:%S}", "direction": "asc", "limit": args.tick_limit}, timeout=120)
    truth = None
    if st != 200 or not isinstance(ticks, list):
        r.verdict("FAIL", f"/api/ticks -> HTTP {st} ({err}) — cannot compute ground truth")
    else:
        prices = [(parse_ts(t.get("timestamp")), t) for t in ticks]
        prices = [(ts, t) for ts, t in prices if ts is not None]
        prices.sort(key=lambda x: x[0])
        if not prices:
            r.verdict("FAIL", f"0 ticks in the RTH window {open_utc}..{close_utc}")
        else:
            vals = [float(t.get("price") or 0) for _, t in prices]
            volumes = [float(t.get("size") or t.get("volume") or 0) for _, t in prices]
            truth = {"time": f"{args.date}", "open": vals[0], "high": max(vals), "low": min(vals),
                     "close": vals[-1], "volume": sum(volumes), "ticks": len(prices),
                     "first": f"{prices[0][0]:%H:%M:%S}", "last": f"{prices[-1][0]:%H:%M:%S}"}
            r.p(f"{len(prices)} ticks, {prices[0][0]:%H:%M:%S}..{prices[-1][0]:%H:%M:%S} UTC "
                f"(fetched in {secs:.2f}s" + (", LIMIT TRUNCATED — raise --tick-limit)" if len(prices) >= args.tick_limit else ")"))
            r.p(f"RTH aggregate: open={truth['open']} high={truth['high']} low={truth['low']} "
                f"close={truth['close']} volume={truth['volume']:.0f}")
            if bounded.get("REG"):
                b = bounded["REG"]
                diffs = [k for k in ("open", "high", "low", "close")
                         if abs(float(b.get(k) or 0) - truth[k]) > 1e-9]
                vol_ratio = (float(b.get("volume") or 0) / truth["volume"]) if truth["volume"] else 0
                r.p(f"backend tf=1d REG bar: open={b.get('open')} high={b.get('high')} low={b.get('low')} "
                    f"close={b.get('close')} volume={b.get('volume')}  (volume ratio vs RTH ticks: {vol_ratio:.2f}x)")
                if diffs:
                    r.verdict("FAIL", f"backend daily bar disagrees with the RTH ticks on {', '.join(diffs)} — "
                                      f"the wrong 14-Oct candle is baked into the LAKE, not just the frontend")
                elif vol_ratio > 1.05:
                    r.verdict("FAIL", f"backend daily VOLUME is {vol_ratio:.2f}x the RTH tick volume — the daily "
                                      f"bar is aggregated over the whole UTC day (ETH included)")
                else:
                    r.verdict("PASS", "backend tf=1d REG bar matches the RTH tick aggregate (OHLC and volume)")

    # ------------------------------------------------- C4 session labelling
    r.h("C4 — the lake's own `session` labelling for that day")
    st, ticks_all, secs, err = fetch(args.base, "/api/ticks", {
        "symbol": args.symbol, "start_time": day_start, "end_time": day_end,
        "direction": "asc", "limit": args.tick_limit}, timeout=120)
    if st != 200 or not isinstance(ticks_all, list):
        r.verdict("FAIL", f"full-day /api/ticks -> HTTP {st} ({err})")
    else:
        buckets: dict[str, list[datetime]] = {}
        for t in ticks_all:
            ts = parse_ts(t.get("timestamp"))
            if ts:
                buckets.setdefault(str(t.get("session") or "(none)").upper(), []).append(ts)
        r.p(f"{len(ticks_all)} ticks in the UTC day, {secs:.2f}s" + (" (LIMIT TRUNCATED)" if len(ticks_all) >= args.tick_limit else ""))
        for label in sorted(buckets):
            stamps = sorted(buckets[label])
            r.p(f"  {label:<12} {len(stamps):>8} ticks   {stamps[0]:%H:%M:%S} .. {stamps[-1]:%H:%M:%S} UTC")
        reg = buckets.get("REG") or []
        outside = [ts for ts in reg if not (open_utc <= ts <= close_utc)]
        if len(buckets) <= 1 and reg:
            r.verdict("WARN", f"every tick of the day is labelled REG ({len(reg)} ticks), including "
                              f"{open_utc:%H:%M}..{close_utc:%H:%M} UTC only? see the ranges above — if REG spans "
                              f"the whole UTC day the session column carries no information")
        elif outside:
            r.verdict("FAIL", f"{len(outside)} ticks labelled REG fall OUTSIDE the RTH window "
                              f"({min(outside):%H:%M:%S}..{max(outside):%H:%M:%S} UTC) — the lake's session column "
                              f"is mislabelled, which poisons every RTH-only aggregate downstream")
        else:
            r.verdict("PASS", "REG ticks fall inside the RTH window; other sessions are labelled separately")

    # ------------------------------------------------------ C5 1m ETH check
    r.h("C5 — does tf=1m serve extended-hours minutes to the frontend?")
    st, m1, secs, err = fetch(args.base, "/api/streaming/candles", {
        "symbol": args.symbol, "tf": "1m", "session": "ALL",
        "start_time": day_start, "end_time": day_end, "direction": "asc", "limit": 2000}, timeout=90)
    if st != 200 or not isinstance(m1, list):
        r.verdict("FAIL", f"tf=1m -> HTTP {st} ({err})")
    else:
        in_rth, out_rth = 0, 0
        for c in m1:
            ts = parse_ts(str(c.get("time", "")))
            if ts is None:
                continue
            if open_utc <= ts < close_utc:
                in_rth += 1
            else:
                out_rth += 1
        r.p(f"{len(m1)} one-minute bars in {secs:.2f}s — {in_rth} inside RTH, {out_rth} outside")
        r.p(f"session key present on 1m rows: {'yes' if m1 and 'session' in m1[0] else 'NO (the client was defaulting it to REG)'}")
        if out_rth == 0:
            r.verdict("PASS", "the lake serves RTH-only minutes, so the frontend's daily candle cannot be "
                              "contaminated by ETH for this symbol/date")
        else:
            r.verdict("WARN", f"{out_rth} extended-hours minutes ARE served — before the fix these set the daily "
                              f"open/high/low/volume; after the fix they are classified by timestamp and excluded")

    # ------------------------------------------------- C6 contention timing
    r.h("C6 — contention: the 1d query while the other chart loads")
    results: dict[str, tuple[int, float, str]] = {}

    def run(name: str, path: str, params: dict) -> None:
        st, _payload, secs, err = fetch(args.base, path, params, timeout=180)
        results[name] = (st, secs, err or "")

    threads = [
        threading.Thread(target=run, args=("1d (1D chart)", "/api/streaming/candles", {
            "symbol": args.symbol, "tf": "1d", "session": "REG", "end_time": day_end,
            "direction": "asc", "limit": 1500})),
        threading.Thread(target=run, args=("1m (5m chart)", "/api/streaming/candles", {
            "symbol": args.symbol, "tf": "1m", "session": "REG", "start_time": day_start,
            "end_time": day_end, "direction": "asc", "limit": 2000})),
        threading.Thread(target=run, args=("100k ticks (store)", "/api/ticks", {
            "symbol": args.symbol, "start_time": f"{args.date} 00:00:00",
            "end_time": f"{args.date} 23:59:59", "direction": "asc", "limit": 100000})),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    for name, (st, secs, err) in results.items():
        r.p(f"  {name:<20} HTTP {st} in {secs:.2f}s {err[:120]}")
    d1 = results.get("1d (1D chart)", (0, 0.0, ""))
    if d1[1] > 15:
        r.verdict("FAIL", f"the 1d query took {d1[1]:.1f}s under concurrent load — above the client's 15s "
                          f"AbortSignal.timeout, so the 1D chart silently receives [] (symptom: no candle until "
                          f"a later successful fetch). This is a real second defect; report it back.")
    else:
        r.verdict("PASS", f"the 1d query took {d1[1]:.2f}s under concurrent load, under the 15s timeout")

    r.finish(args.report)
    fails = sum(1 for mark, _ in r.verdicts if mark == "FAIL")
    return 1 if (args.strict and fails) else 0


if __name__ == "__main__":
    raise SystemExit(main())
