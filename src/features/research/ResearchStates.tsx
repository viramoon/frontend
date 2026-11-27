import { WebRequestError } from '../../api';
import type { ResearchAdapter } from './adapter';
import type { RunSubmission } from './useRunSubmission';

export function FixtureNotice({
  source,
  detail,
}: {
  source: ResearchAdapter['source'];
  detail: string;
}) {
  if (source !== 'fixture') return null;
  return (
    <p className="research-notice">
      <strong>Fixture · 合成示例</strong> {detail}
    </p>
  );
}

export function LoadFailure({
  retry,
  error,
  children,
}: {
  retry: () => void;
  error?: unknown;
  children: string;
}) {
  const pending =
    error instanceof WebRequestError &&
    error.code === 'finance_contract_pending';
  return (
    <div className="job-message" role={pending ? 'status' : 'alert'}>
      <p>{pending ? '待接入 · finance_contract_pending' : children}</p>
      {!pending && error instanceof WebRequestError && <p>{error.message}</p>}
      <button type="button" onClick={retry}>
        重新读取
      </button>
    </div>
  );
}

export function PendingSubmission({
  submission,
}: {
  submission: RunSubmission;
}) {
  const { pending, busy, missing, notice, recover } = submission;
  if (!pending && !notice) return null;
  return (
    <div className="research-recovery">
      {pending && (
        <>
          <h3>待确认的提交</h3>
          <p>
            {pending.request.revision.id}@{pending.request.revision.version} ·{' '}
            {pending.request.start} 至 {pending.request.end}
          </p>
          <p>
            作业键 <code>{pending.key}</code>
          </p>
          <div className="backtest-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void recover()}
            >
              查询原提交
            </button>
            {missing && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void recover(true)}
              >
                用原参数重试
              </button>
            )}
          </div>
        </>
      )}
      <p role="status">{busy ? '正在确认作业…' : notice}</p>
    </div>
  );
}
