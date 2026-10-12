import React, { useMemo, useState } from 'react';
import { useAccountStore } from '../../store/useAccountStore';
import { BTCUSD_RULES, createInstrumentRegistry, trainingProfile } from '../../lib/orderSimulator/profiles';
import { ORDER_TYPE_COPY, SIMULATED_ACCOUNT_LABEL, ticketModel } from '../../lib/orderSimulator/uiViewModels';
import type { Side } from '../../lib/orderSimulator/types';

/**
 * SIM-UI-01 — the order ticket.
 *
 * The ticket does two things and nothing else: it collects an instruction, and it explains what that
 * instruction will do. It does not hold a position, and it does not decide anything about prices —
 * the model it renders is computed from the account's own last quote.
 *
 * Accessibility (SIM-UI-06) is structural here rather than bolted on: every input has a label, every
 * button is a real button, and the quantity carries its unit and its increment in the label text.
 */

export interface OrderTicketProps {
  symbol: string;
  onSubmit: (input: {
    side: Side;
    type: 'MARKET' | 'LIMIT' | 'STOP';
    size: number;
    level: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
  }) => { ok: boolean; error: string | null };
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#94a3b8',
  marginBottom: '3px',
};

const fieldStyle: React.CSSProperties = {
  background: '#0f172a',
  border: '1px solid #334155',
  color: '#fff',
  borderRadius: '4px',
  padding: '5px 6px',
  fontSize: '12px',
  width: '100%',
};

function SideButton({
  side,
  active,
  onClick,
}: {
  side: Side;
  active: boolean;
  onClick: () => void;
}) {
  const colour = side === 'BUY' ? '#26a69a' : '#ef5350';
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? colour : 'transparent',
        color: active ? '#fff' : colour,
        border: `1px solid ${colour}`,
        borderRadius: '4px',
        padding: '6px 0',
        fontSize: '12px',
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {side}
    </button>
  );
}

export function OrderTicket({ symbol, onSubmit }: OrderTicketProps) {
  const accountState = useAccountStore((s) => s.state);
  const [side, setSide] = useState<Side>('BUY');
  const [type, setType] = useState<'MARKET' | 'LIMIT' | 'STOP'>('MARKET');
  const [size, setSize] = useState(1);
  const [levelText, setLevelText] = useState('');
  const [stopLossText, setStopLossText] = useState('');
  const [takeProfitText, setTakeProfitText] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const rules = useMemo(() => {
    try {
      return createInstrumentRegistry([BTCUSD_RULES])(symbol);
    } catch {
      return BTCUSD_RULES;
    }
  }, [symbol]);

  const quote = accountState.lastQuoteBySymbol?.[symbol.toUpperCase()] ?? null;
  const level = levelText.trim() === '' ? null : Number(levelText);

  const model = ticketModel({
    symbol,
    side,
    type,
    size,
    level,
    quote,
    nowMs: accountState.nowMs,
    rules,
    profile: trainingProfile(),
  });

  const decimals = model.priceDecimals;

  const submit = () => {
    const result = onSubmit({
      side,
      type,
      size,
      level: model.levelRequired ? level : null,
      stopLoss: stopLossText.trim() === '' ? null : Number(stopLossText),
      takeProfit: takeProfitText.trim() === '' ? null : Number(takeProfitText),
    });
    setFeedback(result.ok ? 'Instruction sent to the simulated broker.' : result.error);
  };

  return (
    <section aria-labelledby="ticket-heading" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <header>
        <h2 id="ticket-heading" style={{ fontSize: '13px', margin: 0, color: '#e2e8f0' }}>
          Order ticket — {symbol}
        </h2>
        <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#94a3b8' }}>{SIMULATED_ACCOUNT_LABEL}</p>
      </header>

      <div aria-label="Live market" style={{ display: 'flex', gap: '10px', fontSize: '12px', background: '#0f172a', border: '1px solid #334155', borderRadius: '4px', padding: '6px 8px' }}>
        <span>
          Bid <strong data-testid="ticket-bid">{model.bid === null ? '—' : model.bid.toFixed(decimals)}</strong>
        </span>
        <span>
          Ask <strong data-testid="ticket-ask">{model.ask === null ? '—' : model.ask.toFixed(decimals)}</strong>
        </span>
        <span>
          Spread{' '}
          <strong data-testid="ticket-spread">
            {model.spread === null ? '—' : `${model.spread.toFixed(decimals)} (${model.spreadInTicks} ticks)`}
          </strong>
        </span>
        <span title="How long ago the quote this ticket is priced against arrived">
          Age <strong>{model.quoteAgeMs === null ? '—' : `${Math.round(model.quoteAgeMs)} ms`}</strong>
        </span>
      </div>

      <div role="group" aria-label="Order side" style={{ display: 'flex', gap: '6px' }}>
        <SideButton side="BUY" active={side === 'BUY'} onClick={() => setSide('BUY')} />
        <SideButton side="SELL" active={side === 'SELL'} onClick={() => setSide('SELL')} />
      </div>

      <div>
        <span id="ticket-type-label" style={labelStyle}>
          Order type
        </span>
        <div role="radiogroup" aria-labelledby="ticket-type-label" style={{ display: 'flex', gap: '6px' }}>
          {(['MARKET', 'LIMIT', 'STOP'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={type === option}
              onClick={() => setType(option)}
              style={{
                flex: 1,
                background: type === option ? '#1e293b' : 'transparent',
                color: type === option ? '#e2e8f0' : '#94a3b8',
                border: '1px solid #334155',
                borderRadius: '4px',
                padding: '5px 0',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              {ORDER_TYPE_COPY[option].title}
            </button>
          ))}
        </div>
        <p data-testid="type-copy" style={{ margin: '5px 0 0', fontSize: '11px', color: '#94a3b8', lineHeight: 1.4 }}>
          {ORDER_TYPE_COPY[type].consequence}
        </p>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="ticket-size" style={labelStyle}>
            Quantity ({rules.sizeIncrement} increments, min {rules.minSize})
          </label>
          <input
            id="ticket-size"
            type="number"
            inputMode="decimal"
            step={rules.sizeIncrement}
            min={rules.minSize}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            style={fieldStyle}
          />
        </div>
        {model.levelRequired && (
          <div style={{ flex: 1 }}>
            <label htmlFor="ticket-level" style={labelStyle}>
              {type === 'STOP' ? 'Stop level' : 'Limit level'} ({rules.tickSize} steps)
            </label>
            <input
              id="ticket-level"
              type="number"
              inputMode="decimal"
              step={rules.tickSize}
              value={levelText}
              onChange={(e) => setLevelText(e.target.value)}
              style={fieldStyle}
            />
          </div>
        )}
      </div>

      <details>
        <summary style={{ fontSize: '11px', color: '#94a3b8', cursor: 'pointer' }}>
          Protection (optional — off by default)
        </summary>
        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="ticket-sl" style={labelStyle}>
              Stop loss level
            </label>
            <input
              id="ticket-sl"
              type="number"
              inputMode="decimal"
              step={rules.tickSize}
              value={stopLossText}
              onChange={(e) => setStopLossText(e.target.value)}
              style={fieldStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="ticket-tp" style={labelStyle}>
              Take profit level
            </label>
            <input
              id="ticket-tp"
              type="number"
              inputMode="decimal"
              step={rules.tickSize}
              value={takeProfitText}
              onChange={(e) => setTakeProfitText(e.target.value)}
              style={fieldStyle}
            />
          </div>
        </div>
        <p style={{ margin: '5px 0 0', fontSize: '10px', color: '#94a3b8' }}>
          A position is unprotected unless you ask for protection. Leaving these blank sends an entry
          with no attached exits.
        </p>
      </details>

      <div aria-label="Estimated delay" style={{ fontSize: '11px', color: '#94a3b8' }}>
        Estimated delay: <strong data-testid="ticket-delay">{model.estimatedDelay.value} ms</strong> —{' '}
        <span data-testid="ticket-profile">{model.profileLabel}</span>{' '}
        <span style={{ opacity: 0.75 }}>({model.estimatedDelay.provenance})</span>
      </div>

      {model.errors.length > 0 && (
        <ul data-testid="ticket-errors" style={{ margin: 0, paddingLeft: '16px', color: '#fbbf24', fontSize: '11px' }}>
          {model.errors.map((error) => (
            <li key={error.code}>{error.message}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!model.canSubmit}
        aria-disabled={!model.canSubmit}
        style={{
          background: model.canSubmit ? (side === 'BUY' ? '#26a69a' : '#ef5350') : '#334155',
          color: model.canSubmit ? '#fff' : '#94a3b8',
          border: 'none',
          borderRadius: '4px',
          padding: '8px 0',
          fontSize: '12px',
          fontWeight: 700,
          cursor: model.canSubmit ? 'pointer' : 'not-allowed',
        }}
      >
        Submit {side} {type}
      </button>

      {feedback && (
        <p role="status" data-testid="ticket-feedback" style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>
          {feedback}
        </p>
      )}
    </section>
  );
}
