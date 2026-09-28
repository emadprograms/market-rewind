import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartPlugins } from '../../src/hooks/chart/useChartPlugins';

describe('useChartPlugins Hook Tests', () => {
  let mockSeries: any;
  let priceSeriesRef: any;

  beforeEach(() => {
    mockSeries = {
      attachPrimitive: vi.fn(),
      detachPrimitive: vi.fn(),
    };
    priceSeriesRef = { current: mockSeries };
  });

  const defaultProps = {
    priceSeriesRef: { current: null },
    ticker: 'AAPL',
    timeframe: '1H' as const,
    showEth: false,
    showVP: true,
    boundaryTime: null,
    drawings: { rays: [], rects: [] },
  };

  it('attaches all 6 primitives to price series on mount', () => {
    const { result } = renderHook(() =>
      useChartPlugins({
        ...defaultProps,
        priceSeriesRef,
      })
    );

    // 6 plugins: Shading, VP, Ray, Rect, Trade, BoundaryLine
    expect(mockSeries.attachPrimitive).toHaveBeenCalledTimes(6);
    expect(result.current.pluginVersion).toBe(1);

    expect(result.current.shadingPluginRef.current).not.toBeNull();
    expect(result.current.vpPluginRef.current).not.toBeNull();
    expect(result.current.rayPluginRef.current).not.toBeNull();
    expect(result.current.rectPluginRef.current).not.toBeNull();
    expect(result.current.tradePluginRef.current).not.toBeNull();
  });

  it('registers tradeBadgeRef with TradePlugin on mount if provided', () => {
    const mockBadgeRef = { current: document.createElement('div') };
    const { result } = renderHook(() =>
      useChartPlugins({
        ...defaultProps,
        priceSeriesRef,
        tradeBadgeRef: mockBadgeRef,
      })
    );

    expect(result.current.tradePluginRef.current?._badgeRefs.get('active_trade')).toBe(mockBadgeRef);
  });

  it('does NOT re-attach primitives when ticker or timeframe changes', () => {
    const { result, rerender } = renderHook(
      (props) => useChartPlugins(props),
      {
        initialProps: {
          ...defaultProps,
          priceSeriesRef,
        },
      }
    );

    expect(mockSeries.attachPrimitive).toHaveBeenCalledTimes(6);

    // Ticker switch: AAPL -> TSLA, Timeframe: 1H -> 5min
    rerender({
      ...defaultProps,
      priceSeriesRef,
      ticker: 'TSLA',
      timeframe: '5min' as const,
    });

    // Primitives must NOT be re-attached!
    expect(mockSeries.attachPrimitive).toHaveBeenCalledTimes(6);
    expect(result.current.pluginVersion).toBe(1);
  });

  it('updates drawings on ray and rect plugins when drawings prop changes', () => {
    const { result, rerender } = renderHook(
      (props) => useChartPlugins(props),
      {
        initialProps: {
          ...defaultProps,
          priceSeriesRef,
        },
      }
    );

    const rayPlugin = result.current.rayPluginRef.current!;
    const rectPlugin = result.current.rectPluginRef.current!;

    const setRaysSpy = vi.spyOn(rayPlugin, 'setRays');
    const setRectsSpy = vi.spyOn(rectPlugin, 'setRects');

    const newDrawings = {
      rays: [{ id: 'ray1', price: 150 }],
      rects: [{ id: 'rect1', p1: { time: 100, price: 150 }, p2: { time: 200, price: 160 } }],
    };

    rerender({
      ...defaultProps,
      priceSeriesRef,
      drawings: newDrawings as any,
    });

    expect(setRaysSpy).toHaveBeenCalledWith(newDrawings.rays);
    expect(setRectsSpy).toHaveBeenCalledWith(newDrawings.rects);
  });

  it('updates VP enabled state when showVP changes', () => {
    const { result, rerender } = renderHook(
      (props) => useChartPlugins(props),
      {
        initialProps: {
          ...defaultProps,
          priceSeriesRef,
          showVP: true,
        },
      }
    );

    const vpPlugin = result.current.vpPluginRef.current!;
    const setEnabledSpy = vi.spyOn(vpPlugin, 'setEnabled');

    rerender({
      ...defaultProps,
      priceSeriesRef,
      showVP: false,
    });

    expect(setEnabledSpy).toHaveBeenCalledWith(false);
  });

  it('updates boundary time on BoundaryLinePlugin when boundaryTime prop changes', () => {
    const { rerender } = renderHook(
      (props) => useChartPlugins(props),
      {
        initialProps: {
          ...defaultProps,
          priceSeriesRef,
          boundaryTime: null,
        },
      }
    );

    rerender({
      ...defaultProps,
      priceSeriesRef,
      boundaryTime: '2024-05-01 10:00:00',
    });

    // Primitive remains attached and sets boundary time
    expect(mockSeries.attachPrimitive).toHaveBeenCalledTimes(6);
  });

  it('updates shading plugin config when updateShadingConfig is called', () => {
    const { result } = renderHook(() =>
      useChartPlugins({
        ...defaultProps,
        priceSeriesRef,
        timeframe: '15min' as const,
        showEth: true,
      })
    );

    const shadingPlugin = result.current.shadingPluginRef.current!;
    const setConfigSpy = vi.spyOn(shadingPlugin, 'setConfig');

    act(() => {
      result.current.updateShadingConfig(true);
    });

    expect(setConfigSpy).toHaveBeenCalledWith('15min', true);

    act(() => {
      result.current.updateShadingConfig(false);
    });

    expect(setConfigSpy).toHaveBeenCalledWith('15min', false);
  });

  it('detaches all primitives when priceSeriesRef changes or on unmount', () => {
    const { unmount } = renderHook(() =>
      useChartPlugins({
        ...defaultProps,
        priceSeriesRef,
      })
    );

    unmount();

    expect(mockSeries.detachPrimitive).toHaveBeenCalledTimes(6);
  });
});
