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
  Alert,
  ChannelTest,
  Delivery,
  Rule,
  SystemStatus,
} from '../api/generated/types.gen';
import { AppRoutes } from '../app/routes/AppRoutes';

const time = '2000-01-03T12:00:00Z';
const capabilities = '/api/v1/me/capabilities';
const alerts = '/api/v1/alerts';
const rules = '/api/v1/notification-rules';
const tests = '/api/v1/notification-channels/email/tests';
const session = '/api/v1/admin/session';
const ruleId = '10000000-0000-4000-8000-000000000002';
const alertId = '10000000-0000-4000-8000-000000000003';
const csrf = 'synthetic-csrf-marker';

const admin = {
  subject: 'admin',
  products: ['notifications'],
  csrf_token: csrf,
};
const anonymous = { subject: 'anonymous', products: ['system'] };
const rule: Rule = {
  id: ruleId,
  revision: 4,
  condition: 'source_unavailable',
  severity: 'urgent',
  enabled: true,
  email_enabled: true,
  min_occurrences: 1,
  cooldown_seconds: 300,
  reminder_seconds: 7200,
};
const delivery: Delivery = {
  id: '10000000-0000-4000-8000-000000000004',
  kind: 'alert',
  status: 'failed',
  attempts: [{ attempt: 1, started_at: time, outcome: 'timeout' }],
  deferrals: [],
  summary_attempts: [],
  summary_deferrals: [],
  available_at: time,
  created_at: time,
  updated_at: time,
};
const alert: Alert = {
  id: alertId,
  condition: 'source_unavailable',
  severity: 'urgent',
  sequence: '9007199254740999',
  phase: 'triggered',
  disposition: 'pending',
  duplicate_count: 0,
  created_at: time,
  observed_at: time,
  deliveries: [delivery],
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

afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});

function mockWeb(
  reply: (url: URL, request: Request) => Response | Promise<Response>,
) {
  const unexpected: string[] = [];
  const fetch = vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    expect(url.origin).toBe(location.origin);
    try {
      return await reply(url, request);
    } catch (error) {
      unexpected.push(`${request.method} ${url.pathname}`);
      throw error;
    }
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, unexpected };
}

function expectWrite(request: Request) {
  expect(request.headers.get('X-CSRF-Token')).toBe(csrf);
  expect(request.headers.get('Origin')).toBe(location.origin);
  expect(request.credentials).toBe('same-origin');
}

it('loads W3 alerts, follows the exact cursor, and acknowledges through the generated same-origin client', async () => {
  let acknowledgedAt: string | null = null;
  const written: Request[] = [];
  const history: Alert = {
    ...alert,
    id: '10000000-0000-4000-8000-000000000005',
    sequence: '9007199254740998',
    condition: 'backup_stale',
    deliveries: [],
  };
  const { fetch, unexpected } = mockWeb((url, request) => {
    if (url.pathname === capabilities) return Response.json(admin);
    if (url.pathname === '/api/v1/backup/status')
      return Response.json({
        state: 'unavailable',
        alert: true,
        degraded: false,
      });
    if (url.pathname === alerts && request.method === 'GET') {
      return Response.json(
        url.searchParams.has('cursor')
          ? { items: [history] }
          : {
              items: [{ ...alert, acknowledged_at: acknowledgedAt }],
              next_cursor: alert.sequence,
            },
      );
    }
    if (
      url.pathname === `${alerts}/${alertId}/ack` &&
      request.method === 'POST'
    ) {
      written.push(request);
      acknowledgedAt = time;
      // The update committed, but its response timed out.
      return Response.json({}, { status: 504 });
    }
    if (url.pathname === `${alerts}/${alertId}` && request.method === 'GET') {
      return Response.json({ ...alert, acknowledged_at: acknowledgedAt });
    }
    throw new Error('unexpected W3 route');
  });
  const user = userEvent.setup();
  mount('/blog');
  const link = screen.getByRole('link', { name: '事件' });
  link.focus();
  await user.keyboard('{Enter}');
  expect(link).toHaveAttribute('aria-current', 'page');

  const live = within(
    await screen.findByRole('region', { name: '采集源不可用' }),
  );
  expect(live.getByText(/第 1 次尝试 · 中继超时/)).toBeVisible();
  const backup = within(
    screen.getByRole('region', { name: 'Drive 恢复水位事件' }),
  );
  expect(backup.getByText('恢复水位当前无法核验')).toBeVisible();
  expect(backup.queryByText('持续中')).not.toBeInTheDocument();
  expect(document.querySelector('[data-fixture-seed]')).toBeNull();
  expect(
    screen.queryByRole('button', { name: '静默一小时' }),
  ).not.toBeInTheDocument();
  await user.click(live.getByRole('button', { name: '确认告警' }));
  expect(await live.findByText(/^已确认 ·/, { selector: 'dd' })).toBeVisible();
  expect(acknowledgedAt).toBe(time);
  expect(written).toHaveLength(1);
  expectWrite(written[0]);
  expect(await written[0].text()).toBe('');
  const urls = fetch.mock.calls.map(([req]) => new URL(req.url));
  expect(
    urls.some((url) => url.searchParams.get('cursor') === '9007199254740999'),
  ).toBe(true);
  expect(urls.some((url) => url.pathname === `${alerts}/${alertId}`)).toBe(
    true,
  );
  expect(unexpected).toEqual([]);
});

it('updates a W3 rule with the quoted revision and keeps reminder and condition fields', async () => {
  let current = rule;
  const written: { request: Request; body: unknown }[] = [];
  const { unexpected } = mockWeb(async (url, request) => {
    if (url.pathname === capabilities) return Response.json(admin);
    if (url.pathname === rules) return Response.json({ items: [current] });
    if (url.pathname === `${rules}/${ruleId}` && request.method === 'GET')
      return Response.json(current);
    if (url.pathname === `${rules}/${ruleId}` && request.method === 'PUT') {
      const body = await request.json();
      written.push({ request, body });
      current = { ...current, ...body, revision: current.revision + 1 };
      return Response.json(current);
    }
    throw new Error('unexpected W3 route');
  });
  const user = userEvent.setup();
  mount('/blog');
  const link = screen.getByRole('link', { name: '通知设置' });
  link.focus();
  await user.keyboard('{Enter}');
  expect(link).toHaveAttribute('aria-current', 'page');
  const item = within(
    await screen.findByRole('region', { name: '采集源不可用' }),
  );
  await user.click(item.getByLabelText('启用邮件通知'));
  await user.click(item.getByRole('button', { name: '保存规则' }));
  expect(await item.findByText(/修订 5/)).toBeVisible();
  expect(written).toHaveLength(1);
  expectWrite(written[0].request);
  expect(written[0].request.headers.get('If-Match')).toBe('"4"');
  expect(written[0].body).toEqual({
    condition: 'source_unavailable',
    severity: 'urgent',
    reminder_seconds: 7200,
    cooldown_seconds: 300,
    enabled: true,
    email_enabled: false,
    min_occurrences: 1,
  });
  expect(screen.getByText(/收件人 · 由 web 部署管理/)).toBeVisible();
  expect(unexpected).toEqual([]);
});

it('starts a W3 test without a body, reconciles its original UUID and renders the delivery failure', async () => {
  const posted: Request[] = [];
  const checked: string[] = [];
  let key: string | null = null;
  const { unexpected } = mockWeb((url, request) => {
    if (url.pathname === capabilities) return Response.json(admin);
    if (url.pathname === rules) return Response.json({ items: [] });
    if (url.pathname === tests && request.method === 'POST') {
      posted.push(request);
      key = request.headers.get('Idempotency-Key');
      return Response.json({}, { status: 504 });
    }
    if (url.pathname.startsWith(`${tests}/`) && request.method === 'GET') {
      checked.push(url.pathname.slice(tests.length + 1));
      if (checked.length === 1)
        return Response.json(
          { error: { code: 'notification_not_found' } },
          { status: 404 },
        );
      const test: ChannelTest = {
        id: key!,
        available_at: time,
        created_at: time,
        updated_at: time,
        deferrals: [],
        status: 'failed',
        attempts: [
          { attempt: 1, started_at: time, outcome: 'configuration_error' },
        ],
      };
      return Response.json(test);
    }
    throw new Error('unexpected W3 route');
  });
  const user = userEvent.setup();
  mount('/settings/notifications');
  await user.click(await screen.findByRole('button', { name: '发送测试邮件' }));
  const retry = await screen.findByRole('button', {
    name: '按原请求重新发送测试邮件',
  });
  expect(key).toMatch(
    /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
  );
  expect(checked).toEqual([key]);
  expect(posted).toHaveLength(1);
  await user.click(retry);
  expect(await screen.findByText('投递失败')).toBeVisible();
  expect(screen.getByText(/邮件配置错误/)).toBeVisible();
  expect(posted).toHaveLength(2);
  expect(checked).toEqual([key, key]);
  for (const req of posted) {
    expectWrite(req);
    expect(req.headers.get('Idempotency-Key')).toBe(key);
    expect(await req.text()).toBe('');
  }
  expect(unexpected).toEqual([]);
});

it('polls an accepted W3 test request until the SMTP relay accepts delivery', async () => {
  const lookedUp: string[] = [];
  let key: string | null = null;
  const { unexpected } = mockWeb((url, request) => {
    if (url.pathname === capabilities) return Response.json(admin);
    if (url.pathname === rules) return Response.json({ items: [] });
    const test = (status: ChannelTest['status']): ChannelTest => ({
      id: key!,
      status,
      available_at: time,
      created_at: time,
      updated_at: time,
      deferrals: [],
      attempts:
        status === 'accepted'
          ? [{ attempt: 1, started_at: time, outcome: 'accepted' }]
          : [],
    });
    if (url.pathname === tests && request.method === 'POST' && key === null) {
      expectWrite(request);
      key = request.headers.get('Idempotency-Key');
      return Response.json(test('pending'), { status: 202 });
    }
    if (url.pathname.startsWith(`${tests}/`) && request.method === 'GET') {
      lookedUp.push(url.pathname.slice(tests.length + 1));
      return Response.json(
        test(lookedUp.length === 1 ? 'sending' : 'accepted'),
      );
    }
    throw new Error('unexpected W3 route');
  });
  const user = userEvent.setup();
  mount('/settings/notifications');
  await user.click(await screen.findByRole('button', { name: '发送测试邮件' }));
  expect(
    await screen.findByText('正在投递', {}, { timeout: 2000 }),
  ).toBeVisible();
  expect(
    await screen.findByText('SMTP 中继已接受', {}, { timeout: 3000 }),
  ).toBeVisible();
  expect(lookedUp).toEqual([key, key]);
  expect(unexpected).toEqual([]);
});

it('requires notification capability and exchanges a write-only admin token for a web session', async () => {
  let signedIn = false;
  const writes: Request[] = [];
  const marker = ['synthetic', 'admin', 'input'].join('-');
  const { fetch, unexpected } = mockWeb((url, request) => {
    if (url.pathname === capabilities)
      return Response.json(signedIn ? admin : anonymous);
    if (url.pathname === session && request.method === 'POST') {
      writes.push(request);
      signedIn = true;
      return Response.json(
        { csrf_token: csrf, expires_in: 300 },
        { status: 201 },
      );
    }
    if (url.pathname === alerts && signedIn)
      return Response.json({ items: [] });
    throw new Error('unexpected W3 route');
  });
  const user = userEvent.setup();
  const { container } = mount('/alerts');
  const input = await screen.findByLabelText('管理令牌');
  expect(input).toHaveAttribute('type', 'password');
  expect(fetch).toHaveBeenCalledTimes(1);
  await user.type(input, marker);
  await user.click(screen.getByRole('button', { name: '建立管理员会话' }));
  expect(input).toHaveValue('');
  expect(await screen.findByText('没有符合条件的告警')).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].headers.get('Authorization')).toBe('Bearer ' + marker);
  expect(writes[0].headers.get('Origin')).toBe(location.origin);
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  expect(
    JSON.stringify(client.getQueryData(['u4-access', 'notifications'])),
  ).not.toContain(csrf);
  expect(container.innerHTML).not.toContain(marker);
  expect(unexpected).toEqual([]);
});

it('uses live W4 catalogue and status routes while reading W3 mail health', async () => {
  const liveSystem: SystemStatus = {
    web: { version: '0.0.0', commit: 'synthetic-web', started_at: time },
    database: { ok: true },
    finance: { ok: true, latency_ms: 1, circuit: 'closed' },
    market: {
      state: 'ready',
      source: 'synthetic',
      fresh: true,
      instrument_count: 0,
      stale_count: 0,
    },
    notifications: {
      state: 'degraded',
      last_attempt_at: time,
      last_outcome: 'rejected',
    },
  };
  const { fetch, unexpected } = mockWeb((url) => {
    if (url.pathname === capabilities)
      return Response.json({
        ...admin,
        products: ['notifications', 'integrations'],
      });
    if (
      url.pathname === '/api/v1/integrations' ||
      url.pathname === '/api/v1/integrations/catalog'
    )
      return Response.json([]);
    if (url.pathname === '/api/v1/backup/status')
      return Response.json({
        state: 'disabled',
        alert: false,
        degraded: false,
      });
    if (url.pathname === '/api/v1/quality/gaps')
      return Response.json({ state: 'available', items: [], coverage: [] });
    if (url.pathname === '/api/v1/system/status')
      return Response.json(liveSystem);
    if (url.pathname === '/api/v1/backtests/sample')
      return Response.json({}, { status: 404 });
    throw new Error('unexpected W4 route');
  });
  const user = userEvent.setup();
  mount('/blog');
  const settings = screen.getByRole('link', { name: '接口设置' });
  settings.focus();
  await user.keyboard('{Enter}');
  expect(settings).toHaveAttribute('aria-current', 'page');
  expect(await screen.findByText('暂无可配置的接口。')).toBeVisible();
  expect(
    screen.queryByRole('heading', { name: 'IBKR paper' }),
  ).not.toBeInTheDocument();
  expect(
    fetch.mock.calls.map(([request]) => new URL(request.url).pathname),
  ).toContain('/api/v1/integrations/catalog');
  await user.click(screen.getByRole('link', { name: '系统' }));
  const drive = within(
    await screen.findByRole('region', { name: 'Google Drive 备份' }),
  );
  expect(drive.getByText('异地备份已关闭')).toBeVisible();
  expect(drive.getByText('最后可恢复到')).toBeVisible();
  expect(drive.queryByRole('alert')).not.toBeInTheDocument();
  const mail = within(screen.getByRole('region', { name: '邮件投递状态' }));
  expect(await mail.findByText('邮件渠道 · 降级')).toBeVisible();
  expect(mail.getByText('中继拒绝')).toBeVisible();
  expect(document.querySelector('[data-fixture-seed]')).toBeNull();
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(
        ([request]) => new URL(request.url).pathname === '/api/v1/quality/gaps',
      ),
    ).toBe(true),
  );
  expect(unexpected).toEqual([]);
});
