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
  level,
  marketTracks,
  matches,
  selectionTracks,
  tradeRows,
  u64,
  wireTime,
  type Track,
} from './marketWebModel';
import { openMarketStream } from './marketWebStream';

const path = { id: 'default' };
const prefixLimit = 4096;
const recentLimit = 512;
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

async function readWindow(policy: ProductPolicy, signal: AbortSignal) {
  const options = http(signal);
  const { source, product } = policy;
  const key = { source, product };
  const { data: head } = await marketWatermarks({ ...options, query: key });
  checkPolicy(head.access, policy);
  const durable = head.watermarks.local_durable;
  const headPosition = u64(durable);
  if (headPosition === 0n)
    return { policy, prefix: [], recent: [], durable, observedAt: head.as_of };
  const { data: prefix } = await marketWal({
    ...options,
    query: { ...key, after: '0', through: durable, limit: prefixLimit },
  });
  checkPolicy(prefix.access, policy);
  // An inclusive stable cutoff plus continuity from zero proves the start of any
  // partition encountered here. A tail-only match cannot prove an earlier date.
  const prefixLength =
    headPosition < BigInt(prefixLimit) ? Number(headPosition) : prefixLimit;
  const next =
    BigInt(prefixLength) < headPosition ? String(prefixLength) : null;
  if (
    prefix.through !== durable ||
    prefix.records.length !== prefixLength ||
    prefix.next_after !== next ||
    prefix.records.some((record, i) => u64(record.position) !== BigInt(i + 1))
  ) {
    throw new Error('Incomplete WAL prefix');
  }
  if (prefix.next_after == null)
    return {
      policy,
      prefix: prefix.records,
      recent: [],
      durable,
      observedAt: head.as_of,
    };
  const { data: recent } = await marketWal({
    ...options,
    query: {
      ...key,
      after: offset(durable, recentLimit),
      through: durable,
      limit: recentLimit,
    },
  });
  checkPolicy(recent.access, policy);
  return {
    policy,
    prefix: prefix.records,
    recent: recent.records,
    durable,
    observedAt: head.as_of,
  };
}

function viewWindow(
  track: Track,
  until?: string,
): MarketTradesData['query'] & { channel: string } {
  const rows = [...track.window.prefix, ...track.window.recent].reverse();
  const last = rows.find(
    ({ event }) =>
      matches(event, track) &&
      (!until || wireTime(event.exchange_ts ?? event.receive_ts) < until),
  );
  // A sparse partition can have its latest confirmed record outside the default
  // recent product page. Report the page that contains that known record.
  if (
    last &&
    (until ||
      u64(track.window.durable) - u64(last.position) >= BigInt(historyLimit))
  )
    return {
      ...track.partition,
      after: offset(last.position, historyLimit),
      through: last.position,
      limit: historyLimit,
    };
  return { ...track.partition, limit: historyLimit };
}

function bookWindow(track: Track, until?: string) {
  const range = viewWindow(track, until);
  const snapshot = [...track.window.recent]
    .reverse()
    .concat([...track.window.prefix].reverse())
    .find(
      ({ event }) =>
        event.kind === 'snapshot' &&
        matches(event, track) &&
        (!until || wireTime(event.first_available_ts) < until),
    );
  const seed = snapshot && u64(snapshot.position);
  const through = range.through ?? track.window.durable;
  if (
    !seed ||
    u64(through) - seed >= BigInt(historyLimit) ||
    u64(through) < seed
  )
    return range;
  return { ...range, after: (seed - 1n).toString(), through };
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
    book && allowBook
      ? marketBook({
          ...options,
          query: { ...bookWindow(book, until), as_of: asOf },
        }).then(({ data }) => ({
          event: bookState(data, book),
          coverage: coverageText(data.coverage),
        }))
      : undefined,
    trade && allowTrades
      ? marketTrades({
          ...options,
          query: { ...viewWindow(trade, until), ...dates },
        }).then(({ data }) => {
          checkView(data, trade);
          return {
            rows: tradeRows(data.records, trade),
            coverage: coverageText(data.coverage),
          };
        })
      : undefined,
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
  let statuses = new Map<string, InstrumentStatus>();
  let watchlist: Watchlist | undefined;
  let focus: string | null | undefined;
  let quota: WebMarketControls['quota'];
  let financeLines: WebMarketControls['financeLines'];
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
    watchlist = undefined;
    focus = undefined;
    quota = undefined;
    financeLines = undefined;
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
      financeLines = data.finance_lines;
      publish();
    } catch (error) {
      if (!signal.aborted && denied(error)) revoke();
    }
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
      const discovered = await Promise.allSettled(
        policies
          .filter((item) => item.display_live && item.record_local)
          .map((item) => readWindow(item, signal)),
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
      const view = marketTracks(
        discovered.flatMap((item) =>
          item.status === 'fulfilled' ? [item.value] : [],
        ),
      );
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
    get financeLines() {
      return financeLines;
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
    budget: {
      stocks: 0,
      hotOptions: 0,
      rotating: 0,
      reserve: 0,
      total: 0,
      pinnedDepth: 0,
      followingDepth: 0,
    },
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
        clearInterval(poll);
      };
    },
  };
}
