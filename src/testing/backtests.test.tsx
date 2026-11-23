import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dataset, Job, JobRequest } from '../api';
import { Backtests } from '../features/backtest/Backtests';

const dataset: Dataset = {
  instrument: 'IBM.XNYS',
  source: 'UI fixture',
  source_sha256: 'f'.repeat(64),
  asset_type: 'stock',
  data_kind: 'fixture',
  calendar: 'XNYS',
  first_session: '2024-01-02',
  last_session: '2025-12-31',
  observations: 502,
  price_basis: 'raw_unadjusted',
  corporate_actions: 'cash_dividends_excluded_split_free_reviewed',
};

const params: JobRequest = {
  strategy: 'SmaCrossover',
  instrument: 'IBM.XNYS',
  start: '2024-01-02T00:00:00Z',
  end: '2025-12-31T00:00:00Z',
  params: { fast_period: 5, slow_period: 20, shares: 10 },
};

const testToken = 'volatile-test-token';
const prefix = '/api/v1/backtests';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mount(url = '/backtests') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Backtests />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setup(handler: (request: Request) => Promise<Response> | Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn((raw: Request) => handler(raw)),
  );
}

async function setInput() {
  await screen.findByRole('option', { name: /IBM.XNYS/ });
  fireEvent.change(screen.getByLabelText('历史标的'), {
    target: { value: dataset.instrument },
  });
  fireEvent.change(screen.getByLabelText('回测提交令牌'), {
    target: { value: testToken },
  });
}

function job(
  status: Job['status'] = 'queued',
  error: Job['error'] = null,
): Job {
  return {
    id: 71,
    status,
    request: params,
    attempt: 1,
    created_at: '2026-01-01T00:00:00Z',
    error,
    summary: null,
  };
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('historical backtests', () => {
  it('shows an empty catalog and queue with submission disabled', async () => {
    setup(() => json({ items: [] }));
    mount();
    await screen.findByText('暂无历史数据。请管理员先导入经过审核的日线。');
    await screen.findByText('暂无作业。');
    expect(
      (screen.getByRole('button', { name: '提交回测' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('validates parameters before sending a request and renders worker failures', async () => {
    let posts = 0;
    setup((request) => {
      const path = new URL(request.url).pathname;
      if (request.method === 'POST') posts += 1;
      if (path === prefix + '/datasets') return json({ items: [dataset] });
      if (path === prefix + '/71')
        return json(job('failed', 'missing_sessions'));
      return json({ items: [job('failed')], next_cursor: null });
    });
    mount('/backtests?job=71');
    await setInput();
    fireEvent.change(screen.getByLabelText('快线天数'), {
      target: { value: '21' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交回测' }));
    await screen.findByText(/请输入整数参数/);
    await screen.findByText(/日期范围内缺失交易日数据/);
    expect(posts).toBe(0);
  });

  it('looks up an accepted job after a timeout without sending another POST', async () => {
    const mutations: string[] = [];
    let key: string | null = null;
    setup(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === prefix + '/datasets') return json({ items: [dataset] });
      if (path === prefix + '/71') return json(job());
      if (request.method === 'POST') {
        key = request.headers.get('Idempotency-Key');
        expect(key).toBeTruthy();
        expect(request.headers.get('Authorization')).toBe(
          'Bearer ' + testToken,
        );
        expect(await request.json()).toEqual(params);
        mutations.push('POST');
        return json({ error: { code: 'finance_timeout' } }, 504);
      }
      if (path === prefix + '/by-key') {
        expect(request.headers.get('Idempotency-Key')).toBe(key);
        expect(request.headers.get('Authorization')).toBe(
          'Bearer ' + testToken,
        );
        mutations.push('LOOKUP');
        return json({ id: 71 });
      }
      return json({ items: [], next_cursor: null });
    });
    mount();
    await setInput();
    fireEvent.click(screen.getByRole('button', { name: '提交回测' }));
    await screen.findByText('排队中');
    expect(mutations).toEqual(['POST', 'LOOKUP']);
    expect(
      (screen.getByLabelText('回测提交令牌') as HTMLInputElement).value,
    ).toBe('');
    expect(sessionStorage.length).toBe(0);
  });

  it('restores an uncertain submission and retries the same key only after a confirmed miss', async () => {
    const mutations: Array<{ method: string; key: string | null }> = [];
    let online = false;
    setup((request) => {
      const path = new URL(request.url).pathname;
      if (path === prefix + '/datasets') return json({ items: [dataset] });
      if (path === prefix + '/71') return json(job('timed_out', 'job_timeout'));
      if (request.method === 'POST' || path === prefix + '/by-key') {
        mutations.push({
          method: request.method,
          key: request.headers.get('Idempotency-Key'),
        });
        if (!online) throw new TypeError('offline');
        if (request.method === 'POST') return json({ id: 71 }, 202);
        return json({ error: { code: 'job_not_found' } }, 404);
      }
      return json({ items: [], next_cursor: null });
    });
    const first = mount();
    await setInput();
    fireEvent.click(screen.getByRole('button', { name: '提交回测' }));
    await screen.findByText(/无法确认原提交/);
    expect(sessionStorage.getItem('fertile.pending-backtest')).not.toContain(
      testToken,
    );
    expect(screen.queryByRole('button', { name: '用原参数重试' })).toBeNull();
    first.unmount();
    online = true;
    mount();
    fireEvent.change(screen.getByLabelText('回测提交令牌'), {
      target: { value: testToken },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询原提交' }));
    fireEvent.click(
      await screen.findByRole('button', { name: '用原参数重试' }),
    );
    await screen.findByText('作业超过执行时限。');
    expect(mutations.map(({ method }) => method)).toEqual([
      'POST',
      'GET',
      'GET',
      'GET',
      'POST',
    ]);
    expect(new Set(mutations.map(({ key }) => key)).size).toBe(1);
    await waitFor(() => expect(sessionStorage.length).toBe(0));
  });
});
