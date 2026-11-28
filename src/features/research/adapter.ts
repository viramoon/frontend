// View models shared by the web adapter and the synthetic research screens.
export type Version = { id: string; version: string };
export type Revision = Version & { contentSha256: string };
export type DecimalText = string;

type StrategyVersion = Version & { title: string };
export type Strategy = StrategyVersion &
  (
    | { kind: 'backtest' }
    | { kind: 'research_only'; definition: string; conclusion: string }
  );

export type StrategySource =
  | { kind: 'registered'; selection: Version }
  | { kind: 'yaml'; content: string };

export type Diagnostic = {
  code: string;
  message: string;
  path?: string;
  location?: { line: number; column: number };
};

export type CompiledPlan = {
  revision: Revision;
  title: string;
  planVersion: string;
  engine: string;
  bars: string;
  universe: string;
  calendar: string;
  warmupSessions: number | '未提供';
  timing: string;
  dependencies: { name: string; ref: string }[];
  sleeves: { recipe: string; budgetWeight: DecimalText; priority: number }[];
  cash: DecimalText;
  currency: string;
  commissionBps: DecimalText;
  slippageBps: DecimalText;
};

export type Compilation =
  | { kind: 'compiled'; plan: CompiledPlan }
  | { kind: 'invalid'; diagnostics: Diagnostic[] };

export type DateWindow = { start: string; end: string };
export type Dataset = {
  id: string;
  title: string;
  bars: string;
  universe: string;
  windows: DateWindow[];
};

export type Factor = Version & {
  title: string;
  definition: string;
  dataVersion: string;
  availability: string;
  warmupSessions: number | string | null;
  state:
    | 'research_only'
    | 'research'
    | 'out_of_sample_validation'
    | 'observe_only'
    | 'backtest_selectable';
};

export type FactorReport = {
  costBps: DecimalText;
  windows: (DateWindow & {
    phase: 'train' | 'validation' | 'out_of_sample';
    coverage: DecimalText | null;
    factorCoverage?: DecimalText | null;
    scored?: number;
    eligible?: number;
    decay: {
      sessions: number;
      observations: number;
      rankIc: DecimalText | null;
      icir: DecimalText | null;
    }[];
    quantiles: {
      name: string;
      grossReturn: DecimalText | null;
      netReturn: DecimalText | null;
      turnover: DecimalText | null;
    }[];
    benchmarkNetReturn: DecimalText | null;
  })[];
};

// Only immutable references are needed to recover a submission after a reload.
export type RunRequest = DateWindow & { revision: Revision; datasetId: string };
export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled';
export type RunSummary = {
  id: string;
  request: RunRequest;
  status: RunStatus;
};

export type RunResult = {
  manifest: {
    planVersion: string;
    engine: string;
    snapshotSha256: string;
    universe: string;
    calendar: string;
    timezone: string;
    warmupSessions: number | '未提供';
    priceBasis: string;
    commissionBps: DecimalText;
    slippageBps: DecimalText;
  };
  currency: string;
  finalEquity: DecimalText;
  benchmark?: { title: string; finalEquity: DecimalText };
  ledger: {
    session: string;
    instrument: string;
    recipe?: string;
    side?: string;
    quantity: DecimalText;
    price: DecimalText;
    fee: DecimalText;
    cashAfter?: DecimalText;
  }[];
};

export type RunDetail = RunSummary &
  (
    | { status: 'queued' | 'running' }
    | { status: 'failed' | 'timed_out' | 'cancelled'; message: string }
    | { status: 'succeeded'; result: RunResult | null }
  );

export type RunLookup = { kind: 'found'; id: string } | { kind: 'missing' };

export interface ResearchAdapter {
  readonly source: 'fixture' | 'web';
  listStrategies(): Promise<Strategy[]>;
  compile(source: StrategySource): Promise<Compilation>;
  register?(content: string): Promise<Revision>;
  listDatasets(
    input: Pick<CompiledPlan, 'bars' | 'universe'>,
  ): Promise<Dataset[]>;
  listFactors(): Promise<Factor[]>;
  factorReport(selection: Version): Promise<FactorReport | null>;
  listRuns(): Promise<RunSummary[]>;
  listRunPage?(cursor?: string): Promise<{ runs: RunSummary[]; next?: string }>;
  run(id: string): Promise<RunDetail | null>;
  submit(request: RunRequest, key: string): Promise<{ id: string }>;
  byKey(key: string): Promise<RunLookup>;
}

// Only the local adapter can resolve queries while the browser is offline.
export function researchNetworkMode(source: ResearchAdapter['source']) {
  return source === 'fixture' ? 'always' : 'online';
}

export function researchHref(path: string, search: URLSearchParams) {
  if (search.get('research') !== 'replay') return path;
  return path + (path.includes('?') ? '&' : '?') + 'research=replay';
}
