import { useRef, useState } from 'react';
import { WebRequestError } from '../../api';
import { OperationError } from '../../api/operations';
import type { ResearchAdapter, RunRequest } from './adapter';

export type PendingRun = { key: string; request: RunRequest };
export const pendingRunKey = 'fertile.pending-strategy-run.v1';

function restore(storageKey: string): PendingRun | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    const revision = saved?.request?.revision;
    if (
      [
        saved?.key,
        saved?.request?.datasetId,
        saved?.request?.start,
        saved?.request?.end,
        revision?.id,
        revision?.version,
        revision?.contentSha256,
      ].every((field) => typeof field === 'string' && field.length > 0)
    )
      return saved;
  } catch {
    // The screen remains readable when browser storage is unavailable.
  }
  return null;
}

export function useRunSubmission(
  adapter: ResearchAdapter,
  accepted: (id: string) => void,
) {
  const storageKey =
    adapter.source === 'web' ? pendingRunKey + '.web' : pendingRunKey;
  const [pending, setPending] = useState(() => restore(storageKey));
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState('');
  const busyRef = useRef(false);

  function finish(id: string) {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // A subsequent lookup can safely confirm the same id.
    }
    setPending(null);
    setMissing(false);
    setNotice('');
    accepted(id);
  }

  async function lookup(item: PendingRun) {
    setMissing(false);
    try {
      const found = await adapter.byKey(item.key);
      if (found.kind === 'found') {
        finish(found.id);
        return false;
      }
      setMissing(true);
      setNotice('已确认原作业尚未受理，可以使用原版本、时间窗和作业键重试。');
      return true;
    } catch (error) {
      setNotice(
        error instanceof WebRequestError &&
          error.code === 'finance_contract_pending'
          ? '作业查询待接入 · finance_contract_pending'
          : '暂时无法查询原提交。请稍后使用同一作业键查询。',
      );
      return false;
    }
  }

  async function submit(item: PendingRun, first: boolean) {
    try {
      const { id } = await adapter.submit(item.request, item.key);
      finish(id);
    } catch (error) {
      const pendingContract =
        error instanceof WebRequestError &&
        error.code === 'finance_contract_pending';
      const rejected =
        pendingContract ||
        (error instanceof OperationError && error.code === 'forbidden') ||
        (error instanceof WebRequestError &&
          [401, 403, 404, 409, 413, 422, 429].includes(error.status ?? 0));
      if (first && rejected) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
        setNotice(
          pendingContract
            ? '配置回测待接入 · finance_contract_pending'
            : error instanceof WebRequestError
              ? error.message
              : '此会话未获配置回测提交权限。',
        );
        return;
      }
      setNotice('未收到提交结果，正在查询原提交。');
      await lookup(item);
    }
  }

  async function perform(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return {
    pending,
    busy,
    missing,
    notice,
    create(request: RunRequest) {
      return perform(async () => {
        const original = restore(storageKey);
        if (original) {
          setPending(original);
          setNotice('请先核对待确认的作业。');
          return;
        }
        let item: PendingRun;
        try {
          item = { key: crypto.randomUUID(), request };
          sessionStorage.setItem(storageKey, JSON.stringify(item));
        } catch {
          setNotice('无法保存作业键。请允许此页使用会话存储。');
          return;
        }
        setPending(item);
        await submit(item, true);
      });
    },
    recover(retry = false) {
      if (!pending) return;
      return perform(async () => {
        const absent = await lookup(pending);
        if (absent && retry) await submit(pending, false);
      });
    },
  };
}

export type RunSubmission = ReturnType<typeof useRunSubmission>;
