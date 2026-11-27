import type { Event, MarketStreamCommand } from './generated/types.gen';
import {
  applyBookEvent,
  waitingForBook,
  type BookEvent,
} from '../features/market/orderBook';
import { level, matches, u64, wireTime, type Track } from './marketWebModel';

export function openMarketStream({
  track,
  initial,
  onBook,
  onSubscribed,
  onReset,
  onDenied,
  onUnavailable,
}: {
  track: Track;
  initial?: BookEvent;
  onBook: (event: BookEvent) => void;
  onSubscribed: () => void;
  onReset: () => void;
  onDenied: () => void;
  onUnavailable: () => void;
}) {
  const baseline = track.snapshot ? u64(track.snapshot.position) - 1n : 0n;
  const durable = u64(track.window.durable);
  let after = durable - baseline <= 512n ? baseline : durable;
  let state = initial
    ? applyBookEvent(waitingForBook, initial)
    : waitingForBook;
  let stopped = false;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let socket: WebSocket | undefined;
  let delay = 1000;

  function stop() {
    stopped = true;
    clearTimeout(reconnect);
    socket?.close();
  }

  function reset() {
    stop();
    onReset();
  }

  function connect() {
    const url = new URL('/api/v1/stream/market', window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const connection = new WebSocket(url);
    let confirmed = false;
    socket = connection;
    connection.onopen = () => {
      if (stopped) return;
      const command: MarketStreamCommand = {
        type: 'subscribe',
        ...track.partition,
        after: after.toString(),
      };
      connection.send(JSON.stringify(command));
    };
    connection.onclose = () => {
      if (stopped) return;
      state = waitingForBook;
      onUnavailable();
      reconnect = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 15_000);
    };
    connection.onmessage = ({ data }) => {
      if (stopped) return;
      try {
        if (typeof data !== 'string') throw new Error('Unexpected frame');
        const message = JSON.parse(data);
        if (message.type === 'checkpoint') {
          const checkpoint = u64(message.after);
          if (checkpoint < after) throw new Error('Regressed checkpoint');
          after = checkpoint;
          delay = 1000;
          if (!confirmed) {
            confirmed = true;
            onSubscribed();
          }
          return;
        }
        if (message.type === 'error') {
          stop();
          if (message.code === 'authorization_revoked') onDenied();
          else onUnavailable();
          return;
        }
        if (message.type === 'reset' || message.type === 'unsubscribed') {
          reset();
          return;
        }
        const event: Event = message;
        if (!matches(event, track))
          throw new Error('Unexpected market partition');
        const epoch = u64(event.epoch);
        const seq = u64(event.seq);
        const prior = state.kind === 'current' ? state : state.position;
        if (
          prior &&
          (epoch < prior.epoch || (epoch === prior.epoch && seq <= prior.seq))
        )
          return;
        if (
          event.kind === 'reset' ||
          event.kind === 'gap' ||
          event.kind === 'correction' ||
          (event.kind === 'status' && event.payload.state === 'disconnected')
        ) {
          reset();
          return;
        }
        const asOf = wireTime(event.exchange_ts ?? event.receive_ts);
        let next: BookEvent;
        if (event.kind === 'snapshot') {
          next = {
            kind: 'snapshot',
            epoch,
            seq,
            asOf,
            bids: event.payload.bids.map(level),
            asks: event.payload.asks.map(level),
          };
        } else if (event.kind === 'delta') {
          next = {
            kind: 'delta',
            epoch,
            seq,
            asOf,
            updates: event.payload.updates.map((update) => {
              if (update.side !== 'bid' && update.side !== 'ask')
                throw new Error('Unknown book side');
              return { ...level(update), side: update.side };
            }),
          };
        } else if (state.kind === 'current') {
          next = { kind: 'delta', epoch, seq, asOf: state.asOf, updates: [] };
        } else return;
        state = applyBookEvent(state, next);
        if (state.kind === 'waiting') reset();
        else onBook(next);
      } catch {
        reset();
      }
    };
  }

  connect();
  return stop;
}
