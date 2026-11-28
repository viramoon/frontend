import {
  OperationError,
  backupMaxAgeSeconds,
  type DriveBackup,
  type DriveBackupObservation,
  type Alert,
  type AlertsAdapter,
  type CheckOutcome,
  type Delivery,
  type Integration,
  type IntegrationChange,
  type IntegrationVersion,
  type NotificationRule,
  type OperationsAdapter,
} from './operations';

// Hand-authored scenarios, independent of any account, provider or production snapshot.
export { operationsFixtureSeed } from './operations';
const start = Date.parse('2000-01-03T12:00:00Z');
const minute = 60_000;
const mailCompletedAfterMs = 1000;
const timestamp = (time: number) => new Date(time).toISOString();
const beforeStart = (minutes: number) => timestamp(start - minutes * minute);
const stocks = '综合股票 L1';
const options = '期权 L1、OI 与 Greeks';
const depth = 'Nasdaq 多档盘口';
const drive = '预配置加密 remote';

const integrationSpecs = [
  {
    id: 'ibkr-paper',
    name: 'IBKR paper',
    access: 'paper · 只读行情',
    products: [stocks, options, depth],
    initiallyActive: true,
  },
  {
    id: 'hyperliquid',
    name: 'Hyperliquid',
    access: '公共行情 · 无凭据',
    products: ['BTC 永续', 'ETH 永续', 'SOL 永续'],
    initiallyActive: true,
  },
  {
    id: 'binance',
    name: 'Binance',
    access: '公共行情 · 无凭据',
    products: [
      'BTC/USDT 现货',
      'ETH/USDT 现货',
      'SOL/USDT 现货',
      'BTC/USDT 永续',
      'ETH/USDT 永续',
      'SOL/USDT 永续',
    ],
    initiallyActive: false,
  },
  {
    id: 'smtp',
    name: 'SMTP',
    access: '固定 TLS 配置 · 本人邮箱',
    products: ['邮件'],
    initiallyActive: true,
  },
  {
    id: 'drive',
    name: 'Google Drive',
    access: '授权与加密材料由运维管理',
    products: [drive],
    initiallyActive: true,
  },
] as const;

const ibkrChecks = [
  { name: 'paper 端点、唯一 client ID 与只读配置', outcome: 'verified' },
  { name: stocks, outcome: 'verified' },
  { name: options, outcome: 'pending_market_open' },
  { name: depth, outcome: 'permission_denied' },
] as const;

function resultFor(id: Integration['id'], draft: IntegrationVersion) {
  if (id === 'ibkr-paper') {
    return ibkrChecks.find((check) => check.name === draft.product)!.outcome;
  }
  if (id === 'smtp' && !draft.credential) return 'missing_credential';
  return 'verified';
}

function evidence(
  id: Integration['id'],
  draft: IntegrationVersion,
  observedAt: string,
): NonNullable<Integration['test']> {
  const outcome: CheckOutcome = resultFor(id, draft);
  return {
    version: draft.version,
    observedAt,
    outcome,
    checks:
      id === 'ibkr-paper' ? ibkrChecks : [{ name: draft.product, outcome }],
  };
}

function changedIntegration(
  current: Integration,
  change: IntegrationChange,
  now: string,
): Integration {
  const { id, draft, active, rollbackVersion, test } = current;
  const next = { ...current, revision: current.revision + 1 };
  const newDraft = { ...draft, version: next.revision };
  switch (change.kind) {
    case 'configure':
      if (!current.products.includes(change.product))
        throw new OperationError('invalid');
      return {
        ...next,
        draft: { ...newDraft, product: change.product },
        test: null,
      };
    case 'replaceCredential':
      if (!current.acceptsCredential || !change.secret.trim())
        throw new OperationError('invalid');
      return {
        ...next,
        draft: {
          ...newDraft,
          credential: { version: next.revision, rotatedAt: now },
        },
        test: null,
      };
    case 'clearCredential':
      if (!current.acceptsCredential || !draft.credential)
        throw new OperationError('invalid');
      return {
        ...next,
        draft: { ...newDraft, credential: null },
        active: null,
        rollbackVersion: null,
        test: null,
      };
    case 'test':
      return { ...next, test: evidence(id, draft, now) };
    case 'activate':
      if (
        test?.version !== draft.version ||
        test.outcome !== 'verified' ||
        active?.version === draft.version
      ) {
        throw new OperationError('conflict');
      }
      return {
        ...next,
        active: draft,
        rollbackVersion: active ?? rollbackVersion,
        disabledByProfile: false,
      };
    case 'rollback':
      if (!rollbackVersion) throw new OperationError('conflict');
      return {
        ...next,
        active: rollbackVersion,
        rollbackVersion: active,
        disabledByProfile: false,
      };
    case 'disable':
      if (!active) throw new OperationError('conflict');
      return { ...next, active: null, rollbackVersion: active };
  }
}

const rejectedMail: Delivery = {
  status: 'failed',
  updatedAt: beforeStart(24),
  attempts: [{ startedAt: beforeStart(25), outcome: 'rejected' }],
};

export function simulateDriveBackup(
  observation: DriveBackupObservation,
): DriveBackup {
  const ageMs =
    observation.observedAt && observation.lastRecoverableAt
      ? Date.parse(observation.observedAt) -
        Date.parse(observation.lastRecoverableAt)
      : NaN;
  const ageSeconds =
    Number.isFinite(ageMs) && ageMs >= 0 ? Math.trunc(ageMs / 1000) : null;
  const overdue = ageMs > backupMaxAgeSeconds * 1000;
  return {
    ...observation,
    ageSeconds,
    overdue,
    alert:
      overdue ||
      ageSeconds === null ||
      observation.state === 'degraded' ||
      observation.lastDrill?.passed === false,
  };
}

export function createOperationsFixture(
  clock = Date.now,
  initialRecoveryAgeMs = 72 * minute,
): OperationsAdapter & { alerts: Required<Pick<AlertsAdapter, 'silence'>> } {
  const initialized = clock();
  const now = () => start + (clock() - initialized);
  const recoveryPoint = start - initialRecoveryAgeMs;
  const integrations = new Map<Integration['id'], Integration>(
    integrationSpecs.map(({ initiallyActive, ...spec }) => {
      const draft: IntegrationVersion = {
        version: 1,
        product: spec.products[0],
        credential:
          spec.id === 'smtp'
            ? { version: 1, rotatedAt: beforeStart(600) }
            : null,
      };
      return [
        spec.id,
        {
          ...spec,
          acceptsCredential: spec.id === 'smtp',
          revision: 1,
          draft,
          active: initiallyActive ? draft : null,
          rollbackVersion: null,
          disabledByProfile: spec.id === 'binance',
          test: initiallyActive
            ? evidence(spec.id, draft, beforeStart(90))
            : null,
        },
      ];
    }),
  );
  type AlertSeed = Omit<Alert, 'acknowledgedAt' | 'silencedUntil'>;
  const thresholdCrossedAt = timestamp(
    recoveryPoint + backupMaxAgeSeconds * 1000 + 1,
  );
  const backupAlert: AlertSeed = {
    id: 'backup',
    severity: 'urgent',
    condition: 'backup_stale',
    active: true,
    observedAt: thresholdCrossedAt,
    deliveries: [
      { status: 'pending', updatedAt: thresholdCrossedAt, attempts: [] },
    ],
  };
  const alertFixtures: AlertSeed[] = [
    {
      id: 'market',
      severity: 'important',
      condition: 'market_permission_denied',
      active: true,
      observedAt: beforeStart(20),
      deliveries: [],
    },
    {
      id: 'email',
      severity: 'important',
      condition: 'smtp_unavailable',
      active: false,
      observedAt: beforeStart(25),
      deliveries: [rejectedMail],
    },
  ];
  const alerts = new Map<string, Alert>(
    alertFixtures.map(({ id, ...alert }) => [
      id,
      { id, ...alert, acknowledgedAt: null, silencedUntil: null },
    ]),
  );
  const rules = new Map(
    [backupAlert, ...alertFixtures].map(
      ({ id, severity, condition }): [string, NotificationRule] => [
        id,
        {
          id,
          severity,
          condition,
          revision: 1,
          enabled: true,
          emailEnabled: id === 'backup',
          minOccurrences: 1,
          cooldownSeconds: 900,
          silencedUntil: null,
        },
      ],
    ),
  );
  type MailTest = { started: number; configured: boolean };
  const mailTests = new Map<string, MailTest>();
  let lastEmailTest: MailTest | null = null;

  function testDelivery({ started, configured }: MailTest): Delivery {
    const elapsed = now() - started;
    if (elapsed < 300)
      return { status: 'pending', updatedAt: timestamp(started), attempts: [] };
    if (elapsed < mailCompletedAfterMs)
      return {
        status: 'sending',
        updatedAt: timestamp(started + 300),
        attempts: [],
      };
    return {
      status: configured ? 'accepted' : 'failed',
      updatedAt: timestamp(started + mailCompletedAfterMs),
      attempts: [
        {
          startedAt: timestamp(started + 300),
          outcome: configured ? 'accepted' : 'configuration_error',
        },
      ],
    };
  }

  function readBackup(observed = now()): DriveBackup {
    if (!integrations.get('drive')?.active) return { state: 'disabled' };
    return simulateDriveBackup({
      state: 'verified',
      observedAt: timestamp(observed),
      lastRecoverableAt: timestamp(recoveryPoint),
      lastFullAt: beforeStart(540),
      lastHourlyAt: timestamp(recoveryPoint),
      lastDrill: { finishedAt: beforeStart(1440), passed: true },
    });
  }

  function syncBackupAlert() {
    const backup = readBackup();
    const active = backup.state === 'verified' && backup.overdue;
    const current = alerts.get('backup');
    if (active && !current) {
      alerts.set('backup', {
        ...backupAlert,
        acknowledgedAt: null,
        silencedUntil: null,
      });
    } else if (current && current.active !== active) {
      alerts.set('backup', {
        ...current,
        active,
        inactiveReason:
          backup.state === 'disabled' ? 'backup_disabled' : undefined,
      });
    }
  }

  return {
    integrations: {
      async list() {
        return [...integrations.values()];
      },
      async change(id, revision, change) {
        const current = integrations.get(id);
        if (!current || current.revision !== revision)
          throw new OperationError('conflict');
        integrations.set(
          id,
          changedIntegration(current, change, timestamp(now())),
        );
      },
    },
    alerts: {
      async list() {
        syncBackupAlert();
        return [...alerts.values()]
          .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
          .map((alert) =>
            alert.silencedUntil && Date.parse(alert.silencedUntil) <= now()
              ? { ...alert, silencedUntil: null }
              : alert,
          );
      },
      async acknowledge(id) {
        syncBackupAlert();
        const alert = alerts.get(id);
        if (!alert) throw new OperationError('invalid');
        alerts.set(id, {
          ...alert,
          acknowledgedAt: alert.acknowledgedAt ?? timestamp(now()),
        });
      },
      async silence(id, durationMinutes) {
        syncBackupAlert();
        const alert = alerts.get(id);
        if (!alert?.active) throw new OperationError('conflict');
        alerts.set(id, {
          ...alert,
          silencedUntil: durationMinutes
            ? timestamp(now() + durationMinutes * minute)
            : null,
        });
      },
    },
    notifications: {
      async read() {
        return {
          recipientConfigured: true,
          timezone: 'Asia/Shanghai',
          quietStart: '23:00',
          quietEnd: '08:00',
          rules: [...rules.values()],
        };
      },
      async saveRule(
        id,
        revision,
        { enabled, emailEnabled, minOccurrences, cooldownSeconds },
      ) {
        const rule = rules.get(id);
        if (!rule || rule.revision !== revision)
          throw new OperationError('conflict');
        if (
          !Number.isInteger(minOccurrences) ||
          minOccurrences < 1 ||
          minOccurrences > 100 ||
          (cooldownSeconds !== null &&
            (!Number.isInteger(cooldownSeconds) ||
              cooldownSeconds < 0 ||
              cooldownSeconds > 2_147_483_647))
        ) {
          throw new OperationError('invalid');
        }
        rules.set(id, {
          ...rule,
          revision: revision + 1,
          enabled,
          emailEnabled,
          minOccurrences,
          cooldownSeconds,
        });
      },
      async startEmailTest(key) {
        if (mailTests.has(key)) return;
        lastEmailTest = {
          started: now(),
          configured: Boolean(integrations.get('smtp')?.active),
        };
        mailTests.set(key, lastEmailTest);
      },
      async readEmailTest(key) {
        const test = mailTests.get(key);
        return test ? testDelivery(test) : null;
      },
    },
    async readSystem() {
      const ibkr = integrations.get('ibkr-paper')!;
      const publicSource = (id: 'hyperliquid' | 'binance') => {
        const { name, active, disabledByProfile } = integrations.get(id)!;
        return {
          id,
          name,
          status: disabledByProfile
            ? ('disabled_by_profile' as const)
            : active
              ? ('verified' as const)
              : ('disabled' as const),
          permissions: [],
          lines: null,
          depth: null,
          lastEventAt: active ? beforeStart(1) : null,
          gap: null,
          durableAt: null,
          projectedAt: null,
        };
      };
      const lastAttempt =
        lastEmailTest === null ? rejectedMail : testDelivery(lastEmailTest);
      const observed = now();
      const lastCompletedTest = [...mailTests.values()]
        .reverse()
        .find(({ started }) => observed - started >= mailCompletedAfterMs);
      const emailConfigured = Boolean(integrations.get('smtp')?.active);
      return {
        sources: [
          {
            id: ibkr.id,
            name: ibkr.name,
            status: ibkr.active ? 'verified' : 'disabled',
            permissions: ibkr.active ? ibkrChecks.slice(1) : [],
            lines: ibkr.active ? { inUse: 70, limit: 100 } : null,
            depth: ibkr.active ? { inUse: 2, limit: 3 } : null,
            lastEventAt: ibkr.active ? beforeStart(1) : null,
            gap: {
              start: beforeStart(58),
              end: beforeStart(53),
              status: 'bar_only',
            },
            durableAt: beforeStart(2),
            projectedAt: beforeStart(3),
          },
          publicSource('hyperliquid'),
          publicSource('binance'),
        ],
        backup: readBackup(observed),
        email: {
          status: !emailConfigured
            ? 'unavailable'
            : lastCompletedTest?.configured
              ? 'healthy'
              : 'degraded',
          lastAttempt,
        },
      };
    },
  };
}
