/**
 * Guards the series-primitive contract that caused a repaint-escalation bug.
 *
 * Lightweight Charts calls `updateAllViews()` on a primitive *from inside its draw path*
 * (price-scale recalculation -> `_internal_updateAllSources`). The hook exists so a
 * primitive can refresh view data it cached against the current scale.
 *
 * Both plugins here used to implement it as:
 *
 *     updateAllViews() { this._requestUpdate(); }
 *
 * `requestUpdate` resolves to `model._internal_fullUpdate()` ->
 * `invalidate(InvalidateMask.full())`. So asking for a redraw from inside a redraw
 * escalated the light invalidation LWC intended into a FULL one -- which additionally
 * reruns `_private__updateGui()` (time axis, price-axis widgets, layout width) -- every
 * time the price scale was recalculated.
 *
 * Neither pane view caches anything (`renderer()` recomputes from the live scale each
 * draw), so the correct implementation of the hook is to do nothing.
 *
 * The second test in each pair exists so this file cannot pass by the plugins simply
 * being broken: it proves `_requestUpdate` IS still wired up and used for real data
 * changes. Without it, deleting the callback entirely would also "pass".
 */
import { describe, expect, it, vi } from 'vitest';
import { TradePlugin } from '../../src/lib/TradePlugin';
import { VolumeProfilePlugin } from '../../src/lib/VolumeProfilePlugin';

/** Minimal stand-ins: `attached` only stores these. */
function attach(plugin: any, requestUpdate: () => void) {
  plugin.attached({
    chart: { timeScale: () => ({ timeToCoordinate: () => null }) },
    series: { priceToCoordinate: () => null },
    requestUpdate,
  } as any);
}

describe('series primitive updateAllViews contract', () => {
  describe('TradePlugin', () => {
    it('does not request an update from updateAllViews (called during the draw path)', () => {
      const plugin = new TradePlugin();
      const requestUpdate = vi.fn();
      attach(plugin, requestUpdate);

      plugin.updateAllViews();

      expect(requestUpdate).not.toHaveBeenCalled();
    });

    it('still requests an update when its data actually changes', () => {
      const plugin = new TradePlugin();
      const requestUpdate = vi.fn();
      attach(plugin, requestUpdate);

      plugin.setItems([{ id: 'x', price: 100 } as any]);

      expect(requestUpdate).toHaveBeenCalled();
    });

    it('does not request an update when the hovered id is unchanged', () => {
      const plugin = new TradePlugin();
      const requestUpdate = vi.fn();
      attach(plugin, requestUpdate);

      plugin.setHoveredId('same');

      expect(requestUpdate).toHaveBeenCalledTimes(1);
      requestUpdate.mockClear();

      plugin.setHoveredId('same');
      expect(requestUpdate).not.toHaveBeenCalled();
    });
  });

  describe('VolumeProfilePlugin', () => {
    it('does not request an update from updateAllViews (called during the draw path)', () => {
      const plugin = new VolumeProfilePlugin();
      const requestUpdate = vi.fn();
      // attached() also registers a window resize listener; jsdom provides window.
      (globalThis as any).window?.removeEventListener?.('resize', () => {});
      attach(plugin, requestUpdate);

      plugin.updateAllViews();

      expect(requestUpdate).not.toHaveBeenCalled();
    });

    it('still requests an update when its data actually changes', () => {
      const plugin = new VolumeProfilePlugin();
      const requestUpdate = vi.fn();
      attach(plugin, requestUpdate);

      plugin.setData([{ time: 1, open: 1, high: 2, low: 0, close: 1.5, volume: 10 } as any]);

      expect(requestUpdate).toHaveBeenCalled();
    });

    it('still requests an update when toggled', () => {
      const plugin = new VolumeProfilePlugin();
      const requestUpdate = vi.fn();
      attach(plugin, requestUpdate);

      plugin.setEnabled(true);

      expect(requestUpdate).toHaveBeenCalled();
    });
  });
});
