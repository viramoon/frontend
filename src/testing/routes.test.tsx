import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../api';
import { AppRoutes } from '../app/routes/AppRoutes';

let client: QueryClient;

function CurrentAddress() {
  const { pathname, search } = useLocation();
  return <output aria-label="当前地址">{pathname + search}</output>;
}

function mount(path: string) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <CurrentAddress />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});

describe('终端路由', () => {
  it('redirects / to /dashboard and retains the same-origin system query', async () => {
    const http = vi.fn<(request: Request) => Promise<Response>>(() =>
      Promise.resolve(Response.json({}, { status: 503 })),
    );
    vi.stubGlobal('fetch', http);
    mount('/');

    expect(screen.getByLabelText('当前地址')).toHaveTextContent('/dashboard');
    expect(
      screen.getByRole('heading', { name: '仪表盘', level: 1 }),
    ).toBeVisible();
    expect(await screen.findByText('状态未能更新')).toBeVisible();
    const requested = http.mock.calls.map(([request]) => new URL(request.url));
    expect(requested.map((url) => url.origin)).toEqual([
      location.origin,
      location.origin,
    ]);
    expect(requested.map((url) => url.pathname).sort()).toEqual([
      '/api/v1/backtests/sample',
      '/api/v1/system/status',
    ]);
  });

  it.each([
    ['/options/flow', '期权流水', 'U2'],
    ['/options/exposure', '期权敞口', 'U2'],
    ['/factors', '因子', 'U3'],
    ['/settings/integrations', '接口设置', 'U4'],
    ['/alerts', '事件', 'U4'],
    ['/settings/notifications', '通知设置', 'U4'],
  ])(
    'opens %s from a keyboard-focusable navigation link with a planned issue',
    (path, label, issue) => {
      const http = vi.fn();
      vi.stubGlobal('fetch', http);
      mount('/blog');

      const nav = screen.getByRole('navigation', { name: '主导航' });
      const link = within(nav).getByRole('link', { name: label });
      expect(link).toHaveAttribute('href', path);
      expect(link.tabIndex).toBe(0);
      act(() => link.focus());
      expect(link).toHaveFocus();
      fireEvent.click(link);
      expect(link).toHaveAttribute('aria-current', 'page');
      expect(
        screen.getByRole('heading', { name: label, level: 1 }),
      ).toBeVisible();
      expect(screen.getByText(new RegExp(`后续 ${issue}`))).toBeVisible();
      expect(http).not.toHaveBeenCalled();
    },
  );

  it('provides the strategy detail route from the strategy list and as a deep link', () => {
    const { unmount } = mount('/strategies');
    expect(
      screen.getByRole('heading', { name: '策略', level: 1 }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: '查看策略详情骨架' }));
    expect(screen.getByLabelText('当前地址')).toHaveTextContent(
      '/strategies/example',
    );
    expect(
      screen.getByRole('heading', { name: '策略详情', level: 1 }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: '返回策略' }));
    expect(
      screen.getByRole('heading', { name: '策略', level: 1 }),
    ).toBeVisible();
    unmount();

    mount('/strategies/sma-review');
    expect(screen.getByText(/sma-review.*U3/)).toBeVisible();
  });

  it('shows the existing system status and identifies the pending data quality section', async () => {
    vi.stubGlobal('fetch', (request: Request) =>
      Promise.resolve(
        Response.json(
          {},
          {
            status: request.url.endsWith('/backtests/sample') ? 404 : 503,
          },
        ),
      ),
    );
    mount('/system');
    expect(
      screen.getByRole('heading', { name: '系统', level: 1 }),
    ).toBeVisible();
    expect(await screen.findByText('系统状态加载失败')).toBeVisible();
    expect(await screen.findByText('暂无示例回测')).toBeVisible();
    expect(screen.getByText(/后续 U2.*分区水位/)).toBeVisible();
  });

  it('keeps /backtests?job=71 at its original address and requests that job', async () => {
    const job: Job = {
      id: 71,
      status: 'failed',
      request: {
        strategy: 'SmaCrossover',
        instrument: 'IBM.XNYS',
        start: '2024-01-02T00:00:00Z',
        end: '2025-12-31T00:00:00Z',
        params: { fast_period: 5, slow_period: 20, shares: 10 },
      },
      attempt: 1,
      created_at: '2026-01-01T00:00:00Z',
      error: 'missing_sessions',
      summary: null,
    };
    const http = vi.fn((request: Request) => {
      const data = request.url.endsWith('/backtests/71')
        ? job
        : { items: [], next_cursor: null };
      return Promise.resolve(Response.json(data));
    });
    vi.stubGlobal('fetch', http);
    mount('/backtests?job=71');

    expect(screen.getByLabelText('当前地址')).toHaveTextContent(
      '/backtests?job=71',
    );
    expect(
      screen.getByRole('heading', { name: '回测', level: 1 }),
    ).toBeVisible();
    expect(await screen.findByText(/日期范围内缺失交易日数据/)).toBeVisible();
    expect(
      http.mock.calls.some(
        ([request]) => new URL(request.url).pathname === '/api/v1/backtests/71',
      ),
    ).toBe(true);
  });
});
