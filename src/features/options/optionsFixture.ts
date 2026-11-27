import { scaledDecimal } from './decimal';
import type {
  ExposureReading,
  ExposureSeries,
  FlowEntry,
  FlowReading,
  HistoricalTrade,
  OptionContract,
  OptionsDataAdapter,
  OptionsReading,
  Scenario,
} from './optionsData';

// Seeded synthetic options and evidence; no vendor or historical observations.
const seedName = 'options-terminal-v1';
const sessionDate = '2026-11-19';
const laterExpiry = '2026-11-27';
const time = (minute: string) => `${sessionDate}T15:${minute}:00Z`;
const asOf = time('38');

const profiles = {
  SPY: { seed: 1801n, base: 314n, knownOiDate: true },
  AAPL: { seed: 1802n, base: 172n, knownOiDate: false },
};
type Symbol = keyof typeof profiles;

function generator(seed: bigint) {
  let state = seed;
  return (bound: bigint) => {
    state = (1664525n * state + 1013904223n) % 2n ** 32n;
    return state % bound;
  };
}

function makeFlow(
  contracts: readonly OptionContract[],
  seed: bigint,
): FlowReading {
  const jitter = generator(seed);
  const priceCents = 187n + jitter(15n);
  const tradePrice = scaledDecimal(priceCents, 2);
  const bid = scaledDecimal(priceCents - 9n, 2);
  const lot = 320n + jitter(21n);
  const trades: HistoricalTrade[] = [];
  const makeTrade = (
    id: string,
    contract: OptionContract,
    eventTime: string,
    quote: HistoricalTrade['bidAsk'],
    n = lot,
  ): HistoricalTrade => ({
    id,
    contract,
    kind: 'historical',
    eventTime,
    receivedAt: time('36'),
    venue: '模拟场所 A',
    price: tradePrice,
    size: n.toString(),
    premium: scaledDecimal(priceCents * n * BigInt(contract.multiplier), 2),
    side: 'buy',
    bidAsk: quote,
    confidence: 'high',
    inference: '成交价在有效卖价，推测为主动买。',
    condition: 'single',
    rawConditions: ['SIM-SINGLE'],
    mappingVersion: 'fixture-conditions-v1',
    revision: 'original',
    previousId: null,
    flags: ['block', 'institutional'],
  });
  const single = makeTrade('sim-verified-1', contracts[0], time('29'), {
    at: time('28'),
    bid,
    ask: tradePrice,
  });
  // Identical time, price and size can still refer to two distinct prints.
  trades.push(single, { ...single, id: 'sim-verified-2', flags: ['sweep'] });
  const complex = makeTrade(
    'sim-complex-2',
    contracts[3],
    time('26'),
    null,
    71n,
  );
  trades.push({
    ...complex,
    side: 'unknown',
    confidence: 'unknown',
    inference: '明确多腿条件，未取得可配对的有效报价，方向未知。',
    condition: 'complex',
    rawConditions: ['SIM-COMPLEX'],
    revision: 'corrected',
    previousId: 'sim-complex-1',
    flags: [],
  });
  const stale = makeTrade(
    'sim-stale',
    contracts[2],
    time('18'),
    {
      at: time('01'),
      bid,
      ask: tradePrice,
    },
    11n,
  );
  trades.push({
    ...stale,
    side: 'unknown',
    confidence: 'unknown',
    condition: 'unknown',
    rawConditions: [],
    inference: '报价陈旧且缺少条件码，方向未知。',
    flags: [],
  });
  const sell = makeTrade(
    'sim-verified-sell',
    contracts[1],
    time('21'),
    {
      at: time('20'),
      bid: tradePrice,
      ask: scaledDecimal(priceCents + 13n, 2),
    },
    26n,
  );
  trades.push({
    ...sell,
    side: 'sell',
    inference: '成交价在有效买价，推测为主动卖。',
    flags: [],
  });
  trades.push({
    ...makeTrade('sim-canceled', contracts[1], time('20'), null, 70n),
    side: 'unknown',
    confidence: 'unknown',
    inference: '该笔已取消，保留审计证据。',
    revision: 'canceled',
    previousId: 'sim-canceled-original',
    flags: [],
  });

  const volumeDelta = 470n + jitter(43n);
  const entries: FlowEntry[] = [
    {
      id: 'sim-volume',
      contract: contracts[0],
      kind: 'observation',
      eventTime: time('33'),
      receivedAt: time('34'),
      confidence: 'low',
      signal: 'volume',
      coverage: '轮换订阅 · 局部观察',
      evidence:
        '同标的、期限和时段的合成基线为 80 张。观察窗口内累计量跃升，单笔规模未知。',
      volumeDelta: volumeDelta.toString(),
      estimatedPremium: scaledDecimal(
        priceCents * volumeDelta * BigInt(contracts[0].multiplier),
        2,
      ),
    },
    {
      id: 'sim-quote',
      contract: contracts[2],
      kind: 'observation',
      eventTime: time('31'),
      receivedAt: time('32'),
      confidence: 'low',
      signal: 'quote',
      coverage: '热点订阅 · 连续观察',
      evidence: '模拟买卖价差较同时段基线扩大，窗口内无可支持的成交规模。',
      volumeDelta: null,
      estimatedPremium: null,
    },
    ...trades,
  ];
  entries.sort((left, right) => right.eventTime.localeCompare(left.eventTime));
  return {
    sessionDate,
    entries,
    gaps: [
      {
        start: time('05'),
        end: time('13'),
        reason: '轮换期间未订阅 0DTE 合约',
        recovery: {
          kind: 'unfillable',
          reason: '回放中该合约的历史逐笔窗口已过期，仅有分钟 bar。',
        },
      },
      {
        start: time('14'),
        end: time('17'),
        reason: '轮换期间未订阅远月合约',
        recovery: { kind: 'pending' },
      },
    ],
  };
}

type SampleContract = OptionContract & {
  oi: bigint | null;
  gamma: bigint | null;
  iv: string | null;
};

function makeFlip(base: bigint, scenario: Scenario): ExposureSeries['flip'] {
  if (scenario === 'absolute')
    return { kind: 'not_evaluated', reason: '绝对集中度没有净方向。' };

  const from = base - 5n;
  const to = base + 5n;
  const step = 1n;
  const points: { spot: bigint; exposure: bigint }[] = [];
  for (let spot = from; spot <= to; spot += step) {
    // Synthetic backend projection in USD per 1% move, built from two
    // unsigned legs with fixed slopes. These points simulate a response.
    const offset = (spot - from) / step;
    const call = 5750n + 600n * offset;
    const put = 11000n - 400n * offset;
    const exposure =
      scenario === 'callPositive'
        ? call - put
        : (scenario === 'dealerShort' ? -1n : 1n) * (call + put);
    points.push({ spot, exposure });
  }

  const grid = {
    from: from.toString(),
    to: to.toString(),
    step: step.toString(),
    pricingModel: '合成线性网格 v1',
    ivBasis: '合成合约 IV 固定',
    riskFreeRate: '0.04',
    dividendYield: '0.01',
    points: points.map(({ spot, exposure }) => ({
      spot: spot.toString(),
      exposure: exposure.toString(),
    })),
  };

  const spots = points.flatMap(({ spot, exposure }, index) => {
    if (exposure === 0n) return [spot.toString()];
    const next = points[index + 1];
    if (!next || exposure * next.exposure >= 0n) return [];
    // Interpolate the signed bracket in cents. Sample roots fall on whole cents.
    const offsetCents =
      -(exposure * (next.spot - spot) * 100n) / (next.exposure - exposure);
    return [scaledDecimal(spot * 100n + offsetCents, 2)];
  });

  return spots.length
    ? { kind: 'crossings', grid, spots }
    : { kind: 'none', grid };
}

function makeSeries(
  base: bigint,
  spotCents: bigint,
  contracts: readonly SampleContract[],
  scenario: Scenario,
): ExposureSeries {
  const strikes = new Map<
    string,
    { all: bigint; gross: bigint; zeroDte: bigint | null }
  >();
  const expiries = new Map<string, bigint>();
  // OI and multiplier are integers, gamma has 6 places and spot has 2.
  // Including the 1% factor, each contribution has 12 places.
  for (const contract of contracts) {
    if (contract.oi === null || contract.gamma === null || contract.iv === null)
      continue;
    const gross =
      contract.oi *
      BigInt(contract.multiplier) *
      contract.gamma *
      spotCents ** 2n;
    const negative =
      scenario === 'dealerShort' ||
      (scenario === 'callPositive' && contract.right === 'put');
    const value = negative ? -gross : gross;

    const bucket = strikes.get(contract.strike) ?? {
      all: 0n,
      gross: 0n,
      zeroDte: null,
    };
    bucket.all += value;
    bucket.gross += gross;
    if (contract.expiry === sessionDate)
      bucket.zeroDte = (bucket.zeroDte ?? 0n) + value;
    strikes.set(contract.strike, bucket);
    expiries.set(
      contract.expiry,
      (expiries.get(contract.expiry) ?? 0n) + value,
    );
  }

  const ordered = [...strikes.entries()].sort(([a], [b]) =>
    BigInt(a) < BigInt(b) ? -1 : 1,
  );
  const byStrike = ordered.map(([strike, { all, zeroDte }]) => ({
    strike,
    exposure: scaledDecimal(all, 12),
    zeroDte: zeroDte === null ? null : scaledDecimal(zeroDte, 12),
  }));
  let absolute = 0n;
  let positive = 0n;
  let negative = 0n;
  const walls: ExposureSeries['walls'] = {
    absolute: null,
    positive: null,
    negative: null,
  };
  for (const [strike, { all, gross }] of ordered) {
    if (gross > absolute) {
      absolute = gross;
      walls.absolute = strike;
    }
    if (scenario !== 'absolute' && all > positive) {
      positive = all;
      walls.positive = strike;
    }
    if (all < negative) {
      negative = all;
      walls.negative = strike;
    }
  }

  return {
    byStrike,
    byExpiry: [...expiries.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([expiry, value]) => ({
        expiry,
        exposure: scaledDecimal(value, 12),
      })),
    walls,
    flip: makeFlip(base, scenario),
  };
}

function makeReading(symbol: Symbol): OptionsReading {
  const profile = profiles[symbol];
  const jitter = generator(profile.seed);
  const spotCents = profile.base * 100n + 10n + jitter(80n);
  const shapes = [
    {
      offset: 2n,
      right: 'call',
      oi: 1250n,
      expiry: laterExpiry,
      multiplier: '100',
    },
    {
      offset: -2n,
      right: 'put',
      oi: 620n,
      expiry: sessionDate,
      multiplier: '100',
    },
    {
      offset: 2n,
      right: 'call',
      oi: 210n,
      expiry: sessionDate,
      multiplier: '50',
    },
    {
      offset: 2n,
      right: 'put',
      oi: 330n,
      expiry: laterExpiry,
      multiplier: '100',
    },
    {
      offset: 0n,
      right: 'call',
      oi: 0n,
      expiry: sessionDate,
      multiplier: '100',
    },
    {
      offset: 4n,
      right: 'put',
      oi: null,
      expiry: laterExpiry,
      multiplier: '100',
    },
    {
      offset: -4n,
      right: 'call',
      oi: 55n,
      expiry: laterExpiry,
      multiplier: '100',
    },
  ] as const;
  const contracts = shapes.map(
    (shape, index): SampleContract => ({
      id: `${symbol}-SIM-${index + 1}`,
      right: shape.right,
      strike: (profile.base + shape.offset).toString(),
      expiry: shape.expiry,
      multiplier: shape.multiplier,
      oi: index === 5 && symbol === 'AAPL' ? 70n : shape.oi,
      gamma: index < 5 ? 5500n + jitter(1600n) : null,
      iv: index < 5 ? scaledDecimal(2300n + jitter(900n), 4) : null,
    }),
  );
  const valid = contracts.filter(
    ({ oi, iv, gamma }) => oi !== null && iv !== null && gamma !== null,
  );
  const sumOi = (items: readonly SampleContract[]) =>
    items.reduce((sum, contract) => sum + (contract.oi ?? 0n), 0n).toString();
  const exposure: ExposureReading = {
    kind: 'ready',
    modelVersion: 'options-gex-fixture-v1',
    asOf,
    sessionDate,
    spot: scaledDecimal(spotCents, 2),
    oiDate: profile.knownOiDate ? '2026-11-18' : null,
    oiObservedAt: time('04'),
    coverage: {
      validContracts: valid.length,
      candidateContracts: contracts.length,
      validOi: sumOi(valid),
      totalOi: contracts.some(({ oi }) => oi === null)
        ? null
        : sumOi(contracts),
      earliest: time('04'),
      latest: asOf,
      missing:
        symbol === 'SPY'
          ? ['缺 OI 1 份', '缺 IV 与 gamma 2 份']
          : ['缺 IV 与 gamma 2 份'],
    },
    contracts: contracts.map(({ oi, gamma, ...contract }) => ({
      ...contract,
      oi: oi?.toString() ?? null,
      gamma: gamma === null ? null : scaledDecimal(gamma, 6),
    })),
    scenarios: {
      absolute: makeSeries(profile.base, spotCents, contracts, 'absolute'),
      dealerShort: makeSeries(
        profile.base,
        spotCents,
        contracts,
        'dealerShort',
      ),
      dealerLong: makeSeries(profile.base, spotCents, contracts, 'dealerLong'),
      callPositive: makeSeries(
        profile.base,
        spotCents,
        contracts,
        'callPositive',
      ),
    },
  };
  return {
    source: '合成期权回放',
    asOf,
    fixtureSeed: `${seedName}:${profile.seed}`,
    flow: makeFlow(contracts, profile.seed),
    exposure,
  };
}

const emptyReading: OptionsReading = {
  source: '合成期权回放',
  asOf,
  fixtureSeed: `${seedName}:empty`,
  flow: { sessionDate, entries: [], gaps: [] },
  exposure: { kind: 'empty', reason: '所选标的没有可用的期权链估算。' },
};

export const optionsFixtureAdapter: OptionsDataAdapter = {
  underlyings: ['SPY', 'AAPL', 'QQQ'],
  async read(underlying, signal) {
    signal.throwIfAborted();
    return underlying === 'SPY' || underlying === 'AAPL'
      ? makeReading(underlying)
      : emptyReading;
  },
};
