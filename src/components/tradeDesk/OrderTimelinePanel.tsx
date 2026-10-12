import React from 'react';
import { useAccountStore } from '../../store/useAccountStore';
import { orderTimeline, presentTransitions } from '../../lib/orderSimulator/uiViewModels';

/**
 * SIM-UI-04 — the order timeline.
 *
 * Six transitions and three intervals. The intervals are shown as separate, explicitly named numbers
 * because conflating them is the mistake this whole milestone exists to prevent: "the broker is slow"
 * and "the market did not reach my price yet" and "I was not told" are three different complaints with
 * three different fixes.
 */

function Interval({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  return (
    <div style={{ border: '1px solid #334155', borderRadius: '4px', padding: '5px 7px', background: '#0f172a' }}>
      <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div data-testid={`interval-${label}`} style={{ fontSize: '13px', color: value === null ? '#64748b' : '#e2e8f0' }}>
        {value === null ? 'not yet observable' : `${value} ms`}
      </div>
      <div style={{ fontSize: '10px', color: '#64748b' }}>{hint}</div>
    </div>
  );
}

export function OrderTimelinePanel({ orderId }: { orderId: string | null }) {
  const accountState = useAccountStore((s) => s.state);
  const orders = accountState.orders;
  const target = orderId ?? (orders.length > 0 ? orders[orders.length - 1].orderId : null);

  if (target === null) {
    return (
      <section aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" style={{ fontSize: '13px', margin: 0, color: '#e2e8f0' }}>
          Order timeline
        </h2>
        <p style={{ fontSize: '11px', color: '#94a3b8' }}>Submit an order to see its transitions.</p>
      </section>
    );
  }

  const timeline = orderTimeline(accountState, target as never);
  const transitions = presentTransitions(timeline);
  const order = orders.find((o) => o.orderId === target);

  return (
    <section aria-labelledby="timeline-heading" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <h2 id="timeline-heading" style={{ fontSize: '13px', margin: 0, color: '#e2e8f0' }}>
        Order timeline
      </h2>
      <p data-testid="timeline-subject" style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>
        {order ? `${order.side} ${order.type} ${order.size} ${order.symbol} — ${target}` : target}
      </p>

      {transitions.length === 0 ? (
        <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>Nothing has happened to this order yet.</p>
      ) : (
        <ol data-testid="timeline-transitions" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {transitions.map((transition) => (
            <li key={transition.name} data-testid={`transition-${transition.name}`} style={{ borderLeft: '2px solid #334155', paddingLeft: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#e2e8f0' }}>{transition.label}</span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>{transition.replayMs} ms</span>
              </div>
              {transition.reason && (
                <div style={{ fontSize: '10px', color: '#64748b' }}>
                  {transition.quoteSide && transition.quotePrice !== null
                    ? `${transition.quoteSide} ${transition.quotePrice} — `
                    : ''}
                  {transition.reason}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <div role="group" aria-label="Intervals" style={{ display: 'grid', gap: '5px' }}>
        <Interval
          label="Execution delay"
          value={timeline.intervals.executionDelayMs}
          hint="From the moment the order was free to execute to the fill."
        />
        <Interval
          label="Market waiting"
          value={timeline.intervals.marketWaitingMs}
          hint="From eligibility to the market reaching the condition. Not broker latency."
        />
        <Interval
          label="Notification delay"
          value={timeline.intervals.notificationDelayMs}
          hint="From the fill to this client hearing about it."
        />
      </div>
    </section>
  );
}
