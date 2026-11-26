import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent, ReactNode } from 'react';
import {
  hasNotificationAccess,
  openNotificationSession,
} from '../../api/notificationsWeb';
import { OperationError } from '../../api/operations';
import {
  OperationsReadState,
  useOperation,
} from '../../components/OperationsStates';

export function NotificationAccess({
  title,
  children,
  resetTest,
}: {
  title: string;
  children: ReactNode;
  resetTest: () => void;
}) {
  const client = useQueryClient();
  const access = useQuery({
    queryKey: ['u4-access'],
    queryFn: ({ signal }) => hasNotificationAccess(signal),
    staleTime: 0,
    refetchInterval: 30_000,
  });
  const { pending, error, message, run } = useOperation(access.refetch);

  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem(
      'token',
    ) as HTMLInputElement;
    const token = input.value.trim();
    input.value = '';
    void run(async () => {
      if (!token) throw new OperationError('invalid');
      await openNotificationSession(token);
      client.removeQueries({ queryKey: ['u4', 'web'] });
      resetTest();
    }, '会话请求已完成，请核对通知权限。');
  }

  if (access.data && !access.isError) return children;
  return (
    <section
      className="operations-page"
      aria-labelledby="notification-access-title"
    >
      <h1 id="notification-access-title">{title}</h1>
      {access.isPending || access.isError ? (
        <OperationsReadState
          failed={access.isError}
          retry={() => void access.refetch()}
        />
      ) : (
        <div className="operations-card">
          <p>查看和管理通知需要 web 管理员会话。</p>
          <form
            className="operations-actions"
            onSubmit={login}
            autoComplete="off"
          >
            <label>
              管理令牌
              <input
                type="password"
                name="token"
                autoComplete="new-password"
                required
                disabled={pending}
              />
            </label>
            <button type="submit" className="refresh" disabled={pending}>
              建立管理员会话
            </button>
          </form>
          {error && (
            <p className="operations-feedback" role="alert">
              {error}
            </p>
          )}
          <div role="status">{pending ? '正在建立会话…' : message}</div>
        </div>
      )}
    </section>
  );
}
