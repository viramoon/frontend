import { useRef, useState } from 'react';
import type { ResearchAdapter, RunRequest } from './adapter';

export type PendingRun = { key: string; request: RunRequest };
export const pendingRunKey = 'fertile.pending-strategy-run.v1';

function restore(): PendingRun | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(pendingRunKey) ?? 'null');
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
  const [pending, setPending] = useState(restore);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState('');
  const busyRef = useRef(false);

  function finish(id: string) {
    try {
      sessionStorage.removeItem(pendingRunKey);
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
    } catch {
      setNotice('暂时无法查询原提交。请稍后使用同一作业键查询。');
      return false;
    }
  }

  async function submit(item: PendingRun) {
    try {
      const { id } = await adapter.submit(item.request, item.key);
      finish(id);
    } catch {
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
        const original = restore();
        if (original) {
          setPending(original);
          setNotice('请先核对待确认的作业。');
          return;
        }
        let item: PendingRun;
        try {
          item = { key: crypto.randomUUID(), request };
          sessionStorage.setItem(pendingRunKey, JSON.stringify(item));
        } catch {
          setNotice('无法保存作业键。请允许此页使用会话存储。');
          return;
        }
        setPending(item);
        await submit(item);
      });
    },
    recover(retry = false) {
      if (!pending) return;
      return perform(async () => {
        const absent = await lookup(pending);
        if (absent && retry) await submit(pending);
      });
    },
  };
}

export type RunSubmission = ReturnType<typeof useRunSubmission>;
