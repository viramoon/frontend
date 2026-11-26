export const periods = [
  { id: '1h', label: '1 小时' },
  { id: '4h', label: '4 小时' },
] as const;

export type MarketPeriod = (typeof periods)[number]['id'];

export const replayTime = '2026-11-18T12:15:00Z';

type FixedBar = {
  time: string;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;
};

type FixtureBar = { [Field in keyof FixedBar]: string };

type Instrument = {
  id: string;
  name: string;
  product: string;
  currency: string;
  quantityUnit: string;
};

type DepthLevel = {
  side: '买价' | '卖价';
  price: string;
  quantity: string;
};

export type QuotedFixture = Instrument & {
  availability: 'ready' | 'stale';
  source: string;
  asOf: string;
  delay: string;
  bars: Record<MarketPeriod, readonly FixtureBar[]>;
  quote: {
    price: string;
    change: string;
    direction: '上涨' | '下跌' | '持平';
    depth: readonly DepthLevel[];
  };
};

export type MarketFixture =
  | QuotedFixture
  | (Instrument & { availability: 'denied' | 'empty' });

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

function formatFixed(value: bigint, decimals: number) {
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
  instrument: Instrument,
  availability: QuotedFixture['availability'],
  base: bigint,
  step: bigint,
  asOf: string,
): QuotedFixture {
  const start = Date.parse(asOf) - closeOffsets.length * HOUR_MS;
  const unit = step < 0n ? -step : step;
  const hourly = closeOffsets.map((offset, index): FixedBar => {
    const open = base + (closeOffsets[index - 1] ?? offset - 4n) * step;
    const close = base + offset * step;
    const wick = BigInt((index % 5) + 3) * unit;
    return {
      time: new Date(start + index * HOUR_MS).toISOString(),
      open,
      high: (open > close ? open : close) + wick,
      low: (open < close ? open : close) - wick,
      close,
      volume:
        55_080n + BigInt((index * 41) % 29) * 1761n + BigInt(index) * 143n,
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
    delay: '15 分钟（模拟）',
    bars: { '1h': hourly.map(formatBar), '4h': fourHourBars(hourly) },
    quote: {
      price: formatFixed(latest.close, 6),
      change: (change > 0n ? '+' : '') + formatFixed(change, 6),
      direction: change > 0n ? '上涨' : change < 0n ? '下跌' : '持平',
      depth:
        instrument.product === '现货'
          ? [
              {
                side: '买价',
                price: formatFixed(latest.close - spread, 6),
                quantity: '2.0040',
              },
              {
                side: '卖价',
                price: formatFixed(latest.close + spread, 6),
                quantity: '1.8260',
              },
            ]
          : [],
    },
  };
}

export const marketFixtures: readonly [MarketFixture, ...MarketFixture[]] = [
  quotes(
    {
      id: 'BTC-USD',
      name: '比特币 / 美元',
      product: '现货',
      currency: 'USD',
      quantityUnit: 'BTC',
    },
    'ready',
    66_890_712_500n,
    3_000_000n,
    '2026-11-18T12:00:00Z',
  ),
  quotes(
    {
      id: 'ETH-USD',
      name: '以太币 / 美元',
      product: '现货',
      currency: 'USD',
      quantityUnit: 'ETH',
    },
    'ready',
    3_579_032_800n,
    -480_000n,
    '2026-11-18T12:00:00Z',
  ),
  quotes(
    {
      id: 'QQQ.XNAS',
      name: '纳斯达克 100 ETF',
      product: '基金',
      currency: 'USD',
      quantityUnit: '股',
    },
    'stale',
    510_201_000n,
    33_000n,
    '2026-11-17T12:00:00Z',
  ),
  {
    id: 'NDX',
    name: '纳斯达克 100',
    product: '指数',
    currency: 'USD',
    quantityUnit: '份',
    availability: 'denied',
  },
  {
    id: 'VIX',
    name: '波动率指数',
    product: '指数',
    currency: 'USD',
    quantityUnit: '份',
    availability: 'empty',
  },
];

export function hasQuote(fixture: MarketFixture): fixture is QuotedFixture {
  return fixture.availability === 'ready' || fixture.availability === 'stale';
}
