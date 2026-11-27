import type {
  Compilation,
  CompiledPlan,
  Diagnostic,
  Factor,
  FactorReport,
  ResearchAdapter,
  Revision,
  RunDetail,
  RunRequest,
  RunResult,
  RunSummary,
} from '../features/research/adapter';
import { adminMutationHeaders, privateOptions } from './adminWeb';
import {
  isJobId,
  lookupBacktest,
  readBacktestJob,
  readBacktestPage,
  submitBacktest,
  type WebJob,
} from './backtestsWeb';
import {
  factorEvaluation,
  factorEvaluations,
  factorList,
  register,
  strategyVersion,
  strategyVersions,
  validateStrategy,
} from './generated/sdk.gen';
import type {
  BacktestSummary,
  BundleRequestView,
  FactorEvaluationItem,
  FactorReadItem,
  RegisteredStrategy,
  StrategyBundlePreview,
} from './generated/types.gen';
import { WebRequestError } from './index';

const product = 'strategy_research';
const http = () => ({ ...privateOptions, signal: AbortSignal.timeout(10_000) });

function revision({
  id,
  version,
  content_sha256,
}: RegisteredStrategy): Revision {
  return { id, version, contentSha256: content_sha256 };
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function decimal(value: unknown) {
  return typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)
    ? value
    : '未提供';
}

function sessionCount(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : '未提供';
}

function compilePlan({ strategy, plan }: StrategyBundlePreview): CompiledPlan {
  if (strategy.content_sha256 !== plan.content_sha256)
    throw new Error('Web strategy preview has inconsistent content hashes');
  const spec = object(plan.bundle.spec);
  const clock = object(spec.clock);
  const execution = object(spec.execution);
  const cash = object(object(spec.portfolio).initial_cash);
  return {
    revision: revision(strategy),
    title: strategy.id,
    planVersion: plan.plan_version,
    engine: text(spec.engine) ?? plan.execution,
    bars: plan.inputs.bars.id,
    universe: plan.inputs.universe.id,
    calendar: plan.inputs.bars.calendar,
    warmupSessions: sessionCount(clock.warmup_sessions),
    timing: [clock.decide_on, clock.earliest_fill]
      .filter((value) => typeof value === 'string')
      .join(' → '),
    dependencies: [
      ...[...plan.factors, ...plan.modules].map((item) => ({
        name: item.local_id,
        ref: item.component,
      })),
      { name: '执行模型', ref: plan.execution },
    ],
    sleeves: plan.sleeves.map(({ recipe, budget_weight, priority }) => ({
      recipe,
      budgetWeight: budget_weight,
      priority,
    })),
    cash: decimal(cash.amount),
    currency: text(cash.currency) ?? plan.inputs.bars.currency,
    commissionBps: decimal(execution.commission_bps),
    slippageBps: decimal(execution.slippage_bps),
  };
}

export function validationDiagnostic(error: unknown): Diagnostic | undefined {
  if (!(error instanceof WebRequestError) || error.status !== 422) return;
  const { detail } = error;
  const location = detail?.location;
  return {
    code: error.code ?? 'invalid_request',
    message: text(detail?.message) ?? '请检查策略配置。',
    path: text(detail?.path),
    location:
      location &&
      Number.isInteger(location.line) &&
      location.line > 0 &&
      Number.isInteger(location.column) &&
      location.column > 0
        ? location
        : undefined,
  };
}

async function readPages<T>(
  load: (
    after?: string,
  ) => Promise<{ items: T[]; next_cursor?: string | null }>,
) {
  const items: T[] = [];
  const cursors = new Set<string>();
  let after: string | undefined;
  do {
    const page = await load(after);
    items.push(...page.items);
    after = page.next_cursor ?? undefined;
    if (after !== undefined) {
      if (cursors.has(after)) throw new Error('Repeated web catalog cursor');
      cursors.add(after);
    }
  } while (after !== undefined);
  return items;
}

function factorView({
  factor_id,
  version,
  state,
  details,
}: FactorReadItem): Factor {
  const base = { id: factor_id, version, title: factor_id, state };
  return details.kind === 'factor'
    ? {
        ...base,
        definition: details.definition,
        dataVersion: details.data_version,
        availability: details.availability_rule,
        warmupSessions: details.warmup_sessions,
      }
    : {
        ...base,
        definition: details.decision.verdict,
        dataVersion: details.source_commit,
        availability: details.decision.rule,
        warmupSessions: null,
      };
}

function evaluationView(report: FactorEvaluationItem): FactorReport {
  return {
    costBps: report.cost_bps,
    windows: report.windows.map(
      ({
        window,
        scored_coverage,
        factor_coverage,
        ic,
        quantiles,
        benchmark,
      }) => ({
        start: window.start,
        end: window.end,
        phase: window.phase,
        coverage: scored_coverage ?? null,
        factorCoverage: factor_coverage ?? null,
        decay: Object.entries(ic).map(([sessions, point]) => ({
          sessions: Number(sessions),
          observations: point.count,
          rankIc: point.mean ?? null,
          icir: point.ratio ?? null,
        })),
        quantiles: quantiles.map((bucket, index) => ({
          name: `Q${index + 1}`,
          grossReturn: bucket.cumulative_gross_return ?? null,
          netReturn: bucket.cumulative_net_return ?? null,
          turnover: bucket.total_turnover ?? null,
        })),
        benchmarkNetReturn: benchmark.cumulative_net_return ?? null,
      }),
    ),
  };
}

function requestView(request: BundleRequestView, bars?: string): RunRequest {
  return {
    start: request.start,
    end: request.end,
    datasetId: bars ?? '未提供',
    revision: revision({
      ...request.source,
      content_sha256: request.content_sha256,
    }),
  };
}

function summary(job: WebJob, request: BundleRequestView): RunSummary {
  const status = job.error === 'job_cancelled' ? 'cancelled' : job.status;
  return { id: job.id, status, request: requestView(request) };
}

function resultView(report: BacktestSummary): RunResult | null {
  const manifest = report.run_manifest;
  const result = report.strategy_report;
  if (!manifest || !result) return null;
  const data = object(manifest.data);
  const calendar = object(manifest.calendar);
  const costs = object(manifest.costs);
  return {
    currency: report.currency,
    finalEquity: decimal(object(result.equity)[text(result.pnl_as_of) ?? '']),
    manifest: {
      planVersion: text(manifest.plan_version) ?? '未提供',
      engine: text(object(manifest.engine).id) ?? '未提供',
      snapshotSha256: text(data.snapshot_sha256) ?? '未提供',
      universe: text(data.universe_ref) ?? '未提供',
      calendar: text(calendar.id) ?? '未提供',
      timezone: text(calendar.timezone) ?? '未提供',
      warmupSessions: sessionCount(object(manifest.interval).warmup_sessions),
      priceBasis: text(data.price_basis) ?? '未提供',
      commissionBps: decimal(costs.commission_bps),
      slippageBps: decimal(costs.slippage_bps),
    },
    ledger: (Array.isArray(result.fills) ? result.fills : []).map(
      (value: unknown) => {
        const fill = object(value);
        return {
          session: text(fill.fill_date) ?? '未提供',
          instrument: text(fill.instrument_id) ?? '未提供',
          side: text(fill.side),
          quantity: decimal(fill.quantity),
          price: decimal(fill.price),
          fee: decimal(fill.commission),
        };
      },
    ),
  };
}

async function listRunPage(cursor?: string) {
  const page = await readBacktestPage(
    cursor,
    AbortSignal.timeout(10_000),
    true,
  );
  return {
    runs: page.items.flatMap((job) =>
      'source' in job.request ? [summary(job, job.request)] : [],
    ),
    next: page.next_cursor ?? undefined,
  };
}

export const webResearch: ResearchAdapter = {
  source: 'web',
  async listStrategies() {
    const items = await readPages(
      async (after) =>
        (await strategyVersions({ ...http(), query: { after, limit: 100 } }))
          .data,
    );
    return items.map(({ id, version }) => ({
      id,
      version,
      title: id,
      kind: 'backtest',
    }));
  },
  async compile(source): Promise<Compilation> {
    try {
      const { data } =
        source.kind === 'registered'
          ? await strategyVersion({ ...http(), path: source.selection })
          : await validateStrategy({
              ...http(),
              headers: await adminMutationHeaders(product),
              body: { format: 'yaml', content: source.content },
            });
      return { kind: 'compiled', plan: compilePlan(data) };
    } catch (error) {
      const diagnostic = validationDiagnostic(error);
      if (!diagnostic) throw error;
      return { kind: 'invalid', diagnostics: [diagnostic] };
    }
  },
  async register(content) {
    const { data } = await register({
      ...http(),
      headers: await adminMutationHeaders(product),
      body: { format: 'yaml', content },
    });
    return revision(data);
  },
  // W2b binds bundle replay inputs in finance at submission time.
  async listDatasets() {
    return [];
  },
  async listFactors() {
    const items = await readPages(
      async (after) =>
        (await factorList({ ...http(), query: { after, limit: 100 } })).data,
    );
    return items.map(factorView);
  },
  async factorReport({ id, version }) {
    const { data } = await factorEvaluations({
      ...http(),
      path: { id },
      query: { version, limit: 1 },
    });
    const first = data.items[0];
    if (!first) return null;
    const { data: report } = await factorEvaluation({
      ...http(),
      path: { id, evaluation_id: first.evaluation_id },
      query: { version },
    });
    return evaluationView(report.item);
  },
  async listRuns() {
    return (await listRunPage()).runs;
  },
  listRunPage,
  async run(id): Promise<RunDetail | null> {
    if (!isJobId(id)) return null;
    try {
      const job = await readBacktestJob(id, AbortSignal.timeout(10_000), true);
      if (!('source' in job.request)) return null;
      const value = summary(job, job.request);
      switch (value.status) {
        case 'succeeded':
          return {
            ...value,
            status: value.status,
            request: requestView(
              job.request,
              text(object(job.summary?.run_manifest?.data).bars_ref),
            ),
            result: job.summary ? resultView(job.summary) : null,
          };
        case 'cancelled':
        case 'failed':
        case 'timed_out':
          return {
            ...value,
            status: value.status,
            message: job.error ?? '作业未成功完成。',
          };
        default:
          return { ...value, status: value.status };
      }
    } catch (error) {
      if (
        error instanceof WebRequestError &&
        error.status === 404 &&
        error.code === 'job_not_found'
      )
        return null;
      throw error;
    }
  },
  async submit({ revision: { id, version }, start, end }, key) {
    const headers = await adminMutationHeaders('backtest_submission');
    return submitBacktest(
      {
        strategy: 'StrategyBundle',
        source: { kind: 'registered', id, version },
        start: start + 'T00:00:00Z',
        end: end + 'T00:00:00Z',
      },
      key,
      headers,
    );
  },
  async byKey(key) {
    try {
      const { id } = await lookupBacktest(key);
      return { kind: 'found', id };
    } catch (error) {
      if (
        error instanceof WebRequestError &&
        error.status === 404 &&
        error.code === 'job_not_found'
      )
        return { kind: 'missing' };
      throw error;
    }
  },
};
