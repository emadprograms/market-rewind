import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import { TradeDesk } from '../../src/components/tradeDesk/TradeDesk';
import { useAccountStore } from '../../src/store/useAccountStore';
import { BTCUSD_RULES, TRADEABLE_INSTRUMENTS, trainingProfile } from '../../src/lib/orderSimulator/profiles';
import type { Quote } from '../../src/lib/orderSimulator/types';

/**
 * SIM-UI-01..06 through the DOM.
 *
 * These assertions are about what a user can read and do: that a position is never shown because a
 * button was clicked, that a pending order states the condition it is waiting on, that a lost race is
 * acknowledged rather than hidden, that the three delays are presented as different numbers, that
 * observed evidence is not editable, and that the desk is labelled and announced accessibly.
 */

const SYMBOL = 'BTCUSD';

function tape(count = 40, symbol: string = SYMBOL, base = 100): Quote[] {
  // The quotes carry the symbol the tape is registered under: a tape whose quotes name another
  // instrument is malformed input, and building one by accident once let a test pass for the wrong
  // reason (nothing was delivered, so nothing could be mispriced).
  return Array.from({ length: count }, (_, i) => {
    const bid = Math.round((base + i * 0.05) * 100) / 100;
    return { symbol, bid, ask: Math.round((bid + 0.5) * 100) / 100, replayMs: i * 1_000, seq: i + 1 };
  });
}

function mount() {
  return render(<TradeDesk symbol={SYMBOL} onClose={() => {}} />);
}

function openTab(name: 'Ticket' | 'Activity' | 'Timeline' | 'Settings') {
  fireEvent.click(screen.getByRole('tab', { name }));
}

/** Submit through the ticket the way a user does: type a size, pick a type, press submit. */
function submitMarket(size = 1) {
  fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: String(size) } });
  fireEvent.click(screen.getByRole('button', { name: /Submit BUY MARKET/ }));
}

beforeEach(() => {
  const store = useAccountStore.getState();
  store.configure({ instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: 'desk-ui' });
  useAccountStore.getState().registerTape(SYMBOL, tape());
});

// ---------------------------------------------------------------------------
// SIM-UI-01 — the ticket
// ---------------------------------------------------------------------------

describe('SIM-UI-01 — order ticket', () => {
  it('shows live bid, ask and spread from the account quote', () => {
    useAccountStore.getState().advanceTo(0, 'PLAY');
    mount();
    expect(screen.getByTestId('ticket-bid')).toHaveTextContent('100.00');
    expect(screen.getByTestId('ticket-ask')).toHaveTextContent('100.50');
    expect(screen.getByTestId('ticket-spread')).toHaveTextContent('0.50');
  });

  it('offers Market, Limit and Stop, and BUY / SELL', () => {
    mount();
    for (const type of ['Market', 'Limit', 'Stop']) {
      expect(screen.getByRole('radio', { name: type })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'BUY' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'SELL' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('explains the consequence of the selected order type', () => {
    mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Stop' }));
    expect(screen.getByTestId('type-copy')).toHaveTextContent(/worse price/);
  });

  it('requires a valid increment of quantity before it will submit', () => {
    mount();
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '0.00015' } });
    expect(screen.getByTestId('ticket-errors')).toHaveTextContent(/multiple of/);
    expect(screen.getByRole('button', { name: /Submit/ })).toBeDisabled();
  });

  it('refuses a wrong-side stop and says where it belongs', () => {
    useAccountStore.getState().advanceTo(0, 'PLAY'); // a quote to judge placement against
    mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Stop' }));
    fireEvent.change(screen.getByLabelText(/Stop level/), { target: { value: '95' } });
    expect(screen.getByTestId('ticket-errors')).toHaveTextContent(/must be placed above the market/);
    expect(screen.getByRole('button', { name: /Submit/ })).toBeDisabled();
  });

  it('shows the estimated delay with its profile label and provenance', () => {
    mount();
    expect(screen.getByTestId('ticket-delay')).toHaveTextContent('210 ms');
    expect(screen.getByTestId('ticket-profile')).toHaveTextContent(/Training/);
    expect(screen.getByTestId('ticket-delay').parentElement).toHaveTextContent(/TRAINING_ASSUMPTION/);
  });

  it('never shows a position merely because submit was clicked', () => {
    useAccountStore.getState().advanceTo(0, 'PLAY');
    mount();
    submitMarket(1);

    // The instruction exists and is in flight...
    openTab('Activity');
    expect(screen.getByTestId('activity-rows')).toHaveTextContent(/BUY MARKET/);
    // ...but no position is claimed until a fill actually happens.
    expect(screen.queryByText('POSITION')).not.toBeInTheDocument();
  });

  it('offers protection as an opt-in, and says that leaving it blank is unprotected', () => {
    mount();
    expect(screen.getByText(/off by default/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Protection \(optional/));
    expect(screen.getByText(/unprotected unless you ask for protection/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SIM-UI-02 — activity
// ---------------------------------------------------------------------------

describe('SIM-UI-02 — order and position activity', () => {
  it('shows Sending while an instruction is in flight, then Filled', () => {
    useAccountStore.getState().advanceTo(0, 'PLAY');
    mount();
    submitMarket(1);

    openTab('Activity');
    const row = screen.getByTestId('activity-rows').querySelector('li')!;
    expect(within(row).getByText('Sending')).toBeInTheDocument();

    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });

    // The order reports Filled, and the position it created reports itself as Open.
    const rows = screen.getByTestId('activity-rows');
    expect(rows).toHaveTextContent('Filled');
    expect(rows).toHaveTextContent('Open');
  });

  it('keeps a still-working instruction visible next to a filled position', () => {
    useAccountStore.getState().advanceTo(0, 'PLAY');
    mount();
    submitMarket(1);
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });

    // Now a limit order that will not fill: the position and the pending instruction coexist.
    fireEvent.click(screen.getByRole('radio', { name: 'Limit' }));
    fireEvent.change(screen.getByLabelText(/Limit level/), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit BUY LIMIT/ }));
    act(() => {
      useAccountStore.getState().advanceTo(12_000, 'PLAY');
    });

    openTab('Activity');
    const rows = screen.getByTestId('activity-rows');
    expect(rows).toHaveTextContent(/BUY LIMIT/);
    expect(rows).toHaveTextContent(/POSITION/);
  });

  it('states the exact price side and condition on a pending row', () => {
    useAccountStore.getState().advanceTo(0, 'PLAY');
    mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Limit' }));
    fireEvent.change(screen.getByLabelText(/Limit level/), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit BUY LIMIT/ }));
    act(() => {
      useAccountStore.getState().advanceTo(3_000, 'PLAY');
    });

    openTab('Activity');
    expect(screen.getByTestId('activity-rows')).toHaveTextContent(/Waiting for ask <= 80\.00/);
  });

  it('shows a rejection with a plain-language reason', () => {
    // A market that gaps up through the level before the instruction arrives: the stop was validly
    // placed where it was placed, but by the time the broker saw it, it was not a stop any more.
    useAccountStore.getState().registerTape(SYMBOL, [
      { symbol: SYMBOL, bid: 100, ask: 100.5, replayMs: 0, seq: 1 },
      { symbol: SYMBOL, bid: 103, ask: 103.5, replayMs: 50, seq: 2 },
      { symbol: SYMBOL, bid: 103.1, ask: 103.6, replayMs: 400, seq: 3 },
    ]);
    useAccountStore.getState().advanceTo(0, 'PLAY');
    mount();

    fireEvent.click(screen.getByRole('radio', { name: 'Stop' }));
    fireEvent.change(screen.getByLabelText(/Stop level/), { target: { value: '102' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit BUY STOP/ }));

    act(() => {
      useAccountStore.getState().advanceTo(500, 'PLAY');
    });

    openTab('Activity');
    expect(screen.getByTestId('activity-rows')).toHaveTextContent('Rejected');
    expect(screen.getByTestId('activity-rows')).toHaveTextContent(/Refused: this order type must sit on the other side/);
  });

  it('shows no price rather than inventing one, and lets the broker refuse', () => {
    // No tape for this symbol at all. The ticket displays nothing rather than a made-up price. The
    // ETHUSD tape is deliberately present AND deliberately priced ~3000: if the desk borrowed another
    // instrument's data to fill this gap, the bid below would show a number instead of a dash.
    useAccountStore.getState().configure({ instruments: [BTCUSD_RULES], profile: trainingProfile(), sessionId: 'no-quotes' });
    useAccountStore.getState().registerTape('ETHUSD', tape(40, 'ETHUSD', 3_000));
    mount();
    expect(screen.getByTestId('ticket-bid')).toHaveTextContent('—');
    expect(screen.getByTestId('ticket-bid')).not.toHaveTextContent('3');
    expect(screen.getByTestId('ticket-ask')).toHaveTextContent('—');

    // ...and accepting the instruction is all the client can honestly claim: the broker decides.
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit BUY MARKET/ }));
    expect(screen.getByTestId('ticket-feedback')).toHaveTextContent(/sent to the simulated broker/);

    act(() => {
      useAccountStore.getState().advanceTo(3_000, 'PLAY');
    });

    // The account cannot move without market data, and it says so instead of pretending otherwise.
    openTab('Activity');
    expect(screen.getByTestId('account-notices')).toHaveTextContent(/frozen/i);
    expect(screen.getByTestId('account-notices')).toHaveTextContent(/no tape/i);
    // The instruction stays visibly pending rather than quietly disappearing or filling.
    expect(screen.getByTestId('activity-rows')).toHaveTextContent('Sending');
    expect(screen.getByTestId('activity-rows')).not.toHaveTextContent('Filled');

    // Once the data exists the stall is over, and the disclosure goes away with it: the banner is a
    // statement about now, not a permanent scar.
    act(() => {
      useAccountStore.getState().registerTape(SYMBOL, tape());
      useAccountStore.getState().advanceTo(6_000, 'PLAY');
    });
    expect(screen.queryByTestId('account-notices')).toBeNull();
    expect(screen.getByTestId('activity-rows')).toHaveTextContent('Filled');
  });
});

// ---------------------------------------------------------------------------
// SIM-UI-03 — races
// ---------------------------------------------------------------------------

describe('SIM-UI-03 — cancel and amend races', () => {
  it('acknowledges a lost race in plain language and still shows the fill', () => {
    // The market jumps through the stop 50 ms after the cancellation is sent, and the cancellation
    // needs 100 ms to arrive: the race is lost by half the instruction's travel time.
    useAccountStore.getState().registerTape(SYMBOL, [
      { symbol: SYMBOL, bid: 100, ask: 100.5, replayMs: 0, seq: 1 },
      { symbol: SYMBOL, bid: 102, ask: 102.5, replayMs: 250, seq: 2 },
      { symbol: SYMBOL, bid: 102.2, ask: 102.7, replayMs: 2_000, seq: 3 },
    ]);
    useAccountStore.getState().advanceTo(0, 'PLAY');
    mount();

    // A stop above the market that will trigger, then a cancellation that cannot arrive in time.
    fireEvent.click(screen.getByRole('radio', { name: 'Stop' }));
    fireEvent.change(screen.getByLabelText(/Stop level/), { target: { value: '101.5' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit BUY STOP/ }));
    act(() => {
      useAccountStore.getState().advanceTo(200, 'PLAY');
    });

    openTab('Activity');
    const cancel = screen.getByRole('button', { name: /^Cancel BUY STOP/ });
    fireEvent.click(cancel);

    // Time passes; the market reaches the stop before the cancellation can complete its trip.
    act(() => {
      useAccountStore.getState().advanceTo(2_100, 'PLAY');
    });

    // The fill is still on the screen...
    const rows = screen.getByTestId('activity-rows');
    expect(rows).toHaveTextContent(/Filled/);
    // ...and the race is explained rather than hidden.
    const notices = screen.getByTestId('race-notices');
    expect(notices).toHaveTextContent(/before the cancellation arrived/);
  });

  it('offers cancel and amend on a resting order, and neither after it fills', () => {
    useAccountStore.getState().advanceTo(0, 'PLAY');
    mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Limit' }));
    fireEvent.change(screen.getByLabelText(/Limit level/), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit BUY LIMIT/ }));
    act(() => {
      useAccountStore.getState().advanceTo(1_000, 'PLAY');
    });

    openTab('Activity');
    expect(screen.getByRole('button', { name: /^Cancel BUY LIMIT/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Amend BUY LIMIT/ })).toBeInTheDocument();
  });

  it('sends an amendment and applies it once it arrives', () => {
    useAccountStore.getState().advanceTo(0, 'PLAY');
    mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Limit' }));
    fireEvent.change(screen.getByLabelText(/Limit level/), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit BUY LIMIT/ }));
    act(() => {
      useAccountStore.getState().advanceTo(1_000, 'PLAY');
    });

    openTab('Activity');
    fireEvent.click(screen.getByRole('button', { name: /^Amend BUY LIMIT/ }));
    fireEvent.change(screen.getByLabelText('New level'), { target: { value: '85' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    act(() => {
      useAccountStore.getState().advanceTo(3_000, 'PLAY');
    });

    // The instruction travels; once it lands the row states the new condition.
    expect(screen.getByTestId('activity-rows')).toHaveTextContent(/Waiting for ask <= 85\.00/);
  });
});

// ---------------------------------------------------------------------------
// SIM-UI-04 — timeline
// ---------------------------------------------------------------------------

describe('SIM-UI-04 — order timeline', () => {
  it('lists the distinct transitions with their times', () => {
    useAccountStore.getState().advanceTo(0, 'PLAY');
    mount();
    submitMarket(1);
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });

    openTab('Timeline');
    expect(screen.getByTestId('transition-Submitted')).toBeInTheDocument();
    expect(screen.getByTestId('transition-BrokerArrival')).toBeInTheDocument();
    expect(screen.getByTestId('transition-Accepted')).toBeInTheDocument();
    expect(screen.getByTestId('transition-QuoteEligible')).toBeInTheDocument();
    expect(screen.getByTestId('transition-Executed')).toBeInTheDocument();
    expect(screen.getByTestId('transition-NoticeReceived')).toBeInTheDocument();
  });

  it('presents execution delay, market waiting and notification delay as different numbers', () => {
    useAccountStore.getState().advanceTo(0, 'PLAY');
    mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Limit' }));
    fireEvent.change(screen.getByLabelText(/Limit level/), { target: { value: '101' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit BUY LIMIT/ }));
    act(() => {
      // The market climbs through the level a few seconds later.
      useAccountStore.getState().advanceTo(12_000, 'PLAY');
    });

    openTab('Timeline');
    const waiting = screen.getByTestId('interval-Market waiting');
    const notification = screen.getByTestId('interval-Notification delay');
    const execution = screen.getByTestId('interval-Execution delay');

    // The market waited, and the client was told later than the fill happened.
    expect(waiting).toHaveTextContent(/ms/);
    expect(notification).toHaveTextContent('100 ms');
    // Execution delay is a real, separately-measured interval — and never the same number relabelled.
    expect(execution.textContent).toMatch(/ms|not yet observable/);
    expect(waiting.textContent).not.toBe(notification.textContent);
  });

  it('says a value is not yet observable rather than showing a placeholder number', () => {
    useAccountStore.getState().advanceTo(0, 'PLAY');
    mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Limit' }));
    fireEvent.change(screen.getByLabelText(/Limit level/), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit BUY LIMIT/ }));
    act(() => {
      useAccountStore.getState().advanceTo(500, 'PLAY');
    });

    openTab('Timeline');
    expect(screen.getByTestId('interval-Execution delay')).toHaveTextContent('not yet observable');
  });

  it('shows an empty state before any order exists', () => {
    mount();
    openTab('Timeline');
    expect(screen.getByText(/Submit an order to see its transitions/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SIM-UI-05 — settings and provenance
// ---------------------------------------------------------------------------

describe('SIM-UI-05 — execution settings and provenance', () => {
  it('lists every delay as an editable setting with a note', () => {
    mount();
    openTab('Settings');
    const list = screen.getByTestId('settings-list');
    expect(within(list).getAllByRole('spinbutton')).toHaveLength(6);
    expect(list).toHaveTextContent(/Quote freshness limit/);
    expect(list).toHaveTextContent(/TRAINING_ASSUMPTION/);
  });

  it('makes the delay editable and reflects the change', () => {
    mount();
    openTab('Settings');
    const dispatch = screen.getByLabelText('Execution dispatch') as HTMLInputElement;
    expect(dispatch.value).toBe('50');
    fireEvent.change(dispatch, { target: { value: '250' } });
    expect((screen.getByLabelText('Execution dispatch') as HTMLInputElement).value).toBe('250');
  });

  it('presents an observed value as evidence, not as an editable preference', () => {
    mount();
    openTab('Settings');
    fireEvent.click(screen.getByRole('button', { name: 'Pilot reference envelope' }));

    // The measured envelope is displayed...
    expect(screen.getByTestId('setting-value-acknowledgementMs')).toHaveTextContent(/231\.4/);
    expect(screen.getByTestId('provenance-acknowledgementMs')).toHaveTextContent(/OBSERVED_SAMPLE/);
    expect(screen.getByTestId('provenance-acknowledgementMs')).toHaveTextContent(/not editable/);
    // ...and there is no editable control that could change it.
    expect(screen.queryByRole('spinbutton', { name: 'Acknowledgement envelope' })).toBeNull();
    // The surrounding assumptions stay editable.
    expect(screen.getByLabelText('Execution dispatch')).toBeInTheDocument();
  });

  it('keeps the evidence cards separate from the settings', () => {
    mount();
    openTab('Settings');
    const cards = screen.getByTestId('evidence-cards');
    expect(within(cards).getByTestId('evidence-pilot-post-market')).toHaveTextContent('231.5 ms');
    expect(screen.getByText(/single samples and are not a distribution/i)).toBeInTheDocument();
    // The evidence section is not inside the settings list.
    expect(within(screen.getByTestId('settings-list')).queryByTestId('evidence-cards')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SIM-UI-06 — labelling and accessibility
// ---------------------------------------------------------------------------

describe('SIM-UI-06 — labelling and accessibility', () => {
  it('labels the desk as a simulated account', () => {
    mount();
    const desk = screen.getByTestId('trade-desk');
    expect(desk).toHaveTextContent(/Simulated account/);
    expect(desk).toHaveTextContent(/no broker is contacted/i);
  });

  it('labels every input with a unit or an increment', () => {
    mount();
    expect(screen.getByLabelText(/Quantity \(0\.0001 increments, min 0\.0001\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Limit' }));
    expect(screen.getByLabelText(/Limit level \(0.05 steps\)/)).toBeInTheDocument();
  });

  it('exposes a polite live region that announces transitions but not ticks', () => {
    useAccountStore.getState().advanceTo(0, 'PLAY');
    mount();
    const region = screen.getByTestId('desk-announcement');
    expect(region).toHaveAttribute('aria-live', 'polite');

    submitMarket(1);
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });
    const announced = region.textContent ?? '';
    expect(announced).toMatch(/filled|cancelled|rejected|accepted|triggered|opened|closed|updates/i);

    // Twenty quotes arrive with no direction change of their own: the region stays quiet.
    const before = region.textContent;
    act(() => {
      useAccountStore.getState().advanceTo(9_000, 'PLAY');
    });
    expect(region.textContent).toBe(before);
  });

  it('makes the tabs keyboard operable', () => {
    mount();
    const ticketTab = screen.getByRole('tab', { name: 'Ticket' });
    ticketTab.focus();
    expect(ticketTab).toHaveFocus();
    fireEvent.keyDown(ticketTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Activity' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Ticket' })).toHaveAttribute('aria-selected', 'true');
  });

  it('marks the tabs as a tablist and the panels as labelled tabpanels', () => {
    mount();
    expect(screen.getByRole('tablist', { name: 'Trading desk sections' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'desk-tab-ticket');
  });

  it('never contacts a broker transport when an order is submitted', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockImplementation((() => {
      throw new Error('the desk must not perform network calls');
    }) as never);

    useAccountStore.getState().advanceTo(0, 'PLAY');
    mount();
    submitMarket(1);
    act(() => {
      useAccountStore.getState().advanceTo(5_000, 'PLAY');
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('SIM-QUOTE-02 — an instrument with no rules is refused, not approximated', () => {
  // The account trades BTCUSD plus the equity universe, each with its own rules. A symbol outside
  // that set is the case this suite is about: the charting backend can serve more symbols than the
  // simulated account is configured for, and that is exactly when a refusal must be spoken aloud.
  const UNCONFIGURED = 'PLTR';

  it('tells the user plainly instead of rendering a ticket it cannot honour', () => {
    render(<TradeDesk symbol={UNCONFIGURED} onClose={() => {}} />);

    const notice = screen.getByTestId('unsupported-instrument');
    expect(notice).toHaveTextContent(/does not trade PLTR/i);
    expect(notice).toHaveTextContent(/never borrowed from another symbol/i);
  });

  it('offers no way to submit an order it would have to refuse', () => {
    render(<TradeDesk symbol={UNCONFIGURED} onClose={() => {}} />);

    expect(screen.queryByRole('button', { name: /Submit BUY/ })).toBeNull();
    expect(screen.queryByTestId('ticket-bid')).toBeNull();
    expect(screen.queryByTestId('ticket-ask')).toBeNull();
  });

  it('never borrows BTCUSD price decimals or size steps for an unconfigured symbol', () => {
    render(<TradeDesk symbol={UNCONFIGURED} onClose={() => {}} />);

    expect(screen.getByTestId('unsupported-instrument')).toHaveTextContent(/does not trade PLTR/i);
    expect(screen.queryByText(/0\.0001 increments/)).toBeNull();
    expect(screen.queryByText(/0\.05 steps/)).toBeNull();
  });

  it('still renders a full ticket for the instrument it does trade', () => {
    render(<TradeDesk symbol={SYMBOL} onClose={() => {}} />);

    expect(screen.queryByTestId('unsupported-instrument')).toBeNull();
    expect(screen.getByTestId('ticket-bid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit BUY MARKET/ })).toBeInTheDocument();
  });
});

describe('SIM-QUOTE-02 — equity charts trade on their own rules, never BTCUSD\'s', () => {
  // The account must be configured with the same registry the app uses, or this suite would be
  // testing a configuration the application never has.
  beforeEach(() => {
    useAccountStore.getState().configure({ instruments: TRADEABLE_INSTRUMENTS });
  });

  it('renders a live ticket for an equity symbol', () => {
    render(<TradeDesk symbol="SPY" onClose={() => {}} />);

    expect(screen.queryByTestId('unsupported-instrument')).toBeNull();
    expect(screen.getByRole('button', { name: /Submit BUY MARKET/ })).toBeInTheDocument();
  });

  it('shows the equity price grid, not the Bitcoin one', () => {
    render(<TradeDesk symbol="SPY" onClose={() => {}} />);

    // Whole-share size increment. If this still read 0.0001, BTCUSD's rules were lent out instead.
    expect(screen.getByText(/1 increments, min 1/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.0001 increments/)).toBeNull();

    // The tick size is stated on the level field, which only exists for a level-based order.
    fireEvent.click(screen.getByRole('radio', { name: 'Limit' }));
    expect(screen.getByText(/0\.01 steps/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.05 steps/)).toBeNull();
  });
});

describe('SIM-QUOTE-02 — an assumed price grid says that it is assumed', () => {
  beforeEach(() => {
    useAccountStore.getState().configure({ instruments: TRADEABLE_INSTRUMENTS });
  });

  it('labels the equity grid as a training assumption, and says what the pilot did measure', () => {
    render(<TradeDesk symbol="SPY" onClose={() => {}} />);

    const provenance = screen.getByTestId('ticket-instrument-provenance');
    expect(provenance).toHaveTextContent('TRAINING_ASSUMPTION');
    expect(provenance).toHaveTextContent(/the pilot measured BTCUSD, not this instrument/i);
  });

  it('does not attach that disclaimer to the instrument the pilot did measure', () => {
    render(<TradeDesk symbol={SYMBOL} onClose={() => {}} />);

    const provenance = screen.getByTestId('ticket-instrument-provenance');
    expect(provenance).toHaveTextContent('OBSERVED_SAMPLE');
    expect(provenance).not.toHaveTextContent(/the pilot measured BTCUSD, not this instrument/i);
  });
});
