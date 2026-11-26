import type {
  MarketDataType,
  MarketInstrument,
  MarketPeriod,
  MarketQuote,
} from './marketData';

export const replayTime = '2026-11-18T12:15:00Z';
export const marketFixtureSeed = 'market-terminal-v1';

type FixedBar = {
  time: string;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;
};

type FixtureBar = { [Field in keyof FixedBar]: string };

export type QuotedFixture = MarketInstrument & {
  availability: 'ready' | 'stale';
  source: string;
  asOf: string;
  delay?: string;
  marketDataType?: MarketDataType;
  bars: Record<MarketPeriod, readonly FixtureBar[]>;
  quote: MarketQuote;
};

export type MarketFixture =
  | QuotedFixture
  | (MarketInstrument & { availability: 'denied' | 'empty' });

const HOUR_MS = 3_600_000;

// Deterministic synthetic offsets and volumes, without vendor or historical data.
const closeOffsets = [
  0n,
  7n,
  -12n,
  -9n,
  -22n,
  -15n,
  -18n,
  2n,
  17n,
  6n,
  19n,
  31n,
  29n,
  15n,
  43n,
  62n,
  56n,
  70n,
  56n,
  48n,
  57n,
  79n,
  86n,
  110n,
  101n,
  116n,
  91n,
  76n,
  69n,
  79n,
  84n,
  119n,
  144n,
  157n,
  151n,
  179n,
  161n,
  159n,
  172n,
  149n,
  154n,
  177n,
  184n,
  193n,
  187n,
  206n,
  192n,
  213n,
];

export function formatFixed(value: bigint, decimals: number) {
  const absolute = value < 0n ? -value : value;
  const digits = absolute.toString().padStart(decimals + 1, '0');
  const sign = value < 0n ? '-' : '';
  return sign + digits.slice(0, -decimals) + '.' + digits.slice(-decimals);
}

function formatBar(bar: FixedBar): FixtureBar {
  return {
    time: bar.time,
    open: formatFixed(bar.open, 6),
    high: formatFixed(bar.high, 6),
    low: formatFixed(bar.low, 6),
    close: formatFixed(bar.close, 6),
    volume: formatFixed(bar.volume, 4),
  };
}

function fourHourBars(hourly: readonly FixedBar[]) {
  const grouped: FixedBar[] = [];
  for (let index = 0; index < hourly.length; index += 4) {
    const first = hourly[index];
    grouped.push(
      hourly.slice(index + 1, index + 4).reduce(
        (total, bar) => ({
          time: total.time,
          open: total.open,
          high: total.high > bar.high ? total.high : bar.high,
          low: total.low < bar.low ? total.low : bar.low,
          close: bar.close,
          volume: total.volume + bar.volume,
        }),
        first,
      ),
    );
  }
  return grouped.map(formatBar);
}

function quotes(
  instrument: MarketInstrument,
  availability: QuotedFixture['availability'],
  base: bigint,
  step: bigint,
  asOf: string,
  seed: bigint,
  marketDataType?: MarketDataType,
): QuotedFixture {
  const start = Date.parse(asOf) - closeOffsets.length * HOUR_MS;
  const unit = step < 0n ? -step : step;
  // Seed 0 preserves the original U1 fixture. Other seeds perturb that
  // synthetic path with a reproducible 32-bit linear congruential sequence.
  let state = seed;
  const offsets = closeOffsets.map((offset) => {
    if (seed === 0n) return offset;
    state = (1664525n * state + 1013904223n) % (1n << 32n);
    return offset + (state % 23n) - 11n;
  });
  const hourly = offsets.map((offset, index): FixedBar => {
    const open = base + (offsets[index - 1] ?? offset - 4n) * step;
    const close = base + offset * step;
    const wick = BigInt((index % 5) + 3) * unit;
    return {
      time: new Date(start + index * HOUR_MS).toISOString(),
      open,
      high: (open > close ? open : close) + wick,
      low: (open < close ? open : close) - wick,
      close,
      volume:
        instrument.kind === 'crypto'
          ? 55_080n + BigInt((index * 41) % 29) * 1761n + BigInt(index) * 143n
          : (600n + ((BigInt(index * 41) + seed) % 29n) * 17n) * 10_000n,
    };
  });
  const latest = hourly[hourly.length - 1];
  const change = latest.close - latest.open;
  const spread = unit / 20n;

  return {
    ...instrument,
    availability,
    source: '本地合成行情',
    asOf,
    delay:
      marketDataType === undefined || marketDataType >= 3
        ? '15 分钟（模拟）'
        : undefined,
    marketDataType,
    bars: { '1h': hourly.map(formatBar), '4h': fourHourBars(hourly) },
    quote: {
      price: formatFixed(latest.close, 6),
      change: (change > 0n ? '+' : '') + formatFixed(change, 6),
      direction: change > 0n ? '上涨' : change < 0n ? '下跌' : '持平',
      bid: {
        price: formatFixed(latest.close - spread, 6),
        quantity: instrument.kind === 'crypto' ? '2.0040' : '200',
      },
      ask: {
        price: formatFixed(latest.close + spread, 6),
        quantity: instrument.kind === 'crypto' ? '1.8260' : '180',
      },
    },
  };
}

const current = '2026-11-18T12:00:00Z';

function coin(symbol: string, name: string): MarketInstrument {
  return {
    id: symbol + '-USD',
    name,
    product: '加密',
    kind: 'crypto',
    currency: 'USD',
    quantityUnit: symbol,
    timeZone: 'UTC',
  };
}

function stock(
  id: string,
  name: string,
  base: bigint,
  seed: bigint,
  marketDataType: MarketDataType = 1,
) {
  const spy = id === 'SPY.ARCA';
  const etf = spy || id === 'QQQ.XNAS';
  const stale = id === 'QQQ.XNAS';
  return quotes(
    {
      id,
      name,
      product: etf ? '基金' : '股票',
      kind: spy ? 'l1-only' : 'nasdaq',
      currency: 'USD',
      quantityUnit: '股',
      timeZone: 'America/New_York',
    },
    stale ? 'stale' : 'ready',
    base * 1_000_000n + (stale ? 201_000n : 0n),
    33_000n,
    stale ? '2026-11-17T12:00:00Z' : current,
    seed,
    marketDataType,
  );
}

const cryptoSeeds = [
  {
    instrument: coin('BTC', '比特币'),
    base: 66_890_712_500n,
    step: 3_000_000n,
    seed: 0n,
  },
  {
    instrument: coin('ETH', '以太币'),
    base: 3_579_032_800n,
    step: -480_000n,
    seed: 0n,
  },
  {
    instrument: coin('SOL', 'Solana'),
    base: 156_200_000n,
    step: 52_000n,
    seed: 1703n,
  },
];

function cryptoQuotes(
  product: 'hyperliquid-perp' | 'binance-spot' | 'binance-perp',
) {
  const binance = product !== 'hyperliquid-perp';
  const spot = product === 'binance-spot';
  return cryptoSeeds.map(({ instrument, base, step, seed }) =>
    quotes(
      { ...instrument, currency: binance ? 'USDT' : 'USD' },
      'ready',
      base + (binance ? (spot ? 81n : -52n) * step : 0n),
      step,
      current,
      seed + (binance ? (spot ? 1710n : 1720n) : 0n),
    ),
  );
}

const [bitcoin, ethereum, solana] = cryptoQuotes('hyperliquid-perp');

export const marketFixtures: readonly [MarketFixture, ...MarketFixture[]] = [
  bitcoin,
  ethereum,
  solana,
  stock('QQQ.XNAS', '纳斯达克 100 ETF', 510n, 0n, 3),
  stock('SPY.ARCA', '标普 500 ETF', 570n, 1704n),
  stock('AAPL.XNAS', '苹果', 205n, 1705n),
  stock('MSFT.XNAS', '微软', 420n, 1706n, 2),
  stock('NVDA.XNAS', '英伟达', 134n, 1707n, 3),
  stock('AMZN.XNAS', '亚马逊', 190n, 1708n, 4),
  stock('GOOGL.XNAS', 'Alphabet', 174n, 1709n),
  stock('META.XNAS', 'Meta', 590n, 1710n),
  stock('TSLA.XNAS', '特斯拉', 248n, 1711n),
  {
    id: 'NDX',
    name: '纳斯达克 100',
    product: '指数',
    kind: 'diagnostic',
    currency: 'USD',
    quantityUnit: '份',
    timeZone: 'America/New_York',
    availability: 'denied',
  },
  {
    id: 'VIX',
    name: '波动率指数',
    product: '指数',
    kind: 'diagnostic',
    currency: 'USD',
    quantityUnit: '份',
    timeZone: 'America/New_York',
    availability: 'empty',
  },
];

export const binanceFixtures = {
  'binance-spot': cryptoQuotes('binance-spot'),
  'binance-perp': cryptoQuotes('binance-perp'),
};

export function hasQuote(fixture: MarketFixture): fixture is QuotedFixture {
  return fixture.availability === 'ready' || fixture.availability === 'stale';
}
