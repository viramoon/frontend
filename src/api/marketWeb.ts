import {
  adminMutationHeaders,
  hasAdminProduct,
  privateOptions,
} from './adminWeb';
import { WebRequestError } from './index';
import {
  getMarketDepthFocus,
  getWatchlist,
  marketBars,
  marketBook,
  marketDerivatives,
  marketIndicators,
  marketIndicatorValues,
  marketInstruments,
  marketProducts,
  marketQuotes,
  marketSubscriptionBudget,
  marketSubscriptions,
  marketTrades,
  marketWal,
  marketWatermarks,
  putWatchlist,
  setMarketDepthFocus,
} from './generated/sdk.gen';
import type {
  InstrumentStatus,
  MarketTradesData,
  ProductPolicy,
  Watchlist,
  WalRecord,
} from './generated/types.gen';
import type {
  BookSource,
  MarketDataAdapter,
  MarketHistory,
  MarketInstrument,
  MarketPeriod,
  MarketReading,
  MarketRequest,
  WebMarketControls,
} from '../features/market/marketData';
import type { ChartIndicator } from '../components/MarketChart';
import type { DetailDateRange } from '../components/PanelDataClass';
import {
  applyBookEvent,
  waitingForBook,
  type BookEvent,
} from '../features/market/orderBook';
import {
  barRows,
  bookState,
  checkPolicy,
  checkView,
  coverageText,
  decimal,
  historyRows,
  foldBook,
  level,
  marketTracks,
  matches,
  selectionTracks,
  tradeRows,
  tradeTime,
  u64,
  wireTime,
  type Track,
  type ProductWindow,
} from './marketWebModel';
import { openMarketStream } from './marketWebStream';

const path = { id: 'default' };
const walPageSize = 4096;
const timeout = 12_000;
const historyLimit = 128;
const product = 'restricted_market_data';

function http(signal: AbortSignal) {
  return {
    ...privateOptions,
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
  };
}

function offset(value: string, count: number) {
  const result = u64(value) - BigInt(count);
  return (result > 0n ? result : 0n).toString();
}

function fromDay(day: string) {
  const iso = day + 'T00:00:00.000000000Z';
  const time = Date.parse(iso);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(time) ||
    !new Date(time).toISOString().startsWith(day)
  )
    throw new Error('Invalid date');
  return iso;
}

function windowDates(range: DetailDateRange) {
  try {
    const from = range.start ? fromDay(range.start) : undefined;
    const until = range.end ? fromDay(range.end) : undefined;
    if (from && until && from >= until) return;
    return { from, until };
  } catch {
    return;
  }
}

async function collectPages<T>(
  read: (
    offset: number,
  ) => Promise<{ items: T[]; next_offset?: number | null }>,
) {
  const items: T[] = [];
  let pageOffset = 0;
  while (true) {
    const page = await read(pageOffset);
    items.push(...page.items);
    if (page.next_offset == null) return items;
    if (page.next_offset <= pageOffset) throw new Error('Invalid pagination');
    pageOffset = page.next_offset;
  }
}

function pageEnd(after: string, through: string, limit: number) {
  const end = u64(after) + BigInt(limit);
  return end < u64(through) ? end : u64(through);
}

async function readWindow(
  policy: ProductPolicy,
  signal: AbortSignal,
  previous: ProductWindow | undefined,
  checkpoint: (window: ProductWindow) => void,
): Promise<ProductWindow> {
  const { source, product } = policy;
  const key = { source, product };
  const { data: head } = await marketWatermarks({
    ...http(signal),
    query: key,
  });
  checkPolicy(head.access, policy);
  const durable = head.watermarks.local_durable;
  const headPosition = u64(durable);
  const reusable =
    previous &&
    previous.policy.license === policy.license &&
    u64(previous.durable) <= headPosition
      ? previous
      : undefined;
  if (reusable?.durable === durable)
    return { ...reusable, policy, observedAt: head.as_of };
  let after = reusable?.durable ?? '0';
  const records = reusable ? [...reusable.records] : [];
  while (u64(after) < headPosition) {
    const { data } = await marketWal({
      ...http(signal),
      query: { ...key, after, through: durable, limit: walPageSize },
    });
    checkPolicy(data.access, policy);
    const start = u64(after);
    const end = pageEnd(after, durable, walPageSize);
    const next = end < headPosition ? String(end) : null;
    if (
      data.through !== durable ||
      u64(data.durable_through) < headPosition ||
      data.next_after !== next ||
      BigInt(data.records.length) !== end - start ||
      data.records.some(
        (record, index) => u64(record.position) !== start + BigInt(index + 1),
      )
    )
      throw new Error('Incomplete WAL page');
    signal.throwIfAborted();
    records.push(...data.records);
    after = String(end);
    // Keep verified progress for a later retry. Publish only at the fixed cutoff.
    checkpoint({ policy, records, durable: after, observedAt: head.as_of });
  }
  return { policy, records, durable, observedAt: head.as_of };
}

function viewWindow(
  track: Track,
): MarketTradesData['query'] & { channel: string } {
  const rows = [...track.window.records].reverse();
  const last = rows.find(({ event }) => matches(event, track));
  // A sparse partition can have its latest confirmed record outside the default
  // recent product page. Report the page that contains that known record.
  if (
    last &&
    u64(track.window.durable) - u64(last.position) >= BigInt(historyLimit)
  )
    return {
      ...track.partition,
      after: offset(last.position, historyLimit),
      through: last.position,
      limit: historyLimit,
    };
  return { ...track.partition, limit: historyLimit };
}

function bookWindow(track: Track) {
  const range = viewWindow(track);
  const seed = track.snapshot && u64(track.snapshot.position);
  const through = range.through ?? track.window.durable;
  if (
    !seed ||
    u64(through) - seed >= BigInt(historyLimit) ||
    u64(through) < seed
  )
    return range;
  return { ...range, after: (seed - 1n).toString(), through };
}

type HistoryDates = { from?: string; until?: string };

async function readTrades(
  track: Track,
  dates: HistoryDates,
  signal: AbortSignal,
) {
  if (!dates.from && !dates.until) {
    const { data } = await marketTrades({
      ...http(signal),
      query: viewWindow(track),
    });
    checkView(data, track);
    return {
      rows: tradeRows(data.records, track),
      coverage: coverageText(data.coverage),
    };
  }

  // WAL positions, unlike event timestamps, form a complete ordered cursor.
  // Bound the range using all matching positions from the pinned product WAL.
  const matching = track.window.records.filter(({ event }) => {
    if (
      !matches(event, track) ||
      (event.kind !== 'trade' &&
        !(
          event.kind === 'correction' &&
          event.payload.replacement.kind === 'trade'
        ))
    )
      return false;
    const time = tradeTime(event);
    return (
      (!dates.from || dates.from <= time) &&
      (!dates.until || time < dates.until)
    );
  });
  if (!matching.length)
    return {
      rows: [],
      coverage: `授权 WAL 已核对至位置 ${track.window.durable} · 区间无逐笔`,
    };

  const start = offset(matching[0].position, 1);
  const through = matching[matching.length - 1].position;
  let after = start;
  let scanned = 0;
  // W2a's bounded trade query only matches exchange timestamps. The checked
  // WAL supplies rows that match the same interval on their receive clock.
  const records = new Map<bigint, WalRecord>();
  for (const record of matching) {
    if (record.event.exchange_ts === null)
      records.set(u64(record.position), record);
  }
  while (u64(after) < u64(through)) {
    const { data } = await marketTrades({
      ...http(signal),
      query: {
        ...track.partition,
        ...dates,
        limit: historyLimit,
        after,
        through,
      },
    });
    checkView(data, track);
    const coverage = data.coverage;
    const end = pageEnd(after, through, historyLimit);
    const next = end < u64(through) ? String(end) : null;
    if (
      coverage.after !== after ||
      coverage.through !== through ||
      u64(coverage.durable_through) < u64(through) ||
      (coverage.next_after ?? null) !== next ||
      BigInt(coverage.scanned_records) !== end - u64(after) ||
      data.records.some(
        ({ position }) => u64(position) <= u64(after) || u64(position) > end,
      )
    )
      throw new Error('Incomplete trade page');
    scanned += coverage.scanned_records;
    for (const record of data.records)
      records.set(u64(record.position), record);
    after = String(end);
  }
  const ordered = [...records]
    .sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1))
    .map(([, record]) => record);
  return {
    rows: tradeRows(ordered, track),
    coverage: coverageText({
      after: start,
      through,
      durable_through: track.window.durable,
      scanned_records: scanned,
    }),
  };
}

async function readBook(
  track: Track,
  until: string | undefined,
  asOf: string | undefined,
  signal: AbortSignal,
) {
  const recorded = track.window.records.filter(
    ({ event }) =>
      matches(event, track) &&
      (!until || wireTime(event.first_available_ts) < until),
  );
  const seed = recorded.map(({ event }) => event.kind).lastIndexOf('snapshot');
  const last = recorded.at(-1);
  if (seed === -1 || !last)
    return {
      event: undefined,
      coverage: `授权 WAL 已核对至位置 ${track.window.durable} · 区间无盘口快照`,
    };
  const first = recorded[seed].position;
  if (u64(last.position) - u64(first) >= BigInt(historyLimit)) {
    // The book REST view only folds one page. Carry the verified baseline
    // through the committed sequence when the selected state spans pages.
    return {
      event: foldBook(recorded.slice(seed)),
      coverage: `授权 WAL 已核对至位置 ${track.window.durable} · 盘口位置 [${first}, ${last.position}]`,
    };
  }
  const { data } = await marketBook({
    ...http(signal),
    query: {
      ...track.partition,
      after: offset(first, 1),
      through: last.position,
      limit: historyLimit,
      as_of: asOf,
    },
  });
  return {
    event: bookState(data, track),
    coverage: coverageText(data.coverage),
  };
}

async function readSelection(
  instrument: MarketInstrument,
  status: InstrumentStatus | undefined,
  tracks: ReturnType<typeof selectionTracks>,
  period: MarketPeriod | null,
  range: DetailDateRange,
  indicators: readonly ('close' | 'volume')[],
  signal: AbortSignal,
) {
  const options = http(signal);
  const dates = windowDates(range);
  const { quote, book, trade, derivative, bar } = tracks;
  const allowBook =
    !!book?.availableFrom &&
    dates &&
    (!range.end || range.end > book.availableFrom);
  const allowTrades =
    !!trade?.availableFrom &&
    dates &&
    (!range.end || range.end > trade.availableFrom);
  const until = dates?.until;
  const asOf = until
    ? new Date(Date.parse(until) - 1000)
        .toISOString()
        .replace('.000Z', '.999999999Z')
    : undefined;
  const results = await Promise.allSettled([
    quote &&
      marketQuotes({ ...options, query: bookWindow(quote) }).then(
        ({ data }) => {
          checkView(data, quote);
          const bid = data.bid ? level(data.bid) : undefined;
          const ask = data.ask ? level(data.ask) : undefined;
          const observation = data.observation;
          const time = observation
            ? wireTime(observation.exchange_ts ?? observation.receive_ts)
            : data.as_of;
          const event: BookEvent | undefined =
            observation && data.state === 'observed'
              ? {
                  kind: 'snapshot',
                  epoch: u64(observation.epoch),
                  seq: u64(observation.seq),
                  asOf: time,
                  bids: bid ? [bid] : [],
                  asks: ask ? [ask] : [],
                }
              : undefined;
          return { bid, ask, time, state: data.state, event };
        },
      ),
    book && allowBook ? readBook(book, until, asOf, signal) : undefined,
    trade && allowTrades ? readTrades(trade, dates, signal) : undefined,
    bar && period
      ? marketBars({ ...options, query: viewWindow(bar) }).then(
          async ({ data }) => {
            checkView(data, bar);
            const bars = barRows(data.records, bar);
            if (bars.length === 0) return;
            const values = await Promise.allSettled(
              indicators.map(async (indicator): Promise<ChartIndicator> => {
                const { data: column } = await marketIndicatorValues({
                  ...options,
                  query: {
                    ...viewWindow(bar),
                    after: data.coverage.after,
                    through: data.coverage.through,
                    indicator,
                  },
                });
                checkView(column, bar);
                const points = new Map<string, string>();
                for (const item of column.items) {
                  const [barValue] = barRows([item.record], bar);
                  if (barValue) points.set(barValue.time, decimal(item.value));
                }
                return {
                  id: indicator,
                  label: indicator === 'close' ? '收盘价' : '成交量',
                  pane: indicator === 'close' ? 0 : 2,
                  lines: [{ label: indicator, color: '#91b8f6' }],
                  points: bars.map(({ time }) => {
                    const value = points.get(time);
                    return value === undefined
                      ? { status: 'undefined' as const }
                      : { status: 'ready' as const, values: [value] };
                  }),
                };
              }),
            );
            return {
              bars,
              source: `${data.access.source} · ${data.access.product}`,
              adjustment: '复权口径未提供',
              coverage: coverageText(data.coverage),
              indicators: values.flatMap((value) =>
                value.status === 'fulfilled' ? [value.value] : [],
              ),
            } satisfies MarketHistory;
          },
        )
      : undefined,
    derivative &&
      marketDerivatives({ ...options, query: viewWindow(derivative) }).then(
        ({ data }) => {
          checkView(data, derivative);
          const event = [
            ...historyRows(
              data.records,
              derivative,
              'perpetual_context',
            ).values(),
          ].at(-1);
          if (event?.kind !== 'perpetual_context') return;
          return {
            mark: decimal(event.payload.mark_price),
            fundingRate: decimal(event.payload.funding_rate),
            openInterest: decimal(event.payload.open_interest),
          };
        },
      ),
  ] as const);

  for (const result of results) {
    if (
      result.status === 'rejected' &&
      result.reason instanceof WebRequestError &&
      result.reason.status === 401
    )
      throw result.reason;
  }
  function value<T>(result: PromiseSettledResult<T>) {
    return result.status === 'fulfilled' ? result.value : undefined;
  }
  const [quoteResult, bookResult, tradeResult, barsResult, derivativeResult] =
    results;
  const quoteValue = value(quoteResult);
  const bookValue = value(bookResult);
  const tradesValue = value(tradeResult);
  const barsValue = value(barsResult);
  const derivativeValue = value(derivativeResult);
  return {
    quoteValue,
    bookValue,
    tradesValue,
    barsValue,
    derivativeValue,
    status,
    unavailable: results.some((result) => result.status === 'rejected'),
    bookDenied:
      bookResult.status === 'rejected' &&
      bookResult.reason instanceof WebRequestError &&
      bookResult.reason.status === 403,
    tradesDenied:
      tradeResult.status === 'rejected' &&
      tradeResult.reason instanceof WebRequestError &&
      tradeResult.reason.status === 403,
    tradesUnavailable: tradeResult.status === 'rejected',
    source: quote ?? book ?? trade ?? bar ?? derivative,
    instrument,
  };
}

type WatchOptions = Parameters<NonNullable<MarketDataAdapter['watch']>>[1];

export function createWebMarketAdapter(): MarketDataAdapter & {
  start(): () => void;
} {
  const listeners = new Set<() => void>();
  let revision = 0;
  let lifecycle: AbortController | undefined;
  let current: { request: MarketRequest; options: WatchOptions } | undefined;
  let reading: MarketReading = { availability: 'loading' };
  let key: string | undefined;
  let history: MarketHistory | undefined;
  let catalog: WebMarketControls['catalog'] = 'loading';
  let instruments: MarketInstrument[] = [];
  let tracks: Track[] = [];
  const windows = new Map<string, ProductWindow>();
  let statuses = new Map<string, InstrumentStatus>();
  let watchlist: Watchlist | undefined;
  let focus: string | null | undefined;
  let quota: WebMarketControls['quota'];
  let brokerBudget: WebMarketControls['brokerBudget'];
  let busy = false;
  let message: string | undefined;
  let indicators: ('close' | 'volume')[] = [];
  let work: AbortController | undefined;
  let catalogWork: AbortController | undefined;
  let stopStream: (() => void) | undefined;
  let stopEvents: (() => void) | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;

  function publish() {
    revision += 1;
    for (const listener of listeners) listener();
  }

  function clearSelection() {
    clearTimeout(refreshTimer);
    work?.abort();
    stopStream?.();
    stopStream = undefined;
    reading = { availability: 'loading' };
    history = undefined;
  }

  function revoke() {
    clearSelection();
    catalogWork?.abort();
    stopEvents?.();
    instruments = [];
    tracks = [];
    windows.clear();
    watchlist = undefined;
    focus = undefined;
    quota = undefined;
    brokerBudget = undefined;
    catalog = 'denied';
    reading = { availability: 'denied' };
    publish();
  }

  function denied(error: unknown) {
    return error instanceof WebRequestError && error.status === 401;
  }

  async function updateQuota(signal: AbortSignal) {
    try {
      const { data } = await marketSubscriptions(http(signal));
      if (signal.aborted || catalog === 'denied') return;
      quota = data.web;
      publish();
    } catch (error) {
      if (!signal.aborted && denied(error)) revoke();
    }
  }

  async function updateBrokerBudget(signal: AbortSignal) {
    try {
      const { data } = await marketSubscriptionBudget(http(signal));
      if (signal.aborted || catalog === 'denied') return;
      const counts = {
        total: data.account_lines,
        reserve: data.reserve_lines,
        stocks: data.stock_lines,
        hotOptions: data.hot_lines,
        rotating: data.rotation_lines,
      };
      brokerBudget = Object.values(counts).every(
        (count) => Number.isSafeInteger(count) && count >= 0,
      )
        ? counts
        : 'unavailable';
    } catch (error) {
      if (signal.aborted || catalog === 'denied') return;
      if (denied(error)) {
        revoke();
        return;
      }
      brokerBudget = 'unavailable';
    }
    publish();
  }

  async function refreshCatalog() {
    if (!lifecycle || lifecycle.signal.aborted || catalog === 'denied') return;
    catalogWork?.abort();
    const controller = new AbortController();
    catalogWork = controller;
    const signal = AbortSignal.any([lifecycle.signal, controller.signal]);
    const options = http(signal);
    try {
      const [policies, observed, saved, selectedFocus, indicatorsResult] =
        await Promise.all([
          collectPages((offset) =>
            marketProducts({ ...options, query: { offset, limit: 100 } }).then(
              ({ data }) => data,
            ),
          ),
          collectPages((offset) =>
            marketInstruments({
              ...options,
              query: { offset, limit: 128 },
            }).then(({ data }) => data),
          ),
          getWatchlist({ ...options, path }),
          getMarketDepthFocus(options),
          marketIndicators(options),
        ]);
      const permitted = policies.filter(
        (item) => item.display_live && item.record_local,
      );
      const allowedKeys = new Set(
        permitted.map((item) => item.source + '/' + item.product),
      );
      for (const key of windows.keys()) {
        if (!allowedKeys.has(key)) windows.delete(key);
      }
      const discovered = await Promise.allSettled(
        permitted.map(async (item) => {
          const key = item.source + '/' + item.product;
          const window = await readWindow(
            item,
            signal,
            windows.get(key),
            (verified) => windows.set(key, verified),
          );
          signal.throwIfAborted();
          windows.set(key, window);
          return window;
        }),
      );
      if (signal.aborted) return;
      if (
        discovered.some(
          (item) => item.status === 'rejected' && denied(item.reason),
        )
      ) {
        revoke();
        return;
      }
      const available = discovered.flatMap((item) =>
        item.status === 'fulfilled' ? [item.value] : [],
      );
      const view = marketTracks(available);
      for (const item of observed) {
        if (
          !view.instruments.has(item.instrument) &&
          /^[A-Z0-9][A-Z0-9_.-]*\.[A-Z0-9][A-Z0-9_-]*$/.test(item.instrument)
        ) {
          view.instruments.set(item.instrument, {
            id: item.instrument,
            name: item.instrument,
            product: '采集器已观测',
            kind: item.instrument === 'SPY.ARCA' ? 'l1-only' : 'diagnostic',
            currency: 'USD',
            quantityUnit: '份',
            timeZone: 'UTC',
          });
        }
      }
      instruments = [...view.instruments.values()];
      tracks = view.tracks;
      statuses = new Map(observed.map((item) => [item.instrument, item]));
      if (!watchlist || saved.data.revision >= watchlist.revision)
        watchlist = saved.data;
      focus = selectedFocus.data.instrument_id;
      indicators = indicatorsResult.data.items.map(({ id }) => id);
      catalog =
        instruments.length ||
        !discovered.some((item) => item.status === 'rejected')
          ? 'ready'
          : 'unavailable';
      publish();
      if (current) void loadCurrent();
      void updateQuota(signal);
      void updateBrokerBudget(signal);
    } catch (error) {
      if (signal.aborted) return;
      if (denied(error)) revoke();
      else {
        catalog = 'unavailable';
        clearSelection();
        instruments = [];
        publish();
      }
    }
  }

  async function loadCurrent() {
    if (
      !current ||
      !lifecycle ||
      lifecycle.signal.aborted ||
      catalog !== 'ready'
    )
      return;
    const { request, options } = current;
    const instrument = instruments.find(({ id }) => id === request.id);
    if (!instrument) return;
    clearSelection();
    key = request.id;
    const controller = new AbortController();
    work = controller;
    const signal = AbortSignal.any([lifecycle.signal, controller.signal]);
    const range = options.detailRange ?? { start: '', end: '' };
    const selected = selectionTracks(tracks, request.id, options.period);
    const view = await readSelection(
      instrument,
      statuses.get(request.id),
      selected,
      options.period,
      range,
      indicators,
      signal,
    ).catch((error: unknown) => {
      if (!signal.aborted && denied(error)) revoke();
      return undefined;
    });
    if (signal.aborted) return;
    if (!view?.source) {
      reading = { availability: view ? 'empty' : 'unavailable' };
      publish();
      return;
    }

    const { quoteValue, bookValue, tradesValue, barsValue, derivativeValue } =
      view;
    const approvedBook = view.bookDenied ? undefined : selected.book;
    const tradesAvailableFrom = view.tradesDenied
      ? undefined
      : selected.trade?.availableFrom;
    const streamTrack = approvedBook ?? selected.quote;
    let latestBook: BookEvent | undefined = bookValue?.event;
    const receivers = new Set<(event: BookEvent) => void>();
    function receive(event: BookEvent) {
      latestBook = event;
      for (const listener of receivers) listener(event);
    }
    const book: BookSource | undefined = approvedBook?.availableFrom
      ? {
          instrument: request.id,
          venue: request.id.split('.').at(-1) ?? '',
          availableFrom: approvedBook.availableFrom,
          coverage: bookValue ? bookValue.coverage : undefined,
          timeliness: '已采集',
          subscribe(listener) {
            receivers.add(listener);
            if (latestBook) listener(latestBook);
            return () => {
              receivers.delete(listener);
            };
          },
        }
      : undefined;
    const quote =
      quoteValue?.state === 'observed' && (quoteValue.bid || quoteValue.ask)
        ? { bid: quoteValue.bid, ask: quoteValue.ask }
        : undefined;
    history = barsValue;
    reading = {
      availability: view.status?.stale ? 'stale' : 'ready',
      freshnessUnknown: view.status === undefined,
      instrument: request.id,
      venue: request.id.split('.').at(-1) ?? '',
      currency: instrument.currency,
      product: view.source.partition.product,
      source: `${view.source.partition.source} · ${view.source.window.policy.license}`,
      asOf:
        quoteValue?.time ??
        (bookValue?.event?.kind === 'snapshot'
          ? bookValue.event.asOf
          : undefined) ??
        barsValue?.bars.at(-1)?.time ??
        tradesValue?.rows[0]?.time ??
        view.status?.last_bar_at ??
        view.source.window.observedAt,
      quote,
      book,
      trades: tradesValue?.rows,
      tradesAvailableFrom,
      tradesCoverage: tradesValue?.coverage,
      tradesUnavailable: view.tradesUnavailable,
      derivatives: derivativeValue,
    };
    if (
      !quote &&
      !book &&
      !history &&
      !tradesValue?.rows.length &&
      !tradesAvailableFrom &&
      !derivativeValue &&
      view.unavailable
    )
      reading = { availability: 'unavailable' };
    publish();

    if (streamTrack && !range.start && !range.end) {
      const publishBook = (event: BookEvent) => {
        if (approvedBook === streamTrack) receive(event);
      };
      const initial =
        approvedBook === streamTrack ? bookValue?.event : quoteValue?.event;
      let quoteBook = initial
        ? applyBookEvent(waitingForBook, initial)
        : waitingForBook;
      stopStream = openMarketStream({
        track: streamTrack,
        initial,
        onSubscribed: () => void updateQuota(signal),
        onBook(event) {
          publishBook(event);
          if (
            streamTrack !== selected.quote ||
            (reading.availability !== 'ready' &&
              reading.availability !== 'stale')
          )
            return;
          quoteBook = applyBookEvent(quoteBook, event);
          if (quoteBook.kind !== 'current') return;
          reading = {
            ...reading,
            availability: view.status?.stale ? 'stale' : 'ready',
            asOf: quoteBook.asOf,
            quote: {
              ...reading.quote,
              bid: quoteBook.bids[0],
              ask: quoteBook.asks[0],
            },
          };
          publish();
        },
        onUnavailable() {
          quoteBook = waitingForBook;
          publishBook({ kind: 'unavailable', reason: '连接中断' });
          if (reading.availability === 'ready') {
            reading = { ...reading, availability: 'stale' };
            publish();
          }
        },
        onDenied: revoke,
        onReset() {
          publishBook({ kind: 'unavailable', reason: '盘口失同步' });
          if (
            reading.availability === 'ready' ||
            reading.availability === 'stale'
          ) {
            reading = {
              ...reading,
              availability: 'stale',
              quote: streamTrack === selected.quote ? undefined : reading.quote,
            };
            publish();
          }
          refreshTimer = setTimeout(() => void refreshCatalog(), 3000);
        },
      });
    }
  }

  async function write(
    action: (
      headers: Awaited<ReturnType<typeof adminMutationHeaders>>,
      signal: AbortSignal,
    ) => Promise<void>,
  ) {
    if (busy || !lifecycle || lifecycle.signal.aborted || catalog !== 'ready')
      return;
    const signal = lifecycle.signal;
    busy = true;
    message = undefined;
    publish();
    try {
      const headers = await adminMutationHeaders(product);
      if (signal.aborted || catalog !== 'ready') return;
      await action(headers, signal);
    } catch (error) {
      if (!signal.aborted && denied(error)) revoke();
      else if (
        !signal.aborted &&
        error instanceof WebRequestError &&
        error.status === 409
      ) {
        message = '自选已在其他页面更新，请核对后重试。';
        await refreshCatalog();
      } else if (!signal.aborted) message = '保存失败，请重新读取状态。';
    } finally {
      if (!signal.aborted) {
        busy = false;
        publish();
      }
    }
  }

  const web: WebMarketControls = {
    get catalog() {
      return catalog;
    },
    get saved() {
      return watchlist?.instrument_ids;
    },
    get focus() {
      return focus;
    },
    get quota() {
      return quota;
    },
    get brokerBudget() {
      return brokerBudget;
    },
    get busy() {
      return busy;
    },
    get message() {
      return message;
    },
    save(instrument_ids) {
      return write(async (headers, signal) => {
        if (!watchlist || !Number.isSafeInteger(watchlist.revision))
          throw new Error('Invalid watchlist revision');
        const { data } = await putWatchlist({
          ...http(signal),
          headers,
          path,
          body: {
            revision: watchlist.revision,
            instrument_ids: [...instrument_ids],
          },
        });
        if (!signal.aborted && catalog === 'ready') watchlist = data;
      });
    },
    setFocus(instrument_id) {
      return write(async (headers, signal) => {
        const { data } = await setMarketDepthFocus({
          ...http(signal),
          headers,
          body: instrument_id
            ? { action: 'set', instrument_id }
            : { action: 'clear' },
        });
        if (!signal.aborted && catalog === 'ready') focus = data.instrument_id;
      });
    },
    refresh: () => void refreshCatalog(),
  };

  return {
    get instruments() {
      return instruments;
    },
    web,
    revision: () => revision,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read: (request) =>
      request.id === key
        ? reading
        : { availability: catalog === 'denied' ? 'denied' : 'empty' },
    history: (request) => (request.id === key ? history : undefined),
    watch(request, options) {
      const selection = { request, options };
      current = selection;
      void loadCurrent();
      return () => {
        if (current !== selection) return;
        current = undefined;
        clearSelection();
      };
    },
    start() {
      const controller = new AbortController();
      lifecycle = controller;
      catalog = 'loading';
      busy = false;
      publish();
      void refreshCatalog();
      const events = new EventSource('/api/v1/events');
      stopEvents = () => events.close();
      events.addEventListener(
        'permissions',
        (message: MessageEvent<string>) => {
          if (controller.signal.aborted) return;
          try {
            const event = JSON.parse(message.data);
            if (
              event.schema_version !== '1.0' ||
              event.kind !== 'permissions' ||
              event.state !== 'authorized' ||
              !Array.isArray(event.products) ||
              !event.products.includes(product)
            )
              revoke();
          } catch {
            revoke();
          }
        },
      );
      events.addEventListener('reset', () => {
        if (!controller.signal.aborted && catalog === 'ready') {
          clearSelection();
          publish();
          void refreshCatalog();
        }
      });
      events.addEventListener('error', () => {
        if (controller.signal.aborted || catalog === 'denied') return;
        void hasAdminProduct(product, http(controller.signal).signal)
          .then((allowed) => {
            if (!allowed && !controller.signal.aborted) revoke();
          })
          .catch(() => {
            if (!controller.signal.aborted) {
              clearSelection();
              publish();
              void refreshCatalog();
            }
          });
      });
      poll = setInterval(() => {
        if (catalog !== 'denied') void refreshCatalog();
      }, 60_000);
      return () => {
        controller.abort();
        clearSelection();
        catalogWork?.abort();
        stopEvents?.();
        windows.clear();
        clearInterval(poll);
      };
    },
  };
}
