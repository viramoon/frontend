import { useRef, useState } from 'react';
import {
  bearerAuth,
  byKey,
  submit,
  WebRequestError,
  type JobRequest,
} from '../../api';

type Pending = { key: string; request: JobRequest };
const storageKey = 'fertile.pending-backtest';

function restore(): Pending | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    if (typeof value?.key === 'string' && value.request?.instrument) {
      return value;
    }
  } catch {
    // This browser may disallow storage. Do not submit until a key can be saved.
  }
  return null;
}

const rejection = new Map<number | string, string>([
  [401, '令牌无效。请重新输入。'],
  [403, '服务尚未启用回测提交。'],
  [409, '该提交凭据已关联其他参数。'],
  [413, '提交内容超过大小限制。'],
  [422, '参数有误，请检查标的、日期和均线周期。'],
  ['no_data', '所选标的在该日期范围没有数据。'],
  [429, '请求受限，请稍等再重试。'],
]);

function knownRejection(error: unknown) {
  return error instanceof WebRequestError
    ? (rejection.get(error.code ?? '') ?? rejection.get(error.status ?? 0))
    : undefined;
}

export function useSubmission(accepted: (id: number) => void) {
  const [pending, setPending] = useState(restore);
  const [busy, setBusy] = useState(false);
  const [absent, setAbsent] = useState(false);
  const [notice, setNotice] = useState('');
  const mutex = useRef(false);

  function finish(id: number) {
    sessionStorage.removeItem(storageKey);
    setPending(null);
    setAbsent(false);
    setNotice(`已确认作业 #${id}。`);
    accepted(id);
  }

  async function check(item: Pending, token: string) {
    setAbsent(false);
    try {
      const { data } = await byKey({
        auth: bearerAuth(token),
        headers: { 'Idempotency-Key': item.key },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
        throwOnError: true,
      });
      finish(data.id);
    } catch (error) {
      if (
        error instanceof WebRequestError &&
        error.status === 404 &&
        error.code === 'job_not_found'
      ) {
        setAbsent(true);
        setNotice('暂未查到原提交。可用原参数和原幂等键重试。');
        return true;
      }
      setNotice(
        knownRejection(error) ?? '无法确认原提交。网络恢复后再次查询。',
      );
    }
    return false;
  }

  async function post(item: Pending, token: string, first: boolean) {
    try {
      const { data } = await submit({
        auth: bearerAuth(token),
        headers: { 'Idempotency-Key': item.key },
        body: item.request,
        signal: AbortSignal.timeout(10_000),
        throwOnError: true,
      });
      finish(data.id);
    } catch (error) {
      const rejected = knownRejection(error);
      if (rejected && first) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
        setNotice(rejected);
        return;
      }
      setNotice('提交响应中断，正在查询原提交。');
      await check(item, token);
    }
  }

  async function perform(task: () => Promise<void>) {
    if (mutex.current) return;
    mutex.current = true;
    setBusy(true);
    try {
      await task();
    } finally {
      mutex.current = false;
      setBusy(false);
    }
  }

  return {
    pending,
    absent,
    busy,
    notice,
    create(request: JobRequest, token: string) {
      if (pending) return;
      return perform(async () => {
        let item: Pending;
        try {
          item = { key: crypto.randomUUID(), request };
          sessionStorage.setItem(storageKey, JSON.stringify(item));
        } catch {
          setNotice(
            '无法保存幂等键。请通过 HTTPS 访问并允许此页面使用会话存储。',
          );
          return;
        }
        setPending(item);
        await post(item, token, true);
      });
    },
    recover(token: string, retry: boolean) {
      if (!pending) return;
      return perform(async () => {
        const missing = await check(pending, token);
        if (missing && retry) await post(pending, token, false);
      });
    },
  };
}
