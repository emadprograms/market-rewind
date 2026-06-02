import { describe, it, expect } from 'vitest';
import { 
  mockChart, 
  mockSeries, 
  mockTimeScale, 
  createChartMock 
} from './chart-simulation';

describe('Chart Simulation Smoke Tests', () => {
  it('smoke: should return a mock chart', () => {
    const chart = createChartMock();
    expect(chart).toBe(mockChart);
  });

  it('smoke: should return a mock series', () => {
    const series = mockChart.addCandlestickSeries();
    expect(series).toBe(mockSeries);
  });

  it('smoke: should return a mock timeScale', () => {
    const timeScale = mockChart.timeScale();
    expect(timeScale).toBe(mockTimeScale);
  });

  it('smoke: should track calls to setVisibleLogicalRange', () => {
    const range = { from: 10, to: 110 };
    mockTimeScale.setVisibleLogicalRange(range);
    expect(mockTimeScale.setVisibleLogicalRange).toHaveBeenCalledWith(range);
  });

  it('smoke: should track calls to setData', () => {
    const data = [{ time: '2023-01-01', open: 10, high: 12, low: 9, close: 11 }];
    mockSeries.setData(data);
    expect(mockSeries.setData).toHaveBeenCalledWith(data);
  });
});
