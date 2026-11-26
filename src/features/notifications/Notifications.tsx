import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import type {
  NotificationRule,
  NotificationsAdapter,
} from '../../api/operations';
import {
  conditionLabels,
  DeliveryDetails,
  FixtureNotice,
  OperationsReadState,
  severityLabels,
  useOperation,
} from '../../components/OperationsStates';

function RuleCard({
  rule,
  adapter,
  refresh,
}: {
  rule: NotificationRule;
  adapter: NotificationsAdapter;
  refresh: () => Promise<unknown>;
}) {
  const { pending, error, message, run } = useOperation(refresh);
  const title = `rule-${rule.id}`;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const cooldown = fields.get('cooldown');
    void run(
      () =>
        adapter.saveRule(rule.id, rule.revision, {
          enabled: fields.has('enabled'),
          emailEnabled: fields.has('email'),
          minOccurrences: Number(fields.get('occurrences')),
          cooldownSeconds: cooldown === '' ? null : Number(cooldown),
        }),
      '规则已保存。',
    );
  }

  return (
    <section className="operations-card" aria-labelledby={title}>
      <h3 id={title}>{conditionLabels[rule.condition]}</h3>
      <p>
        {severityLabels[rule.severity]} · 修订 {rule.revision}
      </p>
      <form key={rule.revision} onSubmit={save}>
        <fieldset disabled={pending} className="operations-actions">
          <label className="operations-checkbox">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={rule.enabled}
            />
            启用事件规则
          </label>
          <label className="operations-checkbox">
            <input
              type="checkbox"
              name="email"
              defaultChecked={rule.emailEnabled}
            />
            启用邮件通知
          </label>
          <label>
            触发次数
            <input
              type="number"
              name="occurrences"
              defaultValue={rule.minOccurrences}
              min={1}
              max={100}
              step={1}
              required
            />
          </label>
          <label>
            冷却时间（秒）
            <input
              type="number"
              name="cooldown"
              defaultValue={rule.cooldownSeconds ?? ''}
              min={0}
              max={2_147_483_647}
              step={1}
            />
          </label>
          <button type="submit" className="refresh">
            保存规则
          </button>
        </fieldset>
      </form>
      {error && (
        <p className="operations-feedback" role="alert">
          {error}
        </p>
      )}
      <div role="status">{pending ? '正在保存…' : message}</div>
    </section>
  );
}

function EmailTest({
  adapter,
  testKey,
  setTestKey,
  recipientConfigured,
  fixture,
}: {
  adapter: NotificationsAdapter;
  testKey: string | null;
  setTestKey: (key: string) => void;
  recipientConfigured: boolean | null;
  fixture: boolean;
}) {
  const client = useQueryClient();
  const submitting = useRef(false);
  const [starting, setStarting] = useState(false);
  const [startFailed, setStartFailed] = useState(false);
  const testQueryKey = [
    'u4',
    fixture ? 'fixture' : 'web',
    'email-test',
    testKey,
  ];
  const test = useQuery({
    queryKey: testQueryKey,
    enabled: Boolean(testKey) && !starting,
    queryFn: ({ signal }) => adapter.readEmailTest(testKey!, signal),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' || status === 'sending' ? 500 : false;
    },
  });

  async function send() {
    if (submitting.current) return;
    const key = test.data === null && testKey ? testKey : crypto.randomUUID();
    submitting.current = true;
    setStarting(true);
    setStartFailed(false);
    setTestKey(key);
    try {
      await adapter.startEmailTest(key);
    } catch {
      setStartFailed(true);
    } finally {
      // Re-read the same key on every outcome. A timed-out write may have succeeded.
      if (key === testKey) {
        await client.invalidateQueries({ queryKey: testQueryKey, exact: true });
      }
      submitting.current = false;
      setStarting(false);
    }
  }

  const status = test.data?.status;
  const waiting = status === 'pending' || status === 'sending';
  const checking = Boolean(testKey) && (test.isFetching || test.isPending);
  return (
    <section className="operations-card" aria-labelledby="email-channel">
      <h2 id="email-channel">邮件渠道</h2>
      <p>
        收件人 ·{' '}
        {recipientConfigured === null
          ? '由 web 部署管理'
          : recipientConfigured
            ? '已配置的本人邮箱（已隐藏）'
            : '待配置'}
      </p>
      <div className="operations-actions">
        <button
          type="button"
          className="refresh"
          disabled={
            recipientConfigured === false ||
            starting ||
            waiting ||
            checking ||
            test.isError
          }
          onClick={() => void send()}
        >
          {test.data === null ? '按原请求重新发送测试邮件' : '发送测试邮件'}
        </button>
        {test.isError && (
          <button
            type="button"
            className="refresh"
            onClick={() => void test.refetch()}
          >
            查询测试状态
          </button>
        )}
      </div>
      {test.isError ? (
        <p className="operations-feedback" role="alert">
          无法查询测试邮件状态
        </p>
      ) : (
        <div aria-live="polite">
          {test.data && <DeliveryDetails delivery={test.data} />}
          {starting && <p>正在提交测试请求…</p>}
          {testKey && test.isPending && !starting && (
            <p>正在查询测试邮件状态…</p>
          )}
          {test.data === null && (
            <p>
              {startFailed ? '提交结果未确认。' : ''}
              未查到测试记录，可用原请求重新发送。
            </p>
          )}
          {!testKey && <p>暂无本次会话的测试记录。</p>}
        </div>
      )}
      <p>中继接受表示 SMTP 已接收，收件箱送达需在邮箱确认。</p>
    </section>
  );
}

export function Notifications({
  adapter,
  testKey,
  setTestKey,
  fixture = false,
}: {
  adapter: NotificationsAdapter;
  testKey: string | null;
  setTestKey: (key: string) => void;
  fixture?: boolean;
}) {
  const config = useQuery({
    queryKey: ['u4', fixture ? 'fixture' : 'web', 'notifications'],
    queryFn: ({ signal }) => adapter.read(signal),
  });
  return (
    <section className="operations-page" aria-labelledby="notifications-title">
      <h1 id="notifications-title">通知设置</h1>
      {fixture && <FixtureNotice />}
      {config.data && !config.isError ? (
        <>
          <EmailTest
            adapter={adapter}
            testKey={testKey}
            setTestKey={setTestKey}
            recipientConfigured={config.data.recipientConfigured}
            fixture={fixture}
          />
          <section
            className="operations-section"
            aria-labelledby="notification-rules"
          >
            <h2 id="notification-rules">通知规则</h2>
            {config.data.timezone &&
              config.data.quietStart &&
              config.data.quietEnd && (
                <p>
                  静默时段 {config.data.quietStart}–{config.data.quietEnd} ·{' '}
                  {config.data.timezone}
                </p>
              )}
            {config.data.rules.length === 0 && <p>暂无通知规则。</p>}
            <div className="operations-grid">
              {config.data.rules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  adapter={adapter}
                  refresh={config.refetch}
                />
              ))}
            </div>
          </section>
        </>
      ) : (
        <OperationsReadState
          failed={config.isError}
          retry={() => void config.refetch()}
        />
      )}
    </section>
  );
}
