import { useRef, useState } from 'react';
import {
  OperationError,
  operationsFixtureSeed,
  type AlertCondition,
  type CheckOutcome,
  type Delivery,
  type Severity,
} from '../api/operations';
import { DataState } from './TerminalStates';
import './operations.css';

type OperationStatus =
  | CheckOutcome
  | 'pending'
  | 'superseded'
  | 'disabled'
  | 'disabled_by_profile';

const checkLabels: Record<OperationStatus, string> = {
  verified: '已验证',
  pending_market_open: '收盘待验',
  permission_denied: '权限失败',
  delayed: '延迟行情',
  capacity_exhausted: '额度已满',
  unavailable: '源不可用',
  missing_credential: '待配置凭据',
  pending: '正在测试',
  superseded: '测试已被替换',
  disabled: '已停用',
  disabled_by_profile: '按配置关闭',
};

export const conditionLabels: Record<AlertCondition, string> = {
  source_unavailable: '采集源不可用',
  disk_critical: '磁盘空间临界',
  backup_stale: 'Drive 恢复点超过一小时',
  recovery_verification_failed: '恢复校验失败',
  market_data_delayed: '行情变为延迟',
  book_out_of_sync: '盘口簿失同步',
  backfill_failed: '回补失败',
  backtest_failed: '回测失败',
  backtest_completed: '回测完成',
  backup_succeeded: '备份成功',
  market_anomaly: '行情异动',
  market_permission_denied: 'Nasdaq 盘口权限失败',
  smtp_unavailable: 'SMTP 投递失败',
};

export const severityLabels: Record<Severity, string> = {
  urgent: '紧急',
  important: '重要',
  informational: '信息',
};

const deliveryLabels: Record<Delivery['status'], string> = {
  pending: '等待投递',
  sending: '正在投递',
  accepted: 'SMTP 中继已接受',
  failed: '投递失败',
  summarized: '已并入汇总',
  suppressed: '已抑制',
};

export const attemptLabels: Record<
  Delivery['attempts'][number]['outcome'],
  string
> = {
  sending: '正在投递',
  accepted: '中继已接受',
  timeout: '中继超时',
  transient: '中继暂时不可用',
  rejected: '中继拒绝',
  configuration_error: '邮件配置错误',
  interrupted: '投递中断',
};

const errors: Record<OperationError['code'], string> = {
  conflict: '状态已更新，请根据最新版本再操作。',
  invalid: '配置不符合允许的范围。',
  unavailable: '操作暂不可用，请刷新状态。',
  forbidden: '当前会话没有操作权限。',
  uncertain: '写入结果待确认。请核对已刷新的配置、活动版本或测试记录。',
};

export function FixtureNotice() {
  return (
    <p className="operations-source" data-fixture-seed={operationsFixtureSeed}>
      合成演示 · 更改仅在当前页面会话中生效。后续 U4 联调使用 web 的正式契约。
    </p>
  );
}

export function UtcTime({ value }: { value: string | null }) {
  if (!value) return <>未知</>;
  return (
    <time dateTime={value}>
      {value.replace('T', ' ').replace(/(?:\.0+)?Z$/, ' UTC')}
    </time>
  );
}

export function CheckStatus({ outcome }: { outcome: OperationStatus }) {
  return (
    <span className="operations-badge" data-status={outcome}>
      {checkLabels[outcome]}
    </span>
  );
}

export function DeliveryDetails({ delivery }: { delivery: Delivery }) {
  return (
    <div className="operations-delivery">
      <span className="operations-badge" data-status={delivery.status}>
        {deliveryLabels[delivery.status]}
      </span>{' '}
      <UtcTime value={delivery.updatedAt} />
      {delivery.attempts.length > 0 && (
        <ul className="operations-list">
          {delivery.attempts.map((attempt, index) => (
            <li key={`${attempt.startedAt}-${index}`}>
              第 {index + 1} 次尝试 · {attemptLabels[attempt.outcome]} ·{' '}
              <UtcTime value={attempt.startedAt} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OperationsReadState({
  failed,
  retry,
}: {
  failed: boolean;
  retry: () => void;
}) {
  if (!failed) return <DataState kind="loading" title="正在读取状态…" />;
  return (
    <div>
      <p className="operations-feedback" role="alert">
        读取状态失败
      </p>
      <button type="button" className="refresh" onClick={retry}>
        重新读取
      </button>
    </div>
  );
}

// Request bodies stay out of React Query's mutation cache. Error bodies are
// never presented, even when an adapter throws an unexpected error.
export function useOperation(refresh: () => Promise<unknown>) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function run(request: () => Promise<void>, success?: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    setMessage('');
    try {
      await request();
      setMessage(success ?? '');
    } catch (cause) {
      setError(
        cause instanceof OperationError
          ? errors[cause.code]
          : '操作未能完成，请检查最新状态。',
      );
    } finally {
      try {
        await refresh();
      } finally {
        busy.current = false;
        setPending(false);
      }
    }
  }

  return { pending, error, message, run };
}
