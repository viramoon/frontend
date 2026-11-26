import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  researchNetworkMode,
  type ResearchAdapter,
  type RunRequest,
  type RunResult,
  type RunStatus,
} from './adapter';
import {
  FixtureNotice,
  LoadFailure,
  PendingSubmission,
} from './ResearchStates';
import type { RunSubmission } from './useRunSubmission';

const statuses = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  timed_out: '已超时',
};
const active = (status: RunStatus | undefined) =>
  status === 'queued' || status === 'running';
const runHref = (id: string) => `/backtests?run=${encodeURIComponent(id)}`;

function Status({ status }: { status: RunStatus }) {
  return <span className={`job-status ${status}`}>{statuses[status]}</span>;
}

export function RunWorkbench({
  adapter,
  submission,
}: {
  adapter: ResearchAdapter;
  submission: RunSubmission;
}) {
  const [search, setSearch] = useSearchParams();
  const id = search.get('run') || '';
  const list = useQuery({
    networkMode: researchNetworkMode(adapter.source),
    queryKey: ['research', adapter.source, 'runs'],
    queryFn: () => adapter.listRuns(),
    refetchInterval: (query) =>
      query.state.data?.some((run) => active(run.status)) ? 1000 : false,
  });
  const detail = useQuery({
    networkMode: researchNetworkMode(adapter.source),
    queryKey: ['research', adapter.source, 'run', id],
    queryFn: () => adapter.run(id),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      active(query.state.data?.status) ? 1000 : false,
  });

  function open(runId: string) {
    setSearch({ run: runId });
  }

  return (
    <section className="research-page">
      <header className="research-heading">
        <div>
          <h1>配置回测</h1>
          <FixtureNotice
            source={adapter.source}
            detail="作业进度与结果均为合成演示，记录保存在当前浏览器会话。"
          />
        </div>
        <Link to="/strategies">选择策略</Link>
      </header>
      <div className="backtest-columns">
        <section
          className="backtest-panel research-stack"
          aria-labelledby="strategy-runs-heading"
        >
          <div className="panel-heading research-panel-heading">
            <h2 id="strategy-runs-heading">配置作业</h2>
            <button type="button" onClick={() => void list.refetch()}>
              刷新作业
            </button>
          </div>
          {list.isPending && <p role="status">正在读取配置作业…</p>}
          {list.isError && (
            <LoadFailure retry={() => void list.refetch()}>
              配置作业列表读取失败。
            </LoadFailure>
          )}
          {list.data?.length === 0 && (
            <p className="job-note">暂无配置作业。</p>
          )}
          {Boolean(list.data?.length) && (
            <ul className="research-catalog">
              {list.data?.map((run) => (
                <li key={run.id}>
                  <div>
                    <Link
                      to={runHref(run.id)}
                      aria-current={id === run.id ? 'page' : undefined}
                    >
                      {run.id}
                    </Link>
                    <code>
                      {run.request.revision.id}@{run.request.revision.version}
                    </code>
                  </div>
                  <Status status={run.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section
          className="backtest-panel research-stack"
          aria-labelledby="strategy-recovery-heading"
        >
          <h2 id="strategy-recovery-heading">作业恢复</h2>
          {submission.pending || submission.notice ? (
            <PendingSubmission submission={submission} />
          ) : (
            <KeyLookup adapter={adapter} found={open} />
          )}
        </section>
      </div>
      {id && (
        <section
          className="backtest-panel research-stack"
          aria-labelledby="strategy-run-detail"
        >
          <div className="panel-heading research-panel-heading">
            <h2 id="strategy-run-detail">配置作业 {id}</h2>
            {detail.data && <Status status={detail.data.status} />}
          </div>
          {detail.isPending && <p role="status">正在读取配置作业详情…</p>}
          {detail.isError && (
            <LoadFailure retry={() => void detail.refetch()}>
              配置作业详情读取失败。
            </LoadFailure>
          )}
          {detail.data === null && (
            <p className="job-note">此会话中没有该配置作业。</p>
          )}
          {detail.data && (
            <>
              <RunParameters request={detail.data.request} />
              {active(detail.data.status) && (
                <p role="status" className="job-note">
                  作业状态会自动更新。
                </p>
              )}
              {(detail.data.status === 'failed' ||
                detail.data.status === 'timed_out') && (
                <p role="alert" className="job-message">
                  {detail.data.message}
                </p>
              )}
              {detail.data.status === 'succeeded' && (
                <Result result={detail.data.result} />
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}

function KeyLookup({
  adapter,
  found,
}: {
  adapter: ResearchAdapter;
  found: (id: string) => void;
}) {
  const [key, setKey] = useState('');
  const [looking, setLooking] = useState(false);
  const [notice, setNotice] = useState('');

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!key.trim() || looking) return;
    setLooking(true);
    setNotice('');
    try {
      const result = await adapter.byKey(key.trim());
      if (result.kind === 'found') found(result.id);
      else setNotice('未查到该作业键。');
    } catch {
      setNotice('无法查询作业键，请稍后重试。');
    } finally {
      setLooking(false);
    }
  }
  return (
    <form className="research-form" onSubmit={(event) => void lookup(event)}>
      <label>
        作业键
        <input
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            setNotice('');
          }}
          disabled={looking}
        />
      </label>
      <div className="backtest-actions">
        <button type="submit" disabled={looking || !key.trim()}>
          按键查找
        </button>
      </div>
      <p role="status">{looking ? '正在查找作业…' : notice}</p>
    </form>
  );
}

function RunParameters({ request }: { request: RunRequest }) {
  return (
    <dl className="research-facts">
      <div>
        <dt>策略版本</dt>
        <dd>
          <code>
            {request.revision.id}@{request.revision.version}
          </code>
        </dd>
      </div>
      <div>
        <dt>内容 SHA-256</dt>
        <dd>
          <code>{request.revision.contentSha256}</code>
        </dd>
      </div>
      <div>
        <dt>数据集</dt>
        <dd>
          <code>{request.datasetId}</code>
        </dd>
      </div>
      <div>
        <dt>作业时间窗（结束日不含）</dt>
        <dd>
          {request.start} 至 {request.end}
        </dd>
      </div>
    </dl>
  );
}

function Result({ result }: { result: RunResult }) {
  const manifest = result.manifest;
  return (
    <>
      <div className="result-lead">
        <div>
          <p className="metric-label">期末权益</p>
          <p className="pnl-reading">
            <strong className="pnl-value">{result.finalEquity}</strong>
            <span className="currency">{result.currency}</span>
          </p>
        </div>
        <dl className="result-metrics">
          <div>
            <dt>{result.benchmark.title} · 期末权益</dt>
            <dd>
              {result.benchmark.finalEquity} {result.currency}
            </dd>
          </div>
        </dl>
      </div>
      <section className="result-section" aria-labelledby="strategy-manifest">
        <h3 id="strategy-manifest">运行清单</h3>
        <dl className="research-facts">
          <div>
            <dt>编译计划与引擎</dt>
            <dd>
              <code>{manifest.planVersion}</code>
              <br />
              <code>{manifest.engine}</code>
            </dd>
          </div>
          <div>
            <dt>数据快照 SHA-256</dt>
            <dd>
              <code>{manifest.snapshotSha256}</code>
            </dd>
          </div>
          <div>
            <dt>点时股票池</dt>
            <dd>
              <code>{manifest.universe}</code>
            </dd>
          </div>
          <div>
            <dt>交易日历与时区</dt>
            <dd>
              {manifest.calendar} · {manifest.timezone}
            </dd>
          </div>
          <div>
            <dt>预热与价格口径</dt>
            <dd>
              {manifest.warmupSessions} 个会话 ·{' '}
              <code>{manifest.priceBasis}</code>
            </dd>
          </div>
          <div>
            <dt>手续费 / 滑点</dt>
            <dd>
              {manifest.commissionBps} / {manifest.slippageBps} bp
            </dd>
          </div>
        </dl>
      </section>
      <section className="result-section" aria-labelledby="strategy-ledger">
        <h3 id="strategy-ledger">模拟成交账本</h3>
        {result.ledger.length === 0 ? (
          <p className="job-note">所选时间窗内没有模拟成交。</p>
        ) : (
          <div
            className="result-table-wrap"
            role="region"
            aria-label="模拟成交账本表"
            tabIndex={0}
          >
            <table className="result-table">
              <caption>金额单位 {result.currency}，数量单位为股</caption>
              <thead>
                <tr>
                  <th scope="col">会话</th>
                  <th scope="col">标的</th>
                  <th scope="col">配方</th>
                  <th scope="col">数量</th>
                  <th scope="col">成交价</th>
                  <th scope="col">费用</th>
                  <th scope="col">剩余现金</th>
                </tr>
              </thead>
              <tbody>
                {result.ledger.map((fill, index) => (
                  <tr key={index}>
                    <td>{fill.session}</td>
                    <td>
                      <code>{fill.instrument}</code>
                    </td>
                    <td>
                      <code>{fill.recipe}</code>
                    </td>
                    <td>{fill.quantity}</td>
                    <td>{fill.price}</td>
                    <td>{fill.fee}</td>
                    <td>{fill.cashAfter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
