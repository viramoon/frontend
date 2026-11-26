import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dataset, Job, JobRequest, ResearchReport } from '../api';
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
    const cookies: Array<string | null> = [];
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
        cookies.push(request.headers.get('Cookie'));
        expect(await request.json()).toEqual(params);
        mutations.push('POST');
        return json({ error: { code: 'finance_timeout' } }, 504);
      }
      if (path === prefix + '/by-key') {
        expect(request.headers.get('Idempotency-Key')).toBe(key);
        expect(request.headers.get('Authorization')).toBe(
          'Bearer ' + testToken,
        );
        cookies.push(request.headers.get('Cookie'));
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
    expect(cookies).toEqual([null, null]);
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

function showResearch(overrides: Partial<ResearchReport>) {
  const result: Job = {
    ...job('succeeded'),
    summary: {
      run_id: 'research-71',
      strategy: params.strategy,
      instrument: params.instrument,
      start: params.start,
      end: params.end,
      total_orders: 0,
      total_positions: 0,
      pnl: '0.00',
      currency: 'USD',
      generated_at: '2026-01-01T00:00:00Z',
      research: {
        dataset,
        requested_start: '2024-01-02',
        requested_end: '2025-12-31',
        actual_start: '2024-01-02',
        actual_end: '2025-12-31',
        observations: 502,
        warmup_sessions: 20,
        performance_start: '2024-01-31',
        initial_equity: '10000.00',
        ending_equity: '10000.00',
        commission_per_order: '0.00',
        slippage_bps: 0,
        risk_free_rate: '0',
        execution: 'next_session_close',
        windows: [],
        audit: {
          fills: 0,
          zero_volume_bars: 0,
          blocked_zero_volume: 0,
          blocked_insufficient_volume: 0,
          blocked_insufficient_cash: 0,
          recent_fills: [],
          recent_blocked: [],
        },
        ...overrides,
      },
    },
  };
  setup((request) => {
    const path = new URL(request.url).pathname;
    if (path === prefix + '/datasets') return json({ items: [dataset] });
    if (path === prefix + '/71') return json(result);
    return json({ items: [result] });
  });
  mount('/backtests?job=71');
}

describe('research results', () => {
  it.each([null, { return_pct: '9.8765', max_drawdown_pct: '1.2345' }])(
    'shows insufficient window coverage and suppresses its metrics (%j)',
    async (metrics) => {
      showResearch({
        windows: [
          {
            window: '50y',
            label: '50y (insufficient)',
            coverage: 'insufficient',
            coverage_reason: 'calendar_out_of_range',
            requested_start: '1975-12-31',
            actual_start: '2024-01-31',
            actual_end: '2025-12-31',
            observations: 482,
            metrics,
          },
        ],
      });
      const row = within(
        await screen.findByRole('row', {
          name: /50y \(insufficient\) · 覆盖不足/,
        }),
      );
      row.getByText('请求起点 1975-12-31');
      row.getByText('2024-01-31 至 2025-12-31');
      row.getByText('实际观测 482 个交易日');
      row.getByText('请求区间超出交易日历支持范围');
      expect(row.getAllByText('不可用')).toHaveLength(2);
      expect(row.queryByText('9.8765%')).toBeNull();
      expect(row.queryByText('0%')).toBeNull();
    },
  );

  it('explains null overall and full-window metrics and shows calendar diagnostics', async () => {
    const diagnostic = 'XNYS 1975-12-31 to 2025-12-31: ValueError';
    showResearch({
      metrics: null,
      windows: [
        {
          requested_years: 5,
          coverage: 'full',
          metrics: null,
          actual_end: '2025-12-31',
          observations: 482,
          missing_sessions: 0,
        },
        {
          requested_years: 50,
          coverage: 'insufficient',
          coverage_reason: 'calendar_unavailable',
          calendar_diagnostic: diagnostic,
          expected_sessions: null,
          missing_sessions: null,
          observations: 0,
          metrics: null,
        },
      ],
    });
    await screen.findByText('服务未提供整体绩效指标。');
    for (const label of ['净值变动', '最大回撤']) {
      const term = screen.getByText(label, { selector: 'dt' });
      expect(term.nextElementSibling?.textContent).toBe('不可用');
    }
    const full = within(screen.getByRole('row', { name: /5 年 · 覆盖完整/ }));
    full.getByText('不可用');
    full.getByText('服务未提供窗口指标');
    full.getByText('终点 2025-12-31');
    full.getByText('0 / 未提供');
    const insufficient = within(
      screen.getByRole('row', { name: /50 年 · 覆盖不足/ }),
    );
    insufficient.getByText('实际观测 0 个交易日');
    insufficient.getByText('交易日历不可用');
    insufficient.getByText(diagnostic);
  });

  it('shows longest sample details and preserves decimal text', async () => {
    const precise = '12.345678901234567890123456';
    const zero = '0.0000';
    showResearch({
      metrics: { return_pct: precise, max_drawdown_pct: zero },
      windows: [
        {
          window: 'longest_sample',
          label: 'longest_sample',
          requested_years: null,
          coverage: 'full',
          actual_years: '1.9167',
          calendar_start: '2024-01-31',
          calendar_end: '2025-12-31',
          expected_sessions: 482,
          missing_sessions: 0,
          missing_pct: zero,
          rf_source: 'rf=0',
          metrics: { return_pct: precise, max_drawdown_pct: zero },
        },
      ],
    });
    const row = within(
      await screen.findByRole('row', { name: /最长样本 · 覆盖完整/ }),
    );
    row.getByText(`${precise}%`);
    row.getByText('0 / 482');
    row.getByText('缺失 0.0000%');
    row.getByText('约 1.9167 年');
    row.getByText('统计日历 2024-01-31 至 2025-12-31');
    row.getByText('无风险利率来源 rf=0');
    expect(screen.getAllByText(`${precise}%`)).toHaveLength(2);
    screen.getByText('0.0000%');
  });

  it('handles omitted fields and falls back to legacy window years', async () => {
    showResearch({
      windows: [
        { requested_years: 10, coverage: 'insufficient' },
        { coverage: 'full' },
      ],
    });
    await screen.findByText('服务未提供整体绩效指标。');
    const legacy = within(
      screen.getByRole('row', { name: /10 年 · 覆盖不足/ }),
    );
    legacy.getByText('日期未提供');
    legacy.getByText('样本未满足窗口覆盖要求');
    expect(legacy.getAllByText('不可用')).toHaveLength(2);
    expect(legacy.queryByText(/实际观测|请求起点|统计日历/)).toBeNull();
    const minimal = within(
      screen.getByRole('row', { name: /窗口 · 覆盖完整/ }),
    );
    minimal.getByText('服务未提供窗口指标');
    expect(minimal.getAllByText('不可用')).toHaveLength(2);
  });
});
