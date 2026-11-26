import { useEffect, useState } from 'react';
import { DataState, SourceDetails } from '../../components/TerminalStates';
import type { OptionsDataAdapter, OptionsReading } from './optionsData';
import { optionsFixtureAdapter } from './optionsFixture';
import { OptionsExposure } from './OptionsExposure';
import { OptionsFlow } from './OptionsFlow';
import './options.css';

type Page = 'flow' | 'exposure';

type ReadState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; reading: OptionsReading };

function OptionsReadingView({
  adapter,
  underlying,
  page,
}: {
  adapter: OptionsDataAdapter;
  underlying: string;
  page: Page;
}) {
  const [state, setState] = useState<ReadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const reading = await adapter.read(underlying, controller.signal);
        if (!controller.signal.aborted) setState({ kind: 'ready', reading });
      } catch {
        if (!controller.signal.aborted) setState({ kind: 'failed' });
      }
    }
    void read();
    return () => controller.abort();
  }, [adapter, underlying, attempt]);

  if (state.kind === 'loading')
    return <DataState kind="loading" title="正在读取期权数据" />;
  if (state.kind === 'failed')
    return (
      <div role="alert" className="option-error">
        <DataState kind="empty" title="期权数据读取失败" />
        <button
          className="refresh"
          type="button"
          onClick={() => {
            setState({ kind: 'loading' });
            setAttempt((previous) => previous + 1);
          }}
        >
          重新读取
        </button>
      </div>
    );

  const { reading } = state;
  const { flow, exposure, fixtureSeed } = reading;
  const observations = flow.entries.filter(
    (entry) => entry.kind === 'observation',
  );
  const verified = flow.entries
    .filter((entry) => entry.kind === 'historical')
    .filter((entry) => entry.revision !== 'canceled');
  const unknown = verified.filter((entry) => entry.side === 'unknown');
  const unfillable = flow.gaps.filter(
    (gap) => gap.recovery.kind === 'unfillable',
  );

  return (
    <div className="options-reading" data-fixture-seed={fixtureSeed}>
      <section className="option-summary" aria-label="期权数据摘要">
        <SourceDetails
          source={reading.source}
          asOf={reading.asOf}
          freshness="unknown"
          fixture={Boolean(fixtureSeed)}
          replay={Boolean(fixtureSeed)}
        />
        <dl className="option-facts">
          <div>
            <dt>实时观察 · 待核验</dt>
            <dd>{observations.length} 条线索</dd>
          </div>
          <div>
            <dt>历史逐笔 · 已核验</dt>
            <dd>
              {verified.length} 笔 · 含 {unknown.length} 笔方向未知
            </dd>
          </div>
          <div>
            <dt>无法回补</dt>
            <dd>{unfillable.length} 个时间段</dd>
          </div>
        </dl>
        <dl className="option-facts">
          <div>
            <dt>假设</dt>
            <dd>GEX 敞口模型</dd>
          </div>
          <div>
            <dt>实测项</dt>
            <dd>{fixtureSeed ? 'OI 等源输入 · 合成回放值' : 'OI 等源输入'}</dd>
          </div>
          <div>
            <dt>OI 基准日</dt>
            <dd>
              {exposure.kind === 'empty' ? (
                '暂无 OI 数据'
              ) : exposure.oiDate === null ? (
                '日期未证实'
              ) : (
                <time dateTime={exposure.oiDate}>{exposure.oiDate}</time>
              )}
            </dd>
          </div>
        </dl>
      </section>
      {page === 'flow' ? (
        <OptionsFlow reading={flow} />
      ) : (
        <OptionsExposure reading={exposure} />
      )}
    </div>
  );
}

export function OptionsTerminal({
  page,
  adapter = optionsFixtureAdapter,
}: {
  page: Page;
  adapter?: OptionsDataAdapter;
}) {
  const [selected, setSelected] = useState(adapter.underlyings[0]);
  const underlying = adapter.underlyings.includes(selected)
    ? selected
    : adapter.underlyings[0];

  return (
    <div className="options-terminal">
      <header className="option-page-heading">
        <div>
          <h1>{page === 'flow' ? '期权流水' : '期权敞口'}</h1>
          <p className="option-note">后续 U2 实接依赖 W2a 网关契约。</p>
        </div>
        <label className="option-field">
          标的
          <select
            value={underlying}
            onChange={(event) => setSelected(event.target.value)}
          >
            {adapter.underlyings.map((symbol) => (
              <option key={symbol}>{symbol}</option>
            ))}
          </select>
        </label>
      </header>
      <OptionsReadingView
        key={underlying}
        adapter={adapter}
        underlying={underlying}
        page={page}
      />
    </div>
  );
}
