import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  BacktestSummary,
  FactorEvaluationItem,
  FactorReadItem,
  StrategyBundlePreview,
} from '../api/generated/types.gen';
import { AppRoutes } from '../app/routes/AppRoutes';
import { bundles, datasets } from '../features/research/fixtures/catalog';

const root = '/api/v1';
const revision = {
  id: 'synthetic.one',
  version: '1.0.0',
  content_sha256: 'a'.repeat(64),
};
const bars = {
  id: 'example.bars@1.0.0',
  calendar: 'XNYS',
  currency: 'USD',
  asset: 'cash_equity',
  available_at: 'session_close',
  price_basis: 'raw_split_free_reviewed',
  timeframe: '1d',
} as const;
const universe = { ...bars, id: 'example.universe@1.0.0', point_in_time: true };
const exact = '9007199254740993.0123456789';
const preview = {
  strategy: revision,
  plan: {
    bundle: {
      spec: {
        engine: 'nautilus_cash_equity',
        clock: {
          warmup_sessions: 20,
          decide_on: 'session_close',
          earliest_fill: 'next_session_close',
        },
        portfolio: { initial_cash: { amount: exact, currency: 'USD' } },
        execution: { commission_bps: '1.25', slippage_bps: '2.75' },
      },
    },
    conflict_rules: {
      decision_snapshot: 'synthetic',
      duplicate_intents: 'synthetic',
      equal_priority: 'synthetic',
      missing_input: 'synthetic',
      on_entry_exit_collision: 'exit_first',
      on_missing_execution_price: 'synthetic',
      phase_order: [],
      position_change_order: [],
      priority: 'synthetic',
      same_session_reentry: false,
      sleeve_accounting: 'synthetic',
      target_constraints_order: [],
      whole_lot_remainder_order: [],
    },
    content_sha256: revision.content_sha256,
    source_sha256: 'b'.repeat(64),
    execution: 'execution.next_close_cash_equity@1.0.0',
    plan_version: 'fertile.finance/compiled-plan/v1',
    inputs: { bars, universe },
    modules: [],
    factors: [
      {
        available_at: 'session_close',
        component: 'factor.synthetic@1.0.0',
        depends_on: [],
        kind: 'factor',
        local_id: 'synthetic',
        warmup_sessions: 20,
      },
    ],
    sleeves: [
      { budget_weight: '0.125', priority: 2, recipe: 'example-recipe' },
    ],
  },
} satisfies StrategyBundlePreview;

const start = '2026-11-10T00:00:00Z';
const end = '2026-11-15T00:00:00Z';
const bundleRequest = {
  strategy: 'StrategyBundle',
  source: { kind: 'registered', id: revision.id, version: revision.version },
  start,
  end,
  content_sha256: revision.content_sha256,
};
const jobId = '9007199254740993';
const queueJob = {
  request: bundleRequest,
  attempt: 1,
  created_at: start,
  status: 'queued',
};
const summary: BacktestSummary = {
  run_id: 'synthetic-summary',
  strategy: 'StrategyBundle',
  instrument: 'PORTFOLIO',
  start,
  end,
  currency: 'USD',
  pnl: '0.01',
  generated_at: end,
  total_orders: 1,
  total_positions: 1,
  run_manifest: {
    plan_version: preview.plan.plan_version,
    engine: { id: 'nautilus_cash_equity' },
    data: {
      snapshot_sha256: 'c'.repeat(64),
      bars_ref: bars.id,
      universe_ref: universe.id,
      price_basis: bars.price_basis,
    },
    interval: { warmup_sessions: 20 },
    calendar: { id: 'XNYS', timezone: 'America/New_York' },
    costs: { commission_bps: '1.25', slippage_bps: '2.75' },
  },
  strategy_report: {
    pnl_as_of: '2026-11-12',
    equity: { '2026-11-12': exact },
    fills: [
      {
        instrument_id: 'SYN.XNYS',
        fill_date: '2026-11-12',
        side: 'buy',
        quantity: '0.000000123456789',
        price: '123.04000000123',
        commission: '0.010000000001',
      },
    ],
  },
};

function rawJson(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
const failure = (status: number, code: string) =>
  Response.json({ error: { code, message: code } }, { status });

const clients: QueryClient[] = [];
function mount(
  path: string,
  mock: (req: Request, url: URL) => Response | Promise<Response>,
  admin = true,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  const unexpected: string[] = [];
  const fetch = vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    expect(url.origin).toBe(location.origin);
    if (url.pathname === root + '/me/capabilities') {
      return Response.json(
        admin
          ? {
              subject: 'admin',
              products: ['strategy_research', 'backtest_submission'],
              csrf_token: 'synthetic-csrf',
            }
          : { subject: 'anonymous', products: ['backtests'] },
      );
    }
    try {
      return await mock(request, url);
    } catch (error) {
      unexpected.push(url.pathname);
      throw error;
    }
  });
  vi.stubGlobal('fetch', fetch);
  return {
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
    fetch,
    unexpected,
  };
}

async function upload(
  user: ReturnType<typeof userEvent.setup>,
  content = bundles[0].yaml,
) {
  await user.upload(
    await screen.findByLabelText('上传 YAML'),
    new File([content], 'synthetic.yaml', { type: 'application/yaml' }),
  );
  await user.click(screen.getByRole('button', { name: '校验并预览文件' }));
}

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

it.each([
  { entry: 'registered', retry: false },
  { entry: 'registered', retry: true },
  { entry: 'upload', retry: false },
])(
  'submits from the $entry preview and keeps the exact job after timeout (same-key retry: $retry)',
  async ({ entry, retry }) => {
    let registered = false;
    let key = '';
    let posts = 0;
    let lookups = 0;
    let registeredReads = 0;
    const user = userEvent.setup();
    const { unexpected } = mount('/strategies', async (request, url) => {
      switch (url.pathname.slice(root.length)) {
        case '/strategies':
          if (request.method === 'GET')
            return Response.json({ items: registered ? [revision] : [] });
          expect(request.headers.get('X-CSRF-Token')).toBe('synthetic-csrf');
          expect(await request.json()).toEqual({
            format: 'yaml',
            content: bundles[0].yaml,
          });
          registered = true;
          return Response.json(revision);
        case '/strategies/validate':
          expect(request.headers.get('Origin')).toBe(location.origin);
          expect(request.headers.get('X-CSRF-Token')).toBe('synthetic-csrf');
          expect(await request.json()).toEqual({
            format: 'yaml',
            content: bundles[0].yaml,
          });
          return Response.json(preview);
        case `/strategies/${revision.id}/versions/${revision.version}`:
          registeredReads += 1;
          return Response.json(preview);
        case '/backtests': {
          if (request.method === 'GET')
            return rawJson(
              `{"items":[{"id":${jobId},${JSON.stringify(queueJob).slice(1)}]}`,
            );
          expect(request.headers.get('X-CSRF-Token')).toBe('synthetic-csrf');
          expect(await request.json()).toEqual({
            strategy: 'StrategyBundle',
            source: bundleRequest.source,
            start,
            end,
          });
          const actualKey = request.headers.get('Idempotency-Key');
          if (++posts === 1) {
            key = actualKey ?? '';
            expect(key).toMatch(/^[\da-f-]{36}$/);
            return failure(504, 'finance_timeout');
          }
          expect(retry).toBe(true);
          expect(actualKey).toBe(key);
          return rawJson(`{"id":${jobId}}`, 202);
        }
        case '/backtests/by-key':
          expect(request.headers.get('Idempotency-Key')).toBe(key);
          lookups += 1;
          return retry
            ? failure(404, 'job_not_found')
            : rawJson(`{"id":${jobId}}`);
        case `/backtests/${jobId}`:
          return rawJson(
            `{"id":${jobId},${JSON.stringify({ ...queueJob, status: 'succeeded', summary }).slice(1)}`,
          );
        default:
          throw new Error('Unexpected research request');
      }
    });
    await upload(user);
    const uploaded = await screen.findByRole('region', { name: '编译预览' });
    const plan = uploaded.textContent;
    expect(uploaded).toHaveTextContent(exact);
    expect(uploaded).toHaveTextContent('example-recipe');
    expect(screen.queryByRole('button', { name: '提交配置回测' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '登记已校验的版本' }));
    expect(await screen.findByText('策略版本已登记。')).toBeVisible();
    if (entry === 'registered') {
      const select = screen.getByRole('button', { name: '预览登记版本' });
      await waitFor(() => expect(select).toBeEnabled());
      await user.click(select);
    }
    expect(
      await screen.findByRole('region', { name: '编译预览' }),
    ).toHaveTextContent(plan ?? '');
    fireEvent.change(screen.getByLabelText('开始日（UTC）'), {
      target: { value: start.slice(0, 10) },
    });
    fireEvent.change(screen.getByLabelText('结束日（UTC，不含）'), {
      target: { value: end.slice(0, 10) },
    });
    await user.click(screen.getByRole('button', { name: '提交配置回测' }));
    if (retry)
      await user.click(
        await screen.findByRole('button', { name: '用原参数重试' }),
      );
    const detail = await screen.findByRole('region', {
      name: `配置作业 ${jobId}`,
    });
    expect(await within(detail).findByText(exact)).toBeVisible();
    expect(within(detail).getByText('c'.repeat(64))).toBeVisible();
    expect(within(detail).getByText('123.04000000123')).toBeVisible();
    expect(within(detail).getByText('0.000000123456789')).toBeVisible();
    expect(
      sessionStorage.getItem('fertile.pending-strategy-run.v1.web'),
    ).toBeNull();
    expect(registeredReads).toBe(entry === 'registered' ? 1 : 0);
    expect(posts).toBe(retry ? 2 : 1);
    expect(lookups).toBe(retry ? 2 : 1);
    expect(unexpected).toEqual([]);
  },
);

it('blocks submission when registration returns a different hash for the uploaded version', async () => {
  const user = userEvent.setup();
  const { fetch, unexpected } = mount('/strategies', async (request, url) => {
    if (url.pathname === root + '/strategies/validate') {
      return Response.json(preview);
    }
    if (url.pathname === root + '/strategies') {
      if (request.method === 'GET') return Response.json({ items: [] });
      expect(await request.json()).toEqual({
        format: 'yaml',
        content: bundles[0].yaml,
      });
      return Response.json({ ...revision, content_sha256: 'd'.repeat(64) });
    }
    throw new Error('Unexpected request after mismatched registration');
  });
  await upload(user);
  const uploaded = await screen.findByRole('region', { name: '编译预览' });
  expect(uploaded).toHaveTextContent(revision.content_sha256);
  expect(screen.queryByRole('button', { name: '提交配置回测' })).toBeNull();

  await user.click(screen.getByRole('button', { name: '登记已校验的版本' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '登记结果与编译预览不一致，请重新校验。',
  );
  expect(screen.queryByRole('region', { name: '编译预览' })).toBeNull();
  expect(screen.queryByRole('button', { name: '提交配置回测' })).toBeNull();
  expect(screen.getByRole('button', { name: '校验并预览文件' })).toBeEnabled();
  expect(
    fetch.mock.calls.some(
      ([request]) => new URL(request.url).pathname === root + '/backtests',
    ),
  ).toBe(false);
  expect(unexpected).toEqual([]);
});

it('displays compiler line and column, then separately reports upstream errors and pending', async () => {
  let calls = 0;
  const user = userEvent.setup();
  const { unexpected } = mount('/strategies', (request, url) => {
    if (url.pathname === root + '/strategies' && request.method === 'GET')
      return Response.json({ items: [] });
    if (url.pathname !== root + '/strategies/validate')
      throw new Error('Unexpected validation request');
    calls += 1;
    if (calls === 1)
      return Response.json(
        {
          error: {
            code: 'FUTURE_DATA',
            message: 'synthetic compiler error',
            path: '/spec/data/bars',
            location: { line: 11, column: 13 },
          },
        },
        { status: 422 },
      );
    return calls === 2
      ? failure(502, 'finance_upstream_error')
      : failure(503, 'finance_contract_pending');
  });
  await upload(user);
  expect(
    await screen.findByText('第 11 行，第 13 列 · FUTURE_DATA'),
  ).toBeVisible();
  expect(screen.getByText('/spec/data/bars')).toBeVisible();
  expect(screen.queryByRole('button', { name: '提交配置回测' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '校验并预览文件' }));
  expect(
    await screen.findByText('HTTP 502 · finance_upstream_error'),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: '校验并预览文件' }));
  expect(
    await screen.findByText('待接入 · finance_contract_pending'),
  ).toBeVisible();
  expect(unexpected).toEqual([]);
});

it('reads factor definitions, evaluation detail, exact metrics, and missing values', async () => {
  const access = {
    derive_non_display: true,
    license: 'synthetic',
    record_local: false,
    redistribute: false,
  };
  const factor = {
    access,
    factor_id: 'factor.synthetic',
    version: '1.0.0',
    state: 'backtest_selectable',
    selectable_for_backtest: true,
    tradable: false,
    details: {
      kind: 'factor',
      asset_scope: ['cash_equity'],
      availability_rule: 'session_close',
      data_version: 'synthetic-bars',
      definition: '合成因子定义',
      history: [],
      missing_policy: 'skip',
      parameters: {},
      unit: 'ratio',
      warmup_sessions: '20',
    },
  } satisfies FactorReadItem;
  const portfolio = {
    periods: 2,
    gross_observations: 2,
    net_observations: 2,
    turnover_observations: 2,
    cumulative_gross_return: '0.100000000012345',
    cumulative_net_return: '0.099999999912345',
    total_turnover: '0.00000000012345',
  };
  const evaluation = {
    access,
    cost_bps: '1.25',
    data_version: 'synthetic-bars',
    evaluation_id: 'evaluation-one',
    factor_id: factor.factor_id,
    peer_factors: [],
    quantile_count: 1,
    version: factor.version,
    windows: [
      {
        window: {
          name: 'validation',
          phase: 'validation',
          start: '2026-11-10',
          end: '2026-11-14',
        },
        factor_coverage: '0.75',
        scored_coverage: '0.62500000001',
        ic: { '5': { count: 2, mean: '-0.123456789123456', ratio: null } },
        quantiles: [portfolio],
        benchmark: { ...portfolio, cumulative_net_return: '0.05' },
        gross_information: { count: 2 },
        net_information: { count: 2 },
        redundancy: {},
      },
    ],
  } satisfies FactorEvaluationItem;
  const { unexpected } = mount('/factors', (_request, url) => {
    if (url.pathname === root + '/factors')
      return Response.json({ items: [factor] });
    expect(url.searchParams.get('version')).toBe(factor.version);
    if (url.pathname.endsWith('/evaluations'))
      return Response.json({ items: [evaluation] });
    if (url.pathname.endsWith('/evaluation-one'))
      return Response.json({ item: evaluation, as_of: end, schema_version: 1 });
    throw new Error('Unexpected factor request');
  });
  expect(await screen.findByText('合成因子定义')).toBeVisible();
  expect(await screen.findByText('-0.123456789123456')).toBeVisible();
  expect(screen.getByText('0.62500000001')).toBeVisible();
  expect(screen.getByText('0.099999999912345')).toBeVisible();
  expect(screen.getByText('不可用')).toBeVisible();
  expect(unexpected).toEqual([]);
});

it('keeps anonymous research private and passes the raw int64 cursor into the next public page and old deep link', async () => {
  const user = userEvent.setup();
  const lastId = '9223372036854775807';
  const legacy = JSON.stringify({
    ...queueJob,
    request: {
      strategy: 'SmaCrossover',
      instrument: 'SYN.XNYS',
      start,
      end,
      params: {},
    },
  }).slice(1);
  const calls: (string | null)[] = [];
  const mock = (request: Request, url: URL) => {
    expect(request.credentials).toBe('omit');
    if (url.pathname === root + '/backtests/datasets')
      return Response.json({ items: [] });
    if (url.pathname === root + '/backtests') {
      const cursor = url.searchParams.get('cursor');
      calls.push(cursor);
      if (cursor === null)
        return rawJson(
          `{"items":[{"id":${jobId},${legacy}],"next_cursor":${jobId}}`,
        );
      expect(cursor).toBe(jobId);
      return rawJson(
        `{"items":[{"id":${lastId},${legacy}],"next_cursor":null}`,
      );
    }
    if (url.pathname === `${root}/backtests/${lastId}`)
      return rawJson(`{"id":${lastId},${legacy}`);
    throw new Error('Unexpected anonymous request');
  };
  const denied = mount('/strategies', mock, false);
  expect(await screen.findByText('此页面需要 web 管理员会话。')).toBeVisible();
  expect(
    denied.fetch.mock.calls.map(([req]) => new URL(req.url).pathname),
  ).toEqual([root + '/me/capabilities']);
  denied.unmount();
  mount(
    '/backtests',
    (request, url) =>
      url.pathname === root + '/backtests/datasets'
        ? Response.json({ items: [] })
        : mock(request, url),
    false,
  );
  expect(await screen.findByText(`#${jobId}`)).toBeVisible();
  await user.click(screen.getByRole('button', { name: '下一页' }));
  await user.click(
    await screen.findByRole('button', { name: new RegExp(lastId) }),
  );
  expect(
    await screen.findByRole('heading', { name: `作业 #${lastId} 结果` }),
  ).toBeVisible();
  expect(calls).toContain(jobId);
  expect(screen.queryByRole('button', { name: '下一页' })).toBeNull();
});

it('opens the original strategy example deep link with the fixture adapter on the default route', async () => {
  const user = userEvent.setup();
  const { fetch } = mount(
    '/strategies/example',
    () => {
      throw new Error('The legacy example is a browser fixture');
    },
    false,
  );

  expect(await screen.findByText('Fixture · 合成示例')).toBeVisible();
  expect(screen.getByRole('heading', { name: '策略详情' })).toBeVisible();
  await user.click(await screen.findByRole('button', { name: '预览登记版本' }));
  expect(
    await screen.findByRole('region', { name: '编译预览' }),
  ).toHaveTextContent(bundles[0].plan.revision.contentSha256);
  expect(fetch).not.toHaveBeenCalled();
});

it('restores a prior session fixture job from its original deep link without web requests', async () => {
  // Match the sessionStorage representation written before W2b became the default.
  sessionStorage.setItem(
    'fertile.fixture-strategy-runs.v1',
    JSON.stringify([
      {
        id: 'fixture-1',
        key: 'synthetic-legacy-job',
        request: {
          revision: bundles[0].plan.revision,
          datasetId: datasets[0].id,
          ...datasets[0].windows[0],
        },
        created: 0,
      },
    ]),
  );
  const { fetch } = mount(
    '/backtests?run=fixture-1',
    () => {
      throw new Error('The legacy fixture job is local to this session');
    },
    false,
  );

  expect(
    await screen.findByRole('heading', { name: '配置作业 fixture-1' }),
  ).toBeVisible();
  expect(
    await screen.findByRole('heading', { name: '运行清单' }),
  ).toBeVisible();
  const ledger = screen.getByRole('region', { name: '模拟成交账本表' });
  expect(within(ledger).getAllByText('SYN.XNYS').length).toBeGreaterThan(0);
  expect(screen.getByText('Fixture · 合成示例')).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
});

it('gives the historical job deep link precedence over a fixture run parameter', async () => {
  const { fetch, unexpected } = mount(
    '/backtests?job=7&run=fixture-1',
    (request, url) => {
      const path = url.pathname.slice(root.length);
      if (path === '/backtests' || path === '/backtests/datasets')
        return Response.json({ items: [] });
      if (path === '/backtests/7') {
        expect(request.credentials).toBe('omit');
        return Response.json({
          ...queueJob,
          id: 7,
          request: {
            strategy: 'SmaCrossover',
            instrument: 'SYN.XNYS',
            start,
            end,
            params: {},
          },
        });
      }
      throw new Error('Unexpected mixed deep link request');
    },
    false,
  );

  const detail = await screen.findByRole('region', { name: '作业 #7 结果' });
  expect(
    await within(detail).findByText(/SYN\.XNYS · SmaCrossover/),
  ).toBeVisible();
  expect(
    fetch.mock.calls.map(([request]) => new URL(request.url).pathname),
  ).toContain(root + '/backtests/7');
  expect(screen.queryByText('Fixture · 合成示例')).toBeNull();
  expect(unexpected).toEqual([]);
});

it('opens the old top-five version when the web catalog contains only a different version, and runs it locally', async () => {
  const user = userEvent.setup();
  const { fetch, unexpected } = mount(
    '/strategies/example.equity-top-five?version=1.0.0',
    (_request, url) => {
      if (url.pathname !== root + '/strategies')
        throw new Error('Unexpected private request from the legacy fixture');
      return Response.json({
        items: [
          { ...revision, id: 'example.equity-top-five', version: '2.0.0' },
        ],
      });
    },
  );

  expect(await screen.findByText('Fixture · 合成示例')).toBeVisible();
  await user.click(await screen.findByRole('button', { name: '预览登记版本' }));
  expect(
    await screen.findByRole('region', { name: '编译预览' }),
  ).toHaveTextContent(bundles[1].plan.revision.contentSha256);
  const submit = await screen.findByRole('button', { name: '运行示例回测' });
  await waitFor(() => expect(submit).toBeEnabled());
  await user.click(submit);
  expect(
    await screen.findByRole('heading', { name: '配置作业 fixture-1' }),
  ).toBeVisible();
  expect(
    fetch.mock.calls.map(([request]) => [
      request.method,
      new URL(request.url).pathname,
    ]),
  ).toEqual([
    ['GET', root + '/me/capabilities'],
    ['GET', root + '/strategies'],
  ]);
  expect(unexpected).toEqual([]);
});

it.each([false, true])(
  'opens the original read-only research version with a local fixture (admin: %s)',
  async (admin) => {
    const { fetch, unexpected } = mount(
      '/strategies/research.factor-momentum?version=1.0.0',
      (_request, url) => {
        if (url.pathname === root + '/strategies')
          return Response.json({ items: [] });
        throw new Error('Unexpected research request');
      },
      admin,
    );

    expect(
      await screen.findByRole('heading', { name: '月频因子动量' }),
    ).toBeVisible();
    expect(screen.getByText('Fixture · 合成示例')).toBeVisible();
    expect(screen.getByText('研究专用 · 只读')).toBeVisible();
    expect(screen.queryByRole('button', { name: '预览登记版本' })).toBeNull();
    expect(
      fetch.mock.calls.map(([request]) => new URL(request.url).pathname),
    ).toEqual(
      admin
        ? [root + '/me/capabilities', root + '/strategies']
        : [root + '/me/capabilities'],
    );
    expect(unexpected).toEqual([]);
  },
);

it.each([
  ['example', '2.0.0'],
  ['example.equity-top-five', '1.0.0'],
])('opens registered %s@%s from the web catalog link', async (id, version) => {
  const user = userEvent.setup();
  const registered = { ...revision, id, version };
  const versionPath = `/strategies/${id}/versions/${version}`;
  const { fetch, unexpected } = mount('/strategies', (_request, url) => {
    if (url.pathname === root + '/strategies')
      return Response.json({ items: [registered] });
    if (url.pathname === root + versionPath)
      return Response.json({ ...preview, strategy: registered });
    throw new Error('Unexpected registered strategy request');
  });

  const link = await screen.findByRole('link', { name: id });
  expect(link).toHaveAttribute('href', `/strategies/${id}?version=${version}`);
  await user.click(link);
  expect(
    await screen.findByRole('heading', { name: '策略详情' }),
  ).toBeVisible();
  await user.click(await screen.findByRole('button', { name: '预览登记版本' }));
  const plan = await screen.findByRole('region', { name: '编译预览' });
  expect(plan).toHaveTextContent(`${id}@${version}`);
  expect(plan).toHaveTextContent(revision.content_sha256);
  expect(screen.queryByText('Fixture · 合成示例')).toBeNull();
  expect(
    fetch.mock.calls.map(([request]) => new URL(request.url).pathname),
  ).toContain(root + versionPath);
  expect(unexpected).toEqual([]);
});

it('reports a web catalog failure for a legacy link while registration is unknown', async () => {
  const { unexpected } = mount(
    '/strategies/example.equity-top-five?version=1.0.0',
    (_request, url) => {
      if (url.pathname === root + '/strategies')
        return failure(502, 'finance_upstream_error');
      throw new Error('Unexpected research request');
    },
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'HTTP 502 · finance_upstream_error',
  );
  expect(screen.queryByText('Fixture · 合成示例')).toBeNull();
  expect(unexpected).toEqual([]);
});
