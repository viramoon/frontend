// Wire-to-view adapters supply validated, plain base-10 strings.
export type DecimalText = string;

export type OptionContract = {
  id: string;
  expiry: string;
  strike: DecimalText;
  right: 'call' | 'put';
  multiplier: DecimalText;
};

export type Confidence = 'high' | 'low' | 'unknown';
export type Condition = 'single' | 'complex' | 'unknown';

type FlowBase = {
  id: string;
  contract: OptionContract;
  eventTime: string;
  receivedAt: string;
  confidence: Confidence;
};

export type FlowObservation = FlowBase & {
  kind: 'observation';
  signal: 'volume' | 'quote';
  coverage: string;
  evidence: string;
  volumeDelta: DecimalText | null;
  estimatedPremium: DecimalText | null;
};

export type HistoricalTrade = FlowBase & {
  kind: 'historical';
  venue: string;
  price: DecimalText;
  size: DecimalText;
  premium: DecimalText;
  side: 'buy' | 'sell' | 'unknown';
  bidAsk: { at: string; bid: DecimalText; ask: DecimalText } | null;
  inference: string;
  condition: Condition;
  rawConditions: readonly string[];
  mappingVersion: string;
  revision: 'original' | 'corrected' | 'canceled';
  previousId: string | null;
  flags: readonly ('sweep' | 'block' | 'institutional')[];
};

export type FlowEntry = FlowObservation | HistoricalTrade;

export type FlowGap = {
  start: string;
  end: string;
  reason: string;
  recovery: { kind: 'pending' } | { kind: 'unfillable'; reason: string };
};

export type FlowReading = {
  availableFrom?: string;
  sessionDate: string;
  entries: readonly FlowEntry[];
  gaps: readonly FlowGap[];
};

export const scenarioLabels = {
  absolute: '绝对 gamma 集中度',
  dealerShort: '客户净买 · 做市商净卖',
  dealerLong: '客户净卖 · 做市商净买',
  callPositive: '经验约定 · Call 正 / Put 负',
} as const;

export type Scenario = keyof typeof scenarioLabels;

type FlipGrid = {
  from: DecimalText;
  to: DecimalText;
  step: DecimalText;
  pricingModel: string;
  ivBasis: string;
  riskFreeRate: DecimalText;
  dividendYield: DecimalText;
  points: readonly { spot: DecimalText; exposure: DecimalText }[];
};

type Flip =
  | { kind: 'not_evaluated'; reason: string }
  | { kind: 'none'; grid: FlipGrid }
  | { kind: 'crossings'; grid: FlipGrid; spots: readonly DecimalText[] };

export type ExposureSeries = {
  byStrike: readonly {
    strike: DecimalText;
    exposure: DecimalText;
    zeroDte: DecimalText | null;
  }[];
  byExpiry: readonly { expiry: string; exposure: DecimalText }[];
  walls: {
    absolute: DecimalText | null;
    positive: DecimalText | null;
    negative: DecimalText | null;
  };
  flip: Flip;
};

export type ExposureReading =
  | { kind: 'empty'; reason: string }
  | {
      kind: 'ready';
      modelVersion: string;
      asOf: string;
      sessionDate: string;
      spot: DecimalText;
      oiDate: string | null;
      oiObservedAt: string;
      coverage: {
        validContracts: number;
        candidateContracts: number;
        validOi: DecimalText;
        totalOi: DecimalText | null;
        earliest: string;
        latest: string;
        missing: readonly string[];
      };
      contracts: readonly (OptionContract & {
        oi: DecimalText | null;
        iv: DecimalText | null;
        gamma: DecimalText | null;
      })[];
      scenarios: Record<Scenario, ExposureSeries>;
    };

export type OptionsReading = {
  source: string;
  asOf: string;
  fixtureSeed?: string;
  flow: FlowReading;
  exposure: ExposureReading;
};

export interface OptionsDataAdapter {
  readonly underlyings: readonly [string, ...string[]];
  read(underlying: string, signal: AbortSignal): Promise<OptionsReading>;
}
