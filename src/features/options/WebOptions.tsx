import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { WebRequestError } from '../../api';
import { privateOptions } from '../../api/adminWeb';
import {
  marketVenueDepth,
  optionsChain,
  optionsExposure,
  optionsFlowObservations,
  optionsFlowVerification,
} from '../../api/generated/sdk.gen';
import type {
  DealerScenario,
  DepthBook,
  DepthSymbol,
  ExposureView,
  OptionChainContract,
  OptionFlowObservationPage,
  OptionFlowVerificationPage,
  ProductPolicy,
} from '../../api/generated/types.gen';
import { DataClassLabel } from '../../components/PanelDataClass';
import { DataState, displayDataTime } from '../../components/TerminalStates';
import './options.css';

const unknown = '未知';
const depthSymbols: DepthSymbol[] = [
  'QQQ',
  'AAPL',
  'MSFT',
  'NVDA',
  'AMZN',
  'GOOGL',
  'META',
  'TSLA',
];
const scenarios: Record<DealerScenario, string> = {
  absolute: '绝对集中度',
  dealer_short: '做市商净卖假设',
  dealer_long: '做市商净买假设',
  call_long_put_short: 'Call 正 / Put 负假设',
};

function ReadState({
  read,
  title,
}: {
  read: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  title: string;
}) {
  if (read.isPending)
    return <DataState kind="loading" title={`正在读取${title}`} />;
  if (!read.isError) return null;
  const error = read.error;
  if (
    error instanceof WebRequestError &&
    (error.status === 401 || error.status === 403)
  )
    return <DataState kind="denied" title={`无权查看${title}`} />;

  const pending =
    error instanceof WebRequestError &&
    error.code === 'finance_contract_pending';
  return (
    <div role={pending ? 'status' : 'alert'}>
      <DataState
        kind="empty"
        title={`${title}${pending ? '待接入' : '读取失败'}`}
        detail={
          pending
            ? 'finance_contract_pending'
            : error instanceof WebRequestError
              ? error.message
              : undefined
        }
      />
      <button
        type="button"
        className="refresh"
        onClick={() => void read.refetch()}
      >
        重新读取{title}
      </button>
    </div>
  );
}

function Source({ access, at }: { access: ProductPolicy; at?: string | null }) {
  return (
    <p className="option-note">
      来源 {access.source} / {access.product} · 许可 {access.license}
      {at && (
        <>
          {' '}
          · <time dateTime={at}>{displayDataTime(at)}</time>
        </>
      )}
    </p>
  );
}

function Table({
  label,
  headers,
  children,
}: {
  label: string;
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div
      className="result-table-wrap"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="result-table">
        <thead>
          <tr>
            {headers.map((name) => (
              <th scope="col" key={name}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function WebOptions({ page }: { page: 'flow' | 'exposure' }) {
  const [contract, setContract] = useState<OptionChainContract>();
  return (
    <section className="options-terminal">
      <h1>{page === 'flow' ? '期权流水' : '期权敞口'}</h1>
      <Chain onSelect={page === 'flow' ? setContract : undefined} />
      {page === 'flow' ? (
        <Flow key={contract?.con_id} contract={contract} />
      ) : (
        <>
          <Exposure />
          <VenueDepth />
        </>
      )}
    </section>
  );
}

function Chain({
  onSelect,
}: {
  onSelect?: (contract: OptionChainContract) => void;
}) {
  const [underlying, setUnderlying] = useState<string>();
  const [after, setAfter] = useState<number>();
  const read = useQuery({
    queryKey: ['options-web', 'chain', underlying, after],
    enabled: Boolean(underlying),
    gcTime: 0,
    queryFn: async ({ signal }) =>
      (
        await optionsChain({
          ...privateOptions,
          signal,
          query: {
            underlying_con_id: Number(underlying),
            after_con_id: after,
            limit: 30,
          },
        })
      ).data,
  });
  const page = read.isError ? undefined : read.data;
  return (
    <section className="option-panel" aria-labelledby="live-option-chain">
      <h2 id="live-option-chain">期权链</h2>
      <DataClassLabel kind="price-volume" />
      <form
        className="option-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const id = String(
            new FormData(event.currentTarget).get('underlying'),
          );
          if (underlying === id && after === undefined) void read.refetch();
          setUnderlying(id);
          setAfter(undefined);
        }}
      >
        <label className="option-field">
          标的 IBKR ConId
          <input
            name="underlying"
            type="number"
            required
            min={1}
            max={2147483647}
          />
        </label>
        <div className="backtest-actions">
          <button className="refresh" type="submit">
            读取期权链
          </button>
        </div>
      </form>
      {underlying && <ReadState read={read} title="期权链" />}
      {page && (
        <>
          <Source access={page.access} at={page.as_of} />
          <p>
            标的 ConId {page.underlying_con_id} ·{' '}
            {page.discovery_complete ? '合约发现完成' : '合约发现未完成'}
          </p>
          {page.items.length === 0 ? (
            <DataState kind="empty" title="本页暂无期权合约" />
          ) : (
            <Table
              label="期权合约表"
              headers={[
                '合约 ConId',
                '标的',
                '到期日',
                '类型',
                '行权价',
                '乘数',
                '场所',
              ]}
            >
              {page.items.map((item) => (
                <tr key={item.con_id}>
                  <th scope="row">
                    {onSelect ? (
                      <button
                        type="button"
                        onClick={() => onSelect(item)}
                        aria-label={`选择流水合约 ${item.con_id}`}
                      >
                        {item.con_id}
                      </button>
                    ) : (
                      item.con_id
                    )}
                  </th>
                  <td>{item.symbol}</td>
                  <td>{item.expiry}</td>
                  <td>{item.right === 'call' ? 'Call' : 'Put'}</td>
                  <td>{item.strike}</td>
                  <td>{item.multiplier}</td>
                  <td>{item.primary_exchange ?? unknown}</td>
                </tr>
              ))}
            </Table>
          )}
          <div className="backtest-actions">
            {after !== undefined && (
              <button type="button" onClick={() => setAfter(undefined)}>
                期权链首页
              </button>
            )}
            {page.next_after_con_id != null && (
              <button
                type="button"
                onClick={() => setAfter(page.next_after_con_id ?? undefined)}
              >
                下一页合约
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

type FlowQuery = { con_id: number; start: string; end: string };

function Flow({ contract }: { contract?: OptionChainContract }) {
  const [request, setRequest] = useState<FlowQuery>();
  const [offset, setOffset] = useState(0);
  const [verified, setVerified] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const read = useQuery({
    queryKey: ['options-web', 'flow', request, verified, offset],
    enabled: Boolean(request),
    gcTime: 0,
    queryFn: async ({ signal }) => {
      if (!request) throw new Error('Missing options flow window');
      const query = { ...request, offset, limit: 20 };
      return verified
        ? (await optionsFlowVerification({ ...privateOptions, signal, query }))
            .data
        : (await optionsFlowObservations({ ...privateOptions, signal, query }))
            .data;
    },
  });
  const result = read.isError ? undefined : read.data;
  const mode = verified ? '核验流水' : '观察流水';
  function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const start = new Date(String(values.get('start')) + 'Z');
    const end = new Date(String(values.get('end')) + 'Z');
    const con_id = Number(values.get('contract'));
    if (
      !(start < end) ||
      !Number.isInteger(con_id) ||
      con_id < 1 ||
      con_id > 2147483647
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setOffset(0);
    const query = {
      con_id,
      start: start.toISOString(),
      end: end.toISOString(),
    };
    if (
      offset === 0 &&
      request?.con_id === con_id &&
      request.start === query.start &&
      request.end === query.end
    )
      void read.refetch();
    setRequest(query);
  }
  return (
    <section className="option-panel" aria-labelledby="live-option-flow">
      <h2 id="live-option-flow">观察与历史核验</h2>
      <DataClassLabel kind="detail" />
      <form className="option-filters" onSubmit={load}>
        <label className="option-field">
          流水合约 IBKR ConId
          <input
            name="contract"
            type="number"
            defaultValue={contract?.con_id}
            required
            min={1}
            max={2147483647}
          />
        </label>
        <label className="option-field">
          开始时间（UTC）
          <input name="start" type="datetime-local" required />
        </label>
        <label className="option-field">
          结束时间（UTC，不含）
          <input name="end" type="datetime-local" required />
        </label>
        <label className="option-field">
          流水类型
          <select
            value={verified ? 'verified' : 'observed'}
            onChange={(event) => {
              setVerified(event.target.value === 'verified');
              setOffset(0);
            }}
          >
            <option value="observed">观察线索</option>
            <option value="verified">历史核验</option>
          </select>
        </label>
        <div className="backtest-actions">
          <button className="refresh" type="submit">
            读取流水
          </button>
        </div>
      </form>
      {invalid && <p role="alert">请输入递增的 UTC 时间区间和有效合约号。</p>}
      {request && <ReadState read={read} title={mode} />}
      {result && (
        <>
          <p>
            合约 {result.con_id} · {displayDataTime(result.start)} 至{' '}
            {displayDataTime(result.end)}
          </p>
          {'items' in result ? (
            <ObservationRows page={result} />
          ) : (
            <VerificationRows page={result} />
          )}
          <div className="backtest-actions">
            {offset > 0 && (
              <button type="button" onClick={() => setOffset(0)}>
                流水首页
              </button>
            )}
            {result.next_offset !== null && (
              <button
                type="button"
                onClick={() => setOffset(result.next_offset ?? 0)}
              >
                下一页流水
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ObservationRows({ page }: { page: OptionFlowObservationPage }) {
  return (
    <>
      <Source access={page.access} at={page.as_of} />
      {!page.items.length && (
        <DataState kind="empty" title="所选区间暂无观察线索" />
      )}
      {page.items.map(({ clue, coverage, budget }, index) => (
        <details
          key={`${clue.generation}/${clue.observed_at}/${clue.observation.kind}/${index}`}
        >
          <summary>
            {clue.observation.kind === 'volume_increase'
              ? '累计放量'
              : '报价异动'}{' '}
            · {displayDataTime(clue.observed_at)} · 待历史核验
          </summary>
          <p>
            规则 {clue.rule_version} · 乘数 {clue.multiplier} · 调度状态{' '}
            {budget.phase}
          </p>
          {clue.observation.kind === 'volume_increase' ? (
            <p>
              累计量差 {clue.observation.evidence.delta_contracts} ·
              估计权利金额{' '}
              {clue.observation.evidence.estimated_premium ?? unknown} ·
              单笔规模未知
            </p>
          ) : (
            <p>
              价差 {clue.observation.evidence.spread} · 典型价差{' '}
              {clue.observation.evidence.typical_spread}
            </p>
          )}
          <p>
            {coverage
              ? `订阅区间 ${coverage.covered.length} · 未订阅 ${coverage.uncovered.length} · 覆盖未知 ${coverage.unknown.length}`
              : '订阅覆盖未知'}
          </p>
        </details>
      ))}
    </>
  );
}

function VerificationRows({ page }: { page: OptionFlowVerificationPage }) {
  return (
    <>
      <Source access={page.access} at={page.verified_at} />
      <p>
        已核验 {page.counts.verified} · 方向未知 {page.counts.unknown} ·
        不可用区间 {page.counts.unavailable_intervals} · 待核验区间{' '}
        {page.counts.pending_intervals}
      </p>
      {!page.trades.length && (
        <DataState kind="empty" title="所选区间暂无核验成交" />
      )}
      {page.trades.map(
        ({
          trade,
          status,
          inference,
          condition,
          premium,
          link,
          suspected_scale,
        }) => (
          <details
            key={`${trade.batch.requested_start}/${trade.batch.page}/${trade.row.occurred_at}/${trade.occurrence}`}
          >
            <summary>
              核验成交 · {displayDataTime(trade.row.occurred_at)} ·{' '}
              {trade.row.price} × {trade.row.quantity} · {status}
            </summary>
            <p>
              场所 {trade.row.exchange} · 取得时间{' '}
              {displayDataTime(trade.batch.obtained_at)} · 权利金额{' '}
              {premium ?? unknown}
            </p>
            <p>
              方向 {inference.direction} · 置信度 {inference.confidence} ·{' '}
              {inference.reason} · 规则 {inference.rule_version}
            </p>
            <p>
              原始条件 {trade.row.special_conditions || '无'} · 映射{' '}
              {condition.mapping_version} ·{' '}
              {condition.meaning.status === 'mapped'
                ? condition.meaning.condition
                : condition.meaning.status}
            </p>
            {inference.quote && (
              <p>
                报价证据 {inference.quote.quote.row.bid ?? unknown} /{' '}
                {inference.quote.quote.row.ask ?? unknown} ·{' '}
                {inference.quote.age_ms} ms
              </p>
            )}
            {link && <p>成交关联 {link.action.kind}</p>}
            <p>
              规模判定 {suspected_scale.block_contracts_threshold ?? unknown}
              （大宗合约阈值） /{' '}
              {suspected_scale.institution_scale_premium_threshold ?? unknown}
              （机构规模金额阈值）
            </p>
          </details>
        ),
      )}
      {page.issues.length > 0 && (
        <ul aria-label="核验缺口">
          {page.issues.map((issue, index) => (
            <li key={`${issue.start}/${issue.kind}/${index}`}>
              {displayDataTime(issue.start)} 至 {displayDataTime(issue.end)} ·{' '}
              {issue.kind} · {issue.reason}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Exposure() {
  const [instrument, setInstrument] = useState('SPY.ARCA');
  const [scenario, setScenario] = useState<DealerScenario>('absolute');
  const [slice, setSlice] = useState<'all' | 'zero_dte' | 'later'>('all');
  const read = useQuery({
    queryKey: ['options-web', 'exposure', instrument, scenario],
    gcTime: 0,
    queryFn: async ({ signal }) =>
      (
        await optionsExposure({
          ...privateOptions,
          signal,
          query: { underlying_id: instrument, scenario },
        })
      ).data,
  });
  const data = read.isError ? undefined : read.data;
  return (
    <section className="option-panel" aria-labelledby="live-option-exposure">
      <h2 id="live-option-exposure">Gamma 敞口</h2>
      <DataClassLabel kind="price-volume" />
      <form
        className="option-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const id = String(
            new FormData(event.currentTarget).get('instrument'),
          ).trim();
          if (id && id === instrument) void read.refetch();
          else if (id) setInstrument(id);
        }}
      >
        <label className="option-field">
          标的 Instrument ID
          <input name="instrument" defaultValue={instrument} required />
        </label>
        <div className="backtest-actions">
          <button className="refresh" type="submit">
            读取敞口
          </button>
        </div>
        <label className="option-field">
          敞口假设
          <select
            value={scenario}
            onChange={(event) =>
              setScenario(event.target.value as DealerScenario)
            }
          >
            {Object.entries(scenarios).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="option-field">
          到期范围
          <select
            value={slice}
            onChange={(event) => setSlice(event.target.value as typeof slice)}
          >
            <option value="all">全部</option>
            <option value="zero_dte">0DTE</option>
            <option value="later">后续到期</option>
          </select>
        </label>
      </form>
      <ReadState read={read} title="敞口" />
      {data && (
        <>
          <Source access={data.access} at={data.report.as_of} />
          <p>
            {data.report.underlying_id} · 交易日 {data.report.session_date} ·
            模型 {data.report.model_version}
          </p>
          <p>
            假设 · {scenarios[data.report.scenario]} · 实测现货{' '}
            {data.report.spot.value} @{' '}
            {displayDataTime(data.report.spot.observed_at)}
          </p>
          <ExposureReadings view={data.report[slice]} />
          {data.report.gamma_grid && (
            <details>
              <summary>查看情景网格口径</summary>
              <p>
                {data.report.gamma_grid.model} ·{' '}
                {displayDataTime(data.report.gamma_grid.as_of)} · 年化利率{' '}
                {data.report.gamma_grid.annual_risk_free_rate} · 年化股息率{' '}
                {data.report.gamma_grid.annual_dividend_yield}
              </p>
              <p>评估现货点 {data.report.gamma_grid.spots.join('、')}</p>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function ExposureReadings({ view }: { view: ExposureView }) {
  const { coverage, totals, walls, flip } = view;
  const wall = (value: ExposureView['walls']['largest_absolute']) =>
    value ? `${value.strike}（${value.exposure}）` : unknown;
  return (
    <>
      <p>
        {coverage.partial ? '局部覆盖' : '完整覆盖'} · 有效合约{' '}
        {coverage.valid_contracts} / {coverage.candidate_contracts} ·{' '}
        {coverage.universe_complete ? '合约集合完整' : '合约集合未齐'}
      </p>
      <p>
        OI 基准日 {coverage.open_interest_dates.join('、') || '日期未证实'} ·
        日期未证实合约 {coverage.unconfirmed_open_interest_dates} · 有效 OI /
        全部 OI {coverage.eligible_open_interest} /{' '}
        {coverage.total_open_interest ?? unknown}
      </p>
      <p>
        实测覆盖 {displayDataTime(coverage.observed.earliest)} 至{' '}
        {displayDataTime(coverage.observed.latest)}
      </p>
      {coverage.open_interest_observed && (
        <p>
          OI 观察 {displayDataTime(coverage.open_interest_observed.earliest)} 至{' '}
          {displayDataTime(coverage.open_interest_observed.latest)}
        </p>
      )}
      <p>
        缺失 Gamma {coverage.exclusions.missing_gamma} · 缺失 OI{' '}
        {coverage.exclusions.missing_open_interest} · 陈旧 Gamma{' '}
        {coverage.exclusions.stale_gamma} · 陈旧现货{' '}
        {coverage.exclusions.stale_spot} · 时间偏差{' '}
        {coverage.exclusions.spot_gamma_skew}
      </p>
      <p>
        绝对集中度 {totals.absolute ?? unknown} · 净 GEX {totals.gex ?? unknown}
        （USD delta / 1%）
      </p>
      {coverage.valid_contracts === 0 && (
        <DataState kind="empty" title="所选范围暂无有效敞口输入" />
      )}
      <p>
        绝对集中 wall {wall(walls.largest_absolute)} · 最大正 wall{' '}
        {wall(walls.largest_positive)} · 最大负 wall {wall(walls.most_negative)}
      </p>
      <p>
        Gamma flip ·{' '}
        {flip.status === 'crossings'
          ? flip.crossings
              .map(
                ({ lower_spot, upper_spot }) => `${lower_spot}–${upper_spot}`,
              )
              .join('、')
          : flip.status === 'no_flip'
            ? '网格内无过零点'
            : `未评估（${flip.reason}）`}
      </p>
      {view.by_strike.length > 0 && (
        <Table
          label="按行权价敞口"
          headers={['行权价', '绝对集中度', '净 GEX']}
        >
          {view.by_strike.map(({ strike, totals }) => (
            <tr key={strike}>
              <th scope="row">{strike}</th>
              <td>{totals.absolute ?? unknown}</td>
              <td>{totals.gex ?? unknown}</td>
            </tr>
          ))}
        </Table>
      )}
      {view.by_expiry.length > 0 && (
        <Table
          label="按到期日敞口"
          headers={['到期日', '绝对集中度', '净 GEX']}
        >
          {view.by_expiry.map(({ expiry, totals }) => (
            <tr key={expiry}>
              <th scope="row">{expiry}</th>
              <td>{totals.absolute ?? unknown}</td>
              <td>{totals.gex ?? unknown}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

const depthState: Record<DepthBook['state'], string> = {
  permission_unconfirmed: '权限未确认',
  awaiting: '等待场所档位',
  receiving: '正在接收',
  reset: '盘口已重置',
  inactive: '未订阅场所深度',
  failed: '场所深度失败',
};

function VenueDepth() {
  const [symbol, setSymbol] = useState<DepthSymbol>();
  const read = useQuery({
    queryKey: ['options-web', 'depth', symbol],
    enabled: Boolean(symbol),
    gcTime: 0,
    queryFn: async ({ signal }) => {
      if (!symbol) throw new Error('Missing venue symbol');
      return (
        await marketVenueDepth({ ...privateOptions, signal, query: { symbol } })
      ).data;
    },
  });
  const book = read.isError ? undefined : read.data;
  return (
    <section className="option-panel" aria-labelledby="live-option-depth">
      <h2 id="live-option-depth">标的场所深度</h2>
      <DataClassLabel kind="detail" />
      <label className="option-field">
        Nasdaq 深度标的
        <select
          value={symbol ?? ''}
          onChange={(event) =>
            setSymbol(depthSymbols.find((id) => id === event.target.value))
          }
        >
          <option value="">选择标的</option>
          {depthSymbols.map((id) => (
            <option key={id}>{id}</option>
          ))}
        </select>
      </label>
      {symbol && !read.isPending && !read.isError && (
        <div className="backtest-actions">
          <button
            type="button"
            className="refresh"
            onClick={() => void read.refetch()}
          >
            刷新场所深度
          </button>
        </div>
      )}
      {symbol && <ReadState read={read} title="场所深度" />}
      {book && (
        <>
          <Source access={book.access} at={book.received_at} />
          <p>
            {book.symbol} · {book.venue} · {depthState[book.state]}
            {book.failure && ` · ${book.failure}`} · 返回档数{' '}
            {book.returned_rows} / {book.requested_rows} · marketDataType{' '}
            {book.market_data_type ?? unknown}
          </p>
          <p>
            权限确认 · 股票 L1{' '}
            {book.permissions.equity_l1_confirmed ? '已确认' : '未确认'} ·
            TotalView{' '}
            {book.permissions.totalview_confirmed ? '已确认' : '未确认'} · EDS{' '}
            {book.permissions.eds_confirmed ? '已确认' : '未确认'}
          </p>
          {book.state !== 'receiving' ||
          (!book.bids.length && !book.asks.length) ? (
            <DataState kind="empty" title="当前暂无可展示的深度档位" />
          ) : (
            <Table label="场所深度档位" headers={['方向', '价格', '数量']}>
              {(['bids', 'asks'] as const).flatMap((side) =>
                book[side].map(({ price, size }, index) => (
                  <tr key={`${side}/${index}`}>
                    <th scope="row">{side === 'bids' ? '买' : '卖'}</th>
                    <td>{price}</td>
                    <td>{size}</td>
                  </tr>
                )),
              )}
            </Table>
          )}
        </>
      )}
    </section>
  );
}
