import type { ReplayMs } from './types';

/**
 * Deterministic timestamped binary min-heap plus a deterministic sequence generator.
 *
 * The whole simulator is event-driven: every scheduled action is `(fireAtMs, tieBreakSeq)`.
 * Ordering is compared on the pair, never on a naked timestamp, so two actions scheduled for the
 * same millisecond still fire in a reproducible order.
 *
 * `nowMs` NEVER advances on its own — it is only ever set to the timestamp of the action being
 * dispatched. Nothing in the engine may read a wall clock.
 */

export interface Scheduled<TPayload> {
  readonly fireAtMs: ReplayMs;
  /** Assigned by the scheduler, monotonically increasing within a run. */
  readonly tieBreakSeq: number;
  readonly payload: TPayload;
}

export interface CancelHandle {
  readonly id: number;
}

interface HeapEntry<TPayload> {
  readonly handleId: number;
  readonly fireAtMs: ReplayMs;
  readonly tieBreakSeq: number;
  readonly payload: TPayload;
  cancelled: boolean;
}

export class DeterministicScheduler<TPayload = unknown> {
  private readonly heap: HeapEntry<TPayload>[] = [];
  private readonly byHandle = new Map<number, HeapEntry<TPayload>>();
  private nextSeq = 0;
  private nextHandleId = 0;

  /**
   * Schedule an action. Insertion order breaks ties, so two actions scheduled for the same
   * millisecond still fire in a reproducible order (first scheduled, first fired).
   */
  schedule(fireAtMs: ReplayMs, payload: TPayload): CancelHandle {
    const entry: HeapEntry<TPayload> = {
      handleId: this.nextHandleId++,
      fireAtMs,
      tieBreakSeq: this.nextSeq++,
      payload,
      cancelled: false,
    };
    this.byHandle.set(entry.handleId, entry);
    this.push(entry);
    return { id: entry.handleId };
  }

  /**
   * Cancel a scheduled action. Cancellation is lazy (the entry is tombstoned and skipped on pop)
   * so that cancelling does not perturb the ordering of anything else.
   */
  cancel(handle: CancelHandle): boolean {
    const found = this.byHandle.get(handle.id);
    if (!found || found.cancelled) return false;
    found.cancelled = true;
    return true;
  }

  /** Earliest pending action, or null when the queue is drained. Discards tombstones. */
  next(): Scheduled<TPayload> | null {
    for (;;) {
      this.discardTombstones();
      const top = this.heap[0];
      if (!top) return null;
      this.popTop();
      return { fireAtMs: top.fireAtMs, tieBreakSeq: top.tieBreakSeq, payload: top.payload };
    }
  }

  /** Inspect the next action without removing it. */
  peek(): Scheduled<TPayload> | null {
    this.discardTombstones();
    const top = this.heap[0];
    if (!top) return null;
    return { fireAtMs: top.fireAtMs, tieBreakSeq: top.tieBreakSeq, payload: top.payload };
  }

  /** Number of pending (non-cancelled) actions. */
  get size(): number {
    let n = 0;
    for (const e of this.heap) if (!e.cancelled) n++;
    return n;
  }

  clear(): void {
    this.heap.length = 0;
    this.byHandle.clear();
  }

  /** Snapshot in firing order, for debugging and determinism assertions. */
  toArray(): Scheduled<TPayload>[] {
    return this.heap
      .filter((e) => !e.cancelled)
      .map((e) => ({ fireAtMs: e.fireAtMs, tieBreakSeq: e.tieBreakSeq, payload: e.payload }))
      .sort((a, b) => a.fireAtMs - b.fireAtMs || a.tieBreakSeq - b.tieBreakSeq);
  }

  // -- internals ------------------------------------------------------------

  private less(a: HeapEntry<TPayload>, b: HeapEntry<TPayload>): boolean {
    return a.fireAtMs < b.fireAtMs || (a.fireAtMs === b.fireAtMs && a.tieBreakSeq < b.tieBreakSeq);
  }

  private swap(i: number, j: number): void {
    const t = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = t;
  }

  private push(entry: HeapEntry<TPayload>): void {
    this.heap.push(entry);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(this.heap[i], this.heap[parent])) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private popTop(): void {
    const top = this.heap[0];
    this.byHandle.delete(top.handleId);
    const last = this.heap.pop()!;
    if (top !== last) {
      this.heap[0] = last;
      this.siftDown(0);
    }
  }

  private discardTombstones(): void {
    while (this.heap.length > 0 && this.heap[0].cancelled) {
      this.popTop();
    }
  }

  private siftDown(start: number): void {
    let i = start;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < this.heap.length && this.less(this.heap[l], this.heap[smallest])) smallest = l;
      if (r < this.heap.length && this.less(this.heap[r], this.heap[smallest])) smallest = r;
      if (smallest === i) return;
      this.swap(i, smallest);
      i = smallest;
    }
  }
}

/**
 * Monotonic sequence source. Every order, fill, event and instruction sequence number in the
 * engine comes from one of these so that identity is stable across runs (no uuid, no Date.now,
 * no counter that depends on object iteration order).
 */
export class SequenceGenerator {
  private value: number;

  constructor(start = 0) {
    this.value = start;
  }

  next(): number {
    return this.value++;
  }

  get current(): number {
    return this.value;
  }
}
