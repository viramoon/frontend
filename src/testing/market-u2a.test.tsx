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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../app/routes/AppRoutes';
import { fixtureAdapter } from '../features/market/fixtureAdapter';
import { MarketTerminal } from '../features/market/MarketTerminal';
import { hasReading, type BookSource } from '../features/market/marketData';
import type { BookEvent } from '../features/market/orderBook';

const watchlist = () =>
  within(screen.getByRole('complementary', { name: '自选列表' }));
const quotes = () =>
  within(screen.getByRole('complementary', { name: '报价与来源' }));
const chart = () =>
  within(screen.getByRole('region', { name: '主 K 线与成交量' }));
const depth = () => within(quotes().getByRole('region', { name: '盘口深度' }));
const budget = () => within(quotes().getByRole('region', { name: '模拟额度' }));
const choose = (name: string) =>
  fireEvent.click(
    watchlist().getByRole('button', {
      name: (label) => label.startsWith(name),
    }),
  );

function mountTrading() {
  return render(
    <MemoryRouter initialEntries={['/trading']}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

const snapshot: BookEvent = {
  kind: 'snapshot',
  epoch: 1n,
  seq: 1n,
  asOf: '2026-11-18T12:00:00Z',
  bids: [{ price: '12000.000012', quantity: '9.0000100' }],
  asks: [],
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('U2a 行情终端', () => {
  it('switches all nine US equities and three crypto assets through the watchlist', () => {
    render(<MarketTerminal />);
    for (const id of [
      'QQQ.XNAS',
      'SPY.ARCA',
      'AAPL.XNAS',
      'MSFT.XNAS',
      'NVDA.XNAS',
      'AMZN.XNAS',
      'GOOGL.XNAS',
      'META.XNAS',
      'TSLA.XNAS',
      'BTC-USD',
      'ETH-USD',
      'SOL-USD',
    ]) {
      choose(id === 'SPY.ARCA' ? 'SPY · Arca' : id);
      expect(chart().getByRole('heading', { name: id })).toBeVisible();
      expect(
        quotes().getByRole('table', { name: 'L1 最优报价' }),
      ).toBeVisible();
      expect(chart().getByLabelText('K 线精确读数')).toBeVisible();
    }
  });

  it('shows only consolidated L1 for SPY and keeps order books separate from prints on the trading route', () => {
    mountTrading();
    expect(
      screen.getByRole('heading', { name: '交易', level: 1 }),
    ).toBeVisible();
    choose('AAPL.XNAS');
    expect(depth().getByText('AAPL.XNAS · Nasdaq 场所深度')).toBeVisible();
    expect(depth().getByText('数据类别 · 订单簿细节')).toBeVisible();
    expect(depth().getByText(/已返回买 4 档 \/ 卖 4 档/)).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: '已成交记录' })).getByRole(
        'table',
        { name: '逐笔成交' },
      ),
    ).toBeVisible();
    choose('SPY · Arca');
    expect(quotes().getByText('SPY 仅启用美国综合 L1。')).toBeVisible();
    expect(quotes().getByRole('table', { name: 'L1 最优报价' })).toBeVisible();
    expect(screen.queryByRole('region', { name: '盘口深度' })).toBeNull();
    expect(screen.queryByRole('table', { name: '逐笔成交' })).toBeNull();
    expect(budget().getByText('Nasdaq 跟随 0/1 · 空闲')).toBeVisible();
    expect(
      budget().queryByRole('button', { name: /固定 Nasdaq 深度/ }),
    ).toBeNull();
  });

  it('distinguishes callbacks 2, 3 and 4 from independently stale data', () => {
    render(<MarketTerminal />);
    for (const [id, label] of [
      ['MSFT.XNAS', 'marketDataType 2 · 冻结'],
      ['NVDA.XNAS', 'marketDataType 3 · 延迟'],
      ['AMZN.XNAS', 'marketDataType 4 · 延迟冻结'],
    ]) {
      choose(id);
      expect(quotes().getByText(label)).toBeVisible();
      expect(quotes().getByText('已更新')).toBeVisible();
      expect(quotes().queryByText('数据陈旧')).toBeNull();
    }
    choose('QQQ.XNAS');
    expect(quotes().getByText('marketDataType 3 · 延迟')).toBeVisible();
    expect(quotes().getByText('数据陈旧')).toBeVisible();
    expect(depth().getByText('盘口陈旧')).toBeVisible();
    expect(depth().queryByRole('table')).toBeNull();
  });

  it('immediately hides the old book on a gap and waits for a new snapshot', () => {
    render(<MarketTerminal />);
    choose('AAPL.XNAS');
    const oldBestBid = within(
      depth().getByRole('row', { name: /^买 1 / }),
    ).getAllByRole('cell')[0].textContent;
    fireEvent.click(depth().getByRole('button', { name: '回放盘口断序' }));
    expect(depth().getByText(/盘口失同步/)).toBeVisible();
    expect(depth().queryByRole('table')).toBeNull();
    expect(quotes().getByRole('table', { name: 'L1 最优报价' })).toBeVisible();
    fireEvent.click(depth().getByRole('button', { name: '回放后续增量' }));
    expect(depth().queryByRole('table')).toBeNull();
    fireEvent.click(depth().getByRole('button', { name: '回放恢复快照' }));
    expect(depth().getByText(/已返回买 3 档 \/ 卖 4 档/)).toBeVisible();
    expect(
      within(depth().getByRole('row', { name: /^买 1 / })).getAllByRole(
        'cell',
      )[0].textContent,
    ).not.toBe(oldBestBid);
  });

  it('disposes an old book subscription and discards late data when returning to a market', () => {
    const emitters: ((event: BookEvent) => void)[] = [];
    const unsubscribe = vi.fn();
    const source: BookSource = {
      instrument: 'AAPL.XNAS',
      venue: 'Nasdaq',
      timeliness: '回放',
      subscribe(emit) {
        emitters.push(emit);
        return unsubscribe;
      },
    };
    render(
      <MarketTerminal
        adapter={{
          ...fixtureAdapter,
          read(request) {
            const reading = fixtureAdapter.read(request);
            return hasReading(reading) && request.id === 'AAPL.XNAS'
              ? { ...reading, book: source }
              : reading;
          },
        }}
      />,
    );
    choose('AAPL.XNAS');
    act(() => emitters[0](snapshot));
    expect(depth().getByText('9.0000100')).toBeVisible();

    choose('MSFT.XNAS');
    expect(unsubscribe).toHaveBeenCalledOnce();
    choose('AAPL.XNAS');
    expect(depth().queryByRole('table')).toBeNull();
    act(() => emitters[0](snapshot));
    expect(depth().queryByRole('table')).toBeNull();
    act(() => emitters[1](snapshot));
    expect(depth().getByText('12000.000012')).toBeVisible();
    act(() => emitters[1]({ kind: 'unavailable', reason: '连接中断' }));
    expect(depth().queryByRole('table')).toBeNull();
    expect(depth().getByText('连接中断')).toBeVisible();
  });

  it('keeps Binance disabled by default and distinguishes venue, spot and perpetual fixtures', () => {
    const fetch = vi.fn();
    const socket = vi.fn();
    const events = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('WebSocket', socket);
    vi.stubGlobal('EventSource', events);
    mountTrading();

    const venue = screen.getByRole('combobox', { name: '加密场所与产品' });
    expect(venue).toHaveValue('hyperliquid-perp');
    expect(
      quotes().getByText('BTC-USD-PERP.HYPERLIQUID · 比特币'),
    ).toBeVisible();
    expect(
      quotes().getByRole('region', { name: '永续合约指标' }),
    ).toBeVisible();
    fireEvent.change(venue, { target: { value: 'binance-spot' } });
    expect(quotes().getByText('Binance 已由部署配置关闭')).toBeVisible();
    expect(quotes().queryByRole('table')).toBeNull();
    expect(quotes().queryByText(/BTC-USD-PERP\.HYPERLIQUID/)).toBeNull();
    fireEvent.click(
      screen.getByRole('checkbox', { name: '启用 Binance 合成回放' }),
    );
    expect(quotes().getByText('BTC-USDT.BINANCE · 比特币')).toBeVisible();
    expect(quotes().queryByRole('region', { name: '永续合约指标' })).toBeNull();
    const spotPrice = quotes().getByRole('table', {
      name: 'L1 最优报价',
    }).textContent;
    fireEvent.change(venue, { target: { value: 'binance-perp' } });
    expect(quotes().getByText('BTC-USDT-PERP.BINANCE · 比特币')).toBeVisible();
    expect(
      quotes().getByRole('region', { name: '永续合约指标' }),
    ).toBeVisible();
    expect(
      quotes().getByRole('table', { name: 'L1 最优报价' }).textContent,
    ).not.toBe(spotPrice);
    expect(
      screen.queryByRole('button', { name: /下单|提交订单|买入|卖出/ }),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
  });

  it('shows a regional restriction separately from a disabled profile', () => {
    render(
      <MarketTerminal
        adapter={{
          ...fixtureAdapter,
          read(request) {
            return request.cryptoMarket === 'binance-spot'
              ? { availability: 'region_restricted' }
              : fixtureAdapter.read(request);
          },
        }}
      />,
    );
    fireEvent.change(
      chart().getByRole('combobox', { name: '加密场所与产品' }),
      {
        target: { value: 'binance-spot' },
      },
    );
    expect(quotes().getByText('Binance 区域限制（HTTP 451）')).toBeVisible();
    expect(quotes().queryByText('Binance 已由部署配置关闭')).toBeNull();
    expect(quotes().queryByRole('table')).toBeNull();
  });

  it('caps fixed Nasdaq focus at two and deduplicates the one following slot', () => {
    render(<MarketTerminal />);
    choose('NVDA.XNAS');
    expect(budget().getByText('IBKR L1 预算 100 行')).toBeVisible();
    expect(
      budget().getByText('股票常驻 9 · 热点期权 16 · 期权轮换 45 · 余量 30'),
    ).toBeVisible();
    expect(budget().getByText('Nasdaq 跟随 1/1 · NVDA.XNAS')).toBeVisible();
    expect(
      budget().getByRole('button', { name: '固定 Nasdaq 深度' }),
    ).toBeDisabled();
    choose('MSFT.XNAS');
    expect(budget().getByText('Nasdaq 跟随 0/1 · 空闲')).toBeVisible();
    fireEvent.click(
      budget().getByRole('button', { name: '取消固定 Nasdaq 深度' }),
    );
    expect(budget().getByText('Nasdaq 跟随 1/1 · MSFT.XNAS')).toBeVisible();
    choose('NVDA.XNAS');
    fireEvent.click(budget().getByRole('button', { name: '固定 Nasdaq 深度' }));
    expect(
      budget().getByText('Nasdaq 固定 2/2 · AAPL.XNAS、NVDA.XNAS'),
    ).toBeVisible();
    expect(budget().getByText('Nasdaq 跟随 0/1 · 空闲')).toBeVisible();
  });

  it('persists saved instruments, the selected period and the market timezone', () => {
    const view = render(<MarketTerminal />);
    choose('NVDA.XNAS');
    fireEvent.click(watchlist().getByRole('button', { name: '移出自选' }));
    fireEvent.click(watchlist().getByRole('checkbox', { name: '仅看已保存' }));
    fireEvent.click(chart().getByRole('button', { name: '4 小时' }));
    fireEvent.change(chart().getByRole('combobox', { name: '时间显示' }), {
      target: { value: 'market' },
    });
    view.unmount();

    render(<MarketTerminal />);
    expect(chart().getByRole('heading', { name: 'NVDA.XNAS' })).toBeVisible();
    expect(chart().getByRole('button', { name: '4 小时' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(chart().getByText(/已返回 12 根闭合 K 线/)).toBeVisible();
    expect(
      quotes().getByText('2026-11-18 07:00:00 America/New_York'),
    ).toHaveAttribute('datetime', '2026-11-18T12:00:00Z');
    expect(
      watchlist().queryByRole('button', { name: /^NVDA\.XNAS/ }),
    ).toBeNull();
    fireEvent.click(watchlist().getByRole('button', { name: '保存到自选' }));
    expect(
      watchlist().getByRole('button', { name: /^NVDA\.XNAS/ }),
    ).toBeVisible();
  });

  it('shows history provenance, indicator columns and warmup on the selected bar', () => {
    render(<MarketTerminal />);
    choose('AAPL.XNAS');
    expect(chart().getByText('数据类别 · 价量历史')).toBeVisible();
    expect(
      chart().getByText(
        /美国综合 · 合成回放 · 未复权 · 已返回 48 根闭合 K 线和 1 根预览/,
      ),
    ).toBeVisible();
    expect(chart().getByText('未闭合预览')).toBeVisible();
    const selector = chart().getByRole('combobox', { name: '指标' });
    expect(
      within(selector)
        .getAllByRole('option')
        .map(({ textContent }) => textContent),
    ).toEqual([
      '无',
      'SMA (5)',
      'EMA (8)',
      'Wilder RSI (7)',
      '布林带 (8)',
      'MACD (3, 6, 3)',
    ]);
    fireEvent.change(selector, { target: { value: 'indicator.macd@1.0.0' } });
    const exact = within(chart().getByLabelText('指标精确读数'));
    for (const column of ['MACD', '信号', '柱值'])
      expect(exact.getByText(column)).toBeVisible();
    expect(exact.getByText('0.000411')).toBeVisible();
    fireEvent.change(chart().getByRole('slider'), { target: { value: '0' } });
    expect(chart().getByText('预热中')).toBeVisible();
    expect(chart().queryByText('未闭合预览')).toBeNull();
  });
});
