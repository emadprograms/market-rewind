import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingClient } from '../../src/lib/streamingClient';

describe('TDD: streamingClient Timeout & Abort Handling', () => {
  let client: StreamingClient;

  beforeEach(() => {
    client = new StreamingClient();
    client.setServiceUrl('http://100.72.128.22:8420');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes user-provided AbortSignal to getCandles and cancels fetch immediately when aborted', async () => {
    const controller = new AbortController();
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      return new Promise((_, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }
      });
    });

    const promise = client.getCandles('TSLA', {
      timeframe: '5min',
      signal: controller.signal,
    } as any);

    controller.abort();

    const result = await promise;
    // When aborted, getCandles should return empty array without falling back or crashing
    expect(result).toEqual([]);
    // Fallback should NOT have been called because it was aborted by user
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT execute redundant fallback endpoint on timeout or abort', async () => {
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(() => {
      callCount++;
      return Promise.reject(new DOMException('Timeout', 'TimeoutError'));
    });

    const result = await client.getCandles('TSLA', { timeframe: '5min' });
    expect(result).toEqual([]);
    // Should NOT double-retry when primary endpoint timed out
    expect(callCount).toBe(1);
  });

  it('passes user-provided AbortSignal to getTicks and respects abort', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      receivedSignal = init?.signal;
      return new Promise((_, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }
      });
    });

    const promise = client.getTicks('TSLA', {
      signal: controller.signal,
    } as any);

    expect(receivedSignal).toBeDefined();
    controller.abort();
    const result = await promise;
    expect(result).toEqual([]);
  });
});
