import type { ChartBar, ChartIndicator } from '../../components/MarketChart';
import {
  binanceFixtures,
  formatFixed,
  hasQuote,
  marketFixtures,
  replayTime,
  type QuotedFixture,
} from './marketFixture';
import {
  cryptoMarkets,
  type BookSource,
  type MarketDataAdapter,
  type MarketHistory,
  type MarketReading,
  type MarketRequest,
} from './marketData';
import type { BookEvent } from './orderBook';

function fixedPrice(price: string) {
  return BigInt(price.replace('.', ''));
}

// These values exercise the presentation states and columns of F6. They are
// synthetic points, independent of the production indicator algorithms.
function indicatorSamples(bars: readonly ChartBar[]): ChartIndicator[] {
  const wave = (index: number) => BigInt(((index * 11 + 17) % 31) - 15);
  const definitions: (Omit<ChartIndicator, 'points'> & {
    warmup: number;
    sample: (bar: ChartBar, index: number) => readonly string[];
  })[] = [
    {
      id: 'indicator.sma@1.0.0',
      label: 'SMA (5)',
      pane: 0,
      warmup: 4,
      lines: [{ label: 'SMA', color: '#edcb87' }],
      sample: ({ close }) => [
        formatFixed((fixedPrice(close) * 899n) / 900n, 6),
      ],
    },
    {
      id: 'indicator.ema@1.0.0',
      label: 'EMA (8)',
      pane: 0,
      warmup: 7,
      lines: [{ label: 'EMA', color: '#91b8f6' }],
      sample: ({ close }) => [
        formatFixed((fixedPrice(close) * 1301n) / 1300n, 6),
      ],
    },
    {
      id: 'indicator.rsi@1.0.0',
      label: 'Wilder RSI (7)',
      pane: 2,
      warmup: 7,
      lines: [{ label: 'RSI', color: '#edcb87' }],
      sample: (_, index) => [formatFixed(50_000n + wave(index) * 1300n, 3)],
    },
    {
      id: 'indicator.bollinger@1.0.0',
      label: '布林带 (8)',
      pane: 0,
      warmup: 7,
      lines: [
        { label: '中轨', color: '#c6a5ed' },
        { label: '上轨', color: '#a78bcc' },
        { label: '下轨', color: '#a78bcc' },
      ],
      sample: ({ close }) => {
        const value = fixedPrice(close);
        return [
          close,
          formatFixed((value * 121n) / 120n, 6),
          formatFixed((value * 119n) / 120n, 6),
        ];
      },
    },
    {
      id: 'indicator.macd@1.0.0',
      label: 'MACD (3, 6, 3)',
      pane: 2,
      warmup: 7,
      lines: [
        { label: 'MACD', color: '#91b8f6' },
        { label: '信号', color: '#edcb87' },
        { label: '柱值', color: '#ba9de1', histogram: true },
      ],
      sample: (_, index) =>
        [137n, 103n, 34n].map((coefficient) =>
          formatFixed(wave(index) * coefficient, 6),
        ),
    },
  ];
  return definitions.map(({ warmup, sample, ...definition }) => ({
    ...definition,
    points: bars.map((bar, index) =>
      index < warmup
        ? { status: 'warmup' }
        : { status: 'ready', values: sample(bar, index) },
    ),
  }));
}

function depthSource(
  fixture: QuotedFixture,
  instrument: string,
  venue: string,
): BookSource {
  const stock = fixture.kind === 'nasdaq';
  const base = fixedPrice(fixture.quote.price);
  const step = stock ? 10_000n : base / 5000n;
  function side(sign: bigint) {
    return [1n, 2n, 3n, 4n].map((index) => ({
      price: formatFixed(base + index * sign * step, 6),
      quantity: stock ? String(index * 120n) : formatFixed(index * 17_891n, 4),
    }));
  }
  const bids = side(-1n);
  const asks = side(1n);
  const epoch = 1n;
  const seq = 9_007_199_254_740_993n;
  const asOf = new Date(Date.parse(fixture.asOf) - 4000).toISOString();
  const snapshot = { kind: 'snapshot', epoch, seq, asOf, bids, asks } as const;
  const start: BookEvent =
    fixture.availability === 'stale'
      ? { kind: 'unavailable', reason: '盘口陈旧' }
      : snapshot;
  const replay: readonly BookEvent[] = [
    {
      kind: 'delta',
      epoch,
      seq: seq + 2n,
      asOf,
      updates: [{ ...bids[0], side: 'bid', quantity: '0' }],
    },
    {
      kind: 'delta',
      epoch,
      seq: seq + 3n,
      asOf,
      updates: [{ ...asks[0], side: 'ask', quantity: '1' }],
    },
    {
      ...snapshot,
      epoch: epoch + 1n,
      seq: 1n,
      asOf: '2026-11-18T12:14:00Z',
      bids: bids.slice(1),
    },
  ];
  return {
    instrument,
    venue,
    timeliness: '回放',
    subscribe(receive) {
      receive(start);
      return () => {};
    },
    replay: fixture.availability === 'ready' ? replay : undefined,
  };
}

function makeReading(
  fixture: QuotedFixture,
  request: MarketRequest,
): MarketReading {
  const crypto = fixture.kind === 'crypto';
  const choice =
    cryptoMarkets.find(({ id }) => id === request.cryptoMarket) ??
    cryptoMarkets[0];
  const venue = crypto ? choice.venue : '美国综合';
  const product = crypto ? choice.product : 'L1';
  const symbol = fixture.quantityUnit;
  const instrument = crypto
    ? venue === 'Hyperliquid'
      ? `${symbol}-USD-PERP.HYPERLIQUID`
      : `${symbol}-USDT${product === '永续' ? '-PERP' : ''}.BINANCE`
    : fixture.id;
  const book =
    fixture.kind === 'nasdaq'
      ? depthSource(fixture, instrument, 'Nasdaq')
      : crypto
        ? depthSource(fixture, instrument, venue)
        : undefined;
  return {
    availability: fixture.availability,
    instrument,
    venue,
    product,
    currency: fixture.currency,
    source: fixture.source,
    asOf: fixture.asOf,
    delay: fixture.delay,
    fixture: true,
    replay: true,
    marketDataType: fixture.marketDataType,
    quote: fixture.quote,
    book,
    trades:
      book &&
      [2n, 7n, 13n].map((offset) => {
        const time = new Date(
          Date.parse(fixture.asOf) - Number(offset) * 1000,
        ).toISOString();
        return {
          id: time,
          time,
          price: formatFixed(
            fixedPrice(fixture.quote.price) - offset * 100n,
            6,
          ),
          quantity: crypto
            ? formatFixed(offset * 307n, 4)
            : String(offset * 10n),
        };
      }),
    derivatives:
      product === '永续'
        ? {
            mark: fixture.quote.price,
            fundingRate: '0.00012500',
            openInterest: '905.550000',
          }
        : undefined,
  };
}

function createFixtureAdapter(binanceDemo = false): MarketDataAdapter {
  const instruments = marketFixtures.map(
    ({ id, name, product, kind, currency, quantityUnit, timeZone }) => ({
      id,
      name,
      product,
      kind,
      currency,
      quantityUnit,
      timeZone,
    }),
  );
  const readings = new Map<string, MarketReading>();
  const histories = new Map<string, MarketHistory>();
  const key = ({ id, cryptoMarket }: MarketRequest) => {
    const instrument = instruments.find((candidate) => candidate.id === id);
    return instrument?.kind === 'crypto' ? `${id}/${cryptoMarket}` : id;
  };
  function findFixture({ id, cryptoMarket }: MarketRequest) {
    const fixture = marketFixtures.find((candidate) => candidate.id === id);
    if (fixture?.kind !== 'crypto' || cryptoMarket === 'hyperliquid-perp')
      return fixture;
    return binanceFixtures[cryptoMarket].find(
      (candidate) => candidate.id === id,
    );
  }
  return {
    instruments,
    fixture: { replayTime },
    budget: {
      stocks: 9,
      hotOptions: 16,
      rotating: 45,
      reserve: 30,
      total: 100,
      pinnedDepth: 2,
      followingDepth: 1,
    },
    subscribe: () => () => {},
    revision: () => 0,
    read(request) {
      const marketKey = key(request);
      const cached = readings.get(marketKey);
      if (cached) return cached;
      if (marketKey.includes('/binance') && !binanceDemo)
        return { availability: 'disabled_by_profile' };
      const fixture = findFixture(request);
      if (!fixture || !hasQuote(fixture))
        return { availability: fixture?.availability ?? 'empty' };
      const reading = makeReading(fixture, request);
      readings.set(marketKey, reading);
      return reading;
    },
    history(request, period) {
      const historyKey = `${key(request)}/${period}`;
      const cached = histories.get(historyKey);
      if (cached) return cached;
      if (historyKey.includes('/binance') && !binanceDemo) return;
      const fixture = findFixture(request);
      if (!fixture || !hasQuote(fixture)) return;
      const closed = fixture.bars[period];
      const preview =
        fixture.id === 'AAPL.XNAS'
          ? {
              ...closed[closed.length - 1],
              time: fixture.asOf,
              open: fixture.quote.price,
              low: fixture.quote.bid.price,
              high: fixture.quote.ask.price,
              close: fixture.quote.ask.price,
              volume: '24.0000',
              provisional: true,
            }
          : undefined;
      const bars = preview ? [...closed, preview] : closed;
      const venue = cryptoMarkets.find(
        ({ id }) => id === request.cryptoMarket,
      )?.venue;
      const history = {
        bars,
        indicators: indicatorSamples(bars),
        source:
          (fixture.kind === 'crypto' ? venue : '美国综合') + ' · 合成回放',
        adjustment: '未复权',
        coverage: `已返回 ${closed.length} 根闭合 K 线${preview ? '和 1 根预览' : ''} · 合成窗口`,
      };
      histories.set(historyKey, history);
      return history;
    },
  };
}

export const fixtureAdapter = createFixtureAdapter();
export const binanceReplayAdapter = createFixtureAdapter(true);
