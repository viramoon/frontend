import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { MarketChart } from '../../components/MarketChart';
import { DataBadges, DataState } from '../../components/TerminalStates';
import { binanceReplayAdapter, fixtureAdapter } from './fixtureAdapter';
import { useMarketDepth } from './MarketDepth';
import { Change, MarketQuotes, TradePrints, Unavailable } from './MarketQuotes';
import {
  cryptoMarkets,
  hasReading,
  periods,
  type CryptoMarket,
  type MarketDataAdapter,
  type MarketInstrument,
  type MarketReading,
} from './marketData';
import {
  readPreferences,
  writePreferences,
  type MarketPreferences,
} from './marketPreferences';
import './market.css';

const drawerLabels = { watchlist: '自选与搜索', quote: '报价与深度' };
type Drawer = keyof typeof drawerLabels;

function Watchlist({
  instruments,
  prefs,
  query,
  fixture,
  readQuote,
  onQueryChange,
  onSelect,
  onPreferencesChange,
}: {
  instruments: readonly MarketInstrument[];
  prefs: MarketPreferences;
  query: string;
  fixture: boolean;
  readQuote: (instrument: MarketInstrument) => MarketReading;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  onPreferencesChange: (changes: Partial<MarketPreferences>) => void;
}) {
  const searchId = useId();
  const search = query.trim().toLowerCase();
  const matches = instruments.filter(
    ({ id, name, product }) =>
      (!prefs.onlySaved || prefs.saved.includes(id)) &&
      `${id} ${name} ${product}`.toLowerCase().includes(search),
  );
  const isSaved = prefs.saved.includes(prefs.selected);
  const editable = instruments.some(
    ({ id, kind }) => id === prefs.selected && kind !== 'diagnostic',
  );
  return (
    <div className="market-watchlist-content">
      <div className="market-watchlist-heading">
        <h2>自选</h2>
        <DataBadges fixture={fixture} />
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
      <div className="market-watchlist-actions">
        <label className="market-field-label">
          <input
            type="checkbox"
            checked={prefs.onlySaved}
            onChange={(event) =>
              onPreferencesChange({ onlySaved: event.target.checked })
            }
          />
          仅看已保存
        </label>
        {editable && (
          <button
            type="button"
            className="market-control"
            onClick={() =>
              onPreferencesChange({
                saved: isSaved
                  ? prefs.saved.filter((id) => id !== prefs.selected)
                  : [...prefs.saved, prefs.selected],
              })
            }
          >
            {isSaved ? '移出自选' : '保存到自选'}
          </button>
        )}
      </div>
      {matches.length === 0 ? (
        <DataState kind="empty" title="没有匹配的标的" />
      ) : (
        <ul className="market-instruments">
          {matches.map((instrument) => {
            const { id, product } = instrument;
            const reading = readQuote(instrument);
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-pressed={id === prefs.selected}
                  onClick={() => onSelect(id)}
                >
                  <span className="market-instrument-name">
                    <strong>{id === 'SPY.ARCA' ? 'SPY · Arca' : id}</strong>
                    <span>{product}</span>
                  </span>
                  <span className="market-instrument-price">
                    {hasReading(reading) ? (
                      <>
                        <span>{reading.quote.price}</span>
                        {reading.availability === 'stale' ? (
                          <span className="market-stale-label">陈旧</span>
                        ) : (
                          <Change quote={reading.quote} />
                        )}
                      </>
                    ) : (
                      <span>
                        {
                          {
                            denied: '无权',
                            empty: '无数据',
                            loading: '加载中',
                            disabled_by_profile: '配置已关闭',
                            region_restricted: '区域限制',
                          }[reading.availability]
                        }
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function MarketTerminal({
  adapter: providedAdapter,
  trading = false,
}: {
  adapter?: MarketDataAdapter;
  trading?: boolean;
}) {
  const [binanceDemo, setBinanceDemo] = useState(false);
  const adapter =
    providedAdapter ?? (binanceDemo ? binanceReplayAdapter : fixtureAdapter);
  useSyncExternalStore(adapter.subscribe, adapter.revision);
  const [prefs, setPreferences] = useState(() =>
    readPreferences(adapter.instruments),
  );
  const [indicatorId, setIndicatorId] = useState('');
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  const selected =
    adapter.instruments.find(({ id }) => id === prefs.selected) ??
    adapter.instruments[0];
  const requestId = selected?.id ?? '';
  const cryptoMarket =
    selected?.kind === 'crypto' ? prefs.cryptoMarket : 'hyperliquid-perp';
  const request = { id: requestId, cryptoMarket };
  const reading = adapter.read(request);
  const quoted = hasReading(reading) ? reading : undefined;
  const unavailable = hasReading(reading) ? undefined : reading.availability;
  const history =
    quoted && !trading ? adapter.history(request, prefs.period) : undefined;
  const depth = useMarketDepth(
    selected?.kind === 'l1-only' ? undefined : quoted?.book,
  );
  const pinnedDepth = adapter.budget.pinnedDepth;
  const pinned = prefs.pinned.slice(0, pinnedDepth);
  const eligible = selected?.kind === 'nasdaq' ? selected.id : undefined;
  const follow =
    eligible && !pinned.includes(eligible) && adapter.budget.followingDepth > 0
      ? eligible
      : null;
  const timeZone =
    prefs.timeZone === 'market' ? (selected?.timeZone ?? 'UTC') : 'UTC';
  const indicator = history?.indicators.find(({ id }) => id === indicatorId);

  const period = trading ? null : prefs.period;
  useEffect(() => {
    if (!requestId) return;
    return adapter.watch?.(
      { id: requestId, cryptoMarket },
      { period, pinned: prefs.pinned.slice(0, pinnedDepth), follow },
    );
  }, [
    adapter,
    requestId,
    cryptoMarket,
    period,
    prefs.pinned,
    pinnedDepth,
    follow,
  ]);
  useEffect(() => writePreferences(prefs), [prefs]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, [drawer]);

  function closeDrawer() {
    if (dialogRef.current?.open) dialogRef.current.close();
    setDrawer(null);
    opener.current?.focus();
  }

  function updatePreferences(changes: Partial<MarketPreferences>) {
    setPreferences((previous) => ({ ...previous, ...changes }));
  }

  if (!selected) return <DataState kind="empty" title="暂无标的" />;

  const watchlist = (
    <Watchlist
      instruments={adapter.instruments}
      prefs={prefs}
      query={query}
      fixture={!!adapter.fixture}
      readQuote={({ id, kind }) =>
        adapter.read({
          id,
          cryptoMarket:
            kind === 'crypto' ? prefs.cryptoMarket : 'hyperliquid-perp',
        })
      }
      onQueryChange={setQuery}
      onSelect={(id) => {
        updatePreferences({ selected: id });
        if (drawer) closeDrawer();
      }}
      onPreferencesChange={updatePreferences}
    />
  );
  const quoteDetails = (
    <MarketQuotes
      instrument={selected}
      reading={reading}
      depth={depth}
      timeZone={timeZone}
      replayTime={adapter.fixture?.replayTime}
      trading={trading}
      budget={{
        budget: adapter.budget,
        pinned,
        follow,
        eligible,
        togglePin: () => {
          if (!eligible) return;
          setPreferences((previous) => {
            const current = previous.pinned;
            if (current.includes(eligible)) {
              return {
                ...previous,
                pinned: current.filter((id) => id !== eligible),
              };
            }
            if (current.length >= adapter.budget.pinnedDepth) return previous;
            return { ...previous, pinned: [...current, eligible] };
          });
        },
      }}
    />
  );

  return (
    <section
      aria-label="行情终端"
      className="market-terminal"
      data-fixture-seed={adapter.fixture?.seed}
    >
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
          <section
            aria-label={trading ? '市场选择' : '主 K 线与成交量'}
            className="market-panel"
          >
            <header className="market-chart-header">
              <div className="market-chart-heading">
                <div>
                  <h2>{selected.id}</h2>
                  <p>
                    {selected.name} · {selected.product}
                  </p>
                </div>
                <DataBadges
                  fixture={!!adapter.fixture}
                  replay={quoted?.replay}
                  delay={quoted?.delay}
                />
              </div>
              <div className="market-chart-toolbar">
                {!trading && <p>数据类别 · 价量历史</p>}
                <label className="market-field-label">
                  时间显示
                  <select
                    value={prefs.timeZone}
                    onChange={(event) =>
                      updatePreferences({
                        timeZone:
                          event.target.value === 'market' ? 'market' : 'UTC',
                      })
                    }
                  >
                    <option value="UTC">UTC</option>
                    <option value="market">
                      市场时区（{selected.timeZone}）
                    </option>
                  </select>
                </label>
                {selected.kind === 'crypto' && (
                  <>
                    <label className="market-field-label">
                      加密场所与产品
                      <select
                        value={prefs.cryptoMarket}
                        onChange={(event) =>
                          updatePreferences({
                            cryptoMarket: event.target.value as CryptoMarket,
                          })
                        }
                      >
                        {cryptoMarkets.map(({ id, venue, product }) => (
                          <option key={id} value={id}>
                            {venue} · {product}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!providedAdapter &&
                      prefs.cryptoMarket !== 'hyperliquid-perp' && (
                        <label className="market-field-label">
                          <input
                            type="checkbox"
                            checked={binanceDemo}
                            onChange={(event) =>
                              setBinanceDemo(event.target.checked)
                            }
                          />
                          启用 Binance 合成回放
                        </label>
                      )}
                  </>
                )}
              </div>
              {!trading && (
                <div className="market-chart-toolbar">
                  <div
                    role="group"
                    aria-label="K 线周期"
                    className="market-periods"
                  >
                    {periods.map(({ id, label }) => (
                      <button
                        type="button"
                        key={id}
                        aria-pressed={prefs.period === id}
                        disabled={!quoted}
                        onClick={() => updatePreferences({ period: id })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="market-field-label">
                    指标
                    <select
                      value={indicator?.id ?? ''}
                      disabled={!history?.indicators.length}
                      onChange={(event) => setIndicatorId(event.target.value)}
                    >
                      <option value="">无</option>
                      {history?.indicators.map(({ id, label }) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </header>
            {!trading && (
              <div className="market-chart-body">
                {reading.availability === 'stale' && (
                  <DataState
                    kind="stale"
                    title="行情陈旧"
                    detail="展示上次记录的报价与 K 线。"
                  />
                )}
                {quoted ? (
                  history ? (
                    <>
                      <p className="market-chart-provenance">
                        K 线来源 {history.source} · {history.adjustment} ·{' '}
                        {history.coverage}
                      </p>
                      {indicator && adapter.fixture && (
                        <p className="market-chart-provenance">
                          指标值为合成示意
                        </p>
                      )}
                      <MarketChart
                        key={`${quoted.instrument}/${prefs.period}`}
                        bars={history.bars}
                        instrument={selected.id}
                        currency={quoted.currency}
                        quantityUnit={selected.quantityUnit}
                        timeZone={timeZone}
                        indicator={indicator}
                      />
                    </>
                  ) : (
                    <DataState kind="empty" title="暂无 K 线" />
                  )
                ) : (
                  <Unavailable kind={unavailable ?? 'empty'} />
                )}
              </div>
            )}
            {trading && !quoted && (
              <div className="market-chart-body">
                <Unavailable kind={unavailable ?? 'empty'} />
              </div>
            )}
          </section>
          {trading && selected.kind !== 'l1-only' && (
            <TradePrints
              reading={reading}
              instrument={selected}
              timeZone={timeZone}
            />
          )}
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
