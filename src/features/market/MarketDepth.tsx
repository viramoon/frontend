import { useMemo, useSyncExternalStore } from 'react';
import {
  DetailPanelData,
  includesDetailTime,
  type DetailDateRange,
} from '../../components/PanelDataClass';
import {
  DataState,
  displayDataTime,
  type DisplayTimeZone,
} from '../../components/TerminalStates';
import type { BookSource, Level, SubscriptionBudget } from './marketData';
import {
  applyBookEvent,
  waitingForBook,
  type BookEvent,
  type BookState,
} from './orderBook';

function createBookStore(source?: BookSource) {
  let state: BookState = waitingForBook;
  let step = 0;
  let publish = () => {};
  function receive(event: BookEvent) {
    state = applyBookEvent(state, event);
    publish();
  }
  return {
    subscribe(listener: () => void) {
      publish = listener;
      state = waitingForBook;
      step = 0;
      let active = true;
      const unsubscribe = source?.subscribe((event) => {
        if (active) receive(event);
      });
      return () => {
        active = false;
        publish = () => {};
        unsubscribe?.();
      };
    },
    getSnapshot: () => state,
    advance() {
      const event = source?.replay?.[step];
      if (event) {
        step += 1;
        receive(event);
      }
    },
    nextReplay: () => source?.replay?.[step]?.kind,
  };
}

export function useMarketDepth(source?: BookSource) {
  const store = useMemo(() => createBookStore(source), [source]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { state, advance: store.advance, next: store.nextReplay() };
}

export function DepthTable({
  bids,
  asks,
  currency,
  unit,
  label,
}: {
  bids: readonly Level[];
  asks: readonly Level[];
  currency: string;
  unit: string;
  label: string;
}) {
  return (
    <table aria-label={label}>
      <thead>
        <tr>
          <th scope="col">方向</th>
          <th scope="col">价格（{currency}）</th>
          <th scope="col">数量（{unit}）</th>
        </tr>
      </thead>
      <tbody>
        {(['bid', 'ask'] as const).map((side) =>
          (side === 'bid' ? bids : asks).map(({ price, quantity }, index) => (
            <tr key={`${side}/${price}`}>
              <th scope="row">
                {side === 'bid' ? '买' : '卖'} {index + 1}
              </th>
              <td>{price}</td>
              <td>{quantity}</td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}

export function MarketDepth({
  source,
  depth,
  currency,
  unit,
  timeZone,
  detailRange,
}: {
  source: BookSource;
  depth: ReturnType<typeof useMarketDepth>;
  currency: string;
  unit: string;
  timeZone: DisplayTimeZone;
  detailRange: DetailDateRange;
}) {
  const { availableFrom } = source;
  if (!availableFrom) return null;

  const { state, advance, next } = depth;
  const inRange =
    state.kind === 'current' &&
    includesDetailTime(detailRange, state.asOf, availableFrom);
  return (
    <section className="market-depth" aria-label="盘口深度">
      <h3>盘口深度</h3>
      <p>
        {source.instrument} · {source.venue} 场所深度
      </p>
      <DetailPanelData availableFrom={availableFrom} range={detailRange}>
        {source.coverage && <p>{source.coverage}</p>}
        <div className="market-book-status" aria-live="polite">
          {state.kind === 'current' ? (
            inRange ? (
              <p>
                已返回买 {state.bids.length} 档 / 卖 {state.asks.length} 档 ·
                已同步
              </p>
            ) : (
              <DataState kind="empty" title="该区间没有返回盘口快照" />
            )
          ) : (
            <DataState
              kind="stale"
              title={state.reason}
              detail="当前盘口档位已隐藏。"
            />
          )}
        </div>
        {inRange && (
          <>
            <p>
              样本覆盖 · 当前快照{' '}
              <time dateTime={state.asOf}>
                {displayDataTime(state.asOf, timeZone)}
              </time>{' '}
              · 盘口时效 {source.timeliness}
            </p>
            {state.bids.length + state.asks.length > 0 ? (
              <DepthTable
                bids={state.bids}
                asks={state.asks}
                currency={currency}
                unit={unit}
                label="场所订单簿"
              />
            ) : (
              <p>快照为空</p>
            )}
          </>
        )}
        {next && (
          <button type="button" className="market-control" onClick={advance}>
            {next === 'snapshot'
              ? '回放恢复快照'
              : state.kind === 'current'
                ? '回放盘口断序'
                : '回放后续增量'}
          </button>
        )}
      </DetailPanelData>
    </section>
  );
}

export function MarketBudget({
  budget,
  pinned,
  follow,
  eligible,
  togglePin,
}: {
  budget: SubscriptionBudget;
  pinned: readonly string[];
  follow: string | null;
  eligible?: string;
  togglePin: () => void;
}) {
  const selectedPinned = !!eligible && pinned.includes(eligible);
  const full = pinned.length >= budget.pinnedDepth;
  return (
    <section className="market-depth" aria-label="模拟额度">
      <h3>模拟额度</h3>
      <p>IBKR L1 预算 {budget.total} 行</p>
      <p>
        股票常驻 {budget.stocks} · 热点期权 {budget.hotOptions} · 期权轮换{' '}
        {budget.rotating} · 余量 {budget.reserve}
      </p>
      <p>
        Nasdaq 固定 {pinned.length}/{budget.pinnedDepth} ·{' '}
        {pinned.join('、') || '空闲'}
      </p>
      <p>
        Nasdaq 跟随 {follow ? 1 : 0}/{budget.followingDepth} ·{' '}
        {follow ?? '空闲'}
      </p>
      {eligible && (
        <button
          type="button"
          className="market-control"
          onClick={togglePin}
          disabled={!selectedPinned && full}
        >
          {selectedPinned ? '取消固定 Nasdaq 深度' : '固定 Nasdaq 深度'}
        </button>
      )}
      {eligible && !selectedPinned && full && (
        <p>固定名额已满，当前标的使用跟随名额。</p>
      )}
    </section>
  );
}
