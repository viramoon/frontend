import { useEffect, useId, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  type UTCTimestamp,
} from 'lightweight-charts';
import { DataState, displayDataTime } from './TerminalStates';
import './market-chart.css';

export type ChartBar = {
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

const background = '#15172a';
const upColor = '#70d6ba';
const downColor = '#f3a2bd';
const flatColor = '#b6b3ca';

const directionLabels = {
  up: '收涨',
  down: '收跌',
  flat: '平盘',
};

function candleDirection(open: string, close: string) {
  const [openInteger, openFraction = ''] = open.split('.');
  const [closeInteger, closeFraction = ''] = close.split('.');
  const scale = Math.max(openFraction.length, closeFraction.length);
  const scaledOpen = BigInt(openInteger + openFraction.padEnd(scale, '0'));
  const scaledClose = BigInt(closeInteger + closeFraction.padEnd(scale, '0'));
  if (scaledClose > scaledOpen) return 'up';
  if (scaledClose < scaledOpen) return 'down';
  return 'flat';
}

function canvasData(bars: readonly ChartBar[]) {
  // Canvas coordinates are approximate. The displayed values come from ChartBar.
  return bars.map((bar) => {
    const [open, high, low, close, volume] = [
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      bar.volume,
    ].map(Number);
    const time = (Date.parse(bar.time) / 1000) as UTCTimestamp;
    const direction = candleDirection(bar.open, bar.close);
    const color = { up: upColor, down: downColor, flat: flatColor }[direction];
    return {
      candle: {
        time,
        open,
        high,
        low,
        close,
        color: direction === 'down' ? background : color,
        borderColor: color,
        wickColor: color,
      },
      volume: { time, value: volume, color: `${color}a0` },
    };
  });
}

type TooltipProps = {
  id: string;
  bar: ChartBar;
  currency: string;
  quantityUnit?: string;
};

function ExactValueTooltip({ id, bar, currency, quantityUnit }: TooltipProps) {
  const direction = candleDirection(bar.open, bar.close);
  return (
    <div className="market-chart-reading" id={id}>
      <div className="market-chart-reading-heading">
        <time dateTime={bar.time}>{displayDataTime(bar.time)}</time>
        <strong className={`market-chart-direction ${direction}`}>
          {directionLabels[direction]}
        </strong>
      </div>
      <dl className="market-chart-values" aria-label="K 线精确读数">
        {[
          ['开盘', bar.open, currency],
          ['最高', bar.high, currency],
          ['最低', bar.low, currency],
          ['收盘', bar.close, currency],
          ['成交量', bar.volume, quantityUnit],
        ].map(([label, value, unit]) => (
          <div key={label}>
            <dt>{unit ? `${label}（${unit}）` : label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type MarketChartProps = {
  bars: readonly ChartBar[];
  instrument: string;
  currency: string;
  quantityUnit?: string;
};

export function MarketChart({
  bars,
  instrument,
  currency,
  quantityUnit,
}: MarketChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const moveCrosshair = useRef<(index: number) => void>(null);
  const tooltipId = useId();
  const [selection, setSelection] = useState({ bars, index: bars.length - 1 });
  const [unavailableBars, setUnavailableBars] = useState<readonly ChartBar[]>();
  const index = selection.bars === bars ? selection.index : bars.length - 1;
  const bar = bars[index];
  const canvasUnavailable = unavailableBars === bars;

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    if (
      typeof ResizeObserver !== 'function' ||
      typeof CanvasRenderingContext2D !== 'function'
    ) {
      setUnavailableBars(bars);
      return;
    }

    let chart: ReturnType<typeof createChart> | undefined;
    try {
      const data = canvasData(bars);
      chart = createChart(container, {
        autoSize: true,
        layout: {
          attributionLogo: false,
          background: { type: ColorType.Solid, color: background },
          textColor: '#ccc9e0',
          panes: { separatorColor: '#3e3b58' },
        },
        grid: {
          horzLines: { color: '#2c2e46' },
          vertLines: { color: '#2c2e46' },
        },
        crosshair: { mode: CrosshairMode.Magnet },
        rightPriceScale: { borderColor: '#44415d' },
        timeScale: { borderColor: '#44415d', timeVisible: true },
        handleScroll: { vertTouchDrag: false },
      });
      const candles = chart.addSeries(CandlestickSeries, {
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const volume = chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: 'volume' },
          priceLineVisible: false,
          lastValueVisible: false,
        },
        1,
      );
      candles.setData(data.map(({ candle }) => candle));
      volume.setData(data.map(({ volume }) => volume));
      candles.getPane().setStretchFactor(3);
      volume.getPane().setStretchFactor(1);
      const timescale = chart.timeScale();
      timescale.fitContent();

      const candleIndexes = new Map(
        data.map(({ candle }, index) => [candle.time, index]),
      );
      chart.subscribeCrosshairMove(({ time }) => {
        if (typeof time !== 'number') return;
        const index = candleIndexes.get(time);
        if (index === undefined) return;
        setSelection((previous) =>
          previous.bars === bars && previous.index === index
            ? previous
            : { bars, index },
        );
      });

      const currentChart = chart;
      moveCrosshair.current = (index) => {
        const { close, time } = data[index].candle;
        const range = timescale.getVisibleLogicalRange();
        if (range && (index < range.from || index > range.to)) {
          const width = range.to - range.from;
          const from = Math.max(0, index - width / 2);
          timescale.setVisibleLogicalRange({ from, to: from + width });
        }
        currentChart.setCrosshairPosition(close, time, candles);
      };
      setUnavailableBars(undefined);
    } catch {
      chart?.remove();
      container.replaceChildren();
      setUnavailableBars(bars);
      return;
    }

    return () => {
      moveCrosshair.current = null;
      chart.remove();
    };
  }, [bars]);

  if (!bar) return <DataState kind="empty" title="暂无 K 线" />;

  return (
    <figure className="market-chart" aria-label={`${instrument} K 线和成交量`}>
      <ExactValueTooltip
        id={tooltipId}
        bar={bar}
        currency={currency}
        quantityUnit={quantityUnit}
      />
      <div
        aria-hidden="true"
        className="market-chart-canvas"
        ref={host}
        hidden={canvasUnavailable}
      />
      {canvasUnavailable && (
        <p className="market-chart-fallback">
          当前环境无法绘制图表，仍可查看精确读数。
        </p>
      )}
      <figcaption className="market-chart-footer">
        {bars.length > 1 && (
          <label className="market-chart-range">
            <span>K 线时间</span>
            <input
              aria-describedby={tooltipId}
              aria-valuetext={`${displayDataTime(bar.time)}，收盘 ${bar.close} ${currency}`}
              type="range"
              min={0}
              max={bars.length - 1}
              value={index}
              onChange={(event) => {
                const index = event.currentTarget.valueAsNumber;
                setSelection({ bars, index });
                moveCrosshair.current?.(index);
              }}
            />
          </label>
        )}
        <div className="market-chart-attribution">
          <a href="https://www.tradingview.com/">
            Lightweight Charts™ by TradingView
          </a>
          <span>© 2026 TradingView, Inc.</span>
          <a
            href={`${import.meta.env.BASE_URL}third-party/lightweight-charts/NOTICE`}
          >
            许可与署名
          </a>
        </div>
      </figcaption>
    </figure>
  );
}
