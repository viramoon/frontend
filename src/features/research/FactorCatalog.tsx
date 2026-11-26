import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  researchNetworkMode,
  type Factor,
  type FactorReport,
  type ResearchAdapter,
} from './adapter';
import { FixtureNotice, LoadFailure } from './ResearchStates';

const stateLabel = {
  research: '研究中',
  out_of_sample_validation: '样本外验证',
  observe_only: '仅观察',
  backtest_selectable: '可用于配置回测',
};
const phaseLabel = {
  train: '训练',
  validation: '验证',
  out_of_sample: '样本外',
};
const digits = (value: string | null) => value ?? '不可用';
const factorKey = ({ id, version }: Factor) => `${id}@${version}`;

export function FactorCatalog({ adapter }: { adapter: ResearchAdapter }) {
  const [choice, setChoice] = useState('');
  const catalog = useQuery({
    networkMode: researchNetworkMode(adapter.source),
    queryKey: ['research', adapter.source, 'factors'],
    queryFn: () => adapter.listFactors(),
  });
  const selected = choice
    ? catalog.data?.find((factor) => factorKey(factor) === choice)
    : catalog.data?.[0];

  return (
    <section className="research-page">
      <header className="research-heading">
        <div>
          <h1>因子</h1>
          <FixtureNotice
            source={adapter.source}
            detail="后续 U3 联调将由 web 提供因子目录与评价报告。"
          />
        </div>
      </header>
      {catalog.isPending && <p role="status">正在读取因子目录…</p>}
      {catalog.isError && (
        <LoadFailure retry={() => void catalog.refetch()}>
          因子目录读取失败。
        </LoadFailure>
      )}
      {catalog.data?.length === 0 && <p className="feedback">暂无因子版本。</p>}
      {catalog.data && selected && (
        <>
          <section
            className="backtest-panel research-stack"
            aria-labelledby="factor-definition"
          >
            <div className="panel-heading research-panel-heading">
              <h2 id="factor-definition">因子定义</h2>
              <span className="job-status">{stateLabel[selected.state]}</span>
            </div>
            <div className="research-form">
              <label>
                因子版本
                <select
                  value={factorKey(selected)}
                  onChange={(event) => setChoice(event.target.value)}
                >
                  {catalog.data.map((factor) => (
                    <option key={factorKey(factor)} value={factorKey(factor)}>
                      {factor.title} · {factor.version}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p>
              <code>{factorKey(selected)}</code>
            </p>
            <p>{selected.definition}</p>
            <dl className="research-facts">
              <div>
                <dt>数据版本</dt>
                <dd>
                  <code>{selected.dataVersion}</code>
                </dd>
              </div>
              <div>
                <dt>点时可用规则</dt>
                <dd>{selected.availability}</dd>
              </div>
              <div>
                <dt>预热</dt>
                <dd>{selected.warmupSessions} 个会话</dd>
              </div>
            </dl>
          </section>
          <Evaluation adapter={adapter} factor={selected} />
        </>
      )}
    </section>
  );
}

function Evaluation({
  adapter,
  factor,
}: {
  adapter: ResearchAdapter;
  factor: Factor;
}) {
  const report = useQuery({
    networkMode: researchNetworkMode(adapter.source),
    queryKey: [
      'research',
      adapter.source,
      'factor-report',
      factor.id,
      factor.version,
    ],
    queryFn: () =>
      adapter.factorReport({ id: factor.id, version: factor.version }),
  });
  return (
    <section
      className="backtest-panel research-stack"
      aria-labelledby="factor-evaluation"
    >
      <h2 id="factor-evaluation">因子评价</h2>
      {report.isPending && <p role="status">正在读取评价报告…</p>}
      {report.isError && (
        <LoadFailure retry={() => void report.refetch()}>
          评价报告读取失败。
        </LoadFailure>
      )}
      {report.data === null && <p className="job-note">该版本暂无评价报告。</p>}
      {report.data && (
        <>
          <p className="job-note">
            成本 {report.data.costBps} bp · 覆盖率、收益和换手均以比率展示。
          </p>
          {report.data.windows.map((window) => (
            <EvaluationWindow
              key={`${window.phase}/${window.start}/${window.end}`}
              window={window}
            />
          ))}
        </>
      )}
    </section>
  );
}

function EvaluationWindow({
  window,
}: {
  window: FactorReport['windows'][number];
}) {
  return (
    <div className="research-window">
      <div className="panel-heading">
        <div>
          <h3>{phaseLabel[window.phase]}</h3>
          <p className="job-note">
            {window.start} 至 {window.end}
          </p>
        </div>
        <p>
          覆盖率 <strong>{window.coverage}</strong> · {window.scored} /{' '}
          {window.eligible}
        </p>
      </div>
      <div className="research-source-grid">
        <div
          className="result-table-wrap"
          role="region"
          aria-label={`${phaseLabel[window.phase]} IC 衰减表`}
          tabIndex={0}
        >
          <table className="result-table">
            <caption>IC 衰减</caption>
            <thead>
              <tr>
                <th scope="col">期限</th>
                <th scope="col">Rank IC</th>
                <th scope="col">ICIR</th>
                <th scope="col">观测期数</th>
              </tr>
            </thead>
            <tbody>
              {window.decay.map((point) => (
                <tr key={point.sessions}>
                  <th scope="row">{point.sessions} 会话</th>
                  <td>{digits(point.rankIc)}</td>
                  <td>{digits(point.icir)}</td>
                  <td>{point.observations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          className="result-table-wrap"
          role="region"
          aria-label={`${phaseLabel[window.phase]} 分位组合表`}
          tabIndex={0}
        >
          <table className="result-table">
            <caption>分位组合与等权基准</caption>
            <thead>
              <tr>
                <th scope="col">组合</th>
                <th scope="col">费前收益</th>
                <th scope="col">费后收益</th>
                <th scope="col">换手</th>
              </tr>
            </thead>
            <tbody>
              {window.quantiles.map((bucket) => (
                <tr key={bucket.name}>
                  <th scope="row">{bucket.name}</th>
                  <td>{digits(bucket.grossReturn)}</td>
                  <td>{digits(bucket.netReturn)}</td>
                  <td>{digits(bucket.turnover)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">等权基准</th>
                <td>—</td>
                <td>{digits(window.benchmarkNetReturn)}</td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
