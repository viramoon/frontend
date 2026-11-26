// U3 uses only the documented synthetic research inputs.
import type {
  CompiledPlan,
  Dataset,
  Factor,
  FactorReport,
  Strategy,
} from '../adapter';
import entryExit from './entry-exit.yaml?raw';
import futureData from './future-data.yaml?raw';
import targetWeights from './target-weights.yaml?raw';

const commonPlan = {
  planVersion: 'fertile.finance/strategy-plan/v1',
  engine: 'nautilus_cash_equity',
  bars: 'example.reviewed-us-daily@1.0.0',
  universe: 'example.us-cash-equities@1.0.0',
  calendar: 'XNYS',
  warmupSessions: 30,
  timing: '收盘决策 · 最早下一交易日收盘模拟成交',
  cash: '100000',
  currency: 'USD',
  commissionBps: '2',
  slippageBps: '5',
};

export const bundles: { filename: string; yaml: string; plan: CompiledPlan }[] =
  [
    {
      filename: 'entry-exit.yaml',
      yaml: entryExit,
      plan: {
        ...commonPlan,
        revision: {
          id: 'example.equity-momentum',
          version: '1.0.0',
          contentSha256:
            '605b4867eda1d9f5116f3f981ebb403cc40d4e250ab0ba2111719a6573e1922a',
        },
        title: '日线动量入场与持有期退出',
        dependencies: [
          { name: 'mom20', ref: 'factor.close_return@1.0.0' },
          { name: 'rsi14', ref: 'indicator.rsi_wilder@1.0.0' },
          { name: 'A1', ref: 'entry.above_when_flat@1.0.0' },
          { name: 'A2', ref: 'exit.below_when_long@1.0.0' },
          { name: 'B1', ref: 'entry.below_when_flat@1.0.0' },
          { name: 'B2', ref: 'exit.holding_sessions@1.0.0' },
          { name: 'F1', ref: 'filter.complete_session_bar@1.0.0' },
          { name: 'S1', ref: 'sizing.equal_weight_capped@1.0.0' },
          { name: 'R1', ref: 'risk.long_only_cash@1.0.0' },
          { name: '执行模型', ref: 'execution.next_close_cash_equity@1.0.0' },
        ],
        sleeves: [{ recipe: 'A1_B2', budgetWeight: '1', priority: 10 }],
      },
    },
    {
      filename: 'target-weights.yaml',
      yaml: targetWeights,
      plan: {
        ...commonPlan,
        revision: {
          id: 'example.equity-top-five',
          version: '1.0.0',
          contentSha256:
            '96e4b3d55fd2ae813959c24fce20e373bbb5b37f6b0f013930a55534f3c89009',
        },
        title: '日线动量前五等权',
        dependencies: [
          { name: 'mom20', ref: 'factor.close_return@1.0.0' },
          { name: 'top_five', ref: 'allocator.top_n@1.0.0' },
          { name: 'complete_bar', ref: 'filter.complete_session_bar@1.0.0' },
          { name: 'cash_only', ref: 'risk.long_only_cash@1.0.0' },
          { name: '执行模型', ref: 'execution.next_close_cash_equity@1.0.0' },
        ],
        sleeves: [{ recipe: 'topFive', budgetWeight: '1', priority: 10 }],
      },
    },
  ];

export const errorFile = {
  filename: 'future-data.yaml',
  yaml: futureData,
  bars: 'example.delayed-us-daily@1.0.0',
};

export const researchOnly: Strategy = {
  kind: 'research_only',
  id: 'research.factor-momentum',
  version: '1.0.0',
  title: '月频因子动量',
  definition:
    '月频因子动量的历史研究登记示例。评审比较相同成本下各窗口的风险调整表现。',
  conclusion: '研究门槛未通过。此登记只提供研究结论与版本信息。',
};

export const datasets: Dataset[] = [
  {
    id: 'fixture.us-equity-daily@1.0.0',
    title: '合成美股日线',
    bars: commonPlan.bars,
    universe: commonPlan.universe,
    windows: [
      { start: '2024-03-04', end: '2024-03-16' },
      { start: '2024-03-04', end: '2024-03-30' },
    ],
  },
];

export const factors: Factor[] = [
  {
    id: 'factor.close_return',
    version: '1.0.0',
    title: '日线收盘动量',
    definition:
      '用当前可用收盘价相对 20 个会话前的收盘价计算收益率，再按截面排序。',
    dataVersion: 'fixture.us-equity-daily@1.0.0',
    availability: '日线收盘后，仅使用决策时已发布的闭合 bar',
    warmupSessions: 20,
    state: 'backtest_selectable',
  },
  {
    id: 'research.synthetic-reversal',
    version: '1.0.0',
    title: '合成反转得分',
    definition: '对最近 5 个会话的收盘收益率取负，形成反转研究得分。',
    dataVersion: 'fixture.us-equity-daily@1.0.0',
    availability: '日线收盘后，仅使用决策时已发布的闭合 bar',
    warmupSessions: 5,
    state: 'observe_only',
  },
];

// Fixed illustrative values, in decimal text, with different coverage and IC
// availability across windows. These are not the output of an evaluation engine.
export const closeReturnReport: FactorReport = {
  costBps: '2.00',
  windows: [
    {
      phase: 'train',
      start: '2024-01-02',
      end: '2024-02-09',
      coverage: '0.975',
      scored: 390,
      eligible: 400,
      decay: [
        { sessions: 1, observations: 26, rankIc: '0.16', icir: '0.48' },
        { sessions: 5, observations: 22, rankIc: '0.10', icir: '0.35' },
        { sessions: 20, observations: 7, rankIc: '0.03', icir: '0.11' },
      ],
      quantiles: [
        {
          name: 'Q1',
          grossReturn: '0.005',
          netReturn: '0.0044',
          turnover: '3.000',
        },
        {
          name: 'Q5',
          grossReturn: '0.022',
          netReturn: '0.0212',
          turnover: '4.000',
        },
      ],
      benchmarkNetReturn: '0.0112',
    },
    {
      phase: 'validation',
      start: '2024-02-12',
      end: '2024-03-01',
      coverage: '0.900',
      scored: 180,
      eligible: 200,
      decay: [
        { sessions: 1, observations: 13, rankIc: '0.12', icir: '0.32' },
        { sessions: 5, observations: 9, rankIc: '0.06', icir: '0.20' },
        { sessions: 20, observations: 0, rankIc: null, icir: null },
      ],
      quantiles: [
        {
          name: 'Q1',
          grossReturn: '0.003',
          netReturn: '0.0026',
          turnover: '2.000',
        },
        {
          name: 'Q5',
          grossReturn: '0.009',
          netReturn: '0.0086',
          turnover: '2.000',
        },
      ],
      benchmarkNetReturn: '0.0045',
    },
    {
      phase: 'out_of_sample',
      start: '2024-03-04',
      end: '2024-03-29',
      coverage: '0.950',
      scored: 285,
      eligible: 300,
      decay: [
        {
          sessions: 1,
          observations: 18,
          rankIc: '0.123456789012345678',
          icir: '0.40',
        },
        { sessions: 5, observations: 14, rankIc: '0.081', icir: '0.24' },
        { sessions: 20, observations: 0, rankIc: null, icir: null },
      ],
      quantiles: [
        {
          name: 'Q1',
          grossReturn: '0.004',
          netReturn: '0.0036',
          turnover: '2.000',
        },
        {
          name: 'Q5',
          grossReturn: '0.018',
          netReturn: '0.0174',
          turnover: '3.000',
        },
      ],
      benchmarkNetReturn: '0.0080',
    },
  ],
};
