import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../app/routes/AppRoutes';
import { OptionsTerminal } from '../features/options/OptionsTerminal';
import type { OptionsReading } from '../features/options/optionsData';
import { optionsFixtureAdapter } from '../features/options/optionsFixture';

function mount(page: 'flow' | 'exposure') {
  return render(
    <MemoryRouter initialEntries={[`/options/${page}`]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

const summary = () =>
  within(screen.getByRole('region', { name: '期权数据摘要' }));
const results = () => within(screen.getByRole('list', { name: '流水结果' }));
const choose = (name: string, value: string) =>
  fireEvent.change(screen.getByRole('combobox', { name }), {
    target: { value },
  });

function row(table: string, label: string) {
  const view = within(screen.getByRole('table', { name: table }));
  const header = view.getByRole('rowheader', { name: label });
  return within(header.closest('tr')!)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('U2b 期权终端', () => {
  it.each(['flow', 'exposure'] as const)(
    'shows observations, verification, hypothesis, source inputs and OI date together on /options/%s without network or orders',
    async (page) => {
      const fetch = vi.fn();
      const socket = vi.fn();
      const events = vi.fn();
      vi.stubGlobal('fetch', fetch);
      vi.stubGlobal('WebSocket', socket);
      vi.stubGlobal('EventSource', events);
      const { container } = mount(page);

      await screen.findByRole('region', { name: '期权数据摘要' });
      const view = summary();
      expect(view.getByText('Fixture · 示例数据')).toBeVisible();
      expect(view.getByText('回放')).toBeVisible();
      expect(view.getByText('实时观察 · 待核验')).toBeVisible();
      expect(view.getByText('2 条线索')).toBeVisible();
      expect(view.getByText('历史逐笔 · 已核验')).toBeVisible();
      expect(view.getByText('5 笔 · 含 2 笔方向未知')).toBeVisible();
      expect(view.getByText('1 个时间段')).toBeVisible();
      expect(view.getByText('假设')).toBeVisible();
      expect(view.getByText('实测项')).toBeVisible();
      expect(view.getByText('OI 等源输入 · 合成回放值')).toBeVisible();
      expect(view.getByText('OI 基准日')).toBeVisible();
      expect(view.getByText('2026-11-18')).toHaveAttribute(
        'datetime',
        '2026-11-18',
      );
      expect(container.querySelector('[data-fixture-seed]')).toHaveAttribute(
        'data-fixture-seed',
        'options-terminal-v1:1801',
      );
      expect(
        screen.queryByRole('button', { name: /下单|提交订单|买入|卖出/ }),
      ).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
      expect(socket).not.toHaveBeenCalled();
      expect(events).not.toHaveBeenCalled();
    },
  );

  it('keeps a cumulative volume clue and a quote anomaly separate from single-trade evidence', async () => {
    mount('flow');
    await screen.findByRole('list', { name: '流水结果' });
    choose('记录类型', 'observation');

    expect(results().getAllByText('观察 · 待核验')).toHaveLength(2);
    const volume = results().getByText('累计放量');
    const quote = results().getByText('报价异动');
    expect(
      within(volume.closest('summary')!).getByText('估计权利金额 90250 USD'),
    ).toBeVisible();
    expect(
      within(quote.closest('summary')!).getByText('估计权利金额 —'),
    ).toBeVisible();

    fireEvent.click(volume.closest('summary')!);
    const evidence = within(screen.getByLabelText('证据 sim-volume'));
    expect(evidence.getByText('轮换订阅 · 局部观察')).toBeVisible();
    expect(evidence.getByText('475 张')).toBeVisible();
    expect(evidence.getByText(/单笔规模未知/)).toBeVisible();
    expect(evidence.queryByText('成交')).toBeNull();
  });

  it('shows paired quote provenance, distinct same-second prints, and only suspected sweep or block labels', async () => {
    mount('flow');
    await screen.findByRole('list', { name: '流水结果' });
    choose('记录类型', 'historical');
    choose('置信度', 'high');

    const samePrice = results().getAllByText('权利金 64030 USD');
    expect(samePrice).toHaveLength(2);
    fireEvent.click(samePrice[0].closest('summary')!);
    const first = within(screen.getByLabelText('证据 sim-verified-1'));
    expect(first.getByText('1.9 USD × 337 张 × 100 乘数')).toBeVisible();
    expect(first.getByText('成交时间')).toBeVisible();
    expect(first.getByText('取得时间')).toBeVisible();
    expect(first.getByText('2026-11-19 15:28:00 UTC')).toBeVisible();
    expect(first.getByText('SIM-SINGLE · 单腿')).toBeVisible();
    expect(first.getByText('fixture-conditions-v1')).toBeVisible();
    expect(first.getByText(/疑似 block、疑似机构规模/)).toBeVisible();
    fireEvent.click(samePrice[1].closest('summary')!);
    const second = within(screen.getByLabelText('证据 sim-verified-2'));
    expect(second.getByText(/疑似 sweep · 缺少可确认关联的证据/)).toBeVisible();
    expect(results().getByText('单腿 · 推测主动卖')).toBeVisible();
  });

  it('exposes missing or stale quotes, explicit multi-leg conditions, corrections and cancellations', async () => {
    mount('flow');
    await screen.findByRole('list', { name: '流水结果' });
    choose('记录类型', 'unknown');
    expect(results().getAllByText('历史逐笔 · 已核验')).toHaveLength(2);
    fireEvent.click(
      results().getByText('明确多腿 · 方向未知').closest('summary')!,
    );
    const complex = within(screen.getByLabelText('证据 sim-complex-2'));
    expect(complex.getByText('无可用报价')).toBeVisible();
    expect(complex.getByText('SIM-COMPLEX · 明确多腿')).toBeVisible();
    expect(complex.getByText('已更正 · 关联 sim-complex-1')).toBeVisible();

    fireEvent.click(
      results().getByText('未映射或缺失 · 方向未知').closest('summary')!,
    );
    const stale = within(screen.getByLabelText('证据 sim-stale'));
    expect(stale.getByText(/报价陈旧/)).toBeVisible();
    expect(stale.getByText('1.9 USD × 11 张 × 50 乘数')).toBeVisible();
    expect(results().getByText('权利金 1045 USD')).toBeVisible();

    choose('记录类型', 'canceled');
    const canceled = results().getByText('历史记录 · 已取消');
    expect(results().getByText('权利金 —')).toBeVisible();
    fireEvent.click(canceled.closest('summary')!);
    expect(
      screen.getByText('已取消 · 关联 sim-canceled-original'),
    ).toBeVisible();
    expect(results().queryByText('历史逐笔 · 已核验')).toBeNull();
  });

  it('combines expiry, 0DTE, condition, confidence and exact premium filters', async () => {
    mount('flow');
    await screen.findByRole('list', { name: '流水结果' });

    choose('成交条件', 'single');
    choose('置信度', 'high');
    choose('到期日', '2026-11-19');
    choose('期限分组', 'zero');
    expect(results().getAllByText('历史逐笔 · 已核验')).toHaveLength(1);
    expect(results().getByText('权利金 4940 USD')).toBeVisible();

    const premium = screen.getByRole('textbox', {
      name: '最低权利金额（USD）',
    });
    fireEvent.change(premium, { target: { value: '4940.0000000000000001' } });
    expect(screen.getByText('当前筛选无匹配记录')).toBeVisible();
    fireEvent.change(premium, { target: { value: '4940.0000000000000000' } });
    expect(results().getByText('权利金 4940 USD')).toBeVisible();
    fireEvent.change(premium, { target: { value: '1e5' } });
    expect(screen.getByRole('alert')).toHaveTextContent('请输入非负十进制金额');
    expect(premium).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(premium, { target: { value: '' } });
    choose('期限分组', 'later');
    expect(screen.getByText('当前筛选无匹配记录')).toBeVisible();
  });

  it('shows unfillable gaps outside the record filters and distinguishes a truly empty flow', async () => {
    mount('flow');
    await screen.findByRole('list', { name: '流水结果' });
    choose('记录类型', 'observation');
    const gaps = within(screen.getByRole('region', { name: '未订阅时间段' }));
    expect(gaps.getByText('无法回补逐笔')).toBeVisible();
    expect(gaps.getByText(/仅有分钟 bar/)).toBeVisible();
    expect(gaps.getByText('待核验回补能力')).toBeVisible();
    expect(gaps.getByText('2026-11-19 15:05:00 UTC')).toBeVisible();

    choose('标的', 'QQQ');
    expect(await screen.findByText('暂无期权流水数据')).toBeVisible();
    expect(summary().getByText('暂无 OI 数据')).toBeVisible();
    expect(screen.queryByText('无法回补逐笔')).toBeNull();
    expect(screen.queryByText('当前筛选无匹配记录')).toBeNull();
  });

  it('renders precise signed strike and expiry buckets, walls and separate 0DTE values', async () => {
    mount('exposure');
    const strikeName = '按行权价（USD）';
    await screen.findByRole('table', { name: strikeName });
    const walls = within(screen.getByLabelText('Wall 行权价（USD）'));

    expect(row(strikeName, '316')).toEqual([
      '981462.666343566',
      '67949.027422542',
    ]);
    expect(row(strikeName, '314')).toEqual(['0', '0']);
    expect(row('按到期日', '2026-11-19 · 0DTE')).toEqual(['426291.204603206']);
    expect(row('按到期日', '2026-11-27')).toEqual(['913513.638921024']);
    expect(
      walls.getAllByRole('definition').map((item) => item.textContent),
    ).toEqual(['316', '无', '无']);

    choose('敞口情景', 'dealerShort');
    expect(row(strikeName, '316')).toEqual([
      '-981462.666343566',
      '-67949.027422542',
    ]);
    expect(
      walls.getAllByRole('definition').map((item) => item.textContent),
    ).toEqual(['316', '无', '316']);
    choose('敞口情景', 'dealerLong');
    expect(row(strikeName, '316')).toEqual([
      '981462.666343566',
      '67949.027422542',
    ]);
    expect(
      walls.getAllByRole('definition').map((item) => item.textContent),
    ).toEqual(['316', '316', '无']);
    choose('敞口情景', 'callPositive');
    expect(row(strikeName, '312')).toEqual([
      '-358342.177180664',
      '-358342.177180664',
    ]);
    expect(row(strikeName, '316')).toEqual([
      '620667.108700518',
      '67949.027422542',
    ]);
    expect(
      walls.getAllByRole('definition').map((item) => item.textContent),
    ).toEqual(['316', '316', '312']);
    expect(
      screen.getByText(/模型 options-gex-fixture-v1 · 标的价格 314.78 USD/),
    ).toBeVisible();
  });

  it('distinguishes an unevaluated flip, a no-crossing grid, a crossing and no exposure data', async () => {
    mount('exposure');
    expect(await screen.findByText('未评估 flip')).toBeVisible();
    choose('敞口情景', 'dealerShort');
    const flip = within(screen.getByRole('region', { name: 'Gamma flip' }));
    expect(flip.getByText('此情景无 flip')).toBeVisible();
    expect(flip.getByText('309 至 319，步长 1')).toBeVisible();
    expect(flip.getByText('合成合约 IV 固定')).toBeVisible();
    expect(flip.getByText('0.04 / 0.01')).toBeVisible();
    choose('敞口情景', 'callPositive');
    expect(flip.getByText('314.25')).toBeVisible();
    expect(flip.queryByText('此情景无 flip')).toBeNull();

    choose('标的', 'QQQ');
    expect(await screen.findByText('暂无期权敞口数据')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Gamma flip' })).toBeNull();
  });

  it('keeps an unknown OI denominator and date separate from a known zero', async () => {
    mount('exposure');
    const coverage = within(
      await screen.findByRole('region', { name: '覆盖与输入时间' }),
    );
    expect(coverage.getByText('局部估算')).toBeVisible();
    expect(coverage.getByText('5 / 7')).toBeVisible();
    expect(coverage.getByText('2410 / 未知')).toBeVisible();
    expect(coverage.getByText('缺 OI 1 份；缺 IV 与 gamma 2 份')).toBeVisible();
    expect(coverage.getAllByText('2026-11-19 15:04:00 UTC')).toHaveLength(2);
    const name = '合约级 OI、IV 与 gamma';
    expect(row(name, 'SPY-SIM-5 · Call')).toEqual([
      '314',
      '2026-11-19 · 0DTE',
      '100',
      '0',
      '0.2926',
      '0.006951',
    ]);
    expect(row(name, 'SPY-SIM-6 · Put')).toEqual([
      '318',
      '2026-11-27',
      '100',
      '—',
      '—',
      '—',
    ]);

    choose('标的', 'AAPL');
    expect(await screen.findByText('日期未证实')).toBeVisible();
    const nextCoverage = within(
      screen.getByRole('region', { name: '覆盖与输入时间' }),
    );
    expect(nextCoverage.getByText('2410 / 2535')).toBeVisible();
    expect(nextCoverage.getAllByText('2026-11-19 15:04:00 UTC')).toHaveLength(
      2,
    );
    expect(summary().queryByText('2026-11-18')).toBeNull();
  });

  it('ignores a late snapshot for the previous symbol and aborts its read', async () => {
    const response = await optionsFixtureAdapter.read(
      'SPY',
      new AbortController().signal,
    );
    let oldSignal: AbortSignal | undefined;
    let resolveOld!: (value: OptionsReading) => void;
    const read = vi.fn((symbol: string, signal: AbortSignal) => {
      if (symbol !== 'SPY') return optionsFixtureAdapter.read(symbol, signal);
      oldSignal = signal;
      return new Promise<OptionsReading>((resolve) => {
        resolveOld = resolve;
      });
    });
    render(
      <OptionsTerminal
        page="flow"
        adapter={{ ...optionsFixtureAdapter, read }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('正在读取期权数据');
    choose('标的', 'AAPL');
    expect(await screen.findByText('日期未证实')).toBeVisible();
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => resolveOld(response));
    expect(summary().getByText('日期未证实')).toBeVisible();
    expect(summary().queryByText('2026-11-18')).toBeNull();
  });

  it('distinguishes adapter errors from absent data and retries the selected symbol', async () => {
    const read = vi
      .fn(optionsFixtureAdapter.read)
      .mockRejectedValueOnce(new Error('fixture failure'));
    render(
      <OptionsTerminal
        page="exposure"
        adapter={{ ...optionsFixtureAdapter, read }}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '期权数据读取失败',
    );
    expect(screen.queryByText('暂无期权敞口数据')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    expect(
      await screen.findByRole('table', { name: '按到期日' }),
    ).toBeVisible();
    expect(read.mock.calls.map(([symbol]) => symbol)).toEqual(['SPY', 'SPY']);
  });
});
