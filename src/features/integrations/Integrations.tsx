import { useQuery } from '@tanstack/react-query';
import { type FormEvent } from 'react';
import type {
  Integration,
  IntegrationChange,
  IntegrationsAdapter,
} from '../../api/operations';
import {
  CheckStatus,
  FixtureNotice,
  OperationsReadState,
  UtcTime,
  useOperation,
} from '../../components/OperationsStates';

function IntegrationCard({
  integration,
  adapter,
  refresh,
}: {
  integration: Integration;
  adapter: IntegrationsAdapter;
  refresh: () => Promise<unknown>;
}) {
  const { id, name, draft, active, rollbackVersion, test, revision } =
    integration;
  const { pending, error, message, run } = useOperation(refresh);
  const canActivate =
    test?.version === draft.version &&
    test.outcome === 'verified' &&
    active?.version !== draft.version;

  function apply(change: IntegrationChange, success: string) {
    return run(() => adapter.change(id, revision, change), success);
  }

  function replaceCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem(
      'credential',
    ) as HTMLInputElement;
    const secret = input.value;
    input.value = '';
    void apply(
      { kind: 'replaceCredential', secret },
      '已生成新凭据的候选草稿。',
    );
  }

  const title = `integration-${id}`;
  return (
    <section className="operations-card" aria-labelledby={title}>
      <h2 id={title}>{name}</h2>
      <p>{integration.access}</p>
      <dl className="operations-fields">
        <dt>活动版本</dt>
        <dd>
          {active ? (
            `v${active.version} · ${active.product}`
          ) : (
            <CheckStatus
              outcome={
                integration.disabledByProfile
                  ? 'disabled_by_profile'
                  : 'disabled'
              }
            />
          )}
        </dd>
        <dt>候选草稿</dt>
        <dd>
          v{draft.version} · {draft.product}
        </dd>
        {integration.acceptsCredential && (
          <>
            {active?.credential && (
              <>
                <dt>活动凭据</dt>
                <dd>已配置 · •••••••• · v{active.credential.version}</dd>
              </>
            )}
            <dt>草稿凭据</dt>
            <dd>
              {draft.credential ? (
                <>
                  已配置 · •••••••• · v{draft.credential.version} ·{' '}
                  <UtcTime value={draft.credential.rotatedAt} />
                </>
              ) : (
                '未配置'
              )}
            </dd>
          </>
        )}
        <dt>可回滚版本</dt>
        <dd>
          {rollbackVersion
            ? `v${rollbackVersion.version} · ${rollbackVersion.product}`
            : '暂无'}
        </dd>
      </dl>
      {integration.products.length > 1 && (
        <form
          key={draft.version}
          className="operations-actions"
          onSubmit={(event) => {
            event.preventDefault();
            const product = new FormData(event.currentTarget).get('product');
            if (typeof product === 'string' && product !== draft.product) {
              void apply(
                { kind: 'configure', product },
                '已保存草稿，请测试候选版本。',
              );
            }
          }}
        >
          <label>
            产品
            <select
              name="product"
              defaultValue={draft.product}
              disabled={pending}
            >
              {integration.products.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="refresh" disabled={pending}>
            保存草稿
          </button>
        </form>
      )}
      {integration.acceptsCredential && (
        <form
          className="operations-actions"
          onSubmit={replaceCredential}
          autoComplete="off"
        >
          <label>
            替换凭据
            <input
              type="password"
              name="credential"
              autoComplete="new-password"
              required
              maxLength={4096}
              disabled={pending}
            />
          </label>
          <button type="submit" className="refresh" disabled={pending}>
            保存替换
          </button>
          <button
            type="button"
            className="refresh"
            disabled={pending || !draft.credential}
            onClick={(event) => {
              event.currentTarget.form?.reset();
              void apply(
                { kind: 'clearCredential' },
                '凭据已清除，关联配置已停用。',
              );
            }}
          >
            清除凭据并停用
          </button>
          <p>演示请使用占位文本。</p>
        </form>
      )}
      <h3>候选测试证据</h3>
      {test ? (
        <>
          <p>
            v{test.version} · <CheckStatus outcome={test.outcome} /> ·{' '}
            <UtcTime value={test.observedAt} />
          </p>
          <ul className="operations-list">
            {test.checks.map((check) => (
              <li key={check.name}>
                {check.name} · <CheckStatus outcome={check.outcome} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>当前草稿待测试。</p>
      )}
      <div className="operations-actions">
        <button
          type="button"
          className="refresh"
          disabled={pending || test?.outcome === 'pending'}
          onClick={() => void apply({ kind: 'test' }, '测试结果已更新。')}
        >
          测试候选
        </button>
        <button
          type="button"
          className="refresh"
          disabled={pending || !canActivate}
          onClick={() => void apply({ kind: 'activate' }, '候选版本已启用。')}
        >
          启用候选
        </button>
        <button
          type="button"
          className="refresh"
          disabled={pending || !rollbackVersion}
          onClick={() =>
            void apply({ kind: 'rollback' }, '已恢复上个有效版本。')
          }
        >
          回滚到上个有效版本
        </button>
        <button
          type="button"
          className="refresh"
          disabled={pending || !active}
          onClick={() => void apply({ kind: 'disable' }, '集成已停用。')}
        >
          停用
        </button>
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

export function Integrations({ adapter }: { adapter: IntegrationsAdapter }) {
  const integrations = useQuery({
    queryKey: ['u4', 'integrations'],
    queryFn: adapter.list,
    refetchInterval: (query) =>
      query.state.data?.some(({ test }) => test?.outcome === 'pending')
        ? 1000
        : false,
  });
  return (
    <section className="operations-page" aria-labelledby="integrations-title">
      <h1 id="integrations-title">接口设置</h1>
      <FixtureNotice />
      {integrations.data ? (
        <div className="operations-grid">
          {integrations.data.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              adapter={adapter}
              refresh={integrations.refetch}
            />
          ))}
        </div>
      ) : (
        <OperationsReadState
          failed={integrations.isError}
          retry={() => void integrations.refetch()}
        />
      )}
    </section>
  );
}
