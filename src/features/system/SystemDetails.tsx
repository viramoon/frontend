import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type {
  DriveBackup,
  OperationsAdapter,
  SystemDetails as Details,
} from '../../api/operations';
import {
  CheckStatus,
  DeliveryDetails,
  FixtureNotice,
  OperationsReadState,
  UtcTime,
} from '../../components/OperationsStates';

const maxBackupAgeMs = 60 * 60 * 1000;

export function DriveWatermark({ backup }: { backup: DriveBackup }) {
  if (backup.state === 'disabled') {
    return (
      <section
        className="operations-card"
        id="drive-backup"
        aria-labelledby="drive-backup-title"
      >
        <h3 id="drive-backup-title">Google Drive 备份</h3>
        <p>异地备份已关闭</p>
        <dl className="operations-fields">
          <dt>最后可恢复到</dt>
          <dd>未知</dd>
        </dl>
      </section>
    );
  }
  const { observedAt, lastRecoverableAt, lastFullAt, lastHourlyAt, lastDrill } =
    backup;
  const ageMs =
    Date.parse(observedAt) -
    (lastRecoverableAt ? Date.parse(lastRecoverableAt) : NaN);
  const knownAge = Number.isFinite(ageMs) && ageMs >= 0;
  const overdue = knownAge && ageMs > maxBackupAgeMs;
  // Round up for display so an overdue fraction of a second never looks on time.
  const ageSeconds = Math.ceil(ageMs / 1000);

  return (
    <section
      className="operations-card"
      id="drive-backup"
      aria-labelledby="drive-backup-title"
    >
      <h3 id="drive-backup-title">Google Drive 备份</h3>
      <dl className="operations-fields">
        <dt>最后可恢复到</dt>
        <dd>
          <UtcTime value={lastRecoverableAt} />
        </dd>
        <dt>恢复点年龄</dt>
        <dd>
          {knownAge
            ? `${Math.floor(ageSeconds / 60)} 分 ${ageSeconds % 60} 秒`
            : '未知'}
        </dd>
        <dt>观测时间</dt>
        <dd>
          <UtcTime value={observedAt} />
        </dd>
        <dt>日全量</dt>
        <dd>
          <UtcTime value={lastFullAt} />
        </dd>
        <dt>小时增量</dt>
        <dd>
          <UtcTime value={lastHourlyAt} />
        </dd>
        <dt>最近恢复演练</dt>
        <dd>
          {lastDrill ? (
            <>
              {lastDrill.passed ? '通过' : '失败'} ·{' '}
              <UtcTime value={lastDrill.finishedAt} />
            </>
          ) : (
            '暂无记录'
          )}
        </dd>
      </dl>
      {(overdue ||
        !knownAge ||
        backup.state === 'degraded' ||
        lastDrill?.passed === false) && (
        <div role="alert" className="operations-feedback">
          {overdue && <p>告警：最后可恢复点距观测时间超过一小时。</p>}
          {!knownAge && (
            <p>
              {lastRecoverableAt
                ? '告警：恢复点时间无法确认。'
                : '告警：暂无已验证恢复点。'}
            </p>
          )}
          {backup.state === 'degraded' && <p>告警：远端备份验证降级。</p>}
          {lastDrill?.passed === false && <p>告警：最近恢复演练失败。</p>}
          <Link to="/alerts">查看告警事件</Link>
        </div>
      )}
    </section>
  );
}

function SourceCard({ source }: { source: Details['sources'][number] }) {
  const id = `source-${source.id}`;
  const lagMs =
    source.durableAt && source.projectedAt
      ? Date.parse(source.durableAt) - Date.parse(source.projectedAt)
      : NaN;
  return (
    <section className="operations-card" aria-labelledby={id}>
      <h4 id={id}>{source.name}</h4>
      <dl className="operations-fields">
        <dt>采集状态</dt>
        <dd>
          <CheckStatus outcome={source.status} />
        </dd>
        <dt>行情行数</dt>
        <dd>
          {source.lines
            ? `${source.lines.inUse} / ${source.lines.limit}`
            : '未知'}
        </dd>
        <dt>深度名额</dt>
        <dd>
          {source.depth
            ? `${source.depth.inUse} / ${source.depth.limit}`
            : '未知'}
        </dd>
        <dt>最新事件</dt>
        <dd>
          <UtcTime value={source.lastEventAt} />
        </dd>
        <dt>日志已落盘</dt>
        <dd>
          <UtcTime value={source.durableAt} />
        </dd>
        <dt>投影已处理</dt>
        <dd>
          <UtcTime value={source.projectedAt} />
        </dd>
        <dt>投影滞后</dt>
        <dd>
          {Number.isFinite(lagMs) && lagMs >= 0 ? `${lagMs / 1000} 秒` : '未知'}
        </dd>
        <dt>最近缺口</dt>
        <dd>
          {source.gap ? (
            <>
              {source.gap.status === 'bar_only'
                ? '仅 K 线补齐'
                : '历史缺口不可补'}
              {' · '}
              <UtcTime value={source.gap.start} /> 至{' '}
              <UtcTime value={source.gap.end} />
            </>
          ) : (
            '暂无记录'
          )}
        </dd>
      </dl>
    </section>
  );
}

const emailHealth = {
  idle: '暂无投递',
  healthy: '可用',
  degraded: '降级',
  unavailable: '不可用',
};

export function SystemDetails({
  read,
}: {
  read: OperationsAdapter['readSystem'];
}) {
  const details = useQuery({
    queryKey: ['u4', 'system'],
    queryFn: () => read(),
    refetchInterval: 30_000,
    staleTime: 0,
  });
  const data = details.data;
  return (
    <section className="operations-section" aria-labelledby="operations-system">
      <h2 id="operations-system">运行与恢复</h2>
      <FixtureNotice />
      <button
        type="button"
        className="refresh"
        disabled={details.isFetching}
        onClick={() => void details.refetch()}
      >
        刷新运行与恢复
      </button>
      {!data || details.isError ? (
        <OperationsReadState
          failed={details.isError}
          retry={() => void details.refetch()}
        />
      ) : (
        <>
          <div className="operations-grid operations-section">
            <DriveWatermark backup={data.backup} />
            <section className="operations-card" aria-labelledby="system-email">
              <h3 id="system-email">邮件投递状态</h3>
              <p>邮件渠道 · {emailHealth[data.email.status]}</p>
              {data.email.lastAttempt ? (
                <DeliveryDetails delivery={data.email.lastAttempt} />
              ) : (
                <p>暂无投递记录。</p>
              )}
              <Link to="/settings/notifications">打开通知设置</Link>
            </section>
          </div>
          <section aria-labelledby="quality-heading">
            <h3 id="quality-heading">数据质量</h3>
            <p>后续 U2 将接入实际分区水位与数据缺口。</p>
            <div className="operations-grid">
              {data.sources.map((source) => (
                <SourceCard key={source.id} source={source} />
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
