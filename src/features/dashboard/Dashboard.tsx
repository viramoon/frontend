import { useQuery } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import {
  sampleOptions,
  statusOptions,
  WebRequestError,
  type SystemStatus,
  type BacktestSummary,
} from '../../api';
import { DataState } from '../../components/TerminalStates';

const utcFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function Timestamp({ value }: { value: string }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? (
    <span>{value}</span>
  ) : (
    <time dateTime={value} title={value}>
      {utcFormat.format(date)} UTC
    </time>
  );
}

function count(value: number) {
  // JSON numbers outside this range have already lost precision in the browser.
  return Number.isSafeInteger(value) ? String(value) : '超出精确显示范围';
}

function ReadError({ title, error }: { title: string; error: unknown }) {
  return (
    <div className="feedback fault" role="alert">
      <strong>{title}</strong>
      {error instanceof WebRequestError && (
        <span className="error-detail">{error.message}</span>
      )}
    </div>
  );
}

function StatusCard({
  title,
  value,
  ok,
  heading: Heading,
  children,
}: {
  title: string;
  value: string;
  ok: boolean;
  heading: 'h3' | 'h4';
  children: ReactNode;
}) {
  return (
    <article className="status-card">
      <Heading>{title}</Heading>
      <div className={ok ? 'reading good' : 'reading degraded'}>
        <span className="signal" aria-hidden="true" />
        {value}
      </div>
      <dl className="card-details">{children}</dl>
    </article>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Services({
  data: { web, database, finance, market },
  heading,
}: {
  data: SystemStatus;
  heading: 'h3' | 'h4';
}) {
  return (
    <div className="status-grid">
      <StatusCard title="Web 服务" value="已响应" heading={heading} ok>
        <Row label="版本">{web.version}</Row>
        <Row label="提交">
          <span title={web.commit}>{web.commit.slice(0, 12)}</span>
        </Row>
        <Row label="启动时间">
          <Timestamp value={web.started_at} />
        </Row>
      </StatusCard>
      <StatusCard
        title="数据库"
        heading={heading}
        value={database.ok ? '可用' : '不可用'}
        ok={database.ok}
      >
        <Row label="响应时间">
          {database.latency_ms == null ? '暂无' : database.latency_ms + ' ms'}
        </Row>
      </StatusCard>
      <StatusCard
        title="Finance 服务"
        heading={heading}
        value={finance.ok ? '可用' : '不可用'}
        ok={finance.ok}
      >
        <Row label="响应时间">{finance.latency_ms} ms</Row>
        <Row label="熔断状态">{finance.circuit}</Row>
      </StatusCard>
      <StatusCard
        title="行情采集"
        heading={heading}
        value={market.fresh ? '新鲜' : '待恢复'}
        ok={market.fresh}
      >
        <Row label="采集状态">{market.state}</Row>
        <Row label="数据源">{market.source ?? '暂无'}</Row>
        <Row label="跟踪 / 陈旧">
          {count(market.instrument_count)} / {count(market.stale_count)}
        </Row>
        {market.updated_at && (
          <Row label="更新时间">
            <Timestamp value={market.updated_at} />
          </Row>
        )}
      </StatusCard>
    </div>
  );
}

function Sample({ data }: { data: BacktestSummary }) {
  return (
    <div className="sample-grid">
      <div className="pnl-panel">
        <div className="metric-label">回测盈亏</div>
        <div className="pnl-reading">
          <span className="pnl-value">{data.pnl}</span>
          <span className="currency">{data.currency}</span>
        </div>
        <div className="generated-at">
          生成时间 <Timestamp value={data.generated_at} />
        </div>
      </div>
      <dl className="sample-details">
        <Row label="标的">{data.instrument}</Row>
        <Row label="策略">{data.strategy}</Row>
        <Row label="订单数">{count(data.total_orders)}</Row>
        <Row label="持仓数">{count(data.total_positions)}</Row>
        <Row label="开始时间">
          <Timestamp value={data.start} />
        </Row>
        <Row label="结束时间">
          <Timestamp value={data.end} />
        </Row>
        <Row label="运行 ID">{data.run_id}</Row>
      </dl>
    </div>
  );
}

export function SystemStatusStrip() {
  const system = useQuery(statusOptions());
  let summary = '正在读取';
  if (system.isError) {
    summary = '状态未能更新';
  } else if (system.data) {
    const { database, finance, market } = system.data;
    summary =
      database.ok && finance.ok && market.fresh ? '可用' : '部分服务需检查';
  }
  return (
    <div className="system-strip">
      <span className="system-strip-label">系统状态</span>
      <span aria-live="polite">{summary}</span>
    </div>
  );
}

export function SystemOverview({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const system = useQuery({ ...statusOptions(), refetchInterval: 30_000 });
  const sample = useQuery(sampleOptions());
  const fetching = system.isFetching || sample.isFetching;
  const Heading = standalone ? 'h1' : 'h2';
  const SectionHeading = standalone ? 'h2' : 'h3';

  return (
    <section
      className={standalone ? 'system-overview' : 'system-overview embedded'}
      aria-labelledby="overview-heading"
    >
      <div className="page-heading">
        <div>
          <Heading id="overview-heading">
            {standalone ? '系统' : '服务与示例回测'}
          </Heading>
          {system.dataUpdatedAt > 0 && (
            <p className="last-check">
              系统上次响应{' '}
              <Timestamp value={new Date(system.dataUpdatedAt).toISOString()} />
            </p>
          )}
        </div>
        <button
          type="button"
          className="refresh"
          disabled={fetching}
          onClick={() => {
            void system.refetch();
            void sample.refetch();
          }}
        >
          {fetching ? '刷新中' : '刷新'}
        </button>
      </div>
      <section aria-labelledby="system-heading" className="dashboard-section">
        <SectionHeading id="system-heading">系统状态</SectionHeading>
        {system.isPending && (
          <DataState kind="loading" title="正在加载系统状态…" />
        )}
        {system.isError && (
          <ReadError title="系统状态加载失败" error={system.error} />
        )}
        {system.isSuccess && (
          <Services data={system.data} heading={standalone ? 'h3' : 'h4'} />
        )}
      </section>
      <section aria-labelledby="sample-heading" className="dashboard-section">
        <SectionHeading id="sample-heading">示例回测</SectionHeading>
        {sample.isPending && (
          <DataState kind="loading" title="正在加载示例回测…" />
        )}
        {sample.isError &&
          (sample.error instanceof WebRequestError &&
          sample.error.status === 404 ? (
            <DataState kind="empty" title="暂无示例回测" />
          ) : (
            <ReadError title="示例回测加载失败" error={sample.error} />
          ))}
        {sample.isSuccess && <Sample data={sample.data} />}
      </section>
    </section>
  );
}
