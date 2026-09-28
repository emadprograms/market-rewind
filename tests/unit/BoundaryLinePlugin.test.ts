import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BoundaryLinePlugin } from '../../src/lib/BoundaryLinePlugin';

describe('BoundaryLinePlugin Unit Tests', () => {
  let plugin: BoundaryLinePlugin;
  let mockChart: any;
  let mockSeries: any;
  let requestUpdateMock: any;

  beforeEach(() => {
    plugin = new BoundaryLinePlugin('2024-03-15 09:30:00');
    requestUpdateMock = vi.fn();

    mockChart = {
      timeScale: vi.fn().mockReturnValue({
        timeToCoordinate: vi.fn((time: number) => {
          // 2024-03-15 09:30:00 UTC = 1710495000
          if (time === 1710495000) return 350;
          return null;
        }),
      }),
      applyOptions: vi.fn(),
    };

    mockSeries = {
      priceToCoordinate: vi.fn(),
    };

    plugin.attached({
      chart: mockChart,
      series: mockSeries,
      requestUpdate: requestUpdateMock,
    } as any);
  });

  describe('Initialization & Attachment', () => {
    it('initializes with boundary time and null chart/series', () => {
      const fresh = new BoundaryLinePlugin(null);
      expect(fresh._boundaryTime).toBeNull();
      expect(fresh._chart).toBeNull();
      expect(fresh._series).toBeNull();
      expect(fresh.paneViews()).toHaveLength(1);
    });

    it('stores references upon attached()', () => {
      expect(plugin._chart).toBe(mockChart);
      expect(plugin._series).toBe(mockSeries);
      expect(plugin._requestUpdate).toBe(requestUpdateMock);
    });

    it('clears chart and series references on detached()', () => {
      plugin.detached();
      expect(plugin._chart).toBeNull();
      expect(plugin._series).toBeNull();
    });

    it('triggers update on updateAllViews()', () => {
      plugin.updateAllViews();
      expect(requestUpdateMock).toHaveBeenCalled();
    });
  });

  describe('setBoundaryTime & Coordinates', () => {
    it('updates boundary time and requests chart update', () => {
      plugin.setBoundaryTime('2024-04-01 16:00:00');
      expect(plugin._boundaryTime).toBe('2024-04-01 16:00:00');
      expect(requestUpdateMock).toHaveBeenCalled();
    });

    it('returns null coordinate when boundary time is null', () => {
      plugin.setBoundaryTime(null);
      expect(plugin._getXCoordinate()).toBeNull();
    });

    it('returns null coordinate when series or chart is detached', () => {
      plugin.detached();
      expect(plugin._getXCoordinate()).toBeNull();
    });

    it('computes coordinate correctly from date string', () => {
      plugin.setBoundaryTime('2024-03-15 09:30:00');
      const coord = plugin._getXCoordinate();
      expect(coord).toBe(350);
    });
  });

  describe('Renderer and Drawing', () => {
    it('returns normal zOrder pane view', () => {
      const paneView = plugin.paneViews()[0];
      expect(paneView.zOrder()).toBe('normal');
    });

    it('draws dashed vertical boundary line when coordinate is present', () => {
      const paneView = plugin.paneViews()[0];
      const renderer = paneView.renderer();

      const mockCtx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        setLineDash: vi.fn(),
      };

      const mockTarget = {
        useMediaCoordinateSpace: (cb: any) => {
          cb({
            context: mockCtx,
            mediaSize: { width: 1000, height: 600 },
          });
        },
      };

      renderer.draw(mockTarget as any);

      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.moveTo).toHaveBeenCalledWith(350, 0);
      expect(mockCtx.lineTo).toHaveBeenCalledWith(350, 600);
      expect(mockCtx.setLineDash).toHaveBeenCalledWith([4, 4]);
      expect(mockCtx.stroke).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('skips drawing if coordinate is null', () => {
      plugin.setBoundaryTime(null);
      const paneView = plugin.paneViews()[0];
      const renderer = paneView.renderer();

      const mockCtx = {
        save: vi.fn(),
        stroke: vi.fn(),
      };

      const mockTarget = {
        useMediaCoordinateSpace: (cb: any) => {
          cb({ context: mockCtx, mediaSize: { width: 1000, height: 600 } });
        },
      };

      renderer.draw(mockTarget as any);
      expect(mockCtx.save).not.toHaveBeenCalled();
      expect(mockCtx.stroke).not.toHaveBeenCalled();
    });
  });
});
