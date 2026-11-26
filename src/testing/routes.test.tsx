import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    'opens %s with Tab and Enter and shows its planned issue',
    async (path, label, issue) => {
      const http = vi.fn();
      vi.stubGlobal('fetch', http);
      const user = userEvent.setup();
      mount('/blog');

      const nav = screen.getByRole('navigation', { name: '主导航' });
      const link = within(nav).getByRole('link', { name: label });
      expect(link).toHaveAttribute('href', path);
      const links = within(nav).getAllByRole('link');
      const tabStops = [
        screen.getByRole('link', { name: '跳至主要内容' }),
        screen.getByRole('link', { name: 'Fertile 工作台首页' }),
        ...links.slice(0, links.indexOf(link) + 1),
      ];
      for (const stop of tabStops) {
        await user.tab();
        expect(stop).toHaveFocus();
      }
      expect(link).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(screen.getByLabelText('当前地址').textContent).toBe(path);
      expect(link).toHaveAttribute('aria-current', 'page');
      expect(
        screen.getByRole('heading', { name: label, level: 1 }),
      ).toBeVisible();
      expect(screen.getByText(new RegExp(`后续 ${issue}`))).toBeVisible();
      expect(http).not.toHaveBeenCalled();
    },
  );

  it('applies a visible outline to a focused masthead link', () => {
    const { container } = mount('/blog');
    const link = container.querySelector<HTMLAnchorElement>(
      '.navigation a[href="/dashboard"]',
    );
    if (!link) throw new Error('Expected a dashboard link in the masthead');

    link.focus();
    const stylesheet = document.createElement('style');
    const appStyles = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../app/styles.css'),
      'utf8',
    );
    // jsdom does not reliably model keyboard modality. Apply the real focus-visible
    // declarations to :focus so their cascade can be checked on this link.
    stylesheet.textContent = appStyles.replaceAll(':focus-visible', ':focus');
    document.head.append(stylesheet);
    try {
      expect(link).toHaveFocus();
      const style = window.getComputedStyle(link);
      expect(style.outline).toBe('2px solid #f4d5ed');
      expect(style.outlineColor).toBe('var(--accent)');
      expect(style.outlineOffset).toBe('-4px');
    } finally {
      stylesheet.remove();
    }
  });

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

  it.each([404, 503])(
    'shows an error for system status HTTP %s and an empty sample on its 404',
    async (status) => {
      vi.stubGlobal('fetch', (request: Request) =>
        Promise.resolve(
          Response.json(
            {},
            {
              status: request.url.endsWith('/backtests/sample') ? 404 : status,
            },
          ),
        ),
      );
      mount('/system');
      expect(
        screen.getByRole('heading', { name: '系统', level: 1 }),
      ).toBeVisible();
      const system = within(screen.getByRole('region', { name: '系统状态' }));
      const error = await system.findByRole('alert');
      expect(error).toHaveTextContent('系统状态加载失败');
      expect(error).toHaveTextContent(`HTTP ${status}`);
      const sample = within(screen.getByRole('region', { name: '示例回测' }));
      expect(await sample.findByText('暂无示例回测')).toBeVisible();
      expect(sample.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText(/后续 U2.*分区水位/)).toBeVisible();
    },
  );

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
