import React, { useEffect, useRef, useState } from 'react';
import { ISeriesApi } from 'lightweight-charts';
import { SessionShadingPlugin } from '../../lib/SessionShading';
import { VolumeProfilePlugin } from '../../lib/VolumeProfilePlugin';
import { HorizontalRayPlugin } from '../../lib/HorizontalRayPlugin';
import { RectanglePlugin } from '../../lib/RectanglePlugin';
import { TradePlugin } from '../../lib/TradePlugin';
import { BoundaryLinePlugin } from '../../lib/BoundaryLinePlugin';
import type { RayDrawing, RectDrawing, TickerDrawings, Timeframe } from '../../types';

interface UseChartPluginsParams {
  priceSeriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  ticker: string;
  timeframe: Timeframe;
  showEth: boolean;
  showVP: boolean;
  boundaryTime?: string | null;
  drawings: TickerDrawings;
  tradeBadgeRef?: React.RefObject<HTMLDivElement | null>;
}

export function useChartPlugins({
  priceSeriesRef,
  ticker,
  timeframe,
  showEth,
  showVP,
  boundaryTime = null,
  drawings,
  tradeBadgeRef,
}: UseChartPluginsParams) {
  const shadingPluginRef = useRef<SessionShadingPlugin | null>(null);
  const vpPluginRef = useRef<VolumeProfilePlugin | null>(null);
  const rayPluginRef = useRef<HorizontalRayPlugin | null>(null);
  const rectPluginRef = useRef<RectanglePlugin | null>(null);
  const tradePluginRef = useRef<TradePlugin | null>(null);
  const boundaryPluginRef = useRef<BoundaryLinePlugin | null>(null);

  const [pluginVersion, setPluginVersion] = useState(0);

  useEffect(() => {
    const series = priceSeriesRef.current;
    if (!series) return;

    // Initialization ignores ticker/timeframe since they are updated dynamically via lifecycle methods
    shadingPluginRef.current = new SessionShadingPlugin('1H', false);
    series.attachPrimitive(shadingPluginRef.current);

    vpPluginRef.current = new VolumeProfilePlugin();
    series.attachPrimitive(vpPluginRef.current);

    rayPluginRef.current = new HorizontalRayPlugin();
    series.attachPrimitive(rayPluginRef.current);
    
    rectPluginRef.current = new RectanglePlugin();
    series.attachPrimitive(rectPluginRef.current);
    
    tradePluginRef.current = new TradePlugin();
    if (tradeBadgeRef) {
      tradePluginRef.current.setBadgeRef(tradeBadgeRef);
    }
    series.attachPrimitive(tradePluginRef.current);
    
    boundaryPluginRef.current = new BoundaryLinePlugin(null);
    series.attachPrimitive(boundaryPluginRef.current);
    
    rayPluginRef.current.setRays(drawings.rays || []);
    rectPluginRef.current.setRects(drawings.rects || []);

    setPluginVersion(v => v + 1);

    return () => {
        if (series) {
            try { series.detachPrimitive(shadingPluginRef.current!); } catch(e) {}
            try { series.detachPrimitive(vpPluginRef.current!); } catch(e) {}
            try { series.detachPrimitive(rayPluginRef.current!); } catch(e) {}
            try { series.detachPrimitive(rectPluginRef.current!); } catch(e) {}
            try { series.detachPrimitive(tradePluginRef.current!); } catch(e) {}
            try { series.detachPrimitive(boundaryPluginRef.current!); } catch(e) {}
        }
    };
  }, [priceSeriesRef]); // Plugins attached once and reused across ticker/timeframe switches

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

  // Update Boundary Time
  useEffect(() => {
      if (boundaryPluginRef.current) {
          boundaryPluginRef.current.setBoundaryTime(boundaryTime);
      }
  }, [boundaryTime]);

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
    updateShadingConfig,
    pluginVersion
  };
}
