import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../app/routes/AppRoutes';
import { fixtureAdapter } from '../features/market/fixtureAdapter';
import { MarketTerminal } from '../features/market/MarketTerminal';
import { hasReading } from '../features/market/marketData';

const chart = () =>
  within(screen.getByRole('region', { name: '主 K 线与成交量' }));
const watchlist = () =>
  within(screen.getByRole('complementary', { name: '自选列表' }));
const quotes = () =>
  within(screen.getByRole('complementary', { name: '报价与来源' }));
const depth = () => within(quotes().getByRole('region', { name: '盘口深度' }));
const prints = () => within(screen.getByRole('region', { name: '已成交记录' }));
const beforeCollection = '采集开始前无细节数据';

function choose(name: string) {
  fireEvent.click(
    watchlist().getByRole('button', {
      name: (label) => label.startsWith(name),
    }),
  );
}

function setDetailDates(start: string, end: string) {
  fireEvent.change(screen.getByLabelText('起始日期'), {
    target: { value: start },
  });
  fireEvent.change(screen.getByLabelText('结束日期（不含）'), {
    target: { value: end },
  });
}

function mountTrading() {
  return render(
    <MemoryRouter initialEntries={['/trading']}>
      <AppRoutes marketReplay />
    </MemoryRouter>,
  );
}

function expectDetailLabel(panel: ReturnType<typeof within>, date: string) {
  const label = panel.getByText('数据类别 · 订单簿细节').parentElement;
  expect(label).toHaveTextContent(`数据类别 · 订单簿细节（自 ${date} 起）`);
  expect(panel.getByText(date)).toHaveAttribute('datetime', date);
}

const network = vi.fn(() => {
  throw new Error('Market panel tests only use synthetic replay');
});

beforeEach(() => {
  localStorage.clear();
  network.mockClear();
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('WebSocket', network);
  vi.stubGlobal('EventSource', network);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(network).not.toHaveBeenCalled();
});

describe('U5 面板数据类别', () => {
  it('labels price-volume panels and keeps K-line and L1 readable before depth collection', () => {
    render(<MarketTerminal />);
    expect(chart().getByText('数据类别 · 价量历史')).toBeVisible();
    expect(watchlist().getByText('数据类别 · 价量历史')).toBeVisible();
    expect(quotes().getByText('数据类别 · 价量历史')).toBeVisible();
    expectDetailLabel(depth(), '2026-11-17');
    setDetailDates('2026-11-15', '2026-11-17');
    expect(depth().getByText(beforeCollection)).toBeVisible();
    expect(depth().queryByRole('table')).toBeNull();
    expect(chart().getByLabelText('K 线精确读数')).toBeVisible();
    expect(quotes().getByRole('table', { name: 'L1 最优报价' })).toBeVisible();

    choose('SPY · Arca');
    expect(quotes().getByText('数据类别 · 价量历史')).toBeVisible();
    expect(quotes().queryByRole('region', { name: '盘口深度' })).toBeNull();
    expect(screen.queryByLabelText('起始日期')).toBeNull();
  });

  it('treats the collection day as exclusive at the end and inclusive at the start', () => {
    mountTrading();
    choose('AAPL.XNAS');
    expectDetailLabel(depth(), '2026-11-18');
    expectDetailLabel(prints(), '2026-11-18');
    setDetailDates('2026-11-17', '2026-11-18');
    for (const panel of [depth(), prints()]) {
      expect(panel.getByText(beforeCollection)).toBeVisible();
      expect(panel.queryByRole('table')).toBeNull();
      expect(panel.queryByRole('alert')).toBeNull();
    }
    expect(depth().queryByRole('button', { name: /回放/ })).toBeNull();

    setDetailDates('2026-11-17', '2026-11-19');
    for (const panel of [depth(), prints()]) {
      expect(panel.getByText(beforeCollection)).toBeVisible();
      expect(panel.getByRole('table')).toBeVisible();
    }

    setDetailDates('2026-11-18', '2026-11-19');
    for (const panel of [depth(), prints()]) {
      expect(panel.queryByText(beforeCollection)).toBeNull();
      expect(panel.getByRole('table')).toBeVisible();
    }
    expect(depth().getByText(/样本覆盖 · 当前快照/)).toHaveTextContent(
      '2026-11-18 11:59:56.000 UTC',
    );
    expect(prints().getByText(/样本覆盖/)).toHaveTextContent(
      '2026-11-18 11:59:47.000 UTC 至 2026-11-18 11:59:58.000 UTC',
    );
    expect(
      screen.queryByRole('button', { name: /下单|提交订单|买入|卖出/ }),
    ).toBeNull();
  });

  it('distinguishes reversed or empty date ranges from valid windows with no samples', () => {
    mountTrading();
    choose('AAPL.XNAS');
    for (const start of ['2026-11-18', '2026-11-19']) {
      setDetailDates(start, '2026-11-18');
      for (const panel of [depth(), prints()]) {
        expect(panel.getByText(/结束日期须晚于起始日期/)).toBeVisible();
        expect(panel.queryByText(beforeCollection)).toBeNull();
        expect(panel.queryByRole('table')).toBeNull();
      }
    }
    setDetailDates('2026-11-19', '2026-11-20');
    expect(depth().getByText('该区间没有返回盘口快照')).toBeVisible();
    expect(prints().getByText('暂无逐笔成交')).toBeVisible();
    for (const panel of [depth(), prints()]) {
      expect(panel.queryByText(beforeCollection)).toBeNull();
      expect(panel.queryByRole('table')).toBeNull();
    }
  });

  it('explains collection coverage when only the exclusive end date is set', () => {
    mountTrading();
    choose('AAPL.XNAS');

    setDetailDates('', '2026-11-18');
    for (const panel of [depth(), prints()]) {
      expect(panel.getByText(beforeCollection)).toBeVisible();
      expect(panel.queryByRole('table')).toBeNull();
    }

    setDetailDates('', '2026-11-19');
    expect(depth().getByText(beforeCollection)).toBeVisible();
    expect(depth().getByRole('table', { name: '场所订单簿' })).toBeVisible();
    expect(prints().getByText(beforeCollection)).toBeVisible();
    expect(prints().getByRole('table', { name: '逐笔成交' })).toBeVisible();

    setDetailDates('', '');
    for (const panel of [depth(), prints()]) {
      expect(panel.queryByText(beforeCollection)).toBeNull();
      expect(panel.getByRole('table')).toBeVisible();
    }
  });

  it('reads separate stream start dates and updates them when the venue or product changes', () => {
    mountTrading();
    const derivatives = within(
      quotes().getByRole('region', { name: '永续合约指标' }),
    );
    expect(derivatives.getByText('数据类别 · 价量历史')).toBeVisible();
    setDetailDates('', '2026-11-18');
    expectDetailLabel(depth(), '2026-11-17');
    expectDetailLabel(prints(), '2026-11-18');
    expect(depth().getByText(beforeCollection)).toBeVisible();
    expect(depth().getByText('该区间没有返回盘口快照')).toBeVisible();
    expect(prints().getByText(beforeCollection)).toBeVisible();

    const venue = screen.getByRole('combobox', { name: '加密场所与产品' });
    fireEvent.change(venue, { target: { value: 'binance-spot' } });
    expect(quotes().getByText('Binance 已由部署配置关闭')).toBeVisible();
    expect(quotes().queryByRole('region', { name: '盘口深度' })).toBeNull();
    expect(screen.queryByRole('region', { name: '已成交记录' })).toBeNull();
    expect(screen.queryByText('数据类别 · 订单簿细节')).toBeNull();
    expect(screen.queryByLabelText('起始日期')).toBeNull();
    fireEvent.click(
      screen.getByRole('checkbox', { name: '启用 Binance 合成回放' }),
    );
    expectDetailLabel(depth(), '2026-11-16');
    expectDetailLabel(prints(), '2026-11-18');
    expect(quotes().getByText('Fixture · 示例数据')).toBeVisible();
    expect(depth().getByText('该区间没有返回盘口快照')).toBeVisible();
    fireEvent.change(venue, { target: { value: 'binance-perp' } });
    expectDetailLabel(depth(), '2026-11-18');
    expect(depth().getByText(beforeCollection)).toBeVisible();
  });

  it('keeps L1 visible and hides details when their collection starts are missing', () => {
    render(
      <MarketTerminal
        trading
        adapter={{
          ...fixtureAdapter,
          read(request) {
            const reading = fixtureAdapter.read(request);
            if (!hasReading(reading) || !reading.book) return reading;
            return {
              ...reading,
              book: { ...reading.book, availableFrom: undefined },
              tradesAvailableFrom: undefined,
            };
          },
        }}
      />,
    );
    expect(quotes().getByRole('table', { name: 'L1 最优报价' })).toBeVisible();
    expect(quotes().queryByRole('region', { name: '盘口深度' })).toBeNull();
    expect(screen.queryByRole('region', { name: '已成交记录' })).toBeNull();
    expect(screen.queryByText('数据类别 · 订单簿细节')).toBeNull();
    expect(screen.queryByLabelText('起始日期')).toBeNull();
  });

  it('compares UTC day boundaries even when the market timezone displays the previous day', () => {
    render(
      <MarketTerminal
        trading
        adapter={{
          ...fixtureAdapter,
          read(request) {
            const reading = fixtureAdapter.read(request);
            if (!hasReading(reading) || request.id !== 'AAPL.XNAS')
              return reading;
            // Synthetic midnight events with exact values on both boundaries.
            return {
              ...reading,
              trades: [
                '2026-11-18T00:00:00.123456Z',
                '2026-11-18T00:00:00Z',
                '2026-11-19T00:00:00.000Z',
              ].map((time) => ({
                id: time,
                time,
                price: '12.345678',
                quantity: '2',
              })),
            };
          },
        }}
      />,
    );
    choose('AAPL.XNAS');
    setDetailDates('2026-11-18', '2026-11-19');
    fireEvent.change(screen.getByRole('combobox', { name: '时间显示' }), {
      target: { value: 'market' },
    });
    const table = within(prints().getByRole('table', { name: '逐笔成交' }));
    expect(
      table.getByText('2026-11-17 19:00:00 America/New_York'),
    ).toHaveAttribute('datetime', '2026-11-18T00:00:00Z');
    expect(table.getAllByRole('row')).toHaveLength(3);
    expect(table.getAllByText('12.345678')).toHaveLength(2);
    expect(prints().getByText(/样本覆盖/)).toHaveTextContent(
      '2026-11-17 19:00:00 America/New_York 至 2026-11-17 19:00:00.123456 America/New_York',
    );
  });
});
