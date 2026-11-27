import type {
  BookLevel,
  Event,
  MarketBook,
  Message,
  MarketViewMetadata,
  ProductPolicy,
  WalCoverage,
  WalRecord,
} from './generated/types.gen';
import type { ChartBar } from '../components/MarketChart';
import type {
  MarketInstrument,
  MarketPeriod,
  Trade,
} from '../features/market/marketData';
import {
  applyBookEvent,
  waitingForBook,
  type BookEvent,
  type BookState,
} from '../features/market/orderBook';

export type Partition = {
  source: string;
  product: string;
  instrument_id: string;
  channel: string;
};

export type ProductWindow = {
  policy: ProductPolicy;
  records: readonly WalRecord[];
  durable: string;
  observedAt: string;
};

export function u64(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(value))
    throw new Error('Invalid WAL position');
  const number = BigInt(value);
  if (number > 18_446_744_073_709_551_615n)
    throw new Error('Invalid WAL position');
  return number;
}

export function wireTime(value: string) {
  const nanos = u64(value);
  const second = nanos / 1_000_000_000n;
  const fraction = (nanos % 1_000_000_000n).toString().padStart(9, '0');
  return (
    new Date(Number(second) * 1000).toISOString().slice(0, 19) +
    '.' +
    fraction +
    'Z'
  );
}

export function decimal(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value) ||
    value.replace(/[-.]/g, '').length > 28
  )
    throw new Error('Invalid decimal');
  return value;
}

export function level(value: BookLevel) {
  const quantity = decimal(value.quantity);
  if (quantity.startsWith('-')) throw new Error('Negative level quantity');
  return { price: decimal(value.price), quantity };
}

export function checkPolicy(access: ProductPolicy, policy: ProductPolicy) {
  if (
    !access.display_live ||
    !access.record_local ||
    access.source !== policy.source ||
    access.product !== policy.product ||
    access.license !== policy.license
  )
    throw new Error('Market policy changed');
}

export function checkView(view: MarketViewMetadata, track: Track) {
  checkPolicy(view.access, track.window.policy);
  if (view.instrument_id !== track.partition.instrument_id)
    throw new Error('Unexpected instrument');
}

export function matches(event: Event, track: Track) {
  const { partition, window } = track;
  return (
    event.source === partition.source &&
    event.product === partition.product &&
    event.channel === partition.channel &&
    event.instrument_id === partition.instrument_id &&
    event.license === window.policy.license &&
    event.schema_version ===
      (event.kind === 'perpetual_context' ? '2.0' : '1.0') &&
    event.instrument_id.split('.').at(-1) === event.venue
  );
}

export function coverageText(coverage: WalCoverage) {
  return `WAL 已扫描 ${coverage.scanned_records} 条 · 位置 (${coverage.after}, ${coverage.through}]`;
}

type Kind = 'quote' | 'book' | 'trade' | 'bar_closed' | 'perpetual_context';

export type Track = {
  kind: Kind;
  partition: Partition;
  window: ProductWindow;
  availableFrom?: string;
  snapshot?: WalRecord;
};

function bookKind(event: Extract<Event, { kind: 'snapshot' }>): Kind {
  if (/(^|[-_.])(l1|quote|quotes|bbo)([-_.]|$)/.test(event.channel))
    return 'quote';
  return 'book';
}

export function marketTracks(windows: readonly ProductWindow[]) {
  const instruments = new Map<string, MarketInstrument>();
  const tracks = new Map<string, Track>();
  for (const window of windows) {
    for (const record of window.records) {
      const event = record.event;
      const { instrument_id, venue, asset_kind, kind } = event;
      if (
        asset_kind === 'option' ||
        !/^[A-Z0-9][A-Z0-9_.-]*\.[A-Z0-9][A-Z0-9_-]*$/.test(instrument_id)
      )
        continue;
      const id = instrument_id;
      const crypto = asset_kind === 'spot' || asset_kind === 'perpetual';
      const base = id.split(/[-.]/)[0];
      if (!instruments.has(id))
        instruments.set(id, {
          id,
          name: venue,
          product: event.product,
          kind: crypto ? 'crypto' : id === 'SPY.ARCA' ? 'l1-only' : 'nasdaq',
          currency: /-USDT(?:[.-])/.test(id) ? 'USDT' : 'USD',
          quantityUnit: crypto ? base : '股',
          timeZone: crypto ? 'UTC' : 'America/New_York',
        });
      if (
        kind !== 'snapshot' &&
        kind !== 'trade' &&
        kind !== 'bar_closed' &&
        kind !== 'perpetual_context'
      )
        continue;
      const trackKind = kind === 'snapshot' ? bookKind(event) : kind;
      const partition = {
        source: event.source,
        product: event.product,
        instrument_id,
        channel: event.channel,
      };
      const key = JSON.stringify(partition);
      const track = tracks.get(key) ?? { kind: trackKind, partition, window };
      if (!matches(event, track)) continue;
      const day = wireTime(event.first_available_ts).slice(0, 10);
      if (!track.availableFrom || day < track.availableFrom)
        track.availableFrom = day;
      if (kind === 'snapshot') track.snapshot = record;
      tracks.set(key, track);
    }
  }
  return { instruments, tracks: [...tracks.values()] };
}

export function selectionTracks(
  tracks: readonly Track[],
  id: string,
  period: MarketPeriod | null,
) {
  const candidates = tracks.filter(
    (track) => track.partition.instrument_id === id,
  );
  const find = (kind: Kind) => candidates.find((track) => track.kind === kind);
  const book = find('book');
  const bar = period
    ? candidates.find(
        (track) =>
          track.kind === 'bar_closed' &&
          track.partition.channel.split(/[-_.]/).includes(period),
      )
    : undefined;
  return {
    quote: find('quote') ?? book,
    book: id === 'SPY.ARCA' ? undefined : book,
    trade: id === 'SPY.ARCA' ? undefined : find('trade'),
    derivative: find('perpetual_context'),
    bar,
  };
}

export function historyRows(
  records: readonly WalRecord[],
  track: Track,
  kind: 'trade' | 'bar_closed' | 'perpetual_context',
) {
  type Row = Message & {
    exchange_ts: Event['exchange_ts'];
    receive_ts: string;
  };
  const rows = new Map<string, Row>();
  for (const { event } of records) {
    if (!matches(event, track)) continue;
    if (event.kind === kind) rows.set(event.epoch + '/' + event.seq, event);
    if (
      event.kind === 'correction' &&
      event.payload.replacement.kind === kind
    ) {
      const id = event.payload.target_epoch + '/' + event.payload.target_seq;
      const original = rows.get(id);
      rows.set(id, { ...(original ?? event), ...event.payload.replacement });
    }
  }
  return rows;
}

export function barRows(records: readonly WalRecord[], track: Track) {
  const bars = new Map<string, ChartBar>();
  for (const event of historyRows(records, track, 'bar_closed').values()) {
    if (event.kind !== 'bar_closed') continue;
    const { open_ts, open, high, low, close, volume } = event.payload;
    const time = wireTime(open_ts);
    bars.set(time, {
      time,
      open: decimal(open),
      high: decimal(high),
      low: decimal(low),
      close: decimal(close),
      volume: decimal(volume),
    });
  }
  return [...bars.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export function tradeRows(records: readonly WalRecord[], track: Track) {
  const trades: Trade[] = [];
  for (const [id, event] of historyRows(records, track, 'trade')) {
    if (event.kind !== 'trade') continue;
    trades.push({
      id,
      time: wireTime(event.exchange_ts ?? event.receive_ts),
      price: decimal(event.payload.price),
      quantity: decimal(event.payload.quantity),
    });
  }
  return trades.sort((a, b) => b.time.localeCompare(a.time));
}

export function bookState(
  view: MarketBook,
  track: Track,
): BookEvent | undefined {
  checkView(view, track);
  const observation = view.observation;
  if (view.state !== 'observed' || !observation || !view.bids || !view.asks)
    return;
  if (
    observation.channel !== track.partition.channel ||
    observation.venue !== track.partition.instrument_id.split('.').at(-1)
  )
    throw new Error('Unexpected book partition');
  return {
    kind: 'snapshot',
    epoch: u64(observation.epoch),
    seq: u64(observation.seq),
    asOf: wireTime(observation.exchange_ts ?? observation.receive_ts),
    bids: view.bids.map(level),
    asks: view.asks.map(level),
  };
}

// Decode the same F1 frames for live delivery and historical reconstruction.
export function bookEvent(
  event: Event,
  state: BookState,
): BookEvent | undefined {
  const epoch = u64(event.epoch);
  const seq = u64(event.seq);
  if (event.kind === 'reset') return { kind: 'reset', epoch, seq };
  if (
    event.kind === 'gap' ||
    event.kind === 'correction' ||
    (event.kind === 'status' && event.payload.state === 'disconnected')
  )
    return { kind: 'unavailable', reason: '盘口失同步' };
  if (event.kind === 'snapshot')
    return {
      kind: 'snapshot',
      epoch,
      seq,
      asOf: wireTime(event.exchange_ts ?? event.receive_ts),
      bids: event.payload.bids.map(level),
      asks: event.payload.asks.map(level),
    };
  if (event.kind === 'delta')
    return {
      kind: 'delta',
      epoch,
      seq,
      asOf: wireTime(event.exchange_ts ?? event.receive_ts),
      updates: event.payload.updates.map((update) => {
        if (update.side !== 'bid' && update.side !== 'ask')
          throw new Error('Unknown book side');
        return { ...level(update), side: update.side };
      }),
    };
  if (state.kind === 'current')
    return { kind: 'delta', epoch, seq, asOf: state.asOf, updates: [] };
}

export function foldBook(records: readonly WalRecord[]): BookEvent | undefined {
  let state: BookState = waitingForBook;
  let previous: Event | undefined;
  for (const { event } of records) {
    if (
      previous &&
      event.epoch === previous.epoch &&
      event.seq === previous.seq &&
      event.kind === previous.kind &&
      JSON.stringify(event.payload) === JSON.stringify(previous.payload)
    )
      continue;
    previous = event;
    const next = bookEvent(event, state);
    if (next) state = applyBookEvent(state, next);
  }
  return state.kind === 'current' ? { ...state, kind: 'snapshot' } : undefined;
}
