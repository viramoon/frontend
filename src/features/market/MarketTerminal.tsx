import { useEffect, useId, useRef, useState } from 'react';
import { MarketChart } from '../../components/MarketChart';
import {
  DataBadges,
  DataState,
  displayDataTime,
  SourceDetails,
} from '../../components/TerminalStates';
import {
  hasQuote,
  marketFixtures,
  periods,
  replayTime,
  type MarketFixture,
  type MarketPeriod,
  type QuotedFixture,
} from './marketFixture';
import './market.css';

const drawerLabels = {
  watchlist: '自选与搜索',
  quote: '报价与深度',
};
type Drawer = keyof typeof drawerLabels;

function Change({ quote }: { quote: QuotedFixture['quote'] }) {
  const direction = { 上涨: 'up', 下跌: 'down', 持平: 'flat' }[quote.direction];
  return (
    <span className={`market-change market-change--${direction}`}>
      {quote.direction} {quote.change}
    </span>
  );
}

function Watchlist({
  query,
  selected,
  onQueryChange,
  onSelect,
}: {
  query: string;
  selected: string;
  onQueryChange: (query: string) => void;
  onSelect: (fixture: MarketFixture) => void;
}) {
  const searchId = useId();
  const search = query.trim().toLowerCase();
  const matches = marketFixtures.filter((fixture) =>
    `${fixture.id} ${fixture.name} ${fixture.product}`
      .toLowerCase()
      .includes(search),
  );
  return (
    <div className="market-watchlist-content">
      <div className="market-watchlist-heading">
        <h2>自选</h2>
        <DataBadges fixture />
      </div>
      <label htmlFor={searchId} className="market-field-label">
        搜索自选标的
      </label>
      <input
        id={searchId}
        type="search"
        placeholder="代码、名称或类别"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {matches.length === 0 ? (
        <DataState kind="empty" title="没有匹配的标的" />
      ) : (
        <ul className="market-instruments">
          {matches.map((fixture) => (
            <li key={fixture.id}>
              <button
                type="button"
                aria-pressed={fixture.id === selected}
                onClick={() => onSelect(fixture)}
              >
                <span className="market-instrument-name">
                  <strong>{fixture.id}</strong>
                  <span>{fixture.product}</span>
                </span>
                <span className="market-instrument-price">
                  {hasQuote(fixture) ? (
                    <>
                      <span>{fixture.quote.price}</span>
                      {fixture.availability === 'stale' ? (
                        <span className="market-stale-label">陈旧</span>
                      ) : (
                        <Change quote={fixture.quote} />
                      )}
                    </>
                  ) : (
                    <span>
                      {fixture.availability === 'denied' ? '无权' : '无数据'}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Unavailable({ kind }: { kind: 'denied' | 'empty' }) {
  return kind === 'denied' ? (
    <DataState
      kind="denied"
      title="无权读取行情"
      detail="该标的演示需要额外读取权限时的界面。"
    />
  ) : (
    <DataState
      kind="empty"
      title="暂无回放数据"
      detail="这个演示标的没有记录。可在自选列表选择其他标的。"
      illustrated
    />
  );
}

function QuoteDetails({ fixture }: { fixture: MarketFixture }) {
  return (
    <div className="market-quote-content">
      <h2>报价与来源</h2>
      <p className="market-instrument-description">
        {fixture.id} · {fixture.name}
      </p>
      {hasQuote(fixture) ? (
        <>
          <div className="market-quote">
            <p className="market-quote-label">最近收盘（{fixture.currency}）</p>
            <p className="market-quote-price">
              <strong>{fixture.quote.price}</strong>
            </p>
            <div className="market-quote-comparison">
              <Change quote={fixture.quote} />
              <span>较前一小时收盘</span>
            </div>
          </div>
          <SourceDetails
            source={fixture.source}
            asOf={fixture.asOf}
            freshness={fixture.availability === 'stale' ? 'stale' : 'current'}
            fixture
            replay
            delay={fixture.delay}
          />
          <section className="market-depth" aria-label="盘口深度">
            <h3>盘口深度</h3>
            {fixture.quote.depth.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th scope="col">方向</th>
                    <th scope="col">价格</th>
                    <th scope="col">数量（{fixture.quantityUnit}）</th>
                  </tr>
                </thead>
                <tbody>
                  {fixture.quote.depth.map((level) => (
                    <tr key={level.side}>
                      <th scope="row">{level.side}</th>
                      <td>{level.price}</td>
                      <td>{level.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>此标的暂无盘口样本。</p>
            )}
          </section>
        </>
      ) : (
        <p className="market-quote-unavailable">
          {fixture.availability === 'denied'
            ? '模拟权限限制，报价和盘口均不可读取。'
            : '该标的暂无报价或盘口样本。'}
        </p>
      )}
      <section className="market-source-note">
        <h3>读数说明</h3>
        <p>Fixture 为本地合成数据。价格与数量保留源值的小数位。</p>
        {hasQuote(fixture) && (
          <p>
            回放基准时间{' '}
            <time dateTime={replayTime}>{displayDataTime(replayTime)}</time>
          </p>
        )}
      </section>
    </div>
  );
}

export function MarketTerminal() {
  const [selected, setSelected] = useState<MarketFixture>(marketFixtures[0]);
  const [period, setPeriod] = useState<MarketPeriod>('1h');
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const quoted = hasQuote(selected) ? selected : undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, [drawer]);

  function closeDrawer() {
    if (dialogRef.current?.open) dialogRef.current.close();
    setDrawer(null);
    opener.current?.focus();
  }

  const watchlist = (
    <Watchlist
      query={query}
      selected={selected.id}
      onQueryChange={setQuery}
      onSelect={(fixture) => {
        setSelected(fixture);
        if (drawer) closeDrawer();
      }}
    />
  );
  const quoteDetails = <QuoteDetails fixture={selected} />;

  return (
    <section aria-label="行情终端" className="market-terminal">
      <div className="market-mobile-actions">
        {(['watchlist', 'quote'] as const).map((panel) => (
          <button
            key={panel}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={drawer === panel}
            aria-controls={drawer === panel ? dialogId : undefined}
            onClick={(event) => {
              opener.current = event.currentTarget;
              setDrawer(panel);
            }}
          >
            {drawerLabels[panel]}
          </button>
        ))}
      </div>
      <div className="market-columns">
        <aside aria-label="自选列表" className="market-panel market-sidebar">
          {watchlist}
        </aside>
        <div className="market-centre">
          <section aria-label="主 K 线与成交量" className="market-panel">
            <header className="market-chart-header">
              <div className="market-chart-heading">
                <div>
                  <h2>{selected.id}</h2>
                  <p>
                    {selected.name} · {selected.product}
                  </p>
                </div>
                <DataBadges fixture replay={!!quoted} delay={quoted?.delay} />
              </div>
              <div className="market-chart-toolbar">
                <p>主 K 线 · 成交量</p>
                <div
                  role="group"
                  aria-label="K 线周期"
                  className="market-periods"
                >
                  {periods.map(({ id, label }) => (
                    <button
                      type="button"
                      key={id}
                      aria-pressed={period === id}
                      disabled={!quoted}
                      onClick={() => setPeriod(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </header>
            <div className="market-chart-body">
              {selected.availability === 'stale' && (
                <DataState
                  kind="stale"
                  title="行情陈旧"
                  detail="展示上次记录的合成报价与 K 线。"
                />
              )}
              {hasQuote(selected) ? (
                <MarketChart
                  key={`${selected.id}/${period}`}
                  bars={selected.bars[period]}
                  instrument={selected.id}
                  currency={selected.currency}
                  quantityUnit={selected.quantityUnit}
                />
              ) : (
                <Unavailable kind={selected.availability} />
              )}
            </div>
          </section>
          <section
            aria-labelledby="market-indicators"
            className="market-panel market-indicators"
          >
            <h2 id="market-indicators">指标</h2>
            <p>U2 将在此显示指标时序与参数。</p>
          </section>
        </div>
        <aside aria-label="报价与来源" className="market-panel market-sidebar">
          {quoteDetails}
        </aside>
      </div>
      {drawer && (
        <dialog
          id={dialogId}
          ref={dialogRef}
          className="market-drawer"
          data-side={drawer === 'watchlist' ? 'left' : 'right'}
          aria-label={drawerLabels[drawer]}
          onCancel={(event) => {
            event.preventDefault();
            closeDrawer();
          }}
        >
          <div className="market-drawer-actions">
            <button type="button" onClick={closeDrawer}>
              关闭抽屉
            </button>
          </div>
          {drawer === 'watchlist' ? watchlist : quoteDetails}
        </dialog>
      )}
    </section>
  );
}
