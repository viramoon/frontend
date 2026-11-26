import {
  cryptoMarkets,
  periods,
  type CryptoMarket,
  type MarketInstrument,
  type MarketPeriod,
} from './marketData';

const storageKey = 'fertile.market.preferences.v1';

export type MarketPreferences = {
  selected: string;
  saved: string[];
  onlySaved: boolean;
  period: MarketPeriod;
  timeZone: 'UTC' | 'market';
  cryptoMarket: CryptoMarket;
  pinned: string[];
};

export function readPreferences(
  instruments: readonly MarketInstrument[],
): MarketPreferences {
  const defaults: MarketPreferences = {
    selected: instruments[0]?.id ?? '',
    saved: instruments
      .filter(({ kind }) => kind !== 'diagnostic')
      .map(({ id }) => id),
    onlySaved: false,
    period: '1h',
    timeZone: 'UTC',
    cryptoMarket: 'hyperliquid-perp',
    pinned: ['AAPL.XNAS', 'MSFT.XNAS'].filter((id) =>
      instruments.some((item) => item.id === id && item.kind === 'nasdaq'),
    ),
  };
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaults;
    const data: Partial<Record<keyof MarketPreferences, unknown>> | null =
      JSON.parse(raw);
    if (!data) return defaults;
    const saved = data.saved;
    const pinned = data.pinned;
    const nasdaqIds = instruments
      .filter(({ kind }) => kind === 'nasdaq')
      .map(({ id }) => id);
    return {
      selected:
        instruments.find(({ id }) => id === data.selected)?.id ??
        defaults.selected,
      saved: Array.isArray(saved)
        ? defaults.saved.filter((id) => saved.includes(id))
        : defaults.saved,
      onlySaved: data.onlySaved === true,
      period:
        periods.find(({ id }) => id === data.period)?.id ?? defaults.period,
      timeZone: data.timeZone === 'market' ? 'market' : defaults.timeZone,
      cryptoMarket:
        cryptoMarkets.find(({ id }) => id === data.cryptoMarket)?.id ??
        defaults.cryptoMarket,
      pinned: Array.isArray(pinned)
        ? [...new Set(pinned)].filter(
            (id): id is string =>
              typeof id === 'string' && nasdaqIds.includes(id),
          )
        : defaults.pinned,
    };
  } catch {
    return defaults;
  }
}

export function writePreferences(preferences: MarketPreferences) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    // Keep the current session usable when browser storage is unavailable.
  }
}
