import React, { useMemo, useState } from 'react';
import { useAccountStore } from '../../store/useAccountStore';
import { BTCUSD_RULES, createInstrumentRegistry } from '../../lib/orderSimulator/profiles';
import { activityRows, raceNotices, type ActivityRow } from '../../lib/orderSimulator/uiViewModels';

/**
 * SIM-UI-02 and SIM-UI-03 — order and position activity.
 *
 * The list is built from the account's instructions and positions, newest first. Two things it must
 * never do, both of which are asserted in the tests:
 *
 *  - it never shows a position because submit was clicked, only because a fill happened;
 *  - it never hides a fill because a cancel button was pressed, and a lost race is stated plainly.
 */

const STATUS_COLOURS: Record<ActivityRow['status'], string> = {
  Sending: '#94a3b8',
  Working: '#38bdf8',
  Executing: '#a78bfa',
  Triggered: '#fbbf24',
  Filled: '#26a69a',
  Cancelled: '#64748b',
  Rejected: '#ef5350',
  Open: '#26a69a',
  Closed: '#64748b',
};

export function ActivityPanel({ symbol }: { symbol: string }) {
  const accountState = useAccountStore((s) => s.state);
  const notices = useAccountStore((s) => s.notices);
  const frozen = useAccountStore((s) => s.frozen);
  const frozenReason = useAccountStore((s) => s.frozenReason);
  const [selected, setSelected] = useState<string | null>(null);
  const [amendOrderId, setAmendOrderId] = useState<string | null>(null);
  const [amendText, setAmendText] = useState('');

  const rulesFor = useMemo(() => {
    let registry: ((symbol: string) => typeof BTCUSD_RULES) | null = null;
    try {
      registry = createInstrumentRegistry([BTCUSD_RULES]);
    } catch {
      registry = null;
    }
    return (wanted: string) => {
      try {
        return registry ? registry(wanted) : BTCUSD_RULES;
      } catch {
        return null;
      }
    };
  }, []);

  const rows = activityRows(accountState, rulesFor).filter((row) => row.symbol.toUpperCase() === symbol.toUpperCase());
  const races = raceNotices(accountState).filter((notice) =>
    accountState.orders.some((o) => o.orderId === notice.orderId && o.symbol.toUpperCase() === symbol.toUpperCase()),
  );

  const commitAmend = (row: ActivityRow) => {
    const level = Number(amendText);
    const result = useAccountStore.getState().amendOrder(row.id as never, row.version, level);
    if (result.ok) {
      setAmendOrderId(null);
      setAmendText('');
    }
  };

  return (
    <section aria-labelledby="activity-heading" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <h2 id="activity-heading" style={{ fontSize: '13px', margin: 0, color: '#e2e8f0' }}>
        Orders &amp; positions
      </h2>

      {frozen && (
        <div role="status" data-testid="account-notices" style={{ border: '1px solid #fbbf24', background: 'rgba(251,191,36,0.07)', borderRadius: '4px', padding: '6px 8px' }}>
          <p style={{ margin: 0, fontSize: '11px', color: '#fbbf24' }}>
            Playback is stalled: {frozenReason === 'MISSING_TAPE' ? 'there is no market data for a symbol with a live instruction' : 'the market data has run out'}.
          </p>
          <p style={{ margin: '3px 0 0', fontSize: '10px', color: '#cbd5e1' }}>
            Pending instructions wait rather than fill against a price that does not exist. The
            simulator never invents a quote to keep an order moving.
          </p>
          {notices.length > 0 && (
            <p style={{ margin: '3px 0 0', fontSize: '10px', color: '#64748b' }}>{notices[notices.length - 1]}</p>
          )}
        </div>
      )}

      {races.length > 0 && (
        <div role="alert" data-testid="race-notices" style={{ border: '1px solid #fbbf24', background: 'rgba(251,191,36,0.08)', borderRadius: '4px', padding: '6px 8px' }}>
          {races.map((race) => (
            <p key={race.orderId} style={{ margin: 0, fontSize: '11px', color: '#fbbf24' }}>
              {race.text}
            </p>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>No orders yet. Submit one from the ticket.</p>
      ) : (
        <ul data-testid="activity-rows" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {rows.map((row) => (
            <li
              key={row.key}
              data-testid={`row-${row.key}`}
              style={{
                border: `1px solid ${selected === row.id ? '#38bdf8' : '#334155'}`,
                borderRadius: '4px',
                padding: '6px 8px',
                background: '#0f172a',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setSelected(row.id)}
                  aria-label={`Show the timeline for ${row.side} ${row.type} ${row.id}`}
                  style={{ background: 'none', border: 'none', padding: 0, color: '#e2e8f0', fontSize: '12px', cursor: 'pointer', textAlign: 'left' }}
                >
                  <strong style={{ color: row.side === 'BUY' ? '#26a69a' : '#ef5350' }}>{row.side}</strong>{' '}
                  {row.type} {row.size}
                  {row.level !== null ? ` @ ${row.level}` : ''}
                </button>
                <span
                  data-testid={`status-${row.id}`}
                  style={{
                    color: STATUS_COLOURS[row.status],
                    border: `1px solid ${STATUS_COLOURS[row.status]}`,
                    borderRadius: '999px',
                    padding: '1px 7px',
                    fontSize: '10px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.status}
                </span>
              </div>

              {row.condition && (
                <p data-testid={`condition-${row.id}`} style={{ margin: '4px 0 0', fontSize: '11px', color: '#cbd5e1' }}>
                  {row.condition}
                </p>
              )}

              {row.rejectReason && (
                <p data-testid={`reject-${row.id}`} style={{ margin: '4px 0 0', fontSize: '11px', color: '#ef5350' }}>
                  {row.rejectReason}
                </p>
              )}

              {(row.cancellable || row.amendable) && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '5px' }}>
                  {row.cancellable && (
                    <button
                      type="button"
                      onClick={() => useAccountStore.getState().cancelOrder(row.id as never)}
                      aria-label={`Cancel ${row.side} ${row.type} ${row.id}`}
                      style={{ fontSize: '10px', background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  )}
                  {row.amendable && amendOrderId !== row.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setAmendOrderId(row.id);
                        setAmendText(row.level === null ? '' : String(row.level));
                      }}
                      aria-label={`Amend ${row.side} ${row.type} ${row.id}`}
                      style={{ fontSize: '10px', background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
                    >
                      Amend
                    </button>
                  )}
                  {amendOrderId === row.id && (
                    <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <label htmlFor={`amend-${row.id}`} style={{ fontSize: '10px', color: '#94a3b8' }}>
                        New level
                      </label>
                      <input
                        id={`amend-${row.id}`}
                        type="number"
                        step={BTCUSD_RULES.tickSize}
                        value={amendText}
                        onChange={(e) => setAmendText(e.target.value)}
                        style={{ width: '70px', background: '#0f172a', border: '1px solid #334155', color: '#fff', borderRadius: '4px', padding: '2px 4px', fontSize: '11px' }}
                      />
                      <button
                        type="button"
                        onClick={() => commitAmend(row)}
                        style={{ fontSize: '10px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
                      >
                        Send
                      </button>
                    </span>
                  )}
                </div>
              )}

              {row.kind === 'POSITION' && (
                <div style={{ marginTop: '5px' }}>
                  <button
                    type="button"
                    disabled={!row.cancellable}
                    onClick={() => useAccountStore.getState().closePosition(row.id as never)}
                    aria-label={`Close position ${row.id}`}
                    style={{
                      fontSize: '10px',
                      background: row.cancellable ? 'transparent' : '#1e293b',
                      color: row.cancellable ? '#fbbf24' : '#64748b',
                      border: `1px solid ${row.cancellable ? '#fbbf24' : '#334155'}`,
                      borderRadius: '4px',
                      padding: '2px 8px',
                      cursor: row.cancellable ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {row.cancellable ? 'Close position' : 'Close already requested'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p style={{ margin: 0, fontSize: '10px', color: '#64748b' }}>
        A pending instruction stays visible next to the positions it will create. Cancelling is an
        instruction too: it has travel time, and it can lose.
      </p>
    </section>
  );
}
