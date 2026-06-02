import { useEffect, useRef } from 'react';
import { ISeriesApi } from 'lightweight-charts';
import { SessionShadingPlugin } from '../../lib/SessionShading';
import { VolumeProfilePlugin } from '../../lib/VolumeProfilePlugin';
import { HorizontalRayPlugin } from '../../lib/HorizontalRayPlugin';
import { RectanglePlugin } from '../../lib/RectanglePlugin';
import { TradePlugin } from '../../lib/TradePlugin';
import type { RayDrawing, RectDrawing, TickerDrawings, Timeframe } from '../../types';

interface UseChartPluginsParams {
  priceSeriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  timeframe: Timeframe;
  showEth: boolean;
  showVP: boolean;
  drawings: TickerDrawings;
  tradeBadgeRef: React.RefObject<HTMLDivElement | null>;
}

export function useChartPlugins({
  priceSeriesRef,
  timeframe,
  showEth,
  showVP,
  drawings,
  tradeBadgeRef,
}: UseChartPluginsParams) {
  const shadingPluginRef = useRef<SessionShadingPlugin | null>(null);
  const vpPluginRef = useRef<VolumeProfilePlugin | null>(null);
  const rayPluginRef = useRef<HorizontalRayPlugin | null>(null);
  const rectPluginRef = useRef<RectanglePlugin | null>(null);
  const tradePluginRef = useRef<TradePlugin | null>(null);

  useEffect(() => {
    const series = priceSeriesRef.current;
    if (!series) return;

    const isET = (new Date().getTimezoneOffset() === -240); // Simplified ET check for init, will be updated by ticker logic in lifecycle

    shadingPluginRef.current = new SessionShadingPlugin(timeframe, isET && showEth);
    series.attachPrimitive(shadingPluginRef.current);

    vpPluginRef.current = new VolumeProfilePlugin();
    series.attachPrimitive(vpPluginRef.current);

    rayPluginRef.current = new HorizontalRayPlugin();
    series.attachPrimitive(rayPluginRef.current);
    
    rectPluginRef.current = new RectanglePlugin();
    series.attachPrimitive(rectPluginRef.current);
    
    tradePluginRef.current = new TradePlugin();
    tradePluginRef.current.setBadgeRef(tradeBadgeRef);
    series.attachPrimitive(tradePluginRef.current);
    
    rayPluginRef.current.setRays(drawings.rays || []);
    rectPluginRef.current.setRects(drawings.rects || []);

    return () => {
        // Note: Lightweight Charts primitives are usually detached when series is removed, 
        // but if explicit cleanup is needed, it would go here.
    };
  }, [priceSeriesRef]);

  // Update Ray/Rect Plugins when synced drawings change
  useEffect(() => {
    if (rayPluginRef.current && rectPluginRef.current) {
        rayPluginRef.current.setRays(drawings.rays || []);
        rectPluginRef.current.setRects(drawings.rects || []);
    }
  }, [drawings]);

  // Update VP Enabled State
  useEffect(() => {
      if (vpPluginRef.current) {
          vpPluginRef.current.setEnabled(showVP);
      }
  }, [showVP]);

  // Update shading plugin config (Tz/ETH/Tf)
  // This is called from useChartLifecycle based on ticker/timeframe changes
  const updateShadingConfig = (isET: boolean) => {
    if (shadingPluginRef.current) {
        shadingPluginRef.current.setConfig(timeframe, isET && showEth);
    }
  };

  return { 
    shadingPluginRef, 
    vpPluginRef, 
    rayPluginRef, 
    rectPluginRef, 
    tradePluginRef, 
    updateShadingConfig 
  };
}
