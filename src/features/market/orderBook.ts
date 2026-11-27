import type { Level } from './marketData';

type Side = 'bid' | 'ask';
type Position = { epoch: bigint; seq: bigint };
type Levels = { bids: readonly Level[]; asks: readonly Level[] };

export type BookEvent =
  | ({ kind: 'snapshot'; asOf: string } & Position & Levels)
  | ({
      kind: 'delta';
      asOf: string;
      updates: readonly (Level & { side: Side })[];
    } & Position)
  | ({ kind: 'reset' } & Position)
  | {
      kind: 'unavailable';
      reason: '盘口陈旧' | '连接中断' | '权限失效' | '盘口失同步';
    };

export type BookState =
  | ({ kind: 'current'; asOf: string } & Position & Levels)
  | { kind: 'waiting'; position?: Position; reason: string };

// The adapter validates wire-level decimals. Scale only for comparison and
// price identity, keeping the original strings for display.
function priceKey(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(28, '0'));
}

function updateLevels(
  current: readonly Level[],
  updates: Extract<BookEvent, { kind: 'delta' }>['updates'],
  side: Side,
) {
  const levels = new Map(
    current.map((level) => [priceKey(level.price), level]),
  );
  for (const update of updates) {
    if (update.side !== side) continue;
    const key = priceKey(update.price);
    if (priceKey(update.quantity) === 0n) levels.delete(key);
    else levels.set(key, { price: update.price, quantity: update.quantity });
  }
  return Array.from(levels)
    .sort(([a], [b]) => {
      if (a === b) return 0;
      return a < b === (side === 'ask') ? -1 : 1;
    })
    .map(([, level]) => level);
}

export const waitingForBook: BookState = {
  kind: 'waiting',
  reason: '等待盘口快照',
};

export function applyBookEvent(state: BookState, event: BookEvent): BookState {
  const previous =
    state.kind === 'current'
      ? { epoch: state.epoch, seq: state.seq }
      : state.position;
  if (event.kind === 'unavailable') {
    return { kind: 'waiting', position: previous, reason: event.reason };
  }

  const { epoch, seq } = event;
  if (previous && epoch < previous.epoch) return state;
  if (event.kind === 'snapshot') {
    if (previous && epoch === previous.epoch && seq <= previous.seq)
      return state;
    return {
      kind: 'current',
      epoch,
      seq,
      asOf: event.asOf,
      bids: event.bids,
      asks: event.asks,
    };
  }
  const position = { epoch, seq };
  if (previous && epoch === previous.epoch && seq <= previous.seq) {
    return {
      kind: 'waiting',
      position: previous,
      reason: '盘口失同步：序号重复或回退',
    };
  }
  if (event.kind === 'reset') {
    return { kind: 'waiting', position, reason: '盘口重置，等待新快照' };
  }
  if (
    state.kind !== 'current' ||
    epoch !== state.epoch ||
    seq !== state.seq + 1n
  ) {
    return { kind: 'waiting', position, reason: '盘口失同步：等待新快照' };
  }

  return {
    kind: 'current',
    epoch,
    seq,
    asOf: event.asOf,
    bids: updateLevels(state.bids, event.updates, 'bid'),
    asks: updateLevels(state.asks, event.updates, 'ask'),
  };
}
