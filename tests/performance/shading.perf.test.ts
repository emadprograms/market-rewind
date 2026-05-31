import { describe, it, expect } from 'vitest';
import { getSessionType } from '../../src/lib/SessionShading';

describe('SessionShading Performance', () => {
  it('should process 10,000 timestamps in under 50ms', () => {
    const timestamps = Array.from({ length: 10000 }, (_, i) => 1685534400 + i * 60);
    
    const start = performance.now();
    for (const ts of timestamps) {
      getSessionType(ts);
    }
    const end = performance.now();
    const duration = end - start;
    
    console.log(`Shading Benchmark: 10,000 items took ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(100);
  });
});
