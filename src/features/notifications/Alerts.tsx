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
    observedAt,
    acknowledgedAt,
    silencedUntil,
    deliveries,
  } = alert;
  const { pending, error, message, run } = useOperation(refresh);
  const title = `alert-${id}`;

  return (
    <section className="operations-card" aria-labelledby={title}>
      <h2 id={title}>{conditionLabels[condition]}</h2>
      <p>
        <span className="operations-badge" data-status={severity}>
          {severityLabels[severity]}
        </span>{' '}
        {active ? '持续中' : '已恢复'}
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
          {silencedUntil ? (
            <>
              静默至 <UtcTime value={silencedUntil} />
            </>
          ) : (
            '未静默'
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
        <button
          type="button"
          className="refresh"
          disabled={pending || !active}
          onClick={() => {
            void run(
              () => adapter.silence(id, silencedUntil ? null : 60),
              silencedUntil ? '已解除静默。' : '事件已静默一小时。',
            );
          }}
        >
          {silencedUntil ? '解除静默' : '静默一小时'}
        </button>
        {condition === 'backup_stale' && (
          <Link to="/system#drive-backup">查看恢复水位</Link>
        )}
      </div>
      {error && (
        <p className="operations-feedback" role="alert">
          {error}
        </p>
      )}
      <div role="status">{pending ? '正在更新…' : message}</div>
    </section>
  );
}

export function Alerts({ adapter }: { adapter: AlertsAdapter }) {
  const alerts = useQuery({
    queryKey: ['u4', 'alerts'],
    queryFn: adapter.list,
    refetchInterval: 30_000,
  });
  const [onlyUnacknowledged, setOnlyUnacknowledged] = useState(false);
  const visible = alerts.data?.filter(
    (alert) => !onlyUnacknowledged || (alert.active && !alert.acknowledgedAt),
  );

  return (
    <section className="operations-page" aria-labelledby="alerts-title">
      <h1 id="alerts-title">事件</h1>
      <FixtureNotice />
      {visible ? (
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
          retry={() => void alerts.refetch()}
        />
      )}
    </section>
  );
}
