import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  Compilation,
  CompiledPlan,
  ResearchAdapter,
  Strategy,
  StrategySource,
} from './adapter';
import { bundles, errorFile } from './fixtures/catalog';
import { InvalidYaml, maxYamlBytes } from './fixtureYaml';
import {
  FixtureNotice,
  LoadFailure,
  PendingSubmission,
} from './ResearchStates';
import type { RunSubmission } from './useRunSubmission';

const exampleId = bundles[0].plan.revision.id;
const versionKey = ({ id, version }: Strategy) => `${id}@${version}`;
const versionHref = (strategy: Strategy) =>
  `/strategies/${encodeURIComponent(strategy.id)}?version=${encodeURIComponent(strategy.version)}`;

function downloadHref(yaml: string) {
  return `data:application/yaml;charset=utf-8,${encodeURIComponent(yaml)}`;
}

function yamlContent(file: File): Promise<string> {
  if (file.size > maxYamlBytes) {
    return Promise.reject(
      new InvalidYaml({
        code: 'FILE_TOO_LARGE',
        message: 'YAML 上限为 256 KiB。',
      }),
    );
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(
        new InvalidYaml({
          code: 'FILE_READ_FAILED',
          message: '无法读取文件，请重新选择。',
        }),
      );
    reader.onload = () => {
      try {
        resolve(
          new TextDecoder('utf-8', { fatal: true }).decode(
            reader.result as ArrayBuffer,
          ),
        );
      } catch {
        reject(
          new InvalidYaml({
            code: 'INVALID_UTF8',
            message: '请选择 UTF-8 编码的 YAML 文件。',
          }),
        );
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

export function StrategyWorkbench({
  adapter,
  routeId,
  submission,
}: {
  adapter: ResearchAdapter;
  routeId?: string;
  submission: RunSubmission;
}) {
  const [search] = useSearchParams();
  const version = search.get('version');
  const catalog = useQuery({
    queryKey: ['research', adapter.source, 'strategies'],
    queryFn: () => adapter.listStrategies(),
  });
  const id = routeId === 'example' ? exampleId : routeId;
  const versions = (catalog.data ?? []).filter(
    (strategy) => strategy.id === id,
  );
  const selected =
    version === null
      ? versions[0]
      : versions.find((strategy) => strategy.version === version);

  return (
    <section className="research-page">
      <header className="research-heading">
        <div>
          <h1>{routeId ? '策略详情' : '策略'}</h1>
          {routeId && (
            <p className="job-note">
              {id}
              {adapter.source === 'fixture' && ' · U3 合成策略目录'}
            </p>
          )}
          <FixtureNotice
            source={adapter.source}
            detail="内置 YAML 与回测作业用于预览研究工作流。"
          />
        </div>
        {routeId && <Link to="/strategies">返回策略</Link>}
      </header>
      {catalog.isPending && <p role="status">正在读取策略目录…</p>}
      {catalog.isError && (
        <LoadFailure retry={() => void catalog.refetch()}>
          策略目录读取失败。
        </LoadFailure>
      )}
      {catalog.data &&
        (routeId ? (
          selected ? (
            <>
              {versions.length > 1 && (
                <nav className="research-nav" aria-label="登记版本">
                  {versions.map((strategy) => (
                    <Link
                      key={versionKey(strategy)}
                      to={versionHref(strategy)}
                      aria-current={
                        selected.version === strategy.version
                          ? 'page'
                          : undefined
                      }
                    >
                      {strategy.version}
                    </Link>
                  ))}
                </nav>
              )}
              {selected.kind === 'research_only' ? (
                <section
                  className="backtest-panel research-stack"
                  aria-labelledby="research-only-heading"
                >
                  <h2 id="research-only-heading">{selected.title}</h2>
                  <p>
                    <strong>研究专用 · 只读</strong>
                  </p>
                  <p>
                    <code>{versionKey(selected)}</code>
                  </p>
                  <p>{selected.definition}</p>
                  <p>{selected.conclusion}</p>
                </section>
              ) : (
                <CompileForm
                  key={versionKey(selected)}
                  adapter={adapter}
                  registered={[selected]}
                  initial={selected}
                  submission={submission}
                />
              )}
            </>
          ) : (
            <p className="feedback">未找到该策略版本。</p>
          )
        ) : (
          <>
            <CompileForm
              adapter={adapter}
              registered={catalog.data.filter(
                (strategy) => strategy.kind === 'backtest',
              )}
              submission={submission}
            />
            <section
              className="backtest-panel"
              aria-labelledby="strategy-catalog-heading"
            >
              <h2 id="strategy-catalog-heading">策略目录</h2>
              {!catalog.data.length && (
                <p className="job-note">暂无登记的策略版本。</p>
              )}
              <ul className="research-catalog">
                {catalog.data.map((strategy) => (
                  <li key={versionKey(strategy)}>
                    <div>
                      <Link to={versionHref(strategy)}>{strategy.title}</Link>
                      <code>{versionKey(strategy)}</code>
                    </div>
                    <span className="job-status">
                      {strategy.kind === 'research_only'
                        ? '研究专用 · 只读'
                        : '配置回测'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ))}
      {!routeId && adapter.source === 'fixture' && (
        <p className="research-example-link">
          <Link to="/strategies/example">查看策略详情骨架</Link>
        </p>
      )}
    </section>
  );
}

function CompileForm({
  adapter,
  registered,
  initial,
  submission,
}: {
  adapter: ResearchAdapter;
  registered: Strategy[];
  initial?: Strategy;
  submission: RunSubmission;
}) {
  const [choice, setChoice] = useState('');
  const [file, setFile] = useState<File>();
  const [compiling, setCompiling] = useState(false);
  const [compilation, setCompilation] = useState<Compilation>();
  const [failed, setFailed] = useState(false);
  const strategy = choice
    ? registered.find((option) => versionKey(option) === choice)
    : registered[0];
  const fixtureFile =
    adapter.source === 'fixture' &&
    bundles.find(
      ({ plan }) =>
        plan.revision.id === strategy?.id &&
        plan.revision.version === strategy?.version,
    );

  function reset() {
    setCompilation(undefined);
    setFailed(false);
  }

  async function compile(type: StrategySource['kind']) {
    reset();
    setCompiling(true);
    try {
      if (type === 'registered' && strategy) {
        setCompilation(
          await adapter.compile({
            kind: 'registered',
            selection: { id: strategy.id, version: strategy.version },
          }),
        );
      } else if (type === 'yaml' && file) {
        setCompilation(
          await adapter.compile({
            kind: 'yaml',
            content: await yamlContent(file),
          }),
        );
      }
    } catch (error) {
      if (error instanceof InvalidYaml) {
        setCompilation({ kind: 'invalid', diagnostics: [error.diagnostic] });
      } else {
        setFailed(true);
      }
    } finally {
      setCompiling(false);
    }
  }

  return (
    <div className="research-stack">
      <section
        className="backtest-panel research-stack"
        aria-labelledby="strategy-compile-heading"
      >
        <h2 id="strategy-compile-heading">
          {initial?.title ?? '编译策略配置'}
        </h2>
        <fieldset className="research-source-grid" disabled={compiling}>
          <form
            className="research-form"
            onSubmit={(event) => {
              event.preventDefault();
              void compile('registered');
            }}
          >
            <label>
              登记版本
              <select
                value={strategy ? versionKey(strategy) : ''}
                onChange={(event) => {
                  setChoice(event.target.value);
                  reset();
                }}
              >
                {registered.map((option) => (
                  <option key={versionKey(option)} value={versionKey(option)}>
                    {option.title} · {option.version}
                  </option>
                ))}
              </select>
            </label>
            <div className="backtest-actions">
              <button type="submit" disabled={!strategy}>
                预览登记版本
              </button>
              {fixtureFile && (
                <a
                  download={fixtureFile.filename}
                  href={downloadHref(fixtureFile.yaml)}
                >
                  下载示例 YAML
                </a>
              )}
            </div>
          </form>
          {!initial && (
            <form
              className="research-form"
              onSubmit={(event) => {
                event.preventDefault();
                void compile('yaml');
              }}
            >
              <label>
                上传 YAML
                <input
                  type="file"
                  accept=".yaml,.yml,application/yaml,text/yaml"
                  onChange={(event) => {
                    setFile(event.target.files?.[0]);
                    reset();
                  }}
                />
              </label>
              <div className="backtest-actions">
                <button type="submit" disabled={!file}>
                  校验并预览文件
                </button>
                {adapter.source === 'fixture' && (
                  <a
                    download={errorFile.filename}
                    href={downloadHref(errorFile.yaml)}
                  >
                    下载校验错误示例
                  </a>
                )}
              </div>
            </form>
          )}
        </fieldset>
        {compiling && <p role="status">正在读取并校验 YAML 配置…</p>}
        {failed && (
          <p role="alert" className="job-message">
            无法读取编译结果，请重试。
          </p>
        )}
        {compilation?.kind === 'invalid' && (
          <div role="alert" className="research-diagnostics">
            <h3>校验失败</h3>
            <ul>
              {compilation.diagnostics.map((error, index) => (
                <li key={`${error.code}-${index}`}>
                  <strong>
                    {error.location &&
                      `第 ${error.location.line} 行，第 ${error.location.column} 列 · `}
                    {error.code}
                  </strong>
                  {error.path !== undefined && (
                    <code>{error.path || '文档根节点'}</code>
                  )}
                  <p>{error.message}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      {compilation?.kind === 'compiled' && (
        <PlanPreview plan={compilation.plan} />
      )}
      {compilation?.kind === 'compiled' && (
        <RunForm
          key={compilation.plan.revision.contentSha256}
          adapter={adapter}
          plan={compilation.plan}
          submission={submission}
        />
      )}
      {(submission.pending || submission.notice) && (
        <section className="backtest-panel" aria-label="作业恢复">
          <PendingSubmission submission={submission} />
        </section>
      )}
    </div>
  );
}

function PlanPreview({ plan }: { plan: CompiledPlan }) {
  return (
    <section
      className="backtest-panel research-stack"
      aria-labelledby="plan-heading"
    >
      <div className="panel-heading research-panel-heading">
        <h2 id="plan-heading">编译预览</h2>
        <span className="job-status succeeded">校验通过 · 模拟回测</span>
      </div>
      <p>
        <strong>{plan.title}</strong> ·{' '}
        <code>
          {plan.revision.id}@{plan.revision.version}
        </code>
      </p>
      <dl className="research-facts">
        <div>
          <dt>内容 SHA-256</dt>
          <dd>
            <code>{plan.revision.contentSha256}</code>
          </dd>
        </div>
        <div>
          <dt>计划版本</dt>
          <dd>
            <code>{plan.planVersion}</code>
          </dd>
        </div>
        <div>
          <dt>引擎</dt>
          <dd>
            <code>{plan.engine}</code>
          </dd>
        </div>
        <div>
          <dt>来源与股票池</dt>
          <dd>
            <code>{plan.bars}</code>
            <br />
            <code>{plan.universe}</code>
          </dd>
        </div>
        <div>
          <dt>日历与预热</dt>
          <dd>
            {plan.calendar} · {plan.warmupSessions} 个会话
          </dd>
        </div>
        <div>
          <dt>决策与成交时钟</dt>
          <dd>{plan.timing}</dd>
        </div>
        <div>
          <dt>初始资金</dt>
          <dd>
            {plan.cash} {plan.currency}
          </dd>
        </div>
        <div>
          <dt>手续费 / 滑点</dt>
          <dd>
            {plan.commissionBps} / {plan.slippageBps} bp
          </dd>
        </div>
      </dl>
      <div className="research-source-grid">
        <div>
          <h3>锁定组件</h3>
          <ul className="research-rows">
            {plan.dependencies.map(({ name, ref }) => (
              <li key={name}>
                {name} <code>{ref}</code>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>组合配方</h3>
          <ul className="research-rows">
            {plan.sleeves.map(({ recipe, budgetWeight, priority }) => (
              <li key={recipe}>
                <code>{recipe}</code> · 预算权重 {budgetWeight} · 优先级{' '}
                {priority}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function RunForm({
  adapter,
  plan,
  submission,
}: {
  adapter: ResearchAdapter;
  plan: CompiledPlan;
  submission: RunSubmission;
}) {
  const datasets = useQuery({
    queryKey: [
      'research',
      adapter.source,
      'datasets',
      plan.bars,
      plan.universe,
    ],
    queryFn: () =>
      adapter.listDatasets({ bars: plan.bars, universe: plan.universe }),
  });
  const [datasetId, setDatasetId] = useState<string>();
  const [windowIndex, setWindowIndex] = useState(0);
  const dataset = datasetId
    ? datasets.data?.find(({ id }) => id === datasetId)
    : datasets.data?.[0];
  const window = dataset?.windows[windowIndex];

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dataset || !window || submission.pending) return;
    void submission.create({
      revision: plan.revision,
      datasetId: dataset.id,
      ...window,
    });
  }

  return (
    <section
      className="backtest-panel research-stack"
      aria-labelledby="launch-strategy-heading"
    >
      <h2 id="launch-strategy-heading">配置回测</h2>
      {datasets.isPending && <p role="status">正在读取匹配的数据集…</p>}
      {datasets.isError && (
        <LoadFailure retry={() => void datasets.refetch()}>
          数据集读取失败。
        </LoadFailure>
      )}
      {datasets.data && !datasets.data.length && (
        <p>该策略版本暂无匹配的数据集。</p>
      )}
      {datasets.data && dataset && (
        <form className="research-form" onSubmit={start}>
          <fieldset disabled={submission.busy || Boolean(submission.pending)}>
            <div className="research-source-grid">
              <label>
                数据集
                <select
                  value={dataset.id}
                  onChange={(event) => {
                    setDatasetId(event.target.value);
                    setWindowIndex(0);
                  }}
                >
                  {datasets.data.map(({ id, title }) => (
                    <option key={id} value={id}>
                      {title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                时间窗（结束日不含）
                <select
                  value={windowIndex}
                  onChange={(event) =>
                    setWindowIndex(Number(event.target.value))
                  }
                >
                  {dataset.windows.map(({ start, end }, index) => (
                    <option key={`${start}/${end}`} value={index}>
                      {start} 至 {end}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!dataset.windows.length && <p>该数据集暂无可选时间窗。</p>}
            <div className="backtest-actions">
              <button
                type="submit"
                className="submit-backtest"
                disabled={!window}
              >
                {adapter.source === 'fixture' ? '运行示例回测' : '提交配置回测'}
              </button>
              <Link to="/backtests?view=strategy">打开配置作业列表</Link>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
