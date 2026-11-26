import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketChart, type ChartBar } from '../components/MarketChart';
import { DataState, SourceDetails } from '../components/TerminalStates';

const chartMock = vi.hoisted(() => {
  const chartSeries = () => {
    const pane = { setStretchFactor: vi.fn() };
    return { setData: vi.fn(), getPane: () => pane };
  };
  const candle = chartSeries();
  const volume = chartSeries();
  const timescale = { fitContent: vi.fn(), getVisibleLogicalRange: vi.fn() };
  const chart = {
    addSeries: vi.fn((_series, _options, pane?: number) =>
      pane === 1 ? volume : candle,
    ),
    remove: vi.fn(),
    setCrosshairPosition: vi.fn(),
    subscribeCrosshairMove:
      vi.fn<(callback: (event: { time: number }) => void) => void>(),
    timeScale: () => timescale,
  };
  return { candle, volume, chart, create: vi.fn(() => chart) };
});

vi.mock('lightweight-charts', async (load) => ({
  ...(await load<typeof import('lightweight-charts')>()),
  createChart: chartMock.create,
}));

const bars: readonly ChartBar[] = [
  {
    time: '2026-11-03T12:00:00Z',
    open: '12345678901234567890.12345678',
    high: '12345678901234567890.12345680',
    low: '12345678901234567890.12345677',
    close: '12345678901234567890.12345679',
    volume: '9007199254740993.00000100',
  },
  {
    time: '2026-11-03T13:00:00Z',
    open: '22.60000000',
    high: '22.62000000',
    low: '21.96000000',
    close: '21.96800000',
    volume: '560.0000',
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('终端图表', () => {
  it('keeps exact OHLCV and directions available through the labeled range when canvas is unavailable', () => {
    render(
      <MarketChart
        bars={bars}
        instrument="DEMO"
        currency="USD"
        quantityUnit="股"
      />,
    );

    expect(screen.getByText(/当前环境无法绘制图表/)).toBeVisible();
    expect(chartMock.create).not.toHaveBeenCalled();
    expect(screen.getByText(bars[1].close)).toBeVisible();
    expect(screen.getByText('收跌')).toBeVisible();

    const slider = screen.getByRole('slider', { name: 'K 线时间' });
    expect(slider).toHaveAttribute(
      'aria-valuetext',
      `2026-11-03 13:00:00 UTC，收盘 ${bars[1].close} USD`,
    );
    fireEvent.change(slider, { target: { value: '0' } });

    const values = within(screen.getByLabelText('K 线精确读数'));
    for (const raw of [
      bars[0].open,
      bars[0].high,
      bars[0].low,
      bars[0].close,
      bars[0].volume,
    ]) {
      expect(values.getByText(raw)).toBeVisible();
    }
    expect(values.getByText('成交量（股）')).toBeVisible();
    expect(screen.getByText('收涨')).toBeVisible();
    expect(slider).toHaveAttribute(
      'aria-valuetext',
      `2026-11-03 12:00:00 UTC，收盘 ${bars[0].close} USD`,
    );
    expect(
      screen.getByRole('link', { name: /Lightweight Charts.*TradingView/ }),
    ).toHaveAttribute('href', 'https://www.tradingview.com/');
  });

  it('renders both approximate canvas series and resolves crosshair readings from the exact source strings', () => {
    vi.stubGlobal('ResizeObserver', class ResizeObserver {});
    vi.stubGlobal(
      'CanvasRenderingContext2D',
      class CanvasRenderingContext2D {},
    );
    const view = render(
      <MarketChart bars={bars} instrument="DEMO" currency="USD" />,
    );

    const firstTime = Date.parse(bars[0].time) / 1000;
    const secondTime = Date.parse(bars[1].time) / 1000;
    expect(chartMock.candle.setData).toHaveBeenCalledWith([
      expect.objectContaining({
        time: firstTime,
        close: Number(bars[0].close),
      }),
      expect.objectContaining({
        time: secondTime,
        close: Number(bars[1].close),
      }),
    ]);
    expect(chartMock.volume.setData).toHaveBeenCalledWith([
      expect.objectContaining({
        time: firstTime,
        value: Number(bars[0].volume),
      }),
      expect.objectContaining({
        time: secondTime,
        value: Number(bars[1].volume),
      }),
    ]);
    expect(chartMock.chart.addSeries.mock.calls[1][2]).toBe(1);
    expect(chartMock.candle.getPane().setStretchFactor).toHaveBeenCalledWith(3);
    expect(chartMock.volume.getPane().setStretchFactor).toHaveBeenCalledWith(1);

    const onCrosshairMove =
      chartMock.chart.subscribeCrosshairMove.mock.calls[0][0];
    act(() => onCrosshairMove({ time: firstTime }));
    expect(screen.getByText(bars[0].close)).toBeVisible();
    expect(screen.getByText(bars[0].volume)).toBeVisible();

    fireEvent.change(screen.getByRole('slider'), { target: { value: '1' } });
    expect(chartMock.chart.setCrosshairPosition).toHaveBeenCalledWith(
      Number(bars[1].close),
      secondTime,
      chartMock.candle,
    );
    view.unmount();
    expect(chartMock.chart.remove).toHaveBeenCalledOnce();
  });
});

describe('共享行情状态', () => {
  it.each([
    ['loading', '正在加载'],
    ['stale', '数据陈旧'],
    ['denied', '无权查看'],
    ['empty', '暂无数据'],
  ] as const)('renders a textual %s indication', (kind, content) => {
    render(<DataState kind={kind} detail="状态说明" />);
    expect(screen.getByText(content)).toBeVisible();
    expect(screen.getByText('状态说明')).toBeVisible();
    if (kind === 'loading')
      expect(screen.getByRole('status')).toHaveTextContent(content);
  });

  it('identifies fixture, replay, delay, stale provenance and source time in text', () => {
    render(
      <SourceDetails
        source="合成行情 A"
        asOf="2026-11-03T13:00:00.120000Z"
        freshness="stale"
        fixture
        replay
        delay="15 分钟"
      />,
    );

    for (const label of [
      'Fixture · 示例数据',
      '回放',
      '延迟 15 分钟',
      '合成行情 A',
      '数据陈旧',
    ]) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.getByText('2026-11-03 13:00:00.120000 UTC')).toHaveAttribute(
      'datetime',
      '2026-11-03T13:00:00.120000Z',
    );
  });
});
