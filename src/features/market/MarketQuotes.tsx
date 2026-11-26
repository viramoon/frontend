import {
  DataClassLabel,
  DetailPanelData,
  includesDetailTime,
  type DetailDateRange,
} from '../../components/PanelDataClass';
import {
  DataState,
  SourceDetails,
  displayDataTime,
  type DisplayTimeZone,
} from '../../components/TerminalStates';
import {
  DepthTable,
  MarketBudget,
  MarketDepth,
  type useMarketDepth,
} from './MarketDepth';
import {
  hasReading,
  marketDataTypes,
  type MarketInstrument,
  type MarketQuote,
  type MarketReading,
} from './marketData';
import type { ComponentProps } from 'react';

export function Change({ quote }: { quote: MarketQuote }) {
  const direction = { 上涨: 'up', 下跌: 'down', 持平: 'flat' }[quote.direction];
  return (
    <span className={`market-change market-change--${direction}`}>
      {quote.direction} {quote.change}
    </span>
  );
}

export function Unavailable({
  kind,
}: {
  kind: Exclude<MarketReading['availability'], 'ready' | 'stale'>;
}) {
  const titles = {
    denied: '无权读取行情',
    empty: '暂无回放数据',
    loading: '正在加载行情',
    disabled_by_profile: 'Binance 已由部署配置关闭',
    region_restricted: 'Binance 区域限制（HTTP 451）',
  };
  return (
    <DataState
      kind={kind === 'denied' || kind === 'loading' ? kind : 'empty'}
      title={titles[kind]}
      illustrated={kind === 'empty'}
    />
  );
}

export function MarketQuotes({
  instrument,
  reading,
  depth,
  detailRange,
  budget,
  timeZone,
  replayTime,
  trading,
}: {
  instrument: MarketInstrument;
  reading: MarketReading;
  depth: ReturnType<typeof useMarketDepth>;
  detailRange: DetailDateRange;
  budget: ComponentProps<typeof MarketBudget>;
  timeZone: DisplayTimeZone;
  replayTime?: string;
  trading: boolean;
}) {
  const unit = instrument.quantityUnit;
  return (
    <div className="market-quote-content">
      <h2>报价与来源</h2>
      <DataClassLabel kind="price-volume" />
      <p className="market-instrument-description">
        {hasReading(reading) ? reading.instrument : instrument.id} ·{' '}
        {instrument.name}
      </p>
      {hasReading(reading) ? (
        <>
          <div className="market-quote">
            <p className="market-quote-label">
              {reading.venue} {reading.product} · 最近读数（{reading.currency}）
            </p>
            <p className="market-quote-price">
              <strong>{reading.quote.price}</strong>
            </p>
            <div className="market-quote-comparison">
              <Change quote={reading.quote} />
              {reading.marketDataType !== undefined && (
                <span className="terminal-badge">
                  marketDataType {reading.marketDataType} ·{' '}
                  {marketDataTypes[reading.marketDataType]}
                </span>
              )}
            </div>
            {instrument.kind === 'l1-only' && (
              <p className="market-quote-label">SPY 仅启用美国综合 L1。</p>
            )}
            <DepthTable
              bids={[reading.quote.bid]}
              asks={[reading.quote.ask]}
              currency={reading.currency}
              unit={unit}
              label="L1 最优报价"
            />
          </div>
          <SourceDetails
            source={reading.source}
            asOf={reading.asOf}
            freshness={reading.availability === 'stale' ? 'stale' : 'current'}
            fixture={reading.fixture}
            replay={reading.replay}
            delay={reading.delay}
            timeZone={timeZone}
          />
          {instrument.kind !== 'l1-only' && reading.book && (
            <MarketDepth
              source={reading.book}
              depth={depth}
              detailRange={detailRange}
              currency={reading.currency}
              unit={unit}
              timeZone={timeZone}
            />
          )}
          {trading && instrument.kind !== 'l1-only' && reading.derivatives && (
            <section className="market-depth" aria-label="永续合约指标">
              <h3>永续合约指标</h3>
              <DataClassLabel kind="price-volume" />
              <dl className="market-readings">
                <dt>标记价格（{reading.currency}）</dt>
                <dd>{reading.derivatives.mark}</dd>
                <dt>资金费率</dt>
                <dd>{reading.derivatives.fundingRate}</dd>
                <dt>未平仓量（{unit}）</dt>
                <dd>{reading.derivatives.openInterest}</dd>
              </dl>
            </section>
          )}
        </>
      ) : (
        <Unavailable kind={reading.availability} />
      )}
      <MarketBudget {...budget} />
      {replayTime && (
        <section className="market-source-note">
          <h3>读数说明</h3>
          <p>
            合成回放基准{' '}
            <time dateTime={replayTime}>
              {displayDataTime(replayTime, timeZone)}
            </time>
          </p>
        </section>
      )}
    </div>
  );
}

export function TradePrints({
  reading,
  instrument,
  timeZone,
  detailRange,
}: {
  reading: MarketReading;
  instrument: MarketInstrument;
  timeZone: DisplayTimeZone;
  detailRange: DetailDateRange;
}) {
  const quoted = hasReading(reading) ? reading : undefined;
  const prints = quoted?.trades?.filter(({ time }) =>
    includesDetailTime(detailRange, time, quoted.tradesAvailableFrom),
  );
  let first = prints?.[0]?.time ?? '';
  let last = first;
  for (const { time } of prints ?? []) {
    // Compare UTC timestamps without the Z suffix so fractional seconds sort naturally.
    const utc = time.slice(0, -1);
    if (utc < first.slice(0, -1)) first = time;
    if (utc > last.slice(0, -1)) last = time;
  }
  return (
    <section className="market-panel market-trades" aria-label="已成交记录">
      <h2>已成交记录</h2>
      {quoted && (
        <p className="market-quote-label">
          {quoted.instrument} · {quoted.venue} {quoted.product}
          {quoted.availability === 'stale' && ' · 陈旧'}
        </p>
      )}
      <DetailPanelData
        availableFrom={quoted?.tradesAvailableFrom}
        range={detailRange}
      >
        {prints?.length && quoted ? (
          <>
            <p className="market-quote-label">
              样本覆盖 ·{' '}
              <time dateTime={first}>{displayDataTime(first, timeZone)}</time>
              {first !== last && (
                <>
                  {' 至 '}
                  <time dateTime={last}>{displayDataTime(last, timeZone)}</time>
                </>
              )}
            </p>
            <table aria-label="逐笔成交">
              <thead>
                <tr>
                  <th scope="col">成交时间</th>
                  <th scope="col">价格（{quoted.currency}）</th>
                  <th scope="col">数量（{instrument.quantityUnit}）</th>
                </tr>
              </thead>
              <tbody>
                {prints.map(({ id, time, price, quantity }) => (
                  <tr key={id}>
                    <td>
                      <time dateTime={time}>
                        {displayDataTime(time, timeZone)}
                      </time>
                    </td>
                    <td>{price}</td>
                    <td>{quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <DataState kind="empty" title="暂无逐笔成交" />
        )}
      </DetailPanelData>
    </section>
  );
}
