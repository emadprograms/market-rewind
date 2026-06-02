import { useEffect } from 'react';
import { IChartApi, ISeriesApi, MouseEventParams, Time } from 'lightweight-charts';
import type { DrawType, RayDrawing, RectDrawing, RectPoint, TickerDrawings } from '../../types';

interface UseChartDrawingsParams {
  chartRef: React.MutableRefObject<IChartApi | null>;
  priceSeriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>;
  chartContainerRef: React.RefObject<HTMLDivElement | null>;
  isDrawingMode: boolean;
  drawType: DrawType;
  rectAnchor: RectPoint | null;
  setRectAnchor: React.Dispatch<React.SetStateAction<RectPoint | null>>;
  ghostPoint: RectPoint | null;
  setGhostPoint: React.Dispatch<React.SetStateAction<RectPoint | null>>;
  drawings: TickerDrawings;
  ticker: string;
  onUpdateDrawings: (ticker: string, type: 'rays' | 'rects', items: RayDrawing[] | RectDrawing[]) => void;
}

export function useChartDrawings({
  chartRef,
  priceSeriesRef,
  chartContainerRef,
  isDrawingMode,
  drawType,
  rectAnchor,
  setRectAnchor,
  ghostPoint,
  setGhostPoint,
  drawings,
  ticker,
  onUpdateDrawings,
}: UseChartDrawingsParams) {
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || !chartRef.current || !priceSeriesRef.current) return;

    const chart = chartRef.current;
    const series = priceSeriesRef.current;

    const handleClick = (param: MouseEventParams<Time>) => {
      if (!isDrawingMode || !param.point || !param.time) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price === null || price === undefined) return;

      if (drawType === 'ray') {
        onUpdateDrawings(ticker, 'rays', [...(drawings.rays || []), { price, time: param.time }]);
      } else if (drawType === 'rect') {
        if (!rectAnchor) {
          setRectAnchor({ price, time: param.time });
        } else {
          onUpdateDrawings(ticker, 'rects', [...(drawings.rects || []), { p1: rectAnchor, p2: { price, time: param.time } }]);
          setRectAnchor(null);
        }
      }
    };

    const handleMouseMove = (param: MouseEventParams<Time>) => {
      if (!isDrawingMode || !rectAnchor || !param.point || !param.time) {
        if (ghostPoint) setGhostPoint(null);
        return;
      }
      const price = series.coordinateToPrice(param.point.y);
      if (price !== null) {
        setGhostPoint({ price, time: param.time });
      }
    };

    const handleDblClick = (param: MouseEventParams<Time>) => {
      if (!param.point || !param.time) return;
      const clickPrice = series.coordinateToPrice(param.point.y);
      if (clickPrice === null || clickPrice === undefined) return;

      let nearestIdx = -1;
      let nearestDist = Infinity;
      (drawings.rays || []).forEach((entry, idx) => {
        const dist = Math.abs(entry.price - clickPrice);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = idx;
        }
      });

      if (nearestIdx !== -1) {
        const ray = drawings.rays[nearestIdx];
        const rayY = series.priceToCoordinate(ray.price);
        const rayX = chart.timeScale().timeToCoordinate(ray.time as Time);
        if (rayY !== null && Math.abs(rayY - param.point.y) < 10 && (param.point.x >= (rayX || 0) - 5)) { 
          const newRays = [...drawings.rays];
          newRays.splice(nearestIdx, 1);
          onUpdateDrawings(ticker, 'rays', newRays);
          return;
        }
      }

      let rectToDelete = -1;
      (drawings.rects || []).forEach((rect, idx) => {
          const y1 = series.priceToCoordinate(rect.p1.price);
          const y2 = series.priceToCoordinate(rect.p2.price);
          const x1 = chart.timeScale().timeToCoordinate(rect.p1.time as Time);
          const x2 = chart.timeScale().timeToCoordinate(rect.p2.time as Time);
          
          if (y1 === null || y2 === null) return;
          
          const top = Math.min(y1, y2);
          const bottom = Math.max(y1, y2);
          const xStart = x1 === null ? -100 : x1;
          const xEnd = x2 === null ? chart.timeScale().width() + 100 : x2;
          const left = Math.min(xStart, xEnd);
          const right = Math.max(xStart, xEnd);

          if (param.point && param.point.y >= top - 5 && param.point.y <= bottom + 5 &&
              param.point.x >= left - 5 && param.point.x <= right + 5) {
              rectToDelete = idx;
          }
      });

      if (rectToDelete !== -1) {
          const newRects = [...drawings.rects];
          newRects.splice(rectToDelete, 1);
          onUpdateDrawings(ticker, 'rects', newRects);
      }
    };

    chart.subscribeClick(handleClick);
    chart.subscribeCrosshairMove(handleMouseMove);
    chart.subscribeDblClick(handleDblClick);

    return () => {
      try {
        chart.unsubscribeClick(handleClick);
        chart.unsubscribeCrosshairMove(handleMouseMove);
        chart.unsubscribeDblClick(handleDblClick);
      } catch(_) {}
    };
  }, [drawings, drawType, rectAnchor, ghostPoint, isDrawingMode, ticker, onUpdateDrawings, chartRef, priceSeriesRef, chartContainerRef, setRectAnchor, setGhostPoint]);
}
