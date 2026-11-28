import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Alert, AlertsAdapter } from '../../api/operations';
import {
  conditionLabels,
  DeliveryDetails,
  FixtureNotice,
  OperationsReadState,
  severityLabels,
  UtcTime,
  useOperation,
} from '../../components/OperationsStates';
import { DataState } from '../../components/TerminalStates';
import { ManualSilence, SilenceStatus } from './ManualSilence';

const inactiveLabels: Record<NonNullable<Alert['inactiveReason']>, string> = {
  backup_disabled: '异地备份已关闭',
  backup_no_alert: '当前备份水位未告警',
  backup_timeout_unconfirmed: '当前未确认恢复点超时',
};

function AlertCard({
  alert,
  adapter,
  refresh,
}: {
  alert: Alert;
  adapter: AlertsAdapter;
  refresh: () => Promise<unknown>;
}) {
  const {
    id,
    condition,
    severity,
    active,
    inactiveReason,
    observedAt,
    acknowledgedAt,
    silencedUntil,
    deliveries,
  } = alert;
  const { pending, error, message, run } = useOperation(refresh);
  const title = `alert-${id}`;
  const unverifiedBackup = condition === 'backup_stale' && active === null;
  const silence = adapter.silence;

  return (
    <section className="operations-card" aria-labelledby={title}>
      <h2 id={title}>
        {unverifiedBackup ? 'Drive 恢复水位事件' : conditionLabels[condition]}
      </h2>
      <p>
        <span className="operations-badge" data-status={severity}>
          {severityLabels[severity]}
        </span>{' '}
        {active === null
          ? condition === 'backup_stale'
            ? '恢复水位当前无法核验'
            : '未触发'
          : active
            ? '持续中'
            : inactiveReason
              ? inactiveLabels[inactiveReason]
              : '已恢复'}
      </p>
      <dl className="operations-fields">
        <dt>观察时间</dt>
        <dd>
          <UtcTime value={observedAt} />
        </dd>
        <dt>确认状态</dt>
        <dd>
          {acknowledgedAt ? (
            <>
              已确认 · <UtcTime value={acknowledgedAt} />
            </>
          ) : (
            '待确认'
          )}
        </dd>
        <dt>静默状态</dt>
        <dd>
          {silence || adapter.manualSilence ? (
            <SilenceStatus until={silencedUntil} />
          ) : (
            '主动静默待 web 接口'
          )}
        </dd>
      </dl>
      <h3>邮件投递</h3>
      {deliveries.length ? (
        deliveries.map((delivery, index) => (
          <DeliveryDetails
            key={`${delivery.updatedAt}-${index}`}
            delivery={delivery}
          />
        ))
      ) : (
        <p>暂无投递记录。</p>
      )}
      <div className="operations-actions">
        <button
          type="button"
          className="refresh"
          disabled={pending || Boolean(acknowledgedAt)}
          onClick={() =>
            void run(() => adapter.acknowledge(id), '事件已确认。')
          }
        >
          确认告警
        </button>
        {silence && (
          <button
            type="button"
            className="refresh"
            disabled={pending || !active}
            onClick={() => {
              void run(
                () => silence(id, silencedUntil ? null : 60),
                silencedUntil ? '已解除静默。' : '事件已静默一小时。',
              );
            }}
          >
            {silencedUntil ? '解除静默' : '静默一小时'}
          </button>
        )}
        {condition === 'backup_stale' && (
          <Link to="/system#drive-backup">查看恢复水位</Link>
        )}
      </div>
      {adapter.manualSilence && (
        <ManualSilence
          actions={adapter.manualSilence}
          id={id}
          until={silencedUntil}
          pending={pending}
          run={run}
        />
      )}
      {error && (
        <p className="operations-feedback" role="alert">
          {error}
        </p>
      )}
      <div role="status">{pending ? '正在更新…' : message}</div>
    </section>
  );
}

export function Alerts({
  adapter,
  fixture = false,
}: {
  adapter: AlertsAdapter;
  fixture?: boolean;
}) {
  const alerts = useQuery({
    queryKey: ['u4', fixture ? 'fixture' : 'web', 'alerts'],
    queryFn: ({ signal }) => adapter.list(signal),
    staleTime: 0,
    refetchInterval: 30_000,
  });
  const [onlyUnacknowledged, setOnlyUnacknowledged] = useState(false);
  const visible = alerts.data?.filter(
    (alert) => !onlyUnacknowledged || (alert.active && !alert.acknowledgedAt),
  );

  return (
    <section className="operations-page" aria-labelledby="alerts-title">
      <h1 id="alerts-title">事件</h1>
      {fixture && <FixtureNotice />}
      {visible && !alerts.isError ? (
        <>
          <div className="operations-actions">
            <label className="operations-checkbox">
              <input
                type="checkbox"
                checked={onlyUnacknowledged}
                onChange={(event) =>
                  setOnlyUnacknowledged(event.target.checked)
                }
              />
              只看尚未确认的持续告警
            </label>
          </div>
          {visible.length ? (
            <div className="operations-grid">
              {visible.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  adapter={adapter}
                  refresh={alerts.refetch}
                />
              ))}
            </div>
          ) : (
            <DataState kind="empty" title="没有符合条件的告警" />
          )}
        </>
      ) : (
        <OperationsReadState
          failed={alerts.isError}
          error={alerts.error}
          retry={() => void alerts.refetch()}
        />
      )}
    </section>
  );
}
