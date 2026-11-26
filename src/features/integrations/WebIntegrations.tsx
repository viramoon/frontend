import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import type {
  CatalogEntry,
  MarketResult,
  Settings,
  TestEvidence,
  TestView,
} from '../../api/generated/types.gen';
import type {
  ManagedChange,
  ManagedIntegration,
  WebIntegrationsAdapter,
} from '../../api/integrationsWeb';
import {
  attemptLabels,
  OperationsReadState,
  UtcTime,
  useOperation,
} from '../../components/OperationsStates';

const marketResults: Record<MarketResult, string> = {
  verified: '已验证',
  market_closed: '收盘待验',
  delayed: '延迟行情',
  frozen: '冻结行情',
  no_permission: '权限失败',
  lines_full: '行情额度已满',
  source_unavailable: '行情源不可用',
  disabled: '按部署配置关闭',
  adapter_unavailable: '生产者适配器不可用（adapter_unavailable）',
  observation_pending: '等待行情观测',
  timed_out: '测试超时',
  invalid_configuration: '配置不符合要求',
  invalid_response: '生产者响应无效',
  unsafe_broker_session: '券商会话未通过 paper 只读检查',
  evidence_incomplete: '测试证据不完整',
  stale_observation: '行情观测已过期',
  replay_only: '仅有回放证据',
};

const testStatuses: Record<TestView['status'], string> = {
  pending: '正在测试',
  passed: '测试通过',
  failed: '测试失败',
  unavailable: '测试不可用',
  superseded: '测试已被替换',
};

const versionStates = {
  draft: '草稿',
  candidate: '候选',
  active: '活动',
  disabled: '已停用',
};

function settingsFor(
  entry: CatalogEntry,
  value: FormDataEntryValue | null,
): Settings | null {
  const symbol = entry.symbols.find((item) => item === value);
  if (symbol) return { symbol };
  const profile = entry.profiles.find((item) => item === value);
  return profile ? { profile } : null;
}

function SettingsPicker({
  entry,
  current,
  disabled,
}: {
  entry: CatalogEntry;
  current?: string;
  disabled: boolean;
}) {
  const values = entry.symbols.length ? entry.symbols : entry.profiles;
  return (
    <label>
      {entry.symbols.length ? '标的' : '部署配置槽'}
      <select
        name="settings"
        defaultValue={current ?? values[0]}
        disabled={disabled}
        required
      >
        {values.map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
    </label>
  );
}

function TestEvidenceDetails({ evidence }: { evidence: TestEvidence }) {
  if (evidence.kind === 'smtp') return <p>{attemptLabels[evidence.details]}</p>;
  if (evidence.kind === 'adapter') {
    return (
      <p>
        {evidence.details === 'missing_credential'
          ? '缺少凭据'
          : evidence.details}
      </p>
    );
  }
  if (evidence.kind === 'local') {
    return (
      <p>
        {evidence.details.result === 'verified'
          ? '本机验证通过'
          : evidence.details.result}
      </p>
    );
  }
  const { result, observation } = evidence.details;
  const paper =
    observation?.details.kind === 'ibkr_paper'
      ? observation.details.data
      : null;
  return (
    <>
      <p>{marketResults[result]}</p>
      {observation && (
        <p>
          行情观测 <UtcTime value={observation.observed_at} />
        </p>
      )}
      {paper && (
        <dl className="operations-fields">
          <dt>IBKR paper 只读</dt>
          <dd>
            {paper.paper_endpoint && paper.paper_account && paper.read_only
              ? '已验证'
              : '未通过验证'}
          </dd>
          <dt>股票行情类型</dt>
          <dd>{paper.stock_l1_market_data_type ?? '未知'}</dd>
          <dt>期权行情类型</dt>
          <dd>{paper.option_l1_market_data_type ?? '未知'}</dd>
          <dt>期权 OI / Greeks</dt>
          <dd>
            {paper.option_open_interest ? '有观测' : '无观测'} /{' '}
            {paper.option_greeks ? '有观测' : '无观测'}
          </dd>
          <dt>Nasdaq 深度回调</dt>
          <dd>{paper.nasdaq_depth_callback ? '有观测' : '无观测'}</dd>
          <dt>剩余行情行 / 深度行</dt>
          <dd>
            {paper.remaining_l1_lines ?? '未知'} /{' '}
            {paper.remaining_depth_lines ?? '未知'}
          </dd>
        </dl>
      )}
    </>
  );
}

function ManagedCard({
  integration,
  entry,
  adapter,
  refresh,
}: {
  integration: ManagedIntegration;
  entry: CatalogEntry | undefined;
  adapter: WebIntegrationsAdapter;
  refresh: () => Promise<unknown>;
}) {
  const { id, latest, active, lastTestId, rollbackVersions } = integration;
  const { pending, error, message, run } = useOperation(refresh);
  const test = useQuery({
    queryKey: ['u4', 'web', 'integration-test', id, lastTestId],
    queryFn: ({ signal }) => adapter.test(id, lastTestId!, signal),
    enabled: Boolean(lastTestId),
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' ? 1000 : false,
  });
  const result = test.isSuccess ? test.data : undefined;
  const canActivate =
    result?.status === 'passed' &&
    result.config_version === latest.version &&
    latest.state === 'candidate' &&
    active?.version !== latest.version;
  const draftSettings =
    latest.settings.symbol ?? latest.settings.profile ?? undefined;
  const title = `integration-${id}`;
  const canConfigure =
    entry && (entry.symbols.length > 0 || entry.profiles.length > 0);
  const canUseCredential = entry?.credential_fields.includes('api_token');

  function apply(change: ManagedChange, success: string) {
    return run(() => adapter.change(integration, change), success);
  }

  function replaceCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem(
      'credential',
    ) as HTMLInputElement;
    const secret = input.value;
    input.value = '';
    void apply({ kind: 'replaceCredential', secret }, '已生成新的候选草稿。');
  }

  return (
    <section className="operations-card" aria-labelledby={title}>
      <h2 id={title}>{entry?.title ?? integration.connector}</h2>
      <dl className="operations-fields">
        <dt>活动版本</dt>
        <dd>
          {active
            ? `v${active.version} · ${active.settings.symbol ?? active.settings.profile ?? '—'}`
            : '暂无活动版本'}
        </dd>
        <dt>当前版本</dt>
        <dd>
          v{latest.version} · {versionStates[latest.state]} ·{' '}
          {draftSettings ?? '—'}
        </dd>
        <dt>修订</dt>
        <dd>{integration.revision}</dd>
        {canUseCredential && (
          <>
            <dt>当前凭据</dt>
            <dd>
              {latest.credential ? (
                <>
                  •••••••• · v{latest.credential.version} ·{' '}
                  <UtcTime value={latest.credential.rotatedAt} />
                </>
              ) : (
                '未配置'
              )}
            </dd>
          </>
        )}
      </dl>
      {canConfigure && (
        <form
          key={latest.version}
          className="operations-actions"
          onSubmit={(event) => {
            event.preventDefault();
            const settings = settingsFor(
              entry,
              new FormData(event.currentTarget).get('settings'),
            );
            if (settings)
              void apply({ kind: 'configure', settings }, '已保存草稿。');
          }}
        >
          <SettingsPicker
            entry={entry}
            current={draftSettings}
            disabled={pending}
          />
          <button type="submit" className="refresh" disabled={pending}>
            保存草稿
          </button>
        </form>
      )}
      {canUseCredential && (
        <form
          className="operations-actions"
          onSubmit={replaceCredential}
          autoComplete="off"
        >
          <label>
            替换凭据
            <input
              type="password"
              autoComplete="new-password"
              name="credential"
              required
              minLength={16}
              maxLength={4096}
              disabled={pending}
            />
          </label>
          <button type="submit" className="refresh" disabled={pending}>
            保存替换
          </button>
          <button
            type="reset"
            className="refresh"
            disabled={pending || !latest.credential}
            onClick={() =>
              void apply({ kind: 'clearCredential' }, '凭据已清除。')
            }
          >
            清除凭据
          </button>
        </form>
      )}
      <h3>候选测试证据</h3>
      {!lastTestId ? (
        <p>暂无测试记录。</p>
      ) : result ? (
        <>
          <p>
            v{result.config_version} · {testStatuses[result.status]} ·{' '}
            <UtcTime value={result.finished_at ?? result.started_at} />
          </p>
          {result.evidence && (
            <TestEvidenceDetails evidence={result.evidence} />
          )}
        </>
      ) : (
        <OperationsReadState
          failed={test.isError}
          retry={() => void test.refetch()}
        />
      )}
      {entry?.test_available === false && <p>当前配置的测试不可用。</p>}
      <div className="operations-actions">
        <button
          type="button"
          className="refresh"
          disabled={
            pending || !entry?.test_available || result?.status === 'pending'
          }
          onClick={() => void apply({ kind: 'test' }, '已请求测试候选。')}
        >
          测试候选
        </button>
        <button
          type="button"
          className="refresh"
          disabled={pending || !canActivate}
          onClick={() => {
            if (result && canActivate)
              void apply(
                { kind: 'activate', testId: result.id },
                '候选版本已启用。',
              );
          }}
        >
          启用候选
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
      {rollbackVersions.length > 0 && (
        <form
          className="operations-actions"
          onSubmit={(event) => {
            event.preventDefault();
            const version = Number(
              new FormData(event.currentTarget).get('version'),
            );
            if (rollbackVersions.includes(version))
              void apply({ kind: 'rollback', version }, '已回滚到所选配置。');
          }}
        >
          <label>
            可回滚版本
            <select name="version" disabled={pending}>
              {rollbackVersions.map((version) => (
                <option key={version} value={version}>
                  v{version}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="refresh" disabled={pending}>
            回滚配置
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="operations-feedback">
          {error}
        </p>
      )}
      <div role="status">{pending ? '正在更新…' : message}</div>
    </section>
  );
}

function NewIntegration({
  catalog,
  adapter,
  refresh,
}: {
  catalog: readonly CatalogEntry[];
  adapter: WebIntegrationsAdapter;
  refresh: () => Promise<unknown>;
}) {
  const [connector, setConnector] = useState('');
  const { pending, error, message, run } = useOperation(refresh);
  const available = catalog.filter(
    (entry) => entry.symbols.length || entry.profiles.length,
  );
  const entry =
    available.find((item) => item.connector === connector) ?? available[0];
  if (!entry) return <p>暂无可配置的接口。</p>;
  return (
    <section className="operations-card" aria-labelledby="new-integration">
      <h2 id="new-integration">新建配置</h2>
      <form
        className="operations-actions"
        onSubmit={(event) => {
          event.preventDefault();
          const settings = settingsFor(
            entry,
            new FormData(event.currentTarget).get('settings'),
          );
          if (settings)
            void run(
              () => adapter.create(entry.connector, settings),
              '已创建草稿。',
            );
        }}
      >
        <label>
          接口类型
          <select
            value={entry.connector}
            onChange={(event) => setConnector(event.target.value)}
            disabled={pending}
          >
            {available.map((item) => (
              <option key={item.connector} value={item.connector}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <SettingsPicker
          key={entry.connector}
          entry={entry}
          disabled={pending}
        />
        <button type="submit" className="refresh" disabled={pending}>
          创建草稿
        </button>
      </form>
      {error && (
        <p role="alert" className="operations-feedback">
          {error}
        </p>
      )}
      <div role="status">{pending ? '正在创建…' : message}</div>
    </section>
  );
}

export function WebIntegrations({
  adapter,
}: {
  adapter: WebIntegrationsAdapter;
}) {
  const list = useQuery({
    queryKey: ['u4', 'web', 'integrations'],
    queryFn: ({ signal }) => adapter.list(signal),
    staleTime: 0,
  });
  return (
    <section className="operations-page" aria-labelledby="integrations-title">
      <h1 id="integrations-title">接口设置</h1>
      {list.isSuccess ? (
        <div className="operations-grid">
          <NewIntegration
            catalog={list.data.catalog}
            adapter={adapter}
            refresh={list.refetch}
          />
          {list.data.items.map((item) => (
            <ManagedCard
              key={item.id}
              integration={item}
              entry={list.data.catalog.find(
                (entry) => entry.connector === item.connector,
              )}
              adapter={adapter}
              refresh={list.refetch}
            />
          ))}
        </div>
      ) : (
        <OperationsReadState
          failed={list.isError}
          retry={() => void list.refetch()}
        />
      )}
    </section>
  );
}
