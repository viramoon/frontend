import { DataClassLabel } from '../../components/PanelDataClass';
import { useState } from 'react';
import { DataState, displayDataTime } from '../../components/TerminalStates';
import { decimalKeys, readPremiumFilter } from './decimal';
import type {
  FlowEntry,
  FlowReading,
  HistoricalTrade,
  OptionContract,
} from './optionsData';

const paths = {
  all: '全部记录',
  observation: '只看观察',
  historical: '只看已核验',
  unknown: '只看方向未知',
  canceled: '只看已取消',
} as const;

const confidenceLabels = { high: '高', low: '低', unknown: '未知' };
const conditionLabels = {
  single: '单腿',
  complex: '明确多腿',
  unknown: '未映射或缺失',
};
const sideLabels = {
  buy: '推测主动买',
  sell: '推测主动卖',
  unknown: '方向未知',
};
const revisionLabels = {
  original: '原始',
  corrected: '已更正',
  canceled: '已取消',
};
const flagLabels = {
  sweep: '疑似 sweep',
  block: '疑似 block',
  institutional: '疑似机构规模',
};

function entryStatus(entry: FlowEntry) {
  if (entry.kind === 'observation') return '观察 · 待核验';
  return entry.revision === 'canceled'
    ? '历史记录 · 已取消'
    : '历史逐笔 · 已核验';
}

function matchesPath(entry: FlowEntry, path: string) {
  if (path === 'all') return true;
  if (entry.kind === 'observation') return path === 'observation';
  if (entry.revision === 'canceled') return path === 'canceled';
  return (
    path === 'historical' || (path === 'unknown' && entry.side === 'unknown')
  );
}

function premiumOf(entry: FlowEntry) {
  if (entry.kind === 'observation') return entry.estimatedPremium;
  return entry.revision === 'canceled' ? null : entry.premium;
}

function ContractLabel({
  contract,
  sessionDate,
}: {
  contract: OptionContract;
  sessionDate: string;
}) {
  return (
    <span>
      {contract.strike} {contract.right === 'call' ? 'Call' : 'Put'} ·{' '}
      <time dateTime={contract.expiry}>{contract.expiry}</time>
      {contract.expiry === sessionDate && ' · 0DTE'}
    </span>
  );
}

function HistoricalEvidence({ trade }: { trade: HistoricalTrade }) {
  const { bidAsk } = trade;
  return (
    <>
      <div>
        <dt>成交</dt>
        <dd>
          {trade.price} USD × {trade.size} 张 × {trade.contract.multiplier} 乘数
        </dd>
      </div>
      <div>
        <dt>成交场所</dt>
        <dd>{trade.venue}</dd>
      </div>
      <div>
        <dt>配对报价</dt>
        <dd>
          {bidAsk ? (
            <>
              Bid {bidAsk.bid} / Ask {bidAsk.ask} USD ·{' '}
              <time dateTime={bidAsk.at}>{displayDataTime(bidAsk.at)}</time>
            </>
          ) : (
            '无可用报价'
          )}
        </dd>
      </div>
      <div>
        <dt>方向依据</dt>
        <dd>{trade.inference}</dd>
      </div>
      <div>
        <dt>原始条件码</dt>
        <dd>
          {trade.rawConditions.join('、') || '缺失'} ·{' '}
          {conditionLabels[trade.condition]}
        </dd>
      </div>
      <div>
        <dt>映射版本</dt>
        <dd>{trade.mappingVersion}</dd>
      </div>
      <div>
        <dt>更正 / 取消</dt>
        <dd>
          {revisionLabels[trade.revision]}
          {trade.previousId && ` · 关联 ${trade.previousId}`}
        </dd>
      </div>
      {trade.flags.length > 0 && (
        <div>
          <dt>启发式标签</dt>
          <dd>
            {trade.flags.map((flag) => flagLabels[flag]).join('、')} ·
            缺少可确认关联的证据
          </dd>
        </div>
      )}
    </>
  );
}

function FlowRecord({
  entry,
  sessionDate,
}: {
  entry: FlowEntry;
  sessionDate: string;
}) {
  const observed = entry.kind === 'observation';
  const premium = premiumOf(entry);
  return (
    <li>
      <details name="option-flow-evidence" className="option-record">
        <summary>
          <span className="option-record-main">
            <span className={`terminal-badge ${observed ? 'delay' : ''}`}>
              {entryStatus(entry)}
            </span>
            <ContractLabel
              contract={entry.contract}
              sessionDate={sessionDate}
            />
            <time className="option-note" dateTime={entry.eventTime}>
              {displayDataTime(entry.eventTime)}
            </time>
            <span className="option-note">
              {observed
                ? entry.signal === 'volume'
                  ? '累计放量'
                  : '报价异动'
                : `${conditionLabels[entry.condition]} · ${sideLabels[entry.side]}`}
            </span>
            <span className="option-number">
              {observed ? '估计权利金额' : '权利金'}{' '}
              {premium === null ? '—' : `${premium} USD`}
            </span>
          </span>
          <span className="option-evidence-toggle">证据</span>
        </summary>
        <dl
          className="option-facts option-evidence"
          aria-label={`证据 ${entry.id}`}
        >
          <div>
            <dt>记录 ID / 合约</dt>
            <dd>
              {entry.id} · {entry.contract.id}
            </dd>
          </div>
          <div>
            <dt>{observed ? '观察时间' : '成交时间'}</dt>
            <dd>
              <time dateTime={entry.eventTime}>
                {displayDataTime(entry.eventTime)}
              </time>
            </dd>
          </div>
          <div>
            <dt>{observed ? '接收时间' : '取得时间'}</dt>
            <dd>
              <time dateTime={entry.receivedAt}>
                {displayDataTime(entry.receivedAt)}
              </time>
            </dd>
          </div>
          <div>
            <dt>置信度</dt>
            <dd>{confidenceLabels[entry.confidence]}</dd>
          </div>
          {observed ? (
            <>
              <div>
                <dt>订阅覆盖</dt>
                <dd>{entry.coverage}</dd>
              </div>
              <div>
                <dt>合约实际乘数</dt>
                <dd>{entry.contract.multiplier}</dd>
              </div>
              <div>
                <dt>线索依据</dt>
                <dd>{entry.evidence}</dd>
              </div>
              <div>
                <dt>观察窗口累计量差</dt>
                <dd>
                  {entry.volumeDelta === null
                    ? '未知'
                    : `${entry.volumeDelta} 张`}
                </dd>
              </div>
            </>
          ) : (
            <HistoricalEvidence trade={entry} />
          )}
        </dl>
      </details>
    </li>
  );
}

function FlowGaps({
  gaps,
  availableFrom,
}: Pick<FlowReading, 'gaps' | 'availableFrom'>) {
  return (
    <section className="option-panel" aria-labelledby="option-gaps">
      <h2 id="option-gaps">未订阅时间段</h2>
      {availableFrom && (
        <DataClassLabel kind="detail" availableFrom={availableFrom} />
      )}
      {gaps.length === 0 ? (
        <p className="option-note">当前快照未报告缺口。</p>
      ) : (
        <ul className="option-list">
          {gaps.map(({ start, end, reason, recovery }) => (
            <li key={`${start}/${end}`}>
              <div className="option-gap">
                <strong
                  className={`terminal-badge ${recovery.kind === 'unfillable' ? 'delay' : ''}`}
                >
                  {recovery.kind === 'unfillable'
                    ? '无法回补逐笔'
                    : '待核验回补能力'}
                </strong>
                <p>
                  <time dateTime={start}>{displayDataTime(start)}</time> 至{' '}
                  <time dateTime={end}>{displayDataTime(end)}</time>（不含末端）
                </p>
                <p className="option-note">
                  {reason}
                  {recovery.kind === 'unfillable' && ` · ${recovery.reason}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function OptionsFlow({ reading }: { reading: FlowReading }) {
  const [path, setPath] = useState('all');
  const [expiry, setExpiry] = useState('');
  const [term, setTerm] = useState('');
  const [minimumText, setMinimumText] = useState('');
  const [condition, setCondition] = useState('');
  const [confidence, setConfidence] = useState('');
  const { entries, sessionDate, availableFrom } = reading;
  const expiries = [
    ...new Set(entries.map(({ contract }) => contract.expiry)),
  ].sort();
  const { minimum, error } = readPremiumFilter(minimumText);

  const visible = error
    ? []
    : entries.filter((entry) => {
        if (!matchesPath(entry, path)) return false;
        if (expiry && expiry !== entry.contract.expiry) return false;
        const zeroDte = entry.contract.expiry === sessionDate;
        if ((term === 'zero' && !zeroDte) || (term === 'later' && zeroDte))
          return false;
        if (
          condition &&
          (entry.kind !== 'historical' || entry.condition !== condition)
        )
          return false;
        if (confidence && entry.confidence !== confidence) return false;
        if (minimum === null) return true;
        const premium = premiumOf(entry);
        if (premium === null) return false;
        const [value, floor] = decimalKeys([premium, minimum]);
        return value >= floor;
      });

  return (
    <>
      <section className="option-panel" aria-labelledby="option-flow-records">
        <header className="option-section-heading">
          <h2 id="option-flow-records">观察与核验记录</h2>
          {availableFrom && (
            <DataClassLabel kind="detail" availableFrom={availableFrom} />
          )}
        </header>
        {entries.length === 0 || !availableFrom ? (
          <DataState
            kind="empty"
            title="暂无期权流水数据"
            detail={
              entries.length === 0
                ? '所选标的没有观察线索或历史核验记录。'
                : '采集起点待确认。'
            }
            illustrated
          />
        ) : (
          <>
            <div className="option-filters" aria-label="流水筛选">
              <label className="option-field">
                记录类型
                <select
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                >
                  {Object.entries(paths).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="option-field">
                到期日
                <select
                  value={expiry}
                  onChange={(event) => setExpiry(event.target.value)}
                >
                  <option value="">全部到期日</option>
                  {expiries.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="option-field">
                期限分组
                <select
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                >
                  <option value="">全部期限</option>
                  <option value="zero">仅 0DTE</option>
                  <option value="later">其他期限</option>
                </select>
              </label>
              <label className="option-field">
                最低权利金额（USD）
                <input
                  value={minimumText}
                  onChange={(event) => setMinimumText(event.target.value)}
                  inputMode="decimal"
                  aria-invalid={error}
                  aria-describedby={
                    error ? 'option-premium-error' : 'option-premium-note'
                  }
                />
              </label>
              <label className="option-field">
                成交条件
                <select
                  value={condition}
                  onChange={(event) => setCondition(event.target.value)}
                >
                  <option value="">全部条件</option>
                  {Object.entries(conditionLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="option-field">
                置信度
                <select
                  value={confidence}
                  onChange={(event) => setConfidence(event.target.value)}
                >
                  <option value="">全部置信度</option>
                  {Object.entries(confidenceLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="option-note" id="option-premium-note">
              金额门槛含观察路径的估计值。0DTE 按回放交易业务日划分。
            </p>
            {error ? (
              <p id="option-premium-error" role="alert">
                请输入非负十进制金额。
              </p>
            ) : visible.length === 0 ? (
              <DataState kind="empty" title="当前筛选无匹配记录" />
            ) : (
              <ul className="option-list" aria-label="流水结果">
                {visible.map((entry) => (
                  <FlowRecord
                    key={entry.id}
                    entry={entry}
                    sessionDate={sessionDate}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      <FlowGaps gaps={reading.gaps} availableFrom={availableFrom} />
    </>
  );
}
