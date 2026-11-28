import type { ChartBar, ChartIndicator } from '../../components/MarketChart';
import type { DetailDateRange } from '../../components/PanelDataClass';
import type { BookEvent } from './orderBook';

export const periods = [
  { id: '1h', label: '1 小时' },
  { id: '4h', label: '4 小时' },
] as const;

export type MarketPeriod = (typeof periods)[number]['id'];

export const cryptoMarkets = [
  { id: 'hyperliquid-perp', venue: 'Hyperliquid', product: '永续' },
  { id: 'binance-spot', venue: 'Binance', product: '现货' },
  { id: 'binance-perp', venue: 'Binance', product: '永续' },
] as const;

export type CryptoMarket = (typeof cryptoMarkets)[number]['id'];

export type MarketInstrument = {
  id: string;
  name: string;
  product: string;
  kind: 'crypto' | 'nasdaq' | 'l1-only' | 'diagnostic';
  currency: string;
  quantityUnit: string;
  timeZone: 'America/New_York' | 'UTC';
};

export type Level = { price: string; quantity: string };

export type MarketQuote = {
  price: string;
  change: string;
  direction: '上涨' | '下跌' | '持平';
  bid: Level;
  ask: Level;
};

type DisplayQuote = Partial<MarketQuote>;

export type MarketDataType = 1 | 2 | 3 | 4;

export const marketDataTypes: Record<MarketDataType, string> = {
  1: '实时',
  2: '冻结',
  3: '延迟',
  4: '延迟冻结',
};

export type Trade = Level & { id: string; time: string };

export type BookSource = {
  instrument: string;
  venue: string;
  timeliness: '实时' | '延迟' | '回放' | '已采集';
  availableFrom?: string;
  coverage?: string;
  subscribe(receive: (event: BookEvent) => void): () => void;
  replay?: readonly BookEvent[];
};

export type MarketReading =
  | {
      availability: 'ready' | 'stale';
      instrument: string;
      currency: string;
      venue: string;
      product: string;
      source: string;
      asOf: string;
      freshnessUnknown?: boolean;
      fixture?: boolean;
      replay?: boolean;
      delay?: string;
      marketDataType?: MarketDataType;
      quote?: DisplayQuote;
      book?: BookSource;
      trades?: readonly Trade[];
      tradesAvailableFrom?: string;
      tradesCoverage?: string;
      tradesUnavailable?: boolean;
      derivatives?: { mark: string; fundingRate: string; openInterest: string };
    }
  | {
      availability:
        | 'denied'
        | 'empty'
        | 'loading'
        | 'unavailable'
        | 'disabled_by_profile'
        | 'region_restricted';
    };

export function hasReading(
  reading: MarketReading,
): reading is Extract<MarketReading, { availability: 'ready' | 'stale' }> {
  return reading.availability === 'ready' || reading.availability === 'stale';
}

export type MarketHistory = {
  bars: readonly ChartBar[];
  indicators: readonly ChartIndicator[];
  source: string;
  adjustment: string;
  coverage: string;
};

export type MarketRequest = { id: string; cryptoMarket: CryptoMarket };

export type BrokerLineBudget = {
  stocks: number;
  hotOptions: number;
  rotating: number;
  reserve: number;
  total: number;
};

export type ReplaySubscriptionBudget = BrokerLineBudget & {
  pinnedDepth: number;
  followingDepth: number;
};

export type WebMarketControls = {
  catalog: 'loading' | 'ready' | 'denied' | 'unavailable';
  saved?: readonly string[];
  focus?: string | null;
  quota?: { active: number; available: number; limit: number };
  brokerBudget?: BrokerLineBudget | 'unavailable';
  busy: boolean;
  message?: string;
  save(instrumentIds: readonly string[]): Promise<void>;
  setFocus(instrumentId: string | null): Promise<void>;
  refresh(): void;
};

// In-memory view of one adapter. An HTTP/stream implementation can populate
// this view asynchronously and notify React through subscribe.
export interface MarketDataAdapter {
  instruments: readonly MarketInstrument[];
  fixture?: { seed: string; replayTime: string };
  web?: WebMarketControls;
  replayBudget?: ReplaySubscriptionBudget;
  subscribe(listener: () => void): () => void;
  revision(): number;
  watch?(
    request: MarketRequest,
    options: {
      period: MarketPeriod | null;
      pinned: readonly string[];
      follow: string | null;
      detailRange?: DetailDateRange;
    },
  ): () => void;
  read(request: MarketRequest): MarketReading;
  history(
    request: MarketRequest,
    period: MarketPeriod,
  ): MarketHistory | undefined;
}
