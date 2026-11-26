import { describe, expect, it } from 'vitest';
import {
  applyBookEvent,
  waitingForBook,
  type BookEvent,
} from '../features/market/orderBook';

const epoch = 3n;
const seq = 9_007_199_254_740_993n;
const asOf = '2026-11-18T12:00:00Z';
const snapshot = {
  kind: 'snapshot',
  epoch,
  seq,
  asOf,
  bids: [
    { price: '9007199254740993.01', quantity: '2.0000' },
    { price: '9007199254740993.00', quantity: '1.0000' },
  ],
  asks: [{ price: '9007199254740993.03', quantity: '4.0000' }],
} satisfies BookEvent;
const delta = {
  kind: 'delta',
  epoch,
  seq: seq + 1n,
  asOf,
  updates: [
    { side: 'bid', price: '9007199254740993.010', quantity: '0.000' },
    { side: 'bid', price: '9007199254740993.005', quantity: '3.1000' },
    { side: 'bid', price: '9007199254740993.000', quantity: '1.1110' },
    { side: 'ask', price: '9007199254740993.02', quantity: '6.0000' },
  ],
} satisfies BookEvent;

describe('场所订单簿', () => {
  it('applies contiguous bigint positions and exact price updates without merging close levels', () => {
    const current = applyBookEvent(waitingForBook, snapshot);
    expect(applyBookEvent(current, delta)).toEqual({
      kind: 'current',
      epoch,
      seq: seq + 1n,
      asOf,
      bids: [
        { price: '9007199254740993.005', quantity: '3.1000' },
        { price: '9007199254740993.000', quantity: '1.1110' },
      ],
      asks: [
        { price: '9007199254740993.02', quantity: '6.0000' },
        { price: '9007199254740993.03', quantity: '4.0000' },
      ],
    });
  });

  it.each([
    ['missing sequence', { ...delta, seq: seq + 2n }],
    ['duplicate sequence', { ...delta, seq }],
    ['new epoch without a snapshot', { ...delta, epoch: epoch + 1n, seq: 1n }],
    ['explicit reset', { kind: 'reset', epoch: epoch + 1n, seq: 0n }],
    ['stale source', { kind: 'unavailable', reason: '盘口陈旧' }],
    ['revoked display access', { kind: 'unavailable', reason: '权限失效' }],
  ] as const)(
    'clears rows on %s and ignores the prior snapshot',
    (_, event) => {
      const current = applyBookEvent(waitingForBook, snapshot);
      const invalid = applyBookEvent(current, event);
      expect(invalid).toMatchObject({ kind: 'waiting' });
      expect(invalid).not.toHaveProperty('bids');
      expect(applyBookEvent(invalid, snapshot)).toBe(invalid);
      const fresh = {
        ...snapshot,
        epoch: epoch + 1n,
        seq: 2n,
        bids: [],
        asks: [],
      };
      expect(applyBookEvent(invalid, fresh)).toMatchObject({
        kind: 'current',
        bids: [],
        asks: [],
      });
    },
  );
});
