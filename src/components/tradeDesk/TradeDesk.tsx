import React, { useEffect, useRef, useState } from 'react';
import { useAccountStore } from '../../store/useAccountStore';
import { announce, SIMULATED_ACCOUNT_LABEL } from '../../lib/orderSimulator/uiViewModels';
import { trainingProfile } from '../../lib/orderSimulator/profiles';
import { OrderTicket } from './OrderTicket';
import { ActivityPanel } from './ActivityPanel';
import { OrderTimelinePanel } from './OrderTimelinePanel';
import { ExecutionSettings } from './ExecutionSettings';
import type { LatencyProfile, Side } from '../../lib/orderSimulator/types';

/**
 * SIM-UI-06 — the desk: tabs, the live region, and the honest label.
 *
 * One live region for the whole desk, fed by `announce`. It is deliberately fed from *transitions*
 * rather than from state: announcing every price tick would make the region useless to a screen
 * reader user, so ticks produce nothing at all.
 */

type Tab = 'ticket' | 'activity' | 'timeline' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'ticket', label: 'Ticket' },
  { id: 'activity', label: 'Activity' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'settings', label: 'Settings' },
];

export interface TradeDeskProps {
  symbol: string;
  onClose: () => void;
}

export function TradeDesk({ symbol, onClose }: TradeDeskProps) {
  const accountState = useAccountStore((s) => s.state);
  const [tab, setTab] = useState<Tab>('ticket');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [profile, setProfile] = useState<LatencyProfile>(() => trainingProfile());
  const [announcement, setAnnouncement] = useState<string | null>(null);

  // The live region tracks how much of the log has been spoken, so a re-render never repeats an
  // announcement and a quiet render never clears one.
  const spokenCount = useRef(accountState.events.length);

  useEffect(() => {
    const message = announce(accountState, spokenCount.current);
    spokenCount.current = accountState.events.length;
    if (message) setAnnouncement(message);
  }, [accountState]);

  const submit = (input: {
    side: Side;
    type: 'MARKET' | 'LIMIT' | 'STOP';
    size: number;
    level: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
  }) => {
    const result = useAccountStore.getState().openPosition({ symbol, ...input });
    return { ok: result.ok, error: result.error };
  };

  return (
    <aside
      aria-label="Trading desk"
      data-testid="trade-desk"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: '352px',
        background: '#0b1220',
        borderLeft: '1px solid #1e293b',
        color: '#e2e8f0',
        fontFamily: 'Inter, system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 4000,
        boxShadow: '-8px 0 24px rgba(0,0,0,0.35)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid #1e293b' }}>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700 }}>Trading desk</div>
          <div style={{ fontSize: '10px', color: '#94a3b8' }}>{SIMULATED_ACCOUNT_LABEL}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the trading desk"
          style={{ background: 'transparent', border: '1px solid #334155', color: '#cbd5e1', borderRadius: '4px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer' }}
        >
          Close
        </button>
      </header>

      {/* The one live region for the desk. It speaks transitions, never ticks. */}
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="desk-announcement" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        {announcement ?? ''}
      </div>

      <div role="tablist" aria-label="Trading desk sections" style={{ display: 'flex', borderBottom: '1px solid #1e293b' }}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            id={`desk-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`desk-panel-${entry.id}`}
            tabIndex={tab === entry.id ? 0 : -1}
            onClick={() => setTab(entry.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const index = TABS.findIndex((t) => t.id === tab);
              const next = TABS[(index + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
              setTab(next.id);
            }}
            style={{
              flex: 1,
              background: tab === entry.id ? '#111c33' : 'transparent',
              color: tab === entry.id ? '#e2e8f0' : '#94a3b8',
              border: 'none',
              borderBottom: `2px solid ${tab === entry.id ? '#38bdf8' : 'transparent'}`,
              padding: '7px 0',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`desk-panel-${tab}`}
        aria-labelledby={`desk-tab-${tab}`}
        style={{ padding: '10px', overflowY: 'auto', flex: 1 }}
      >
        {tab === 'ticket' && <OrderTicket symbol={symbol} onSubmit={submit} />}
        {tab === 'activity' && <ActivityPanel symbol={symbol} />}
        {tab === 'timeline' && <OrderTimelinePanel orderId={selectedOrderId} />}
        {tab === 'settings' && <ExecutionSettings profile={profile} onChangeProfile={setProfile} />}
      </div>
    </aside>
  );
}
