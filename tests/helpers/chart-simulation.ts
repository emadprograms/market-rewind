import { vi } from 'vitest';

export const mockTimeScale = {
  setVisibleLogicalRange: vi.fn(),
  getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 100 })),
  scrollToRealTime: vi.fn(),
  subscribeVisibleLogicalRangeChange: vi.fn(),
};

export const mockSeries = {
  setData: vi.fn(),
  update: vi.fn(),
  attachPrimitive: vi.fn(),
  data: vi.fn(() => []),
  createPriceLine: vi.fn(),
  removePriceLine: vi.fn(),
  priceScale: vi.fn(() => mockPriceScale),
};

export const mockPriceScale = {
  applyOptions: vi.fn(),
};

export const mockChart = {
  addCandlestickSeries: vi.fn(() => mockSeries),
  addHistogramSeries: vi.fn(() => mockSeries),
  timeScale: vi.fn(() => mockTimeScale),
  priceScale: vi.fn(() => mockPriceScale),
  remove: vi.fn(),
  applyOptions: vi.fn(),
  subscribeClick: vi.fn(),
  unsubscribeClick: vi.fn(),
  subscribeCrosshairMove: vi.fn(),
  unsubscribeCrosshairMove: vi.fn(),
  subscribeDblClick: vi.fn(),
  unsubscribeDblClick: vi.fn(),
};

export const createChartMock = vi.fn(() => mockChart);
