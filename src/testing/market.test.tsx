import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketTerminal } from '../features/market/MarketTerminal';
import { hasQuote, marketFixtures } from '../features/market/marketFixture';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function chart() {
  return within(screen.getByRole('region', { name: '主 K 线与成交量' }));
}

function quotes() {
  return within(screen.getByRole('complementary', { name: '报价与来源' }));
}

function watchlist() {
  return within(screen.getByRole('complementary', { name: '自选列表' }));
}

describe('行情终端', () => {
  it('labels fixture replay, simulated delay, source time and exact quotes without a request', () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    render(<MarketTerminal />);

    expect(chart().getByText('Fixture · 示例数据')).toBeVisible();
    expect(chart().getByText('回放')).toBeVisible();
    expect(chart().getByText('延迟 15 分钟（模拟）')).toBeVisible();
    expect(quotes().getByText('本地合成行情')).toBeVisible();
    expect(quotes().getByText('已更新')).toBeVisible();
    expect(quotes().getByText('2026-11-18 12:00:00 UTC')).toHaveAttribute(
      'datetime',
      '2026-11-18T12:00:00Z',
    );
    expect(quotes().getByText('67529.712500')).toBeVisible();
    expect(quotes().getByText('上涨 +63.000000')).toBeVisible();
    expect(quotes().getByText('2.0040')).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it('filters the watchlist, switches the active instrument and selects a chart period', () => {
    render(<MarketTerminal />);

    const search = watchlist().getByRole('searchbox', { name: '搜索自选标的' });
    fireEvent.change(search, { target: { value: 'eth' } });
    expect(watchlist().queryByRole('button', { name: /BTC-USD/ })).toBeNull();

    const ethereum = watchlist().getByRole('button', { name: /ETH-USD/ });
    fireEvent.click(ethereum);
    expect(ethereum).toHaveAttribute('aria-pressed', 'true');
    expect(chart().getByRole('heading', { name: 'ETH-USD' })).toBeVisible();
    expect(quotes().getByText('下跌 -10.080000')).toBeVisible();

    fireEvent.click(chart().getByRole('button', { name: '4 小时' }));
    expect(chart().getByRole('button', { name: '4 小时' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(chart().getByRole('button', { name: '1 小时' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.change(search, { target: { value: 'missing' } });
    expect(watchlist().getByText('没有匹配的标的')).toBeVisible();
  });

  it('identifies stale data and clears the previous quote for denied or empty fixtures', () => {
    render(<MarketTerminal />);

    fireEvent.click(watchlist().getByRole('button', { name: /QQQ\.XNAS/ }));
    expect(chart().getByText('行情陈旧')).toBeVisible();
    expect(quotes().getByText('数据陈旧')).toBeVisible();
    expect(quotes().getByText('517.230000')).toBeVisible();

    fireEvent.click(watchlist().getByRole('button', { name: /NDX/ }));
    expect(chart().getByText('无权读取行情')).toBeVisible();
    expect(chart().getByRole('button', { name: '1 小时' })).toBeDisabled();
    expect(quotes().queryByText('517.230000')).toBeNull();
    expect(quotes().queryByText('本地合成行情')).toBeNull();

    fireEvent.click(watchlist().getByRole('button', { name: /VIX/ }));
    expect(chart().getByText('暂无回放数据')).toBeVisible();
    expect(chart().getByText('Fixture · 示例数据')).toBeVisible();
    expect(quotes().queryByText('数据陈旧')).toBeNull();
  });

  it('opens modal drawers and restores trigger focus on dismissal or selection', () => {
    const prototype = HTMLDialogElement.prototype;
    // jsdom exposes dialog.open but does not implement the native modal methods.
    Object.defineProperties(prototype, {
      showModal: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.open = true;
          this.querySelector('button')?.focus();
        },
      },
      close: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.open = false;
        },
      },
    });

    try {
      render(<MarketTerminal />);
      const showWatchlist = screen.getByRole('button', { name: '自选与搜索' });
      fireEvent.click(showWatchlist);
      const choose = screen.getByRole('dialog', { name: '自选与搜索' });
      expect(showWatchlist).toHaveAttribute('aria-expanded', 'true');
      expect(
        within(choose).getByRole('button', { name: '关闭抽屉' }),
      ).toHaveFocus();
      fireEvent.click(within(choose).getByRole('button', { name: /ETH-USD/ }));
      expect(choose).not.toBeInTheDocument();
      expect(showWatchlist).toHaveFocus();

      const showQuote = screen.getByRole('button', { name: '报价与深度' });
      fireEvent.click(showQuote);
      const depth = screen.getByRole('dialog', { name: '报价与深度' });
      expect(
        within(depth).getByRole('heading', { name: '盘口深度' }),
      ).toBeVisible();
      expect(within(depth).getByText('3476.792800')).toBeVisible();
      fireEvent(depth, new Event('cancel', { cancelable: true }));
      expect(depth).not.toBeInTheDocument();
      expect(showQuote).toHaveFocus();
    } finally {
      Reflect.deleteProperty(prototype, 'showModal');
      Reflect.deleteProperty(prototype, 'close');
    }
  });

  it('aggregates the fixture periods in fixed point and serializes exact readings', () => {
    const bitcoin = marketFixtures[0];
    expect(hasQuote(bitcoin)).toBe(true);
    if (!hasQuote(bitcoin)) throw new Error('BTC fixture must contain quotes');

    expect(bitcoin.bars['1h']).toHaveLength(48);
    expect(bitcoin.bars['4h']).toHaveLength(12);
    expect(bitcoin.bars['4h'][0]).toEqual({
      time: '2026-11-16T12:00:00.000Z',
      open: '66878.712500',
      high: '66926.712500',
      low: '66836.712500',
      close: '66863.712500',
      volume: '29.6901',
    });
    expect(bitcoin.bars['4h'].at(-1)?.close).toBe(bitcoin.quote.price);
  });
});
