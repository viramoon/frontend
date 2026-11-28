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
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  BackupStatus,
  CatalogEntry,
  Integration,
  MarketResult,
  QualityGapsPage,
  TestView,
} from '../api/generated/types.gen';
import { AppRoutes } from '../app/routes/AppRoutes';

const base = '/api/v1/integrations';
const backupPath = '/api/v1/backup/status';
const gapsPath = '/api/v1/quality/gaps';
const time = '2000-01-03T12:00:00Z';
const admin = {
  subject: 'admin',
  products: ['integrations', 'notifications'],
  csrf_token: 'u4-synthetic-csrf',
};
const id = '10000000-0000-4000-8000-000000000030';

const catalogEntry: CatalogEntry = {
  connector: 'ibkr_paper',
  product: 'integrations',
  auth_kind: 'none',
  auto_backfill: false,
  credential_fields: [],
  fee_class: 'unavailable',
  file_types: [],
  profiles: [],
  settings_fields: ['symbol'],
  symbols: ['SPY', 'QQQ'],
  test_method: 'authorized_read',
  test_available: true,
  title: 'IBKR paper',
};

function candidate(testId: string, result: MarketResult): TestView {
  return {
    id: testId,
    integration_id: id,
    config_version: 2,
    started_at: time,
    finished_at: time,
    status:
      result === 'verified'
        ? 'passed'
        : result === 'adapter_unavailable'
          ? 'unavailable'
          : 'failed',
    evidence: { kind: 'market', details: { result } },
  };
}

const draft: Integration = {
  id,
  connector: 'ibkr_paper',
  revision: 2,
  rollback_versions: [],
  latest: { version: 2, state: 'draft', settings: { symbol: 'QQQ' } },
  active: { version: 1, state: 'active', settings: { symbol: 'SPY' } },
};

let client: QueryClient;

function mount(path: string) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockWeb(
  reply: (request: Request, url: URL) => Response | Promise<Response>,
) {
  const unexpected: string[] = [];
  const fetch = vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    try {
      expect(url.origin).toBe(location.origin);
      if (url.pathname === '/api/v1/me/capabilities')
        return Response.json(admin);
      return await reply(request, url);
    } catch (error) {
      unexpected.push(`${request.method} ${url.pathname}: ${String(error)}`);
      throw error;
    }
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, unexpected };
}

function expectMutation(request: Request, revision?: number) {
  expect(request.headers.get('X-CSRF-Token')).toBe(admin.csrf_token);
  expect(request.headers.get('Origin')).toBe(location.origin);
  expect(request.headers.get('If-Match')).toBe(
    revision ? `"${revision}"` : null,
  );
  expect(request.credentials).toBe('same-origin');
}

function field(card: ReturnType<typeof within>, label: string) {
  return card.getByText(label, { selector: 'dt' }).nextElementSibling!;
}

afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});

it('uses W4 draft, scoped tests, activation and rollback without discarding the active version on adapter_unavailable', async () => {
  let integration = { ...draft, revision: 1, latest: draft.active! };
  let test: TestView | undefined;
  const writes: string[] = [];
  let scopeReads = 0;
  const { unexpected } = mockWeb(async (request, url) => {
    const path = url.pathname;
    const method = request.method;
    if (path === base + '/catalog') return Response.json([catalogEntry]);
    if (path === base && method === 'GET') return Response.json([integration]);
    if (path === base && method === 'POST') {
      expectMutation(request);
      expect(await request.json()).toEqual({
        connector: 'ibkr_paper',
        settings: { symbol: 'QQQ' },
      });
      writes.push('create');
      return Response.json(integration, { status: 201 });
    }
    if (path === base + '/' + id && method === 'GET')
      return Response.json(integration);
    if (path === base + '/' + id && method === 'PATCH') {
      expectMutation(request, integration.revision);
      expect(await request.json()).toEqual({
        action: 'configure',
        settings: { symbol: 'QQQ' },
      });
      integration = { ...draft, revision: 2 };
      writes.push('configure');
      return Response.json(integration);
    }
    if (path === base + '/' + id + '/tests' && method === 'POST') {
      expectMutation(request, integration.revision);
      expect(await request.text()).toBe('');
      const second = integration.revision > 2;
      const testId = `10000000-0000-4000-8000-00000000003${second ? 2 : 1}`;
      test = candidate(testId, second ? 'verified' : 'adapter_unavailable');
      integration = {
        ...integration,
        revision: integration.revision + 1,
        last_test_id: testId,
        latest: { ...integration.latest, state: 'candidate' },
      };
      writes.push('test');
      // Exercise reconciliation by configuration revision and scoped test ID.
      return second
        ? Response.json(test, { status: 202 })
        : Response.json({}, { status: 504 });
    }
    if (
      test &&
      path === base + '/' + id + '/tests/' + test.id &&
      method === 'GET'
    ) {
      scopeReads += 1;
      return Response.json(test);
    }
    if (test && path === base + '/' + id + '/activate' && method === 'POST') {
      expectMutation(request, integration.revision);
      expect(await request.json()).toEqual({ test_id: test.id });
      const active = { ...integration.latest, state: 'active' as const };
      integration = {
        ...integration,
        revision: 5,
        latest: active,
        active,
        rollback_versions: [1],
      };
      writes.push('activate');
      return Response.json(integration);
    }
    if (path === base + '/' + id + '/rollback' && method === 'POST') {
      expectMutation(request, integration.revision);
      expect(await request.json()).toEqual({ version: 1 });
      const active = { ...draft.active!, version: 3 };
      integration = {
        ...integration,
        revision: 6,
        latest: active,
        active,
        last_test_id: null,
        rollback_versions: [2],
      };
      writes.push('rollback');
      return Response.json(integration);
    }
    throw new Error('unexpected W4 route');
  });
  const user = userEvent.setup();
  mount('/settings/integrations');
  const create = within(
    await screen.findByRole('region', { name: '新建配置' }),
  );
  await user.selectOptions(create.getByLabelText('标的'), 'QQQ');
  await user.click(create.getByRole('button', { name: '创建草稿' }));
  expect(await create.findByText('已创建草稿。')).toBeVisible();
  const entry = within(
    await screen.findByRole('region', { name: 'IBKR paper' }),
  );
  await user.selectOptions(entry.getByLabelText('标的'), 'QQQ');
  await user.click(entry.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(field(entry, '修订')).toHaveTextContent('2'));
  await user.click(entry.getByRole('button', { name: '测试候选' }));
  expect(await entry.findByText(/adapter_unavailable/)).toBeVisible();
  expect(field(entry, '活动版本')).toHaveTextContent('v1 · SPY');
  expect(entry.getByRole('button', { name: '启用候选' })).toBeDisabled();
  await user.click(entry.getByRole('button', { name: '测试候选' }));
  await waitFor(() =>
    expect(entry.getByRole('button', { name: '启用候选' })).toBeEnabled(),
  );
  await user.click(entry.getByRole('button', { name: '启用候选' }));
  await waitFor(() =>
    expect(field(entry, '活动版本')).toHaveTextContent('v2 · QQQ'),
  );
  await user.click(entry.getByRole('button', { name: '回滚配置' }));
  await waitFor(() =>
    expect(field(entry, '活动版本')).toHaveTextContent('v3 · SPY'),
  );
  expect(writes).toEqual([
    'create',
    'configure',
    'test',
    'test',
    'activate',
    'rollback',
  ]);
  expect(scopeReads).toBeGreaterThanOrEqual(3);
  expect(unexpected).toEqual([]);
});

it.each([
  ['market_closed', '收盘待验'],
  ['no_permission', '权限失败'],
] as const)(
  'renders W4 %s without enabling an unverified candidate',
  async (result, text) => {
    const test = candidate('10000000-0000-4000-8000-000000000031', result);
    const { unexpected } = mockWeb((_request, url) => {
      if (url.pathname === base + '/catalog')
        return Response.json([catalogEntry]);
      if (url.pathname === base)
        return Response.json([
          {
            ...draft,
            latest: { ...draft.latest, state: 'candidate' },
            last_test_id: test.id,
          },
        ]);
      if (url.pathname === base + '/' + id + '/tests/' + test.id)
        return Response.json(test);
      throw new Error('unexpected W4 route');
    });
    mount('/settings/integrations');
    const entry = within(
      await screen.findByRole('region', { name: 'IBKR paper' }),
    );
    expect(await entry.findByText(text)).toBeVisible();
    expect(field(entry, '活动版本')).toHaveTextContent('v1 · SPY');
    expect(entry.getByRole('button', { name: '启用候选' })).toBeDisabled();
    expect(unexpected).toEqual([]);
  },
);

it('writes a W4 credential once and keeps returned masks and raw values out of visible state and caches', async () => {
  const marker = ['synthetic', 'write', 'only', 'input'].join('-');
  const entry: CatalogEntry = {
    ...catalogEntry,
    connector: 'licensed_options',
    title: '授权期权测试',
    auth_kind: 'api_token',
    symbols: ['SPX'],
    credential_fields: ['api_token'],
  };
  let integration = { ...draft, connector: entry.connector };
  let writes = 0;
  const { unexpected } = mockWeb(async (request, url) => {
    if (url.pathname === base + '/catalog') return Response.json([entry]);
    if (url.pathname === base) return Response.json([integration]);
    if (
      url.pathname === base + '/' + id + '/credential' &&
      request.method === 'PUT'
    ) {
      expectMutation(request, 2);
      expect(await request.json()).toEqual({ api_token: marker });
      writes += 1;
      integration = {
        ...integration,
        revision: 3,
        latest: {
          ...integration.latest,
          version: 3,
          credential: { mask: marker, rotated_at: time, version: 1 },
        },
      };
      return Response.json(integration);
    }
    throw new Error('unexpected W4 route');
  });
  const user = userEvent.setup();
  const { container } = mount('/settings/integrations');
  const card = within(
    await screen.findByRole('region', { name: '授权期权测试' }),
  );
  const fieldInput = card.getByLabelText('替换凭据');
  await user.type(fieldInput, marker);
  await user.click(card.getByRole('button', { name: '保存替换' }));
  expect(fieldInput).toHaveValue('');
  await waitFor(() =>
    expect(field(card, '当前凭据')).toHaveTextContent('•••••••• · v1'),
  );
  expect(writes).toBe(1);
  expect(container.innerHTML).not.toContain(marker);
  expect(
    JSON.stringify(client.getQueryData(['u4', 'web', 'integrations'])),
  ).not.toContain(marker);
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  expect(unexpected).toEqual([]);
});

const triggeredBackupEvent = {
  id,
  condition: 'backup_stale',
  severity: 'urgent',
  phase: 'triggered',
  disposition: 'pending',
  observed_at: time,
  created_at: time,
  sequence: '4',
  deliveries: [],
  duplicate_count: 0,
};

it.each([
  {
    description: 'a recent recovery point with producer degradation',
    backup: {
      state: 'degraded',
      age_seconds: 1200,
      alert: true,
      degraded: true,
      last_recoverable_at: time,
    },
    title: 'Drive 恢复点超过一小时',
    status: '当前未确认恢复点超时',
  },
  {
    description: 'producer degradation at the whole-second timeout boundary',
    backup: {
      state: 'degraded',
      age_seconds: 3600,
      alert: true,
      degraded: true,
      last_recoverable_at: time,
    },
    title: 'Drive 恢复点超过一小时',
    status: '当前未确认恢复点超时',
  },
  {
    description: 'no verified recovery point',
    backup: {
      state: 'no_verified_point',
      age_seconds: null,
      alert: true,
      degraded: false,
      last_recoverable_at: null,
    },
    title: 'Drive 恢复水位事件',
    status: '恢复水位当前无法核验',
  },
])(
  'excludes historical backup timeouts from ongoing alerts for $description',
  async ({ backup, title, status }) => {
    const { unexpected } = mockWeb((request, url) => {
      expect(request.method).toBe('GET');
      if (url.pathname === backupPath) return Response.json(backup);
      if (url.pathname === '/api/v1/alerts')
        return Response.json({ items: [triggeredBackupEvent] });
      if (url.pathname === `/api/v1/alerts/${triggeredBackupEvent.id}/silence`)
        return Response.json({ active: false, silence: null });
      throw new Error('unexpected W3/W4 route');
    });
    const user = userEvent.setup();
    mount('/alerts');
    const event = within(await screen.findByRole('region', { name: title }));
    expect(event.getByText(status)).toBeVisible();
    expect(event.queryByText('持续中')).not.toBeInTheDocument();
    expect(event.queryByText('已恢复')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('checkbox', { name: '只看尚未确认的持续告警' }),
    );
    expect(screen.getByText('没有符合条件的告警')).toBeVisible();
    expect(
      screen.queryByRole('region', { name: title }),
    ).not.toBeInTheDocument();
    expect(unexpected).toEqual([]);
  },
);

it('uses web Drive age and alert while the observation stalls, preserves exact watermarks, and ends a disabled alert', async () => {
  let backup: BackupStatus = {
    state: 'healthy',
    alert: false,
    degraded: false,
    observed_at: '2000-01-03T11:20:00.000000001Z',
    age_seconds: 3600,
    last_recoverable_at: '2000-01-03T11:00:00.000000001Z',
    last_hourly_at: '2000-01-03T11:55:00Z',
    last_full_at: '2000-01-03T03:00:00Z',
  };
  // Fixed synthetic observations above JS's safe integer range exercise exact display.
  const snapshot: QualityGapsPage = {
    state: 'available',
    as_of: time,
    next_offset: 20,
    coverage: [
      {
        source: 'ibkr',
        product: 'synthetic',
        license: 'display_only',
        watermarks: {
          local_durable: '9007199254740999',
          projected: '9007199254740998',
          remote_verified: '9007199254740997',
          source_latest: {
            channel: 'bars',
            instrument_id: 'SPY.SYNTHETIC',
            epoch: '9007199254740995',
            seq: '9007199254740993',
            exchange_ts: null,
            receive_ts: '947203200000000001',
          },
        },
      },
      {
        source: 'ibkr',
        product: 'synthetic-partial',
        license: 'display_only',
        watermarks: {
          local_durable: '0',
          projected: '0',
          remote_verified: null,
          source_latest: null,
        },
      },
      {
        source: 'ibkr',
        product: 'synthetic-unavailable',
        license: 'display_only',
        watermarks: null,
      },
    ],
    items: [
      {
        source: 'ibkr',
        product: 'synthetic',
        channel: 'bars',
        instrument_id: 'SPY.SYNTHETIC',
        from: '2000-01-03T10:10:00Z',
        to: '2000-01-03T10:15:00Z',
        cause: 'disconnected',
        outcome: 'bar_backfilled',
        count: '9007199254740999',
      },
    ],
  };
  const { unexpected } = mockWeb((request, url) => {
    expect(request.method).toBe('GET');
    if (url.pathname === backupPath) return Response.json(backup);
    if (url.pathname === gapsPath)
      return Response.json(
        url.searchParams.get('offset') === '0'
          ? snapshot
          : { ...snapshot, as_of: '2000-01-03T12:00:05Z', next_offset: null },
      );
    if (url.pathname === '/api/v1/system/status')
      return Response.json({}, { status: 503 });
    if (url.pathname === '/api/v1/backtests/sample')
      return Response.json({}, { status: 404 });
    if (url.pathname === '/api/v1/alerts')
      return Response.json({ items: [triggeredBackupEvent] });
    if (url.pathname === `/api/v1/alerts/${triggeredBackupEvent.id}/silence`)
      return Response.json({ active: false, silence: null });
    throw new Error('unexpected W4 route');
  });
  const user = userEvent.setup();
  mount('/system');
  const drive = within(
    await screen.findByRole('region', { name: 'Google Drive 备份' }),
  );
  expect(field(drive, '最后可恢复到').querySelector('time')).toHaveAttribute(
    'datetime',
    backup.last_recoverable_at,
  );
  expect(field(drive, '观测时间').querySelector('time')).toHaveAttribute(
    'datetime',
    backup.observed_at,
  );
  expect(field(drive, '恢复点年龄')).toHaveTextContent('60 分 0 秒');
  expect(drive.queryByRole('alert')).not.toBeInTheDocument();
  const quality = within(
    await screen.findByRole('region', { name: '采集水位与缺口' }),
  );
  const watermarks = within(
    await quality.findByRole('region', { name: 'ibkr synthetic 水位' }),
  );
  expect(field(watermarks, '本机持久位置')).toHaveTextContent(
    '9007199254740999',
  );
  expect(field(watermarks, '投影位置')).toHaveTextContent('9007199254740998');
  expect(field(watermarks, '远端已验证位置')).toHaveTextContent(
    '9007199254740997',
  );
  expect(field(watermarks, '源最新位置')).toHaveTextContent(
    'epoch 9007199254740995 / seq 9007199254740993',
  );
  expect(field(watermarks, '源接收时间（ns）')).toHaveTextContent(
    '947203200000000001',
  );
  const partial = within(
    quality.getByRole('region', { name: 'ibkr synthetic-partial 水位' }),
  );
  expect(field(partial, '本机持久位置')).toHaveTextContent(/^0$/);
  expect(field(partial, '投影位置')).toHaveTextContent(/^0$/);
  expect(field(partial, '源最新位置')).toHaveTextContent('未知');
  expect(field(partial, '源接收时间（ns）')).toHaveTextContent('未知');
  expect(field(partial, '远端已验证位置')).toHaveTextContent('未知');
  const unavailable = within(
    quality.getByRole('region', { name: 'ibkr synthetic-unavailable 水位' }),
  );
  expect(unavailable.getAllByText('未知')).toHaveLength(5);
  expect(
    quality.getByText(/断连 · 仅 K 线补齐 · 计数 9007199254740999/),
  ).toBeVisible();
  await user.click(quality.getByRole('button', { name: '下一页' }));
  expect(await quality.findByText(/采集快照已更新/)).toBeVisible();
  expect(quality.queryByText(/SPY.SYNTHETIC/)).not.toBeInTheDocument();

  backup = {
    ...backup,
    state: 'degraded',
    // web truncates the age to whole seconds, but evaluates the alert before truncating.
    alert: true,
  };
  await user.click(screen.getByRole('button', { name: '刷新备份状态' }));
  expect(await drive.findByRole('alert')).toHaveTextContent('超过一小时');
  expect(drive.getByRole('alert')).not.toHaveTextContent('远端备份验证降级');

  // The producer file has stopped updating. Only the server's current age changes.
  backup = { ...backup, age_seconds: 4320 };
  await user.click(screen.getByRole('button', { name: '刷新备份状态' }));
  await waitFor(() =>
    expect(field(drive, '恢复点年龄')).toHaveTextContent('72 分 0 秒'),
  );
  expect(field(drive, '观测时间').querySelector('time')).toHaveAttribute(
    'datetime',
    '2000-01-03T11:20:00.000000001Z',
  );
  expect(drive.getByRole('alert')).toHaveTextContent('超过一小时');
  const nav = within(screen.getByRole('navigation', { name: '主导航' }));
  await user.click(nav.getByRole('link', { name: '事件' }));
  const active = within(
    await screen.findByRole('region', { name: 'Drive 恢复点超过一小时' }),
  );
  expect(active.getByText('持续中')).toBeVisible();
  expect(active.queryByText('已恢复')).not.toBeInTheDocument();
  await user.click(
    screen.getByRole('checkbox', { name: '只看尚未确认的持续告警' }),
  );
  expect(
    screen.getByRole('region', { name: 'Drive 恢复点超过一小时' }),
  ).toBeVisible();

  backup = { ...backup, age_seconds: 1200, degraded: true };
  await user.click(nav.getByRole('link', { name: '系统' }));
  const degraded = within(
    await screen.findByRole('region', { name: 'Google Drive 备份' }),
  );
  await waitFor(() =>
    expect(degraded.getByRole('alert')).toHaveTextContent('远端备份验证降级'),
  );
  expect(degraded.getByRole('alert')).not.toHaveTextContent('超过一小时');
  await user.click(nav.getByRole('link', { name: '事件' }));
  const recent = within(
    await screen.findByRole('region', { name: 'Drive 恢复点超过一小时' }),
  );
  expect(await recent.findByText('当前未确认恢复点超时')).toBeVisible();
  expect(recent.queryByText('持续中')).not.toBeInTheDocument();

  // A triggered event remains historical evidence when the current backup alarm clears.
  backup = {
    ...backup,
    state: 'healthy',
    alert: false,
    age_seconds: 1200,
    degraded: false,
  };
  await user.click(nav.getByRole('link', { name: '系统' }));
  await user.click(nav.getByRole('link', { name: '事件' }));
  const cleared = within(
    await screen.findByRole('region', { name: 'Drive 恢复点超过一小时' }),
  );
  expect(await cleared.findByText('当前备份水位未告警')).toBeVisible();
  expect(cleared.queryByText('已恢复')).not.toBeInTheDocument();

  backup = { state: 'disabled', alert: false, degraded: false };
  await user.click(nav.getByRole('link', { name: '系统' }));
  const disabled = within(
    await screen.findByRole('region', { name: 'Google Drive 备份' }),
  );
  expect(await disabled.findByText('异地备份已关闭')).toBeVisible();
  await user.click(nav.getByRole('link', { name: '事件' }));
  const history = within(
    await screen.findByRole('region', { name: 'Drive 恢复点超过一小时' }),
  );
  expect(await history.findByText('异地备份已关闭')).toBeVisible();
  expect(history.queryByText('持续中')).not.toBeInTheDocument();
  expect(unexpected).toEqual([]);
});
