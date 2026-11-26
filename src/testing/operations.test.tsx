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
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DriveBackup, NotificationsAdapter } from '../api/operations';
import {
  createOperationsFixture,
  operationsFixtureSeed,
} from '../api/operationsFixture';
import { AppRoutes } from '../app/routes/AppRoutes';
import { Integrations } from '../features/integrations/Integrations';
import { Notifications } from '../features/notifications/Notifications';
import { DriveWatermark } from '../features/system/SystemDetails';
import { useState, type ReactNode } from 'react';

let client: QueryClient | undefined;

function mount(ui: ReactNode, path = '/') {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});

async function card(name: string) {
  return within(await screen.findByRole('region', { name }));
}

function field(region: ReturnType<typeof within>, label: string) {
  // A field value directly follows its term in the definition list.
  return region.getByText(label, { selector: 'dt' }).nextElementSibling!;
}

describe('U4 接口配置', () => {
  it('distinguishes a closed market from missing permission and keeps the active IBKR paper version', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    mount(<AppRoutes />, '/settings/integrations');

    const ibkr = await card('IBKR paper');
    expect(ibkr.getByText('paper · 只读行情')).toBeVisible();
    expect(ibkr.getByText('收盘待验')).toBeVisible();
    expect(ibkr.getByText('权限失败')).toBeVisible();
    expect(field(ibkr, '活动版本')).toHaveTextContent('v1 · 综合股票 L1');
    for (const [product, outcome] of [
      ['期权 L1、OI 与 Greeks', '收盘待验'],
      ['Nasdaq 多档盘口', '权限失败'],
    ]) {
      await user.selectOptions(ibkr.getByLabelText('产品'), product);
      await user.click(ibkr.getByRole('button', { name: '保存草稿' }));
      await ibkr.findByText('当前草稿待测试。');
      await user.click(ibkr.getByRole('button', { name: '测试候选' }));
      await waitFor(() => expect(ibkr.getAllByText(outcome)).toHaveLength(2));
      expect(ibkr.getByRole('button', { name: '启用候选' })).toBeDisabled();
      expect(field(ibkr, '活动版本')).toHaveTextContent('v1 · 综合股票 L1');
    }

    expect(field(await card('Binance'), '活动版本')).toHaveTextContent(
      '按配置关闭',
    );
    expect(ibkr.queryByLabelText('替换凭据')).not.toBeInTheDocument();
    expect(
      (await card('Google Drive')).queryByLabelText('替换凭据'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /下单|买入|卖出/ }),
    ).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('saves, verifies, activates, rolls back and disables a public integration in the app session', async () => {
    const user = userEvent.setup();
    mount(<AppRoutes />, '/settings/integrations');
    const publicFeed = await card('Hyperliquid');

    await user.selectOptions(publicFeed.getByLabelText('产品'), 'ETH 永续');
    await user.click(publicFeed.getByRole('button', { name: '保存草稿' }));
    await publicFeed.findByText('当前草稿待测试。');
    expect(publicFeed.getByRole('button', { name: '启用候选' })).toBeDisabled();
    await user.click(publicFeed.getByRole('button', { name: '测试候选' }));
    await waitFor(() =>
      expect(
        publicFeed.getByRole('button', { name: '启用候选' }),
      ).toBeEnabled(),
    );
    await user.click(publicFeed.getByRole('button', { name: '启用候选' }));
    await waitFor(() =>
      expect(field(publicFeed, '活动版本')).toHaveTextContent('v2 · ETH 永续'),
    );
    expect(field(publicFeed, '可回滚版本')).toHaveTextContent('v1 · BTC 永续');
    await user.click(
      publicFeed.getByRole('button', { name: '回滚到上个有效版本' }),
    );
    await waitFor(() =>
      expect(field(publicFeed, '活动版本')).toHaveTextContent('v1 · BTC 永续'),
    );
    await user.click(
      publicFeed.getByRole('button', { name: '停用' }),
    );
    await waitFor(() =>
      expect(field(publicFeed, '活动版本')).toHaveTextContent('已停用'),
    );

    const nav = within(screen.getByRole('navigation', { name: '主导航' }));
    await user.click(nav.getByRole('link', { name: '事件' }));
    await user.click(nav.getByRole('link', { name: '接口设置' }));
    expect(field(await card('Hyperliquid'), '活动版本')).toHaveTextContent(
      '已停用',
    );
  });

  it('keeps credential input write-only and revokes every version after clearing it', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const fixture = createOperationsFixture();
    const marker = ['u4', 'synthetic', 'input'].join('-');
    const { container } = mount(
      <Integrations adapter={fixture.integrations} />,
    );
    const smtp = await card('SMTP');
    const input = smtp.getByLabelText('替换凭据');

    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('');
    await user.type(input, marker);
    await user.click(smtp.getByRole('button', { name: '保存替换' }));
    expect(input).toHaveValue('');
    await waitFor(() =>
      expect(field(smtp, '草稿凭据')).toHaveTextContent('•••••••• · v2'),
    );
    expect(field(smtp, '活动凭据')).toHaveTextContent('•••••••• · v1');
    expect(JSON.stringify(await fixture.integrations.list())).not.toContain(
      marker,
    );
    expect(
      JSON.stringify(client?.getQueryData(['u4', 'integrations'])),
    ).not.toContain(marker);
    expect(client?.getMutationCache().getAll()).toHaveLength(0);
    expect(container.innerHTML).not.toContain(marker);
    expect(JSON.stringify([localStorage, sessionStorage])).not.toContain(
      marker,
    );

    await user.click(smtp.getByRole('button', { name: '测试候选' }));
    await waitFor(() =>
      expect(smtp.getByRole('button', { name: '启用候选' })).toBeEnabled(),
    );
    await user.click(smtp.getByRole('button', { name: '启用候选' }));
    await waitFor(() =>
      expect(
        smtp.getByRole('button', { name: '回滚到上个有效版本' }),
      ).toBeEnabled(),
    );
    await user.click(smtp.getByRole('button', { name: '清除凭据并停用' }));
    await waitFor(() =>
      expect(field(smtp, '活动版本')).toHaveTextContent('已停用'),
    );
    expect(field(smtp, '草稿凭据')).toHaveTextContent('未配置');
    expect(
      smtp.getByRole('button', { name: '回滚到上个有效版本' }),
    ).toBeDisabled();
    await user.click(smtp.getByRole('button', { name: '测试候选' }));
    await waitFor(() =>
      expect(smtp.getAllByText('待配置凭据')).toHaveLength(2),
    );
    expect(smtp.getByRole('button', { name: '启用候选' })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears password inputs on failure and suppresses unexpected adapter error contents', async () => {
    const fixture = createOperationsFixture().integrations;
    const marker = ['never', 'display', 'this'].join('-');
    const change = vi.fn(async () => {
      throw new Error(marker);
    });
    const { container } = mount(
      <Integrations adapter={{ ...fixture, change }} />,
    );
    const user = userEvent.setup();
    const smtp = await card('SMTP');
    const input = smtp.getByLabelText('替换凭据');

    await user.type(input, marker);
    await user.click(smtp.getByRole('button', { name: '保存替换' }));
    expect(change).toHaveBeenCalledWith('smtp', 1, {
      kind: 'replaceCredential',
      secret: marker,
    });
    expect(input).toHaveValue('');
    expect(await smtp.findByRole('alert')).toHaveTextContent('操作未能完成');
    expect(container.innerHTML).not.toContain(marker);
  });

  it('rejects concurrent revisions, unlisted targets and activation after superseding evidence', async () => {
    const fixture = createOperationsFixture().integrations;
    const configure = (revision: number, product: string) =>
      fixture.change('hyperliquid', revision, { kind: 'configure', product });

    await expect(
      configure(1, 'arbitrary fixture target'),
    ).rejects.toMatchObject({ code: 'invalid' });
    const race = await Promise.allSettled([
      configure(1, 'ETH 永续'),
      configure(1, 'SOL 永续'),
    ]);
    expect(race.map(({ status }) => status)).toEqual(['fulfilled', 'rejected']);
    await fixture.change('hyperliquid', 2, { kind: 'test' });
    await configure(3, 'SOL 永续');
    await expect(
      fixture.change('hyperliquid', 4, { kind: 'activate' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(
      (await fixture.list()).find(({ id }) => id === 'hyperliquid'),
    ).toMatchObject({
      active: { version: 1 },
      draft: { version: 4 },
      test: null,
    });
  });
});

describe('U4 告警及邮件', () => {
  it('acknowledges, silences, unmutes and filters alerts while retaining delivery evidence', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    mount(<AppRoutes />, '/alerts');
    const backup = await card('Drive 恢复点超过一小时');

    expect(backup.getByText('等待投递')).toBeVisible();
    expect(
      (await card('SMTP 投递失败')).getByText(/第 1 次尝试 · 中继拒绝/),
    ).toBeVisible();
    await user.click(backup.getByRole('button', { name: '静默一小时' }));
    await waitFor(() =>
      expect(field(backup, '静默状态')).toHaveTextContent('静默至'),
    );
    expect(field(backup, '确认状态')).toHaveTextContent('待确认');
    await user.click(backup.getByRole('button', { name: '确认告警' }));
    await waitFor(() =>
      expect(field(backup, '确认状态')).toHaveTextContent('已确认'),
    );
    expect(field(backup, '静默状态')).toHaveTextContent('静默至');
    await user.click(backup.getByRole('button', { name: '解除静默' }));
    await waitFor(() =>
      expect(field(backup, '静默状态')).toHaveTextContent('未静默'),
    );
    await user.click(screen.getByLabelText('只看尚未确认的持续告警'));
    expect(
      screen.queryByRole('region', { name: 'Drive 恢复点超过一小时' }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('region', { name: 'Nasdaq 盘口权限失败' }),
    ).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('expires silence, keeps the first acknowledgement time and deduplicates a test email key', async () => {
    let clock = 0;
    const { alerts, notifications } = createOperationsFixture(() => clock);
    await alerts.acknowledge('backup');
    await alerts.silence('backup', 60);
    const first = (await alerts.list()).find(({ id }) => id === 'backup')!;
    expect(first.silencedUntil).not.toBeNull();
    clock = 3_600_000;
    await alerts.acknowledge('backup');
    expect(
      (await alerts.list()).find(({ id }) => id === 'backup'),
    ).toMatchObject({
      acknowledgedAt: first.acknowledgedAt,
      silencedUntil: null,
    });

    const key = 'test-email-fixture-key';
    await notifications.startEmailTest(key);
    expect(await notifications.readEmailTest(key)).toMatchObject({
      status: 'pending',
    });
    clock += 500;
    await notifications.startEmailTest(key);
    expect(await notifications.readEmailTest(key)).toMatchObject({
      status: 'sending',
    });
    clock += 500;
    expect(await notifications.readEmailTest(key)).toMatchObject({
      status: 'accepted',
      attempts: [{ outcome: 'accepted' }],
    });
  });

  it('edits notification rules and shows the synthetic test email up to SMTP acceptance across navigation', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    mount(<AppRoutes />, '/settings/notifications');
    const channel = await card('邮件渠道');

    expect(channel.getByText(/本人邮箱（已隐藏）/)).toBeVisible();
    expect(screen.getByText(/23:00–08:00 · Asia\/Shanghai/)).toBeVisible();
    await user.click(channel.getByRole('button', { name: '发送测试邮件' }));
    expect(await channel.findByText('等待投递')).toBeVisible();
    expect(
      channel.getByRole('button', { name: '发送测试邮件' }),
    ).toBeDisabled();
    expect(
      await channel.findByText('SMTP 中继已接受', {}, { timeout: 3000 }),
    ).toBeVisible();
    expect(channel.getByText(/收件箱送达需在邮箱确认/)).toBeVisible();

    const rule = await card('Drive 恢复点超过一小时');
    await user.click(rule.getByLabelText('启用邮件通知'));
    const occurrences = rule.getByLabelText('触发次数');
    await user.clear(occurrences);
    await user.type(occurrences, '3');
    await user.click(rule.getByRole('button', { name: '保存规则' }));
    expect(await rule.findByText(/修订 2/)).toBeVisible();
    expect(rule.getByLabelText('启用邮件通知')).not.toBeChecked();
    expect(rule.getByLabelText('触发次数')).toHaveValue(3);

    const nav = within(screen.getByRole('navigation', { name: '主导航' }));
    await user.click(nav.getByRole('link', { name: '事件' }));
    await user.click(nav.getByRole('link', { name: '通知设置' }));
    expect((await card('邮件渠道')).getByText('SMTP 中继已接受')).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks the original test key after a timeout and only retries the same key when missing', async () => {
    const fixture = createOperationsFixture().notifications;
    const startEmailTest = vi
      .fn<NotificationsAdapter['startEmailTest']>()
      .mockRejectedValueOnce(new Error('synthetic timeout'))
      .mockImplementation(fixture.startEmailTest);
    const readEmailTest = vi.fn(fixture.readEmailTest);
    const adapter = { ...fixture, startEmailTest, readEmailTest };
    function TestPage() {
      const [key, setKey] = useState<string | null>(null);
      return (
        <Notifications adapter={adapter} testKey={key} setTestKey={setKey} />
      );
    }
    const user = userEvent.setup();
    mount(<TestPage />);
    const channel = await card('邮件渠道');

    await user.click(channel.getByRole('button', { name: '发送测试邮件' }));
    const retry = await channel.findByRole('button', {
      name: '按原请求重新发送测试邮件',
    });
    expect(channel.getByText(/提交结果未确认.*未查到测试记录/)).toBeVisible();
    expect(startEmailTest).toHaveBeenCalledTimes(1);
    const [key] = startEmailTest.mock.calls[0];
    expect(readEmailTest).toHaveBeenCalledWith(key);
    await user.click(retry);
    expect(await channel.findByText('等待投递')).toBeVisible();
    expect(startEmailTest.mock.calls).toEqual([[key], [key]]);
  });
});

describe('U4 系统与备份', () => {
  it('shows the verified Drive watermark, overdue alert, source gaps and existing same-origin reads', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', (request: Request) => {
      const url = new URL(request.url);
      expect(url.origin).toBe(location.origin);
      expect(request.method).toBe('GET');
      requests.push(url.pathname);
      if (url.pathname === '/api/v1/system/status')
        return Promise.resolve(Response.json({}, { status: 503 }));
      if (url.pathname === '/api/v1/backtests/sample')
        return Promise.resolve(Response.json({}, { status: 404 }));
      throw new Error('Unexpected request in the offline fixture');
    });
    mount(<AppRoutes />, '/system');
    const drive = await card('Google Drive 备份');
    expect(field(drive, '最后可恢复到').querySelector('time')).toHaveAttribute(
      'datetime',
      '2000-01-03T10:48:00.000Z',
    );
    expect(field(drive, '恢复点年龄')).toHaveTextContent('72 分');
    expect(field(drive, '最近恢复演练')).toHaveTextContent('通过');
    expect(drive.getByRole('alert')).toHaveTextContent('超过一小时');
    expect(drive.getByRole('link', { name: '查看告警事件' })).toHaveAttribute(
      'href',
      '/alerts',
    );
    expect(field(await card('IBKR paper'), '最近缺口')).toHaveTextContent(
      '仅 K 线补齐',
    );
    expect(field(await card('Binance'), '采集状态')).toHaveTextContent(
      '按配置关闭',
    );
    expect(
      (await card('邮件投递状态')).getByText('邮件渠道 · 降级'),
    ).toBeVisible();
    expect(screen.getByText(/合成演示/)).toHaveAttribute(
      'data-fixture-seed',
      operationsFixtureSeed,
    );
    expect(await screen.findByText('暂无示例回测')).toBeVisible();
    expect(requests.sort()).toEqual([
      '/api/v1/backtests/sample',
      '/api/v1/system/status',
    ]);
  });

  const backup: DriveBackup = {
    state: 'verified',
    observedAt: '2000-01-03T12:00:00.000Z',
    lastRecoverableAt: '2000-01-03T11:00:00.000Z',
    lastFullAt: '2000-01-03T03:00:00.000Z',
    lastHourlyAt: '2000-01-03T11:55:00.000Z',
    lastDrill: null,
  };

  it('warns strictly after one hour of verified-point age, irrespective of a newer hourly upload', () => {
    const { rerender } = render(
      <MemoryRouter>
        <DriveWatermark backup={backup} />
      </MemoryRouter>,
    );
    expect(screen.getByText('60 分 0 秒')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <DriveWatermark
          backup={{ ...backup, observedAt: '2000-01-03T12:00:00.001Z' }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('超过一小时');
  });

  it.each([
    ['no point', { ...backup, lastRecoverableAt: null }, '暂无已验证恢复点'],
    [
      'future point',
      { ...backup, lastRecoverableAt: '2000-01-03T13:00:00.000Z' },
      '恢复点时间无法确认',
    ],
    [
      'degraded remote',
      { ...backup, state: 'degraded' } as const,
      '远端备份验证降级',
    ],
    [
      'failed drill',
      {
        ...backup,
        lastDrill: { passed: false, finishedAt: backup.observedAt },
      },
      '最近恢复演练失败',
    ],
  ] as const)('warns separately about %s', (_name, record, message) => {
    render(
      <MemoryRouter>
        <DriveWatermark backup={record} />
      </MemoryRouter>,
    );
    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent(message);
    expect(warning).not.toHaveTextContent('超过一小时');
  });

  it('distinguishes disabled remote backup from an enabled backup with no verified point', () => {
    render(
      <MemoryRouter>
        <DriveWatermark backup={{ state: 'disabled' }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('异地备份已关闭')).toBeVisible();
    expect(screen.getByText('未知')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
