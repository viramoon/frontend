import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BacktestSummary, SystemStatus } from '../api/generated/types.gen';
import { AppRoutes } from '../app/routes/AppRoutes';

const statusPath = '/api/v1/system/status';
const samplePath = '/api/v1/backtests/sample';
const pnl = '12345678901234567890.12345678';
const status = {
  web: {
    version: '0.0.0',
    commit: 'b73e2c9',
    started_at: '2026-11-02T14:00:00Z',
  },
  database: { ok: true, latency_ms: 17 },
  finance: { ok: false, latency_ms: 29, circuit: 'half_open' },
  market: {
    state: 'degraded',
    source: 'ib-delayed',
    fresh: false,
    instrument_count: 2,
    stale_count: 1,
    updated_at: '2026-11-02T15:30:00Z',
  },
  notifications: { state: 'idle' },
} satisfies SystemStatus;
const sample = {
  run_id: 'sample-run-101',
  strategy: 'DemoStrategy',
  instrument: 'SPY.ARCA',
  start: '2026-11-02T14:30:00Z',
  end: '2026-11-02T15:30:00Z',
  total_orders: 21,
  total_positions: 4,
  pnl,
  currency: 'USD',
  generated_at: '2026-11-02T15:30:01Z',
} satisfies BacktestSummary;

let queryClient: QueryClient;

function mount(path = '/dashboard') {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes marketReplay />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.unstubAllGlobals();
});

type Reply = { status?: number; json: unknown };

function mockWeb(replies: Record<string, Reply>, wait?: Promise<void>) {
  const requests: string[] = [];
  const http: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    requests.push(`${req.method} ${url.origin}${url.pathname}`);
    if (wait) await wait;
    const reply = replies[url.pathname];
    if (!reply) throw new Error(`Unexpected API route ${url.pathname}`);
    return Response.json(reply.json, { status: reply.status ?? 200 });
  };
  vi.stubGlobal('fetch', http);
  return requests;
}

const failure = {
  status: 503,
  json: { error: { code: 'finance_unavailable', message: 'Unavailable' } },
};
const healthy = {
  [statusPath]: { json: status },
  [samplePath]: { json: sample },
};

describe('仪表盘', () => {
  it('keeps both loading states visible, then renders actual service and exact money values', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests = mockWeb(healthy, pending);
    mount();

    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getByText(/正在加载系统状态/)).toBeVisible();
    expect(screen.getByText(/正在加载示例回测/)).toBeVisible();
    await act(async () => {
      release();
    });
    expect(await screen.findByText(pnl)).toBeVisible();
    for (const name of ['Web 服务', '数据库', 'Finance 服务', '行情采集']) {
      expect(screen.getByRole('heading', { name })).toBeVisible();
    }
    for (const value of [
      status.web.commit,
      status.web.version,
      '17 ms',
      '29 ms',
      '可用',
      '不可用',
      'half_open',
      'ib-delayed',
      '2 / 1',
      '待恢复',
      sample.strategy,
      sample.instrument,
      sample.currency,
    ]) {
      expect(screen.getByText(value)).toBeVisible();
    }
    expect(screen.queryByText(/正在加载/)).not.toBeInTheDocument();
    expect(requests.sort()).toEqual(
      [samplePath, statusPath].sort().map((p) => `GET ${location.origin}${p}`),
    );
  });

  it('shows independent failures for the status and sample calls', async () => {
    mockWeb({ [statusPath]: failure, [samplePath]: failure });
    mount();
    expect(await screen.findByText(/系统状态加载失败/)).toBeVisible();
    expect(await screen.findByText(/示例回测加载失败/)).toBeVisible();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.queryByText(/暂无示例回测/)).not.toBeInTheDocument();
    expect(screen.queryByText(pnl)).not.toBeInTheDocument();
  });

  it('keeps the sample visible when only the system status service fails', async () => {
    mockWeb({ [statusPath]: failure, [samplePath]: healthy[samplePath] });
    mount();
    expect(await screen.findByText(/系统状态加载失败/)).toBeVisible();
    expect(await screen.findByText(pnl)).toBeVisible();
    expect(screen.queryByText(/示例回测加载失败/)).not.toBeInTheDocument();
  });

  it('renders an empty sample on 404 alongside the successful system status', async () => {
    mockWeb({
      [statusPath]: { json: status },
      [samplePath]: {
        status: 404,
        json: { error: { code: 'not_found', message: 'No sample' } },
      },
    });
    mount();
    expect(await screen.findByText(/暂无示例回测/)).toBeVisible();
    expect(
      await screen.findByText('ib-delayed', { exact: false }),
    ).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('navigates to all four pages through the application links', async () => {
    mockWeb(healthy);
    mount('/trading');
    for (const [name, path] of [
      ['交易', '/trading'],
      ['回测', '/backtests'],
      ['仪表盘', '/dashboard'],
      ['博客', '/blog'],
    ]) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('href', path);
      fireEvent.click(link);
      await waitFor(() =>
        expect(screen.getByRole('heading', { name, level: 1 })).toBeVisible(),
      );
    }
  });
});
