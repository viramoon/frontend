import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../app/routes/AppRoutes';
import type { ResearchAdapter } from '../features/research/adapter';
import { fixtureResearch } from '../features/research/fixtureAdapter';
import {
  bundles,
  errorFile,
  researchOnly,
} from '../features/research/fixtures/catalog';
import { maxYamlBytes } from '../features/research/fixtureYaml';
import { pendingRunKey } from '../features/research/useRunSubmission';

const sample = bundles[0];
const blockedHttp = vi.fn(() => {
  throw new Error('Research fixture screens must not make HTTP requests');
});
const clients: QueryClient[] = [];

function CurrentAddress() {
  const { pathname, search } = useLocation();
  return (
    <output aria-label="当前地址">
      {pathname}
      {search}
    </output>
  );
}

function mount(path: string, adapter = fixtureResearch) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes research={adapter} />
        <CurrentAddress />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function upload(
  user: ReturnType<typeof userEvent.setup>,
  value: string | Uint8Array<ArrayBuffer>,
) {
  await user.upload(
    await screen.findByLabelText('上传 YAML'),
    new File([value], 'synthetic.yaml', { type: 'application/yaml' }),
  );
  await user.click(screen.getByRole('button', { name: '校验并预览文件' }));
}

async function previewRegistered(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '预览登记版本' }));
  return await screen.findByRole('region', { name: '编译预览' });
}

async function startRun(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole('button', { name: '运行示例回测' });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

beforeEach(() => {
  sessionStorage.clear();
  blockedHttp.mockClear();
  vi.stubGlobal('fetch', blockedHttp);
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  expect(blockedHttp).not.toHaveBeenCalled();
});

describe('配置策略与因子工作台', () => {
  it('runs an uploaded YAML and the registered file with the same plan, version and result', async () => {
    const user = userEvent.setup();
    mount('/strategies');
    expect(screen.getByText('Fixture · 合成示例')).toBeVisible();

    const registered = within(await previewRegistered(user));
    expect(
      registered.getByText(sample.plan.revision.contentSha256),
    ).toBeVisible();
    expect(registered.getByText('A1_B2', { selector: 'code' })).toBeVisible();
    expect(registered.getByText('2 / 5 bp')).toBeVisible();
    const preview = registered
      .getByRole('heading', { name: '编译预览' })
      .closest('section')?.textContent;
    expect(screen.getByRole('link', { name: '下载示例 YAML' })).toHaveAttribute(
      'download',
      sample.filename,
    );
    await user.selectOptions(
      await screen.findByLabelText('时间窗（结束日不含）'),
      '1',
    );
    await startRun(user);

    const first = within(
      await screen.findByRole('region', { name: '配置作业 fixture-1' }),
    );
    await first.findByText('100039.620000000000000002', {}, { timeout: 3500 });
    expect(first.getByText(sample.plan.revision.contentSha256)).toBeVisible();
    expect(first.getByText('2024-03-04 至 2024-03-30')).toBeVisible();
    expect(first.getByRole('heading', { name: '运行清单' })).toBeVisible();
    expect(first.getByText('101.125000000000000001')).toBeVisible();
    expect(first.getByText('100050.0000 USD')).toBeVisible();
    const firstResult = first.getByRole('region', {
      name: '模拟成交账本表',
    }).textContent;

    await user.click(screen.getByRole('link', { name: '选择策略' }));
    await upload(
      user,
      '# Local synthetic copy\n' +
        sample.yaml.replace('"100000.00"', '"100000.0000"'),
    );
    const uploaded = await screen.findByRole('region', { name: '编译预览' });
    expect(uploaded.textContent).toBe(preview);
    await user.selectOptions(
      await screen.findByLabelText('时间窗（结束日不含）'),
      '1',
    );
    await startRun(user);

    const second = within(
      await screen.findByRole('region', { name: '配置作业 fixture-2' }),
    );
    expect(
      await second.findByText(
        '100039.620000000000000002',
        {},
        { timeout: 3500 },
      ),
    ).toBeVisible();
    expect(second.getByText(sample.plan.revision.contentSha256)).toBeVisible();
    expect(
      second.getByRole('region', { name: '模拟成交账本表' }).textContent,
    ).toBe(firstResult);
    expect(screen.getByLabelText('当前地址')).toHaveTextContent(
      '/backtests?run=fixture-2',
    );
    expect(screen.getByRole('link', { name: 'fixture-1' })).toBeVisible();
  }, 12000);

  it('selects a registered revision from a strategy detail deep link', async () => {
    const user = userEvent.setup();
    const { plan } = bundles[1];
    mount(`/strategies/${plan.revision.id}?version=${plan.revision.version}`);
    const preview = within(await previewRegistered(user));
    expect(preview.getByText(plan.revision.contentSha256)).toBeVisible();
    expect(preview.getByText('topFive', { selector: 'code' })).toBeVisible();
    expect(screen.queryByLabelText('上传 YAML')).not.toBeInTheDocument();
  });

  it('shows compiler path and one-based positions, and clears stale previews for invalid YAML', async () => {
    const user = userEvent.setup();
    mount('/strategies');
    await previewRegistered(user);

    await upload(user, errorFile.yaml);
    const compiler = await screen.findByRole('alert');
    expect(compiler).toHaveTextContent('第 11 行，第 13 列 · FUTURE_DATA');
    expect(compiler).toHaveTextContent('/spec/data/bars');
    expect(compiler).toHaveTextContent('日线在决策截止后才发布');
    expect(
      screen.queryByRole('region', { name: '编译预览' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '运行示例回测' }),
    ).not.toBeInTheDocument();

    await upload(
      user,
      'metadata:\n  id: example.first\n  id: example.second\n',
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '第 3 行，第 3 列 · INVALID_YAML',
    );

    await upload(
      user,
      sample.yaml.replace('lookback_sessions: 20', 'lookback_sessions: 21'),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'FIXTURE_CONTENT_MISMATCH',
    );
  });

  it.each([
    ['oversized', new Uint8Array(maxYamlBytes + 1), 'FILE_TOO_LARGE'],
    ['non UTF-8', new Uint8Array([0xff, 0xfe]), 'INVALID_UTF8'],
    [
      'anchored',
      sample.yaml.replace('metadata:', 'metadata: &meta'),
      'YAML_PROPERTY',
    ],
    [
      'tagged',
      sample.yaml.replace('kind: StrategyBundle', 'kind: !!str StrategyBundle'),
      'YAML_PROPERTY',
    ],
  ])(
    'rejects %s uploads before offering a run',
    async (_label, value, code) => {
      const user = userEvent.setup();
      mount('/strategies');
      await upload(user, value);
      expect(await screen.findByRole('alert')).toHaveTextContent(code);
      expect(
        screen.queryByRole('button', { name: '运行示例回测' }),
      ).not.toBeInTheDocument();
    },
  );

  it('shows a research-only revision as read-only and rejects it in both compile paths', async () => {
    const user = userEvent.setup();
    mount('/strategies');
    const researchTitle = await screen.findByRole('link', {
      name: researchOnly.title,
    });
    expect(
      within(screen.getByLabelText('登记版本')).queryByRole('option', {
        name: /月频因子动量/,
      }),
    ).not.toBeInTheDocument();

    await upload(
      user,
      sample.yaml.replace(sample.plan.revision.id, researchOnly.id),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'RESEARCH_ONLY_STRATEGY',
    );
    expect(
      await fixtureResearch.compile({
        kind: 'registered',
        selection: researchOnly,
      }),
    ).toMatchObject({
      kind: 'invalid',
      diagnostics: [{ code: 'RESEARCH_ONLY_STRATEGY' }],
    });

    await user.click(researchTitle);
    expect(await screen.findByText('研究专用 · 只读')).toBeVisible();
    expect(
      screen.getByText('研究门槛未通过。此登记只提供研究结论与版本信息。'),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /交易|下单|回测|预览/ }),
    ).not.toBeInTheDocument();
    expect(await fixtureResearch.listRuns()).toEqual([]);
  });

  it('shows factor definition, evaluation windows, coverage, IC decay and absent results', async () => {
    const user = userEvent.setup();
    mount('/factors');
    expect(await screen.findByText('可用于配置回测')).toBeVisible();
    expect(screen.getByText(/日线收盘后，仅使用决策时已发布/)).toBeVisible();
    expect(await screen.findByRole('heading', { name: '训练' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '验证' })).toBeVisible();
    expect(screen.getByText('285 / 300', { exact: false })).toBeVisible();
    const decay = within(
      screen.getByRole('region', { name: '样本外 IC 衰减表' }),
    );
    expect(decay.getByRole('row', { name: /1 会话/ })).toHaveTextContent(
      '0.123456789012345678',
    );
    expect(decay.getByRole('row', { name: /5 会话/ })).toHaveTextContent(
      '0.081',
    );
    expect(decay.getByRole('row', { name: /20 会话/ })).toHaveTextContent(
      '不可用',
    );
    const buckets = within(
      screen.getByRole('region', { name: '样本外 分位组合表' }),
    );
    expect(buckets.getByRole('row', { name: /Q5/ })).toHaveTextContent(
      '0.0174',
    );
    expect(buckets.getByRole('row', { name: /等权基准/ })).toHaveTextContent(
      '0.0080',
    );

    await user.selectOptions(
      screen.getByLabelText('因子版本'),
      'research.synthetic-reversal@1.0.0',
    );
    expect(await screen.findByText('该版本暂无评价报告。')).toBeVisible();
    expect(screen.getByText('仅观察')).toBeVisible();
    expect(
      screen.queryByRole('region', { name: '样本外 IC 衰减表' }),
    ).not.toBeInTheDocument();
  });
});

describe('配置作业恢复', () => {
  it('recovers a lost accepted response by key after reload and opens the persisted deep link', async () => {
    const submit = vi.fn<ResearchAdapter['submit']>(async (request, key) => {
      await fixtureResearch.submit(request, key);
      throw new Error('simulated lost response');
    });
    const byKey = vi
      .fn<ResearchAdapter['byKey']>(fixtureResearch.byKey)
      .mockRejectedValueOnce(
        new Error('simulated temporarily unavailable lookup'),
      );
    const adapter = { ...fixtureResearch, submit, byKey };
    const user = userEvent.setup();
    const original = mount('/strategies', adapter);
    await previewRegistered(user);
    await startRun(user);
    expect(
      await screen.findByText('暂时无法查询原提交。请稍后使用同一作业键查询。'),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: '用原参数重试' }),
    ).not.toBeInTheDocument();
    const [request, key] = submit.mock.calls[0];
    expect(JSON.parse(sessionStorage.getItem(pendingRunKey) ?? 'null')).toEqual(
      { request, key },
    );
    original.unmount();

    const recovered = mount('/backtests?view=strategy', adapter);
    expect(screen.getByText(key)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '查询原提交' }));
    expect(
      await screen.findByRole('heading', { name: '配置作业 fixture-1' }),
    ).toBeVisible();
    expect(byKey.mock.calls).toEqual([[key], [key]]);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(pendingRunKey)).toBeNull();
    recovered.unmount();

    const deepLink = mount('/backtests?run=fixture-1', adapter);
    expect(
      await screen.findByText(
        '100025.620000000000000002',
        {},
        { timeout: 3500 },
      ),
    ).toBeVisible();
    deepLink.unmount();

    mount('/backtests?view=strategy', adapter);
    await user.type(screen.getByLabelText('作业键'), key);
    await user.click(screen.getByRole('button', { name: '按键查找' }));
    expect(
      await screen.findByRole('heading', { name: '配置作业 fixture-1' }),
    ).toBeVisible();
  }, 9000);

  it('rechecks an explicitly missing job before retrying with the original key and parameters', async () => {
    const submit = vi
      .fn<ResearchAdapter['submit']>(fixtureResearch.submit)
      .mockRejectedValueOnce(
        new Error('simulated response loss before acceptance'),
      );
    const byKey = vi.fn<ResearchAdapter['byKey']>(fixtureResearch.byKey);
    const adapter = { ...fixtureResearch, submit, byKey };
    const user = userEvent.setup();
    mount('/strategies', adapter);
    await previewRegistered(user);
    await startRun(user);

    await user.click(
      await screen.findByRole('button', { name: '用原参数重试' }),
    );
    expect(
      await screen.findByRole('heading', { name: '配置作业 fixture-1' }),
    ).toBeVisible();
    const [request, key] = submit.mock.calls[0];
    expect(byKey.mock.calls).toEqual([[key], [key]]);
    expect(submit.mock.calls).toEqual([
      [request, key],
      [request, key],
    ]);
    expect(await fixtureResearch.listRuns()).toHaveLength(1);
  });

  it('keeps one job per key and rejects a different time window for that key', async () => {
    const [dataset] = await fixtureResearch.listDatasets(sample.plan);
    const request = {
      revision: sample.plan.revision,
      datasetId: dataset.id,
      ...dataset.windows[0],
    };
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { id } = await fixtureResearch.submit(request, 'fixture-key');
    expect(await fixtureResearch.run(id)).toMatchObject({ status: 'queued' });
    clock.mockReturnValue(2000);
    expect(await fixtureResearch.run(id)).toMatchObject({ status: 'running' });
    clock.mockReturnValue(3000);
    expect(await fixtureResearch.run(id)).toMatchObject({
      status: 'succeeded',
    });
    expect(
      await fixtureResearch.submit(
        {
          ...dataset.windows[0],
          revision: request.revision,
          datasetId: request.datasetId,
        },
        'fixture-key',
      ),
    ).toEqual({ id });
    await expect(
      fixtureResearch.submit(
        { ...request, ...dataset.windows[1] },
        'fixture-key',
      ),
    ).rejects.toThrow('idempotency key conflict');
    expect(await fixtureResearch.listRuns()).toHaveLength(1);
  });
});
