/**
 * Perf invariant — chart-adjacent surfaces must not use `backdrop-filter`.
 *
 * WHY THIS TEST EXISTS
 *
 * A `backdrop-filter` forces the compositor to sample and blur whatever is *behind* the
 * element, and to redo that work whenever the backdrop changes. Placing one on (or over)
 * a live chart therefore re-blurs on every frame: the chart canvases repaint at 60fps
 * during replay.
 *
 * Measured on an Apple M4 during a 25x replay with charts repainting: ~45-51% GPU device
 * utilisation. Four persistent surfaces carried a blur, and three of them gained almost
 * nothing from it:
 *
 *   .chart-card         background #000000 (fully opaque) -> the blur is literally
 *                       invisible, yet it is a composited ancestor of every canvas, so a
 *                       2v grid stacks two such layers over repainting content.
 *   .playback-bar       rgba(0,0,0,0.9) and re-renders 60x/second at z-index 10000.
 *   .scroll-to-end-btn  rgba(255,255,255,0.1), absolutely positioned directly on top of a
 *                       live canvas -- the worst possible placement.
 *   .sidebar            persistent full-height rail; imperceptible over a near-black page.
 *
 * The blur was removed from all four and the alpha raised to preserve appearance. This
 * test keeps it that way, because the cost is invisible in review and the regression is
 * easy to reintroduce.
 *
 * Transient overlays (dropdown menus, modals, the session card) are intentionally NOT
 * covered: they appear while replay is idle and are where the glass effect actually reads
 * as glass.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CSS_PATH = path.resolve(__dirname, '../../src/index.css');
const rawCss = fs.readFileSync(CSS_PATH, 'utf8');

/** Comments must be stripped first: prose that merely *mentions* backdrop-filter (for
 *  example a note explaining why it was removed) is not a declaration. */
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** Extracts the declaration block for an exact top-level selector (e.g. ".chart-card"). */
function block(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

const CHART_ADJACENT = [
  '.chart-card',
  '.playback-bar',
  '.scroll-to-end-btn',
  '.sidebar',
];

describe('chart-adjacent surfaces avoid backdrop-filter', () => {
  it('finds every selector it claims to guard', () => {
    for (const selector of CHART_ADJACENT) {
      expect(block(selector), `${selector} not found in index.css`).not.toBe('');
    }
  });

  it.each(CHART_ADJACENT)('%s declares no backdrop-filter', (selector) => {
    const declarations = block(selector);
    expect(
      declarations.includes('backdrop-filter'),
      `${selector} declares backdrop-filter. It sits on or over continuously repainting ` +
        'chart canvases, so the blur is recomputed every frame; measured ~45-51% GPU on ' +
        'an M4 during 25x replay. Raise the background alpha instead of restoring blur.',
    ).toBe(false);
  });

  it('.chart-card background stays opaque (which is why blur there is pointless)', () => {
    const declarations = block('.chart-card');
    // Opaque means the blur can never be visible, so any blur on this card is pure cost.
    expect(declarations).toMatch(/background:\s*(#[0-9a-fA-F]{3,8}|var\(--bg-card\))/);
    const bgCard = /--bg-card:\s*([^;]+);/.exec(css)?.[1]?.trim();
    expect(bgCard, '--bg-card must resolve to an opaque colour').toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
