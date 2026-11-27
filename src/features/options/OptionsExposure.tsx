import { DataClassLabel } from '../../components/PanelDataClass';
import { useState } from 'react';
import { DataState, displayDataTime } from '../../components/TerminalStates';
import { decimalKeys, scaledDecimal } from './decimal';
import {
  scenarioLabels,
  type ExposureReading,
  type ExposureSeries,
  type Scenario,
} from './optionsData';

type ReadyExposure = Extract<ExposureReading, { kind: 'ready' }>;
type PlotRow = {
  key: string;
  label: string;
  exposure: string;
  zeroDte?: string | null;
};

function ExposureTable({
  title,
  rows,
  showZeroDte,
}: {
  title: string;
  rows: readonly PlotRow[];
  showZeroDte?: boolean;
}) {
  const values = decimalKeys(rows.map(({ exposure }) => exposure));
  const max = values.reduce((peak, value) => {
    const magnitude = value < 0n ? -value : value;
    return magnitude > peak ? magnitude : peak;
  }, 0n);

  return (
    <div
      className="option-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={title}
    >
      <table className="option-table">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{showZeroDte ? '行权价' : '到期日'}</th>
            <th scope="col">GEX（USD / 1%）</th>
            {showZeroDte && <th scope="col">其中 0DTE</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const value = values[index];
            const negative = value < 0n;
            const magnitude = negative ? -value : value;
            const width =
              max === 0n ? '0' : scaledDecimal((magnitude * 10000n) / max, 2);
            return (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td className="option-number">
                  <span className="option-plot" aria-hidden="true">
                    <span className="option-plot-side negative">
                      {negative && <i style={{ width: width + '%' }} />}
                    </span>
                    <span className="option-plot-side positive">
                      {!negative && <i style={{ width: width + '%' }} />}
                    </span>
                  </span>
                  {row.exposure}
                </td>
                {showZeroDte && (
                  <td className="option-number">{row.zeroDte ?? '—'}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExposureFlip({
  flip,
  fixture,
}: {
  flip: ExposureSeries['flip'];
  fixture: boolean;
}) {
  return (
    <section className="option-panel" aria-labelledby="option-flip">
      <h2 id="option-flip">Gamma flip</h2>
      <DataClassLabel kind="price-volume" />
      {flip.kind === 'not_evaluated' ? (
        <DataState kind="empty" title="未评估 flip" detail={flip.reason} />
      ) : (
        <>
          <p className="option-note">
            {fixture
              ? '后端情景网格的过零点（当前为合成样例）'
              : '后端情景网格的过零点'}
          </p>
          {flip.kind === 'none' ? (
            <DataState
              kind="empty"
              title="此情景无 flip"
              detail="在所列现货价格网格内未发现过零点。"
            />
          ) : (
            <p>
              现货价格（USD） ·{' '}
              <span className="option-number">{flip.spots.join('、')}</span>
            </p>
          )}
          <dl className="option-facts option-grid-facts">
            <div>
              <dt>现货价格网格（USD）</dt>
              <dd>
                {flip.grid.from} 至 {flip.grid.to}，步长 {flip.grid.step}
              </dd>
            </div>
            <div>
              <dt>后端网格模型</dt>
              <dd>{flip.grid.pricingModel}</dd>
            </div>
            <div>
              <dt>IV 口径</dt>
              <dd>{flip.grid.ivBasis}</dd>
            </div>
            <div>
              <dt>利率 / 股息率（小数）</dt>
              <dd>
                {flip.grid.riskFreeRate} / {flip.grid.dividendYield}
              </dd>
            </div>
          </dl>
          <details className="option-record">
            <summary>查看情景网格点</summary>
            <div
              className="option-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="情景网格点"
            >
              <table className="option-table">
                <caption className="option-visually-hidden">情景网格点</caption>
                <thead>
                  <tr>
                    <th scope="col">现货价格（USD）</th>
                    <th scope="col">净 GEX（USD / 1%）</th>
                  </tr>
                </thead>
                <tbody>
                  {flip.grid.points.map(({ spot, exposure }) => (
                    <tr key={spot}>
                      <th scope="row">{spot}</th>
                      <td className="option-number">{exposure}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

function ExposureCoverage({ reading }: { reading: ReadyExposure }) {
  const { coverage } = reading;
  const partial =
    coverage.validContracts < coverage.candidateContracts ||
    coverage.totalOi === null;
  return (
    <section className="option-panel" aria-labelledby="option-coverage">
      <header className="option-section-heading">
        <h2 id="option-coverage">覆盖与输入时间</h2>
        {partial && <span className="terminal-badge delay">局部估算</span>}
      </header>
      <DataClassLabel kind="price-volume" />
      <dl className="option-facts option-grid-facts">
        <div>
          <dt>有效 / 候选合约</dt>
          <dd>
            {coverage.validContracts} / {coverage.candidateContracts}
          </dd>
        </div>
        <div>
          <dt>有效 / 全部 OI（张）</dt>
          <dd>
            {coverage.validOi} / {coverage.totalOi ?? '未知'}
          </dd>
        </div>
        <div>
          <dt>OI 观察时间</dt>
          <dd>
            <time dateTime={reading.oiObservedAt}>
              {displayDataTime(reading.oiObservedAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>输入观察跨度</dt>
          <dd>
            <time dateTime={coverage.earliest}>
              {displayDataTime(coverage.earliest)}
            </time>{' '}
            至{' '}
            <time dateTime={coverage.latest}>
              {displayDataTime(coverage.latest)}
            </time>
          </dd>
        </div>
        <div>
          <dt>缺失原因</dt>
          <dd>{coverage.missing.join('；') || '无'}</dd>
        </div>
      </dl>
    </section>
  );
}

function ExposureInputs({ reading }: { reading: ReadyExposure }) {
  return (
    <section className="option-panel" aria-labelledby="option-contracts">
      <h2 id="option-contracts">合约级输入</h2>
      <DataClassLabel kind="price-volume" />
      <p className="option-note">OI 用张数，IV 用小数。— 表示缺值。</p>
      <div
        className="option-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="合约级 OI、IV 与 gamma"
      >
        <table className="option-table option-inputs">
          <caption className="option-visually-hidden">
            合约级 OI、IV 与 gamma
          </caption>
          <thead>
            <tr>
              <th scope="col">合约</th>
              <th scope="col">行权价（USD）</th>
              <th scope="col">到期</th>
              <th scope="col">乘数</th>
              <th scope="col">OI</th>
              <th scope="col">IV</th>
              <th scope="col">gamma</th>
            </tr>
          </thead>
          <tbody>
            {reading.contracts.map((contract) => (
              <tr key={contract.id}>
                <th scope="row">
                  {contract.id} · {contract.right === 'call' ? 'Call' : 'Put'}
                </th>
                <td>{contract.strike}</td>
                <td>
                  <time dateTime={contract.expiry}>{contract.expiry}</time>
                  {contract.expiry === reading.sessionDate && ' · 0DTE'}
                </td>
                <td>{contract.multiplier}</td>
                <td>{contract.oi ?? '—'}</td>
                <td>{contract.iv ?? '—'}</td>
                <td>{contract.gamma ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function OptionsExposure({
  reading,
  fixture,
}: {
  reading: ExposureReading;
  fixture: boolean;
}) {
  const [scenario, setScenario] = useState<Scenario>('absolute');
  if (reading.kind === 'empty')
    return (
      <DataState
        kind="empty"
        title="暂无期权敞口数据"
        detail={reading.reason}
        illustrated
      />
    );

  const series = reading.scenarios[scenario];
  return (
    <>
      <section
        className="option-panel"
        aria-labelledby="option-exposure-series"
      >
        <header className="option-section-heading">
          <div>
            <h2 id="option-exposure-series">GEX 分布</h2>
            <DataClassLabel kind="price-volume" />
          </div>
          <label className="option-field">
            敞口情景
            <select
              value={scenario}
              onChange={(event) => setScenario(event.target.value as Scenario)}
            >
              {Object.entries(scenarioLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </header>
        <p className="option-note">
          {scenarioLabels[scenario]} · 模型 {reading.modelVersion} · 标的价格{' '}
          {reading.spot} USD · 估值时点{' '}
          <time dateTime={reading.asOf}>{displayDataTime(reading.asOf)}</time>
        </p>
        <p className="option-note">
          每项表示标的变动 1% 对应的美元 delta 变化。方向由持仓假设给定。0DTE
          按估值交易业务日划分，— 表示没有有效的 0DTE 分量。
        </p>
        <div className="option-columns">
          <ExposureTable
            title="按行权价（USD）"
            rows={series.byStrike.map(({ strike, exposure, zeroDte }) => ({
              key: strike,
              label: strike,
              exposure,
              zeroDte,
            }))}
            showZeroDte
          />
          <ExposureTable
            title="按到期日"
            rows={series.byExpiry.map(({ expiry, exposure }) => ({
              key: expiry,
              label:
                expiry === reading.sessionDate ? `${expiry} · 0DTE` : expiry,
              exposure,
            }))}
          />
        </div>
        <dl
          className="option-facts option-grid-facts option-walls"
          aria-label="Wall 行权价（USD）"
        >
          <div>
            <dt>最大绝对集中 wall</dt>
            <dd>{series.walls.absolute ?? '无'}</dd>
          </div>
          <div>
            <dt>最大正值 wall</dt>
            <dd>{series.walls.positive ?? '无'}</dd>
          </div>
          <div>
            <dt>最大负值 wall</dt>
            <dd>{series.walls.negative ?? '无'}</dd>
          </div>
        </dl>
      </section>
      <div className="option-columns">
        <ExposureCoverage reading={reading} />
        <ExposureFlip flip={series.flip} fixture={fixture} />
      </div>
      <ExposureInputs reading={reading} />
    </>
  );
}
