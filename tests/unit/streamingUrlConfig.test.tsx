import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import {
  resolveServiceUrl,
  normalizeServiceUrl,
  getHostDefaultStreamingUrl,
  StreamingClient,
  STORAGE_KEY_STREAMING_URL,
} from '../../src/lib/streamingClient';
import { ConnectionSetupCard } from '../../src/components/ConnectionSetupCard';
import { ConnectionModal } from '../../src/components/ConnectionModal';

describe('Streaming URL Resolution & Normalization', () => {
  describe('resolveServiceUrl', () => {
    it('prioritizes savedUrl from localStorage over hostname or env', () => {
      const url = resolveServiceUrl({
        savedUrl: 'http://100.110.120.130:8420',
        hostname: '100.64.0.1',
        envUrl: 'http://localhost:8420',
      });
      expect(url).toBe('http://100.110.120.130:8420');
    });

    it('defaults to http://<hostname>:8420 when accessed over Tailscale/LAN in browser', () => {
      const url = resolveServiceUrl({
        hostname: '100.85.14.92',
        protocol: 'http:',
        isTest: false,
      });
      expect(url).toBe('http://100.85.14.92:8420');
    });

    it('preserves https protocol for secure deployments', () => {
      const url = resolveServiceUrl({
        hostname: 'rewind.my-tailnet.ts.net',
        protocol: 'https:',
        isTest: false,
      });
      expect(url).toBe('https://rewind.my-tailnet.ts.net:8420');
    });

    it('defaults to DEFAULT_STREAMING_URL (http://100.72.128.22:8420) on localhost in browser', () => {
      const url = resolveServiceUrl({
        hostname: 'localhost',
        isTest: false,
      });
      expect(url).toBe('http://100.72.128.22:8420');
    });

    it('falls back to envUrl or localhost in test mode when no savedUrl', () => {
      const url = resolveServiceUrl({
        envUrl: 'http://test-server:8420',
        isTest: true,
      });
      expect(url).toBe('http://test-server:8420');

      const urlDefault = resolveServiceUrl({
        isTest: true,
      });
      expect(urlDefault).toBe('http://localhost:8420');
    });
  });

  describe('normalizeServiceUrl', () => {
    it('prepends http:// if protocol is omitted', () => {
      const res = normalizeServiceUrl('100.101.102.103:8420');
      expect(res.httpUrl).toBe('http://100.101.102.103:8420');
      expect(res.wsUrl).toBe('ws://100.101.102.103:8420');
    });

    it('strips trailing slashes from URL', () => {
      const res = normalizeServiceUrl('http://100.101.102.103:8420///');
      expect(res.httpUrl).toBe('http://100.101.102.103:8420');
      expect(res.wsUrl).toBe('ws://100.101.102.103:8420');
    });

    it('derives wss:// for https URLs', () => {
      const res = normalizeServiceUrl('https://my-host.tailnet.ts.net:8420');
      expect(res.httpUrl).toBe('https://my-host.tailnet.ts.net:8420');
      expect(res.wsUrl).toBe('wss://my-host.tailnet.ts.net:8420');
    });

    it('converts ws:// inputs to http base URL', () => {
      const res = normalizeServiceUrl('ws://192.168.1.50:8420');
      expect(res.httpUrl).toBe('http://192.168.1.50:8420');
      expect(res.wsUrl).toBe('ws://192.168.1.50:8420');
    });

    it('trims leading and trailing whitespace', () => {
      const res = normalizeServiceUrl('   http://tailscale-box:8420   ');
      expect(res.httpUrl).toBe('http://tailscale-box:8420');
      expect(res.wsUrl).toBe('ws://tailscale-box:8420');
    });
  });
});

describe('StreamingClient URL State & Subscriptions', () => {
  let client: StreamingClient;

  beforeEach(() => {
    localStorage.clear();
    client = new StreamingClient();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('updates base URL and WebSocket URL on setServiceUrl', () => {
    const res = client.setServiceUrl('100.90.80.70:8420');
    expect(res.httpUrl).toBe('http://100.90.80.70:8420');
    expect(res.wsUrl).toBe('ws://100.90.80.70:8420');
    expect(client.getBaseUrl()).toBe('http://100.90.80.70:8420');
    expect(client.getWsUrl()).toBe('ws://100.90.80.70:8420');
    expect(localStorage.getItem(STORAGE_KEY_STREAMING_URL)).toBe('http://100.90.80.70:8420');
  });

  it('notifies registered listeners when service URL changes', () => {
    const listener = vi.fn();
    const unsubscribe = client.subscribeUrlChange(listener);

    client.setServiceUrl('http://desktop-tailscale:8420');
    expect(listener).toHaveBeenCalledWith('http://desktop-tailscale:8420');

    unsubscribe();
    client.setServiceUrl('http://laptop:8420');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears localStorage on resetToDefaultUrl', () => {
    client.setServiceUrl('http://custom-url:8420');
    expect(localStorage.getItem(STORAGE_KEY_STREAMING_URL)).toBe('http://custom-url:8420');

    client.resetToDefaultUrl();
    expect(localStorage.getItem(STORAGE_KEY_STREAMING_URL)).toBeNull();
  });

  it('performs dynamic fetch calls targeting the configured base URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'OK', streaming_db: { exists: true, tick_count: 5000000 } }),
    } as any);

    client.setServiceUrl('http://100.70.80.90:8420');
    await client.checkStatus();

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://100.70.80.90:8420/api/status',
      expect.objectContaining({ signal: expect.any(Object) })
    );

    fetchSpy.mockRestore();
  });
});

describe('Connection UI Components', () => {
  it('renders ConnectionSetupCard with presets and input', () => {
    const onConnect = vi.fn();
    render(
      <ConnectionSetupCard
        currentUrl="http://100.200.300.400:8420"
        dbStatus="Streaming DuckDB offline at http://100.200.300.400:8420"
        onConnect={onConnect}
      />
    );

    expect(screen.getByText('DuckDB Streaming Service Offline')).toBeInTheDocument();
    const input = screen.getByLabelText(/Streaming Service URL/i) as HTMLInputElement;
    expect(input.value).toBe('http://100.200.300.400:8420');

    // Click Tailscale IP preset
    const tailscaleBtn = screen.getByRole('button', { name: /Tailscale IP/i });
    fireEvent.click(tailscaleBtn);
    expect(input.value).toBe('http://100.72.128.22:8420');

    // Click MagicDNS preset
    const magicDnsBtn = screen.getByRole('button', { name: /MagicDNS/i });
    fireEvent.click(magicDnsBtn);
    expect(input.value).toBe('http://arshad-pc-1:8420');
  });

  it('tests and connects successfully in ConnectionSetupCard when service is healthy', async () => {
    const onConnect = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'OK', streaming_db: { exists: true, tick_count: 1000 } }),
    } as any);

    render(
      <ConnectionSetupCard
        currentUrl="http://my-desktop:8420"
        dbStatus="Offline"
        onConnect={onConnect}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /Connect to Service/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith('http://my-desktop:8420');
    });

    fetchSpy.mockRestore();
  });

  it('renders ConnectionModal and handles save and reset', () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    const onReset = vi.fn();

    const { rerender } = render(
      <ConnectionModal
        isOpen={false}
        onClose={onClose}
        currentUrl="http://100.1.2.3:8420"
        isDbLoaded={false}
        dbStatus="Offline"
        onSave={onSave}
        onReset={onReset}
      />
    );

    expect(screen.queryByText('DuckDB Streaming Backend')).not.toBeInTheDocument();

    rerender(
      <ConnectionModal
        isOpen={true}
        onClose={onClose}
        currentUrl="http://100.1.2.3:8420"
        isDbLoaded={true}
        dbStatus="Connected"
        onSave={onSave}
        onReset={onReset}
      />
    );

    expect(screen.getByText('DuckDB Streaming Backend')).toBeInTheDocument();

    // Test Save & Connect button
    const saveBtn = screen.getByRole('button', { name: /Save & Connect/i });
    fireEvent.click(saveBtn);
    expect(onSave).toHaveBeenCalledWith('http://100.1.2.3:8420');
    expect(onClose).toHaveBeenCalled();
  });
});
