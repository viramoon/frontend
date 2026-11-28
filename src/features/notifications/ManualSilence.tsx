import type { FormEvent } from 'react';
import {
  OperationError,
  type ManualSilenceActions,
} from '../../api/operations';
import { UtcTime, type useOperation } from '../../components/OperationsStates';

export function SilenceStatus({ until }: { until: string | null }) {
  return until ? (
    <>
      静默至 <UtcTime value={until} />
    </>
  ) : (
    '未静默'
  );
}

export function ManualSilence({
  actions,
  id,
  until,
  pending,
  run,
}: {
  actions: ManualSilenceActions;
  id: string;
  until: string | null;
} & Pick<ReturnType<typeof useOperation>, 'pending' | 'run'>) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const deadline = new Date(String(fields.get('until')));
    const reason = String(fields.get('reason')).trim();
    void run(async () => {
      if (
        !(deadline.getTime() > Date.now()) ||
        !reason ||
        [...reason].length > 256
      )
        throw new OperationError('invalid');
      await actions.silence(id, deadline.toISOString(), reason);
    }, '已设置静默。');
  }

  if (until) {
    return (
      <button
        type="button"
        className="refresh"
        disabled={pending}
        onClick={() => void run(() => actions.unsilence(id), '已解除静默。')}
      >
        解除静默
      </button>
    );
  }

  return (
    <form onSubmit={submit} autoComplete="off">
      <fieldset className="operations-actions" disabled={pending}>
        <label>
          静默截止（本地时间）
          <input type="datetime-local" name="until" required />
        </label>
        <label>
          静默原因
          <input type="text" name="reason" required />
        </label>
        <button type="submit" className="refresh">
          设置静默
        </button>
      </fieldset>
    </form>
  );
}
