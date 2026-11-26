import type {
  Compilation,
  Diagnostic,
  ResearchAdapter,
  RunDetail,
  RunRequest,
  RunResult,
  Strategy,
  Version,
} from './adapter';
import {
  bundles,
  closeReturnReport,
  datasets,
  errorFile,
  factors,
  researchOnly,
} from './fixtures/catalog';
import { fixtureFingerprint, InvalidYaml, readYaml } from './fixtureYaml';

const compiled = bundles.map(({ plan, yaml }) => ({
  plan,
  fingerprint: fixtureFingerprint(readYaml(yaml)),
}));
const strategies: Strategy[] = [
  ...bundles.map(({ plan }) => ({
    kind: 'backtest' as const,
    id: plan.revision.id,
    version: plan.revision.version,
    title: plan.title,
  })),
  researchOnly,
];

const sameVersion = (left: Version, right: Version) =>
  left.id === right.id && left.version === right.version;
const invalid = (diagnostic: Diagnostic): Compilation => ({
  kind: 'invalid',
  diagnostics: [diagnostic],
});
const unavailable = () =>
  invalid({
    code: 'FIXTURE_NOT_FOUND',
    message: '当前演示可预览随页面提供的合成策略版本。',
  });
const researchOnlyError = () =>
  invalid({
    code: 'RESEARCH_ONLY_STRATEGY',
    path: '/metadata/id',
    message: '研究专用版本仅供查阅，不能用于配置回测。',
  });

function lookupMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || !('metadata' in value)) return;
  const { metadata } = value;
  if (!metadata || typeof metadata !== 'object') return;
  if (
    'id' in metadata &&
    'version' in metadata &&
    typeof metadata.id === 'string' &&
    typeof metadata.version === 'string'
  ) {
    return { id: metadata.id, version: metadata.version };
  }
}

function compileYaml(content: string): Compilation {
  if (content === errorFile.yaml) {
    return invalid({
      code: 'FUTURE_DATA',
      path: '/spec/data/bars',
      message: '日线在决策截止后才发布，请选择收盘时已可得的数据。',
      location: { line: 11, column: 13 },
    });
  }
  try {
    const value = readYaml(content);
    const version = lookupMetadata(value);
    if (version?.id === researchOnly.id) return researchOnlyError();
    const known =
      version &&
      compiled.find(({ plan }) => sameVersion(plan.revision, version));
    if (!known) return unavailable();
    if (known.fingerprint !== fixtureFingerprint(value)) {
      return invalid({
        code: 'FIXTURE_CONTENT_MISMATCH',
        path: '',
        message: '该策略版本已绑定合成示例内容。请重新下载对应版本后再上传。',
      });
    }
    return { kind: 'compiled', plan: known.plan };
  } catch (error) {
    if (error instanceof InvalidYaml) return invalid(error.diagnostic);
    throw error;
  }
}

type StoredRun = {
  id: string;
  key: string;
  request: RunRequest;
  created: number;
};
const runsKey = 'fertile.fixture-strategy-runs.v1';

function runs(): StoredRun[] {
  const saved = sessionStorage.getItem(runsKey);
  return saved ? JSON.parse(saved) : [];
}

function planFor({ revision, datasetId, start, end }: RunRequest) {
  const plan = compiled.find(
    ({ plan }) =>
      sameVersion(plan.revision, revision) &&
      plan.revision.contentSha256 === revision.contentSha256,
  )?.plan;
  const dataset = datasets.find(({ id }) => id === datasetId);
  if (
    !plan ||
    dataset?.bars !== plan.bars ||
    dataset.universe !== plan.universe ||
    !dataset.windows.some(
      (window) => window.start === start && window.end === end,
    )
  ) {
    throw new Error('Invalid fixture run request');
  }
  return plan;
}

function resultFor(request: RunRequest): RunResult {
  const plan = planFor(request);
  const extended = request.end === '2024-03-30';
  const rotation = plan.sleeves[0].recipe === 'topFive';
  return {
    manifest: {
      planVersion: plan.planVersion,
      engine: plan.engine,
      snapshotSha256:
        'f4758f887d8dc846457bd930d7a5ebd3703bd747d742fe6c2f16ab750ede7546',
      universe: plan.universe,
      calendar: plan.calendar,
      timezone: 'America/New_York',
      warmupSessions: plan.warmupSessions,
      priceBasis: 'raw_split_free_reviewed',
      commissionBps: plan.commissionBps,
      slippageBps: plan.slippageBps,
    },
    currency: plan.currency,
    finalEquity: rotation
      ? extended
        ? '100091.620000000000000002'
        : '100063.620000000000000002'
      : extended
        ? '100039.620000000000000002'
        : '100025.620000000000000002',
    benchmark: {
      title: '合成成分等权基准',
      finalEquity: extended ? '100050.0000' : '100020.0000',
    },
    ledger: [
      {
        session: '2024-03-05',
        instrument: 'SYN.XNYS',
        recipe: plan.sleeves[0].recipe,
        quantity: rotation ? '4' : '2',
        price: '101.125000000000000001',
        fee: rotation ? '0.1600' : '0.1300',
        cashAfter: rotation
          ? '99595.339999999999999996'
          : '99797.619999999999999998',
      },
    ],
  };
}

function statusAt(created: number) {
  const age = Date.now() - created;
  if (age < 750) return 'queued';
  if (age < 1500) return 'running';
  return 'succeeded';
}

function runDetail({ id, request, created }: StoredRun): RunDetail {
  const status = statusAt(created);
  return status === 'succeeded'
    ? { id, request, status, result: resultFor(request) }
    : { id, request, status };
}

export const fixtureResearch: ResearchAdapter = {
  source: 'fixture',
  async listStrategies() {
    return strategies;
  },
  async compile(source) {
    if (source.kind === 'yaml') return compileYaml(source.content);
    if (source.selection.id === researchOnly.id) return researchOnlyError();
    const known = compiled.find(({ plan }) =>
      sameVersion(plan.revision, source.selection),
    );
    return known ? { kind: 'compiled', plan: known.plan } : unavailable();
  },
  async listDatasets({ bars, universe }) {
    return datasets.filter(
      (dataset) => dataset.bars === bars && dataset.universe === universe,
    );
  },
  async listFactors() {
    return factors;
  },
  async factorReport(selection) {
    return sameVersion(selection, factors[0]) ? closeReturnReport : null;
  },
  async listRuns() {
    return runs().map(({ id, request, created }) => ({
      id,
      request,
      status: statusAt(created),
    }));
  },
  async run(id) {
    const found = runs().find((run) => run.id === id);
    return found ? runDetail(found) : null;
  },
  async submit(request, key) {
    planFor(request);
    const saved = runs();
    const original = saved.find((run) => run.key === key);
    if (original) {
      const previous = original.request;
      if (
        !sameVersion(previous.revision, request.revision) ||
        previous.revision.contentSha256 !== request.revision.contentSha256 ||
        previous.datasetId !== request.datasetId ||
        previous.start !== request.start ||
        previous.end !== request.end
      ) {
        throw new Error('Fixture idempotency key conflict');
      }
      return { id: original.id };
    }
    const id = `fixture-${saved.length + 1}`;
    sessionStorage.setItem(
      runsKey,
      JSON.stringify([{ id, key, request, created: Date.now() }, ...saved]),
    );
    return { id };
  },
  async byKey(key) {
    const found = runs().find((run) => run.key === key);
    return found ? { kind: 'found', id: found.id } : { kind: 'missing' };
  },
};
