import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  BookSnapshot,
  Event,
  WalRecord,
} from '../api/generated/types.gen';
import { AppRoutes } from '../app/routes/AppRoutes';

const instrument = 'SYNTH.XNAS';
const source = 'synthetic';
const product = 'test-equity';
const license = 'synthetic-display';
const price = '100.123456789012345678';
const size = '0.000000000000000001';
const snapshot: BookSnapshot = {
  bids: [{ price, quantity: size }],
  asks: [{ price: '101.00', quantity: '3.000' }],
};
const asOf = '2026-11-21T12:00:00Z';
const epoch = '9007199254740993';
const access = {
  source,
  product,
  license,
  display_live: true,
  record_local: true,
  derive_non_display: false,
  backup_personal_drive: false,
};

function nanos(iso: string) {
  return (BigInt(Date.parse(iso)) * 1_000_000n).toString();
}

// A fixed clock and literals generate each mock WAL row. No provider samples are used.
function row(
  position: number,
  date: string,
  channel: string,
  value:
    | Pick<Extract<Event, { kind: 'snapshot' }>, 'kind' | 'payload'>
    | Pick<Extract<Event, { kind: 'trade' }>, 'kind' | 'payload'>
    | Pick<Extract<Event, { kind: 'bar_closed' }>, 'kind' | 'payload'>,
  clocks?: { receive: string; available: string },
): WalRecord {
  const time = nanos(date);
  return {
    position: String(position),
    generation: '1',
    event: {
      ...value,
      schema_version: '1.0',
      channel,
      source,
      product,
      license,
      instrument_id: instrument,
      asset_kind: 'stock',
      venue: 'XNAS',
      epoch,
      seq: (BigInt(epoch) + BigInt(position)).toString(),
      cursor: 'synthetic-' + position,
      revision: '0',
      exchange_ts: time,
      receive_ts: clocks ? nanos(clocks.receive) : time,
      first_available_ts: clocks ? nanos(clocks.available) : time,
    },
  };
}

const rows = [
  row(1, '2026-11-15T12:00:00Z', 'book', {
    kind: 'snapshot',
    payload: snapshot,
  }),
  row(2, '2026-11-17T12:00:00Z', 'trades', {
    kind: 'trade',
    payload: { price, quantity: size, side: 'unknown' },
  }),
  row(3, '2026-11-20T10:00:00Z', 'bars-1h', {
    kind: 'bar_closed',
    payload: {
      open_ts: nanos('2026-11-20T09:00:00Z'),
      open: price,
      high: '102',
      low: '99',
      close: price,
      volume: size,
    },
  }),
  row(4, '2026-11-20T12:00:00Z', 'book', {
    kind: 'snapshot',
    payload: snapshot,
  }),
  row(5, '2026-11-21T12:00:00Z', 'trades', {
    kind: 'trade',
    payload: { price, quantity: size, side: 'unknown' },
  }),
];
const coverage = {
  after: '0',
  through: '5',
  durable_through: '5',
  next_after: null,
  scanned_records: 5,
};
const metadata = { as_of: asOf, access, instrument_id: instrument, coverage };

class MockSocket {
  static opened: MockSocket[] = [];
  sent: unknown[] = [];
  closed = false;
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (event: { data: string }) => void;

  constructor(readonly url: URL) {
    MockSocket.opened.push(this);
  }
  send(message: string) {
    this.sent.push(JSON.parse(message));
  }
  close() {
    this.closed = true;
  }
  frame(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

class MockEvents extends EventTarget {
  static opened: MockEvents[] = [];
  closed = false;
  constructor(readonly url: string) {
    super();
    MockEvents.opened.push(this);
  }
  close() {
    this.closed = true;
  }
  frame(type: string, value: unknown) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(value) }));
  }
}

type Call = { path: string; query: URLSearchParams; request: Request };

function mockWeb(admin = true, perpetual = false, wal = rows) {
  let ids: string[] = [];
  let revision = 3;
  let focus: string | null = null;
  const calls: Call[] = [];
  const unexpected: string[] = [];
  const perpetualId = 'SYNTH-USD-PERP.SYNTHETIC';
  const derivative: WalRecord = {
    ...rows[4],
    position: '6',
    event: {
      ...rows[4].event,
      instrument_id: perpetualId,
      asset_kind: 'perpetual',
      venue: 'SYNTHETIC',
      channel: 'perpetual_context',
      schema_version: '2.0',
      revision: '0',
      kind: 'perpetual_context',
      payload: {
        mark_price: price,
        funding_rate: '0.000000001',
        open_interest: '12.0001',
      },
    },
  };
  const records = perpetual ? [...wal, derivative] : wal;
  const durable = String(records.length);
  async function mock(request: Request) {
    const url = new URL(request.url);
    const path = url.pathname;
    function page(max: number, fromBeginning = false) {
      const through = Number(url.searchParams.get('through') ?? durable);
      const limit = Number(url.searchParams.get('limit') ?? max);
      const after = Number(
        url.searchParams.get('after') ??
          (fromBeginning ? 0 : Math.max(0, through - limit)),
      );
      const end = Math.min(through, after + limit);
      return {
        records: records.slice(after, end),
        coverage: {
          after: String(after),
          through: String(through),
          durable_through: durable,
          next_after: end < through ? String(end) : null,
          scanned_records: end - after,
        },
      };
    }
    calls.push({ path, query: url.searchParams, request });
    if (url.origin !== window.location.origin)
      throw new Error('External mock request');
    switch (path) {
      case '/api/v1/me/capabilities':
        return Response.json(
          admin
            ? {
                subject: 'admin',
                products: ['restricted_market_data'],
                csrf_token: 'fixture-csrf',
              }
            : { subject: 'anonymous', products: ['market_status'] },
        );
      case '/api/v1/system/status':
        return Response.json({}, { status: 503 });
      case '/api/v1/backtests/sample':
        return Response.json({}, { status: 404 });
      case '/api/v1/market/products':
        return Response.json({ as_of: asOf, items: [access] });
      case '/api/v1/market/instruments':
        return Response.json({
          state: 'ready',
          source,
          items: [{ instrument, stale: false }],
        });
      case '/api/v1/market/watermarks':
        return Response.json({
          access,
          as_of: asOf,
          watermarks: { local_durable: durable },
        });
      case '/api/v1/market/wal': {
        const raw = page(512, true);
        return Response.json({
          access,
          as_of: asOf,
          through: raw.coverage.through,
          durable_through: durable,
          next_after: raw.coverage.next_after,
          records: raw.records,
        });
      }
      case '/api/v1/market/derivatives':
        return Response.json({
          ...metadata,
          instrument_id: perpetualId,
          records: [derivative],
        });
      case '/api/v1/market/quotes':
      case '/api/v1/market/book': {
        const cutoff = url.searchParams.get('as_of');
        const scanned = page(128);
        const found = scanned.records
          .slice()
          .reverse()
          .find(
            ({ event }) =>
              event.kind === 'snapshot' &&
              event.channel === url.searchParams.get('channel') &&
              (!cutoff ||
                BigInt(event.first_available_ts) <= BigInt(nanos(cutoff))),
          );
        if (!found)
          return Response.json({
            ...metadata,
            coverage: scanned.coverage,
            state: 'unknown',
          });
        const event = found.event;
        return Response.json({
          ...metadata,
          coverage: scanned.coverage,
          state: 'observed',
          ...snapshot,
          bid: snapshot.bids[0],
          ask: snapshot.asks[0],
          observation: {
            channel: event.channel,
            venue: event.venue,
            epoch: event.epoch,
            seq: event.seq,
            exchange_ts: event.exchange_ts,
            receive_ts: event.receive_ts,
            position: found.position,
          },
        });
      }
      case '/api/v1/market/trades': {
        const from = url.searchParams.get('from');
        const until = url.searchParams.get('until');
        const scanned = page(128);
        return Response.json({
          ...metadata,
          coverage: scanned.coverage,
          records: scanned.records.filter(
            ({ event }) =>
              event.kind === 'trade' &&
              (!from ||
                (event.exchange_ts !== null &&
                  BigInt(event.exchange_ts) >= BigInt(nanos(from)))) &&
              (!until ||
                (event.exchange_ts !== null &&
                  BigInt(event.exchange_ts) < BigInt(nanos(until)))),
          ),
        });
      }
      case '/api/v1/market/bars':
        return Response.json({ ...metadata, records: [rows[2]] });
      case '/api/v1/indicators':
        return Response.json({
          items: [{ id: 'close', source_kind: 'bar_closed' }],
        });
      case '/api/v1/indicators/values':
        return Response.json({
          ...metadata,
          items: [{ record: rows[2], value: price }],
          indicator: 'close',
        });
      case '/api/v1/market/subscriptions':
        return Response.json({
          web: { limit: 8, active: 1, available: 7 },
          finance_lines: 'finance_contract_pending',
        });
      case '/api/v1/market/depth-focus':
        if (request.method === 'PUT') {
          const body = await request.json();
          focus = body.action === 'set' ? body.instrument_id : null;
        }
        return Response.json({ instrument_id: focus });
      case '/api/v1/watchlists/default':
        if (request.method === 'PUT') {
          const body = await request.json();
          if (body.revision !== revision)
            return Response.json({}, { status: 409 });
          ids = body.instrument_ids;
          revision++;
        }
        return Response.json({ id: 'default', revision, instrument_ids: ids });
      case '/api/v1/options/flow':
        return Response.json(
          { error: { code: 'finance_contract_pending' } },
          { status: 503 },
        );
      default:
        unexpected.push(path);
        return Response.json({}, { status: 404 });
    }
  }
  vi.stubGlobal('fetch', vi.fn(mock));
  return { calls, unexpected };
}

function mount(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const quotes = () =>
  within(screen.getByRole('complementary', { name: '报价与来源' }));
const depth = () => within(quotes().getByRole('region', { name: '盘口深度' }));
const trades = () => within(screen.getByRole('region', { name: '已成交记录' }));
const beforeCollection = '采集开始前无细节数据';

beforeEach(() => {
  localStorage.clear();
  MockSocket.opened = [];
  MockEvents.opened = [];
  vi.stubGlobal('WebSocket', MockSocket);
  vi.stubGlobal('EventSource', MockEvents);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('defaults dashboard to the W2a catalog, bars, indicators and policy-approved quote', async () => {
  const { calls, unexpected } = mockWeb();
  mount('/dashboard');
  const chart = within(
    await screen.findByRole('region', { name: '主 K 线与成交量' }),
  );
  expect(await chart.findByLabelText('K 线精确读数')).toBeVisible();
  expect(chart.getByText('数据类别 · 价量历史')).toBeVisible();
  expect(
    chart.getByText(/synthetic · test-equity.*WAL 已扫描 5 条/),
  ).toBeVisible();
  expect(
    within(chart.getByLabelText('指标')).getByRole('option', {
      name: '收盘价',
    }),
  ).toBeInTheDocument();
  expect(
    quotes().getByRole('table', { name: '场所最优报价' }),
  ).toHaveTextContent(price);
  expect(screen.queryByText('Fixture · 示例数据')).toBeNull();
  for (const path of [
    '/api/v1/market/instruments',
    '/api/v1/market/products',
    '/api/v1/market/wal',
    '/api/v1/market/quotes',
    '/api/v1/market/bars',
    '/api/v1/indicators/values',
  ]) {
    expect(calls.find((call) => call.path === path)?.request.cache, path).toBe(
      'no-store',
    );
  }
  expect(unexpected).toEqual([]);
});

it('uses separate first committed dates and queries only collectable dates at the trading route', async () => {
  const { calls, unexpected } = mockWeb();
  mount('/trading');
  await screen.findByRole('table', { name: '逐笔成交' });
  expect(depth().getByText('2026-11-15')).toHaveAttribute(
    'datetime',
    '2026-11-15',
  );
  expect(trades().getByText('2026-11-17')).toHaveAttribute(
    'datetime',
    '2026-11-17',
  );
  expect(trades().getByText(/WAL 已扫描 5 条/)).toBeVisible();
  expect(trades().getByRole('table')).toHaveTextContent(size);
  const requestsBefore = calls.filter(
    ({ path }) =>
      path === '/api/v1/market/book' || path === '/api/v1/market/trades',
  ).length;

  fireEvent.change(screen.getByLabelText('结束日期（不含）'), {
    target: { value: '2026-11-15' },
  });
  await waitFor(() =>
    expect(depth().getByText(beforeCollection)).toBeVisible(),
  );
  expect(trades().getByText(beforeCollection)).toBeVisible();
  expect(depth().queryByRole('table')).toBeNull();
  expect(trades().queryByRole('table')).toBeNull();
  expect(
    calls.filter(
      ({ path }) =>
        path === '/api/v1/market/book' || path === '/api/v1/market/trades',
    ),
  ).toHaveLength(requestsBefore);

  fireEvent.change(screen.getByLabelText('结束日期（不含）'), {
    target: { value: '2026-11-21' },
  });
  await screen.findByRole('table', { name: '逐笔成交' });
  expect(depth().getByText(beforeCollection)).toBeVisible();
  expect(depth().getByRole('table')).toBeVisible();
  expect(trades().getByText(beforeCollection)).toBeVisible();
  expect(trades().getByRole('table').querySelectorAll('tbody tr')).toHaveLength(
    1,
  );
  expect(
    calls
      .filter(({ path }) => path === '/api/v1/market/trades')
      .at(-1)
      ?.query.get('until'),
  ).toBe('2026-11-21T00:00:00.000000000Z');
  expect(
    calls
      .filter(({ path }) => path === '/api/v1/market/book')
      .at(-1)
      ?.query.get('as_of'),
  ).toBe('2026-11-20T23:59:59.999999999Z');
  expect(unexpected).toEqual([]);
});

it('uses first availability across UTC midnight rather than the exchange or receive day', async () => {
  const exchanged = '2026-11-17T23:59:58Z';
  const clocks = {
    receive: '2026-11-17T23:59:59Z',
    available: '2026-11-18T00:00:01Z',
  };
  const { calls } = mockWeb(true, false, [
    row(1, exchanged, 'book', { kind: 'snapshot', payload: snapshot }, clocks),
    row(
      2,
      exchanged,
      'trades',
      { kind: 'trade', payload: { price, quantity: size, side: 'unknown' } },
      clocks,
    ),
    ...rows.slice(2),
  ]);
  mount('/trading');
  await screen.findByRole('table', { name: '逐笔成交' });
  const isDetail = ({ path }: Call) =>
    path === '/api/v1/market/book' || path === '/api/v1/market/trades';
  const count = calls.filter(isDetail).length;
  fireEvent.change(screen.getByLabelText('结束日期（不含）'), {
    target: { value: '2026-11-18' },
  });
  await waitFor(() =>
    expect(depth().getByText(beforeCollection)).toBeVisible(),
  );
  for (const panel of [depth(), trades()]) {
    expect(panel.getByText('2026-11-18')).toHaveAttribute(
      'datetime',
      '2026-11-18',
    );
    expect(panel.getByText(beforeCollection)).toBeVisible();
    expect(panel.queryByRole('table')).toBeNull();
  }
  expect(calls.filter(isDetail)).toHaveLength(count);
});

it('discovers late partitions and returns all scoped records in a 6000-record WAL', async () => {
  const middle = '2026-11-18T12:00:00Z';
  const firstTrade = row(4800, middle, 'trades', {
    kind: 'trade',
    payload: { price: '4800.0001', quantity: size, side: 'unknown' },
  });
  const lastTrade = row(5200, middle, 'trades', {
    kind: 'trade',
    payload: { price: '5200.0001', quantity: size, side: 'unknown' },
  });
  const middleBook = row(4750, middle, 'book', {
    kind: 'snapshot',
    payload: snapshot,
  });
  const updates: WalRecord = {
    ...middleBook,
    position: '5100',
    event: {
      ...middleBook.event,
      schema_version: '1.0',
      kind: 'delta',
      seq: (BigInt(middleBook.event.seq) + 1n).toString(),
      payload: {
        updates: [{ ...snapshot.bids[0], side: 'bid', quantity: '7.22345' }],
      },
    },
  };
  const tailBook = row(5900, asOf, 'book', {
    kind: 'snapshot',
    payload: snapshot,
  });
  const tailTrade = row(5950, asOf, 'trades', {
    kind: 'trade',
    payload: { price, quantity: size, side: 'unknown' },
  });
  const known = new Map(
    [middleBook, firstTrade, updates, lastTrade, tailBook, tailTrade].map(
      (record) => [record.position, record],
    ),
  );
  const wal = Array.from({ length: 6000 }, (_, index) => {
    const position = String(index + 1);
    return (
      known.get(position) ?? {
        ...rows[2],
        position,
        event: { ...rows[2].event, channel: 'unselected' },
      }
    );
  });
  const { calls, unexpected } = mockWeb(true, false, wal);
  mount('/trading');
  await screen.findByRole('table', { name: '逐笔成交' });
  expect(trades().getByText('2026-11-18')).toBeVisible();
  fireEvent.change(screen.getByLabelText('起始日期'), {
    target: { value: '2026-11-18' },
  });
  fireEvent.change(screen.getByLabelText('结束日期（不含）'), {
    target: { value: '2026-11-19' },
  });
  await waitFor(() =>
    expect(trades().getByRole('table')).toHaveTextContent('4800.0001'),
  );
  expect(trades().getByRole('table')).toHaveTextContent('5200.0001');
  expect(trades().getByRole('table').querySelectorAll('tbody tr')).toHaveLength(
    2,
  );
  expect(depth().getByText('7.22345')).toBeVisible();
  expect(depth().getByText(/盘口位置 \[4750, 5100\]/)).toBeVisible();
  expect(
    trades().getByText(/WAL 已扫描 401 条 · 位置 \(4799, 5200\]/),
  ).toBeVisible();
  const history = calls.filter(
    ({ path, query }) =>
      path === '/api/v1/market/trades' &&
      query.get('until') === '2026-11-19T00:00:00.000000000Z',
  );
  expect(history.length).toBeGreaterThan(1);
  expect(new Set(history.map(({ query }) => query.get('through'))).size).toBe(
    1,
  );
  expect(unexpected).toEqual([]);
});

it('uses authorized same-origin streams, exact sequence deltas, watchlist revisions and depth focus writes', async () => {
  const { calls, unexpected } = mockWeb();
  mount('/trading');
  await screen.findByRole('table', { name: '场所订单簿' });
  const socket = MockSocket.opened.at(-1)!;
  expect(socket.url.pathname).toBe('/api/v1/stream/market');
  expect(socket.url.host).toBe(window.location.host);
  act(() => socket.onopen?.());
  expect(socket.sent).toEqual([
    {
      type: 'subscribe',
      source,
      product,
      channel: 'book',
      instrument_id: instrument,
      after: '3',
    },
  ]);
  act(() =>
    socket.frame({
      ...rows[3].event,
      kind: 'delta',
      seq: (BigInt(epoch) + 5n).toString(),
      payload: {
        updates: [{ side: 'bid', price, quantity: '7.00000000000001' }],
      },
    }),
  );
  expect(depth().getByText('7.00000000000001')).toBeVisible();

  const save = screen.getByRole('button', { name: '保存到自选' });
  fireEvent.click(save);
  expect(await screen.findByRole('button', { name: '移出自选' })).toBeVisible();
  const watchPut = calls.find(
    ({ request, path }) =>
      request.method === 'PUT' && path === '/api/v1/watchlists/default',
  );
  expect(watchPut?.request.headers.get('X-CSRF-Token')).toBe('fixture-csrf');

  expect(await screen.findByText('Web 订阅 1/8 · 可用 7')).toBeVisible();
  expect(screen.getByText('券商线路额度待接入')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '设为深度焦点' }));
  expect(await screen.findByText('当前焦点 ' + instrument)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '清除深度焦点' }));
  expect(await screen.findByText('当前焦点 未设置')).toBeVisible();

  const events = MockEvents.opened.at(-1)!;
  expect(events.url).toBe('/api/v1/events');
  const bookReads = calls.filter(
    ({ path }) => path === '/api/v1/market/book',
  ).length;
  act(() =>
    events.frame('reset', {
      schema_version: '1.0',
      kind: 'reset',
      reason: 'cursor_unavailable',
    }),
  );
  expect(socket.closed).toBe(true);
  expect(screen.queryByText('7.00000000000001')).toBeNull();
  expect(
    await screen.findByRole('table', { name: '场所订单簿' }),
  ).toBeVisible();
  expect(
    calls.filter(({ path }) => path === '/api/v1/market/book'),
  ).toHaveLength(bookReads + 1);
  const restored = MockSocket.opened.at(-1)!;
  expect(restored).not.toBe(socket);
  act(() =>
    events.frame('permissions', {
      schema_version: '1.0',
      kind: 'permissions',
      state: 'revoked',
      products: [],
    }),
  );
  expect(await screen.findByText('无权读取行情')).toBeVisible();
  expect(screen.queryByRole('table', { name: '场所订单簿' })).toBeNull();
  expect(socket.closed).toBe(true);
  expect(restored.closed).toBe(true);
  expect(events.closed).toBe(true);
  expect(unexpected).toEqual([]);
});

it('clears old levels on disconnect and reopens the selected partition after its exact checkpoint', async () => {
  mockWeb();
  mount('/trading');
  await screen.findByRole('table', { name: '场所订单簿' });
  const first = MockSocket.opened.at(-1)!;
  const after = '9007199254740994';
  act(() => {
    first.frame({ type: 'checkpoint', after });
    first.onclose?.();
  });
  expect(depth().getByText('连接中断')).toBeVisible();
  expect(depth().queryByRole('table')).toBeNull();
  await waitFor(() => expect(MockSocket.opened).toHaveLength(2), {
    timeout: 2000,
  });
  const second = MockSocket.opened.at(-1)!;
  act(() => second.onopen?.());
  expect(second.sent).toEqual([
    {
      type: 'subscribe',
      source,
      product,
      channel: 'book',
      instrument_id: instrument,
      after,
    },
  ]);
});

it('reads F1 perpetual context without a quote and preserves exact fields', async () => {
  const { calls, unexpected } = mockWeb(true, true);
  mount('/trading');
  fireEvent.click(
    await screen.findByRole('button', { name: /^SYNTH-USD-PERP\.SYNTHETIC/ }),
  );
  const summary = within(
    await screen.findByRole('region', { name: '永续合约指标' }),
  );
  for (const value of [price, '0.000000001', '12.0001'])
    expect(summary.getByText(value)).toBeVisible();
  expect(quotes().getByText('暂无最优报价')).toBeVisible();
  expect(
    calls
      .find(({ path }) => path === '/api/v1/market/derivatives')
      ?.query.get('channel'),
  ).toBe('perpetual_context');
  expect(unexpected).toEqual([]);
});

it('does not open W2a reads or streams for anonymous sessions', async () => {
  const { calls, unexpected } = mockWeb(false);
  mount('/trading');
  expect(
    await screen.findByRole('button', { name: '建立管理员会话' }),
  ).toBeVisible();
  expect(calls.map(({ path }) => path)).toEqual(['/api/v1/me/capabilities']);
  expect(MockSocket.opened).toEqual([]);
  expect(MockEvents.opened).toEqual([]);
  expect(unexpected).toEqual([]);
});

it('shows the W2a option contract pending response and keeps replay explicit', async () => {
  const { unexpected } = mockWeb();
  const page = mount('/options/flow');
  expect(await screen.findByText('finance_contract_pending')).toBeVisible();
  expect(screen.queryByText('Fixture · 示例数据')).toBeNull();
  page.unmount();
  mount('/options/flow?market=replay');
  expect(await screen.findByText('Fixture · 示例数据')).toBeVisible();
  expect(unexpected).toEqual([]);
});
