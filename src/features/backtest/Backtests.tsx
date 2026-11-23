import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  datasetsOptions,
  detailOptions,
  listOptions,
  type Dataset,
  type Job,
  type JobStatus,
} from '../../api';
import { ResearchResult } from './ResearchResult';
import { useSubmission } from './useSubmission';

const statuses: Record<JobStatus, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  timed_out: '超时',
};
const failures: Record<string, string> = {
  no_data: '没有可用的历史数据。',
  missing_sessions:
    '日期范围内缺失交易日数据。请选择完整区间或请管理员检查 catalog。',
  insufficient_history:
    '连续交易日不足以完成慢均线预热。请延长区间或缩短慢线周期。',
  invalid_parameters: '不支持该策略参数。',
  invalid_date: '日期不在支持范围内。',
  invalid_source: '历史数据来源校验失败。',
  invalid_instrument: '标的校验失败。',
  invalid_bar: '日线价格或时间戳校验失败。',
  execution_audit_failed: '成交审计失败。结果未发布。',
  worker_lost_twice: '执行进程重复中断，已停止自动重试。',
  job_timeout: '作业超过执行时限。',
};

const active = (job: Job | undefined) =>
  job?.status === 'queued' || job?.status === 'running';

function QueryFailure({ retry }: { retry: () => void }) {
  return (
    <div className="job-message" role="alert">
      <p>无法读取数据。请检查网络或服务状态。</p>
      <button type="button" onClick={retry}>
        重新读取
      </button>
    </div>
  );
}

export function Backtests() {
  const [search, setSearch] = useSearchParams();
  const [cursor, setCursor] = useState<number>();
  const catalog = useQuery(datasetsOptions());
  const list = useQuery({
    ...listOptions({ query: { limit: 20, cursor } }),
    refetchInterval: 5_000,
  });
  const id = Number(search.get('job') ?? 0);
  const selected = Number.isSafeInteger(id) && id > 0;
  const detail = useQuery({
    ...detailOptions({ path: { id } }),
    enabled: selected,
    refetchInterval: (query) => (active(query.state.data) ? 2_000 : false),
  });

  function show(id: number) {
    setSearch({ job: String(id) });
    void list.refetch();
  }

  return (
    <section className="backtest-page">
      <h1>回测</h1>
      <p className="page-intro">在已导入的日线数据上运行单标的均线策略。</p>
      <div className="backtest-columns">
        <section className="backtest-panel" aria-labelledby="new-backtest">
          <h2 id="new-backtest">新建作业</h2>
          {catalog.isPending && <p role="status">正在读取历史数据目录…</p>}
          {catalog.isError && (
            <QueryFailure retry={() => void catalog.refetch()} />
          )}
          <BacktestForm
            datasets={catalog.data?.items ?? []}
            onAccepted={show}
          />
          {catalog.isSuccess && !catalog.data.items.length && (
            <p className="job-note">
              暂无历史数据。请管理员先导入经过审核的日线。
            </p>
          )}
        </section>
        <section className="backtest-panel" aria-labelledby="backtest-history">
          <div className="panel-heading">
            <h2 id="backtest-history">作业列表</h2>
            <button
              type="button"
              className="quiet-button"
              onClick={() => void list.refetch()}
            >
              刷新
            </button>
          </div>
          {list.isPending && <p role="status">正在读取作业…</p>}
          {list.isError && <QueryFailure retry={() => void list.refetch()} />}
          {list.isSuccess && !list.data.items.length && (
            <p className="job-note">暂无作业。</p>
          )}
          {list.data && (
            <>
              <ul className="job-list">
                {list.data.items.map((job) => (
                  <li key={job.id}>
                    <button
                      type="button"
                      aria-current={id === job.id ? 'true' : undefined}
                      onClick={() => show(job.id)}
                    >
                      <span>
                        <strong>#{job.id}</strong> {job.request.instrument}
                      </span>
                      <span className={`job-status ${job.status}`}>
                        {statuses[job.status]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {(cursor != null || list.data.next_cursor != null) && (
                <div className="backtest-actions">
                  {cursor != null && (
                    <button type="button" onClick={() => setCursor(undefined)}>
                      首页
                    </button>
                  )}
                  {list.data.next_cursor != null && (
                    <button
                      type="button"
                      onClick={() =>
                        setCursor(list.data.next_cursor ?? undefined)
                      }
                    >
                      下一页
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
      {selected && (
        <section
          className="backtest-panel job-detail"
          aria-labelledby="job-detail"
        >
          <h2 id="job-detail">作业 #{id} 结果</h2>
          {detail.isPending && <p role="status">正在读取作业状态…</p>}
          {detail.isError && (
            <QueryFailure retry={() => void detail.refetch()} />
          )}
          {detail.data && <JobDetail job={detail.data} />}
        </section>
      )}
    </section>
  );
}

function BacktestForm({
  datasets,
  onAccepted,
}: {
  datasets: Dataset[];
  onAccepted: (id: number) => void;
}) {
  const [instrument, setInstrument] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [fast, setFast] = useState('5');
  const [slow, setSlow] = useState('20');
  const [shares, setShares] = useState('10');
  const [validation, setValidation] = useState('');
  const credential = useRef<HTMLInputElement>(null);
  const submission = useSubmission((id) => {
    if (credential.current) credential.current.value = '';
    onAccepted(id);
  });
  const dataset = datasets.find((d) => d.instrument === instrument);

  function select(value: string) {
    const next = datasets.find((d) => d.instrument === value);
    setInstrument(value);
    setStart(next?.first_session ?? '');
    setEnd(next?.last_session ?? '');
    setValidation('');
  }

  function token() {
    const current = credential.current?.value.trim();
    if (!current) setValidation('请填写回测提交令牌。');
    else setValidation('');
    return current;
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const [short, long, quantity] = [fast, slow, shares].map(Number);
    if (
      !dataset ||
      !start ||
      !end ||
      start >= end ||
      start < dataset.first_session ||
      end > dataset.last_session
    ) {
      setValidation('请选择该标的可用的日期范围，起始日须早于结束日。');
      return;
    }
    if (
      ![short, long, quantity].every(Number.isInteger) ||
      short < 2 ||
      long <= short ||
      long > 250 ||
      quantity < 1 ||
      quantity > 1000
    ) {
      setValidation(
        '请输入整数参数。快线至少 2 日，慢线须大于快线且最多 250 日，股数为 1 至 1000。',
      );
      return;
    }
    const bearer = token();
    if (bearer)
      void submission.create(
        {
          strategy: 'SmaCrossover',
          instrument: dataset.instrument,
          start: start + 'T00:00:00Z',
          end: end + 'T00:00:00Z',
          params: { fast_period: short, slow_period: long, shares: quantity },
        },
        bearer,
      );
  }

  function recover(retry: boolean) {
    const bearer = token();
    if (bearer) void submission.recover(bearer, retry);
  }

  return (
    <form className="research-form" onSubmit={create} noValidate>
      <fieldset
        disabled={
          submission.busy || submission.pending !== null || !datasets.length
        }
      >
        <label>
          历史标的
          <select
            value={instrument}
            onChange={(event) => select(event.target.value)}
          >
            <option value="">选择标的</option>
            {datasets.map((item) => (
              <option key={item.instrument} value={item.instrument}>
                {item.instrument} ·{' '}
                {item.data_kind === 'historical' ? '历史数据' : '测试数据'}
              </option>
            ))}
          </select>
        </label>
        {dataset && (
          <p className="job-note">
            {dataset.source} · {dataset.first_session} 至 {dataset.last_session}
          </p>
        )}
        <div className="research-fields dates">
          <label>
            起始日期
            <input
              type="date"
              value={start}
              min={dataset?.first_session}
              max={dataset?.last_session}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={end}
              min={dataset?.first_session}
              max={dataset?.last_session}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
        </div>
        <div className="research-fields">
          <label>
            快线天数
            <input
              type="number"
              min="2"
              max="249"
              value={fast}
              onChange={(event) => setFast(event.target.value)}
            />
          </label>
          <label>
            慢线天数
            <input
              type="number"
              min="3"
              max="250"
              value={slow}
              onChange={(event) => setSlow(event.target.value)}
            />
          </label>
          <label>
            目标股数
            <input
              type="number"
              min="1"
              max="1000"
              value={shares}
              onChange={(event) => setShares(event.target.value)}
            />
          </label>
        </div>
      </fieldset>
      <label>
        回测提交令牌
        <input
          ref={credential}
          type="password"
          autoComplete="off"
          spellCheck={false}
          disabled={submission.busy}
        />
      </label>
      <div className="backtest-actions">
        {submission.pending ? (
          <>
            <button
              type="button"
              disabled={submission.busy}
              onClick={() => recover(false)}
            >
              查询原提交
            </button>
            {submission.absent && (
              <button
                type="button"
                disabled={submission.busy}
                onClick={() => recover(true)}
              >
                用原参数重试
              </button>
            )}
          </>
        ) : (
          <button
            className="submit-backtest"
            type="submit"
            disabled={submission.busy || !datasets.length}
          >
            提交回测
          </button>
        )}
      </div>
      {validation && (
        <p role="alert" className="job-message">
          {validation}
        </p>
      )}
      <p aria-live="polite" className="job-note">
        {submission.busy
          ? '正在处理提交…'
          : submission.notice ||
            (submission.pending &&
              `${submission.pending.request.instrument} 的提交待确认，请查询原提交。`)}
      </p>
    </form>
  );
}

function JobDetail({ job }: { job: Job }) {
  return (
    <>
      <div className="job-detail-status">
        <span className={`job-status ${job.status}`}>
          {statuses[job.status]}
        </span>
        <span>
          {job.request.instrument} · {job.request.strategy} · 第 {job.attempt}{' '}
          次执行
        </span>
      </div>
      {active(job) && <p role="status">页面会自动更新此作业的状态。</p>}
      {(job.status === 'failed' || job.status === 'timed_out') && (
        <p role="alert" className="job-message">
          {failures[job.error ?? ''] ??
            '作业未完成。请检查参数或将作业编号交给管理员。'}
        </p>
      )}
      {job.summary && <ResearchResult summary={job.summary} />}
    </>
  );
}
