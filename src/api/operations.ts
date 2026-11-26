export const operationsFixtureSeed = 'u4-operations-v1';

// View models for the U4 adapter. Future implementations use the same-origin web client.
export type IntegrationId =
  | 'ibkr-paper'
  | 'hyperliquid'
  | 'binance'
  | 'smtp'
  | 'drive';

export type CheckOutcome =
  | 'verified'
  | 'pending_market_open'
  | 'permission_denied'
  | 'delayed'
  | 'capacity_exhausted'
  | 'unavailable'
  | 'missing_credential';

export type IntegrationCheck = {
  name: string;
  outcome: CheckOutcome;
};

export type IntegrationVersion = {
  version: number;
  product: string;
  credential: { version: number; rotatedAt: string } | null;
};

export type Integration = {
  id: IntegrationId;
  name: string;
  access: string;
  products: readonly string[];
  acceptsCredential: boolean;
  revision: number;
  draft: IntegrationVersion;
  active: IntegrationVersion | null;
  rollbackVersion: IntegrationVersion | null;
  disabledByProfile: boolean;
  test: {
    version: number;
    observedAt: string;
    outcome: CheckOutcome | 'pending' | 'superseded';
    checks: readonly IntegrationCheck[];
  } | null;
};

export type IntegrationChange =
  | { kind: 'configure'; product: string }
  | { kind: 'replaceCredential'; secret: string }
  | { kind: 'clearCredential' }
  | { kind: 'test' }
  | { kind: 'activate' }
  | { kind: 'rollback' }
  | { kind: 'disable' };

export type IntegrationsAdapter = {
  list(): Promise<readonly Integration[]>;
  change(
    id: IntegrationId,
    revision: number,
    change: IntegrationChange,
  ): Promise<void>;
};

export type Severity = 'urgent' | 'important' | 'informational';
export type AlertCondition =
  | 'source_unavailable'
  | 'disk_critical'
  | 'backup_stale'
  | 'recovery_verification_failed'
  | 'market_data_delayed'
  | 'book_out_of_sync'
  | 'backfill_failed'
  | 'backtest_failed'
  | 'backtest_completed'
  | 'backup_succeeded'
  | 'market_anomaly'
  | 'market_permission_denied'
  | 'smtp_unavailable';

export type DeliveryStatus =
  | 'pending'
  | 'sending'
  | 'accepted'
  | 'failed'
  | 'summarized'
  | 'suppressed';

export type Delivery = {
  status: DeliveryStatus;
  updatedAt: string;
  attempts: readonly {
    startedAt: string;
    outcome:
      | 'sending'
      | 'accepted'
      | 'timeout'
      | 'transient'
      | 'rejected'
      | 'configuration_error'
      | 'interrupted';
  }[];
};

export type Alert = {
  id: string;
  condition: AlertCondition;
  severity: Severity;
  active: boolean | null;
  inactiveReason?: 'backup_disabled' | 'backup_no_alert';
  observedAt: string;
  acknowledgedAt: string | null;
  silencedUntil: string | null;
  deliveries: readonly Delivery[];
};

export type AlertsAdapter = {
  list(signal?: AbortSignal): Promise<readonly Alert[]>;
  acknowledge(id: string): Promise<void>;
  silence?(id: string, durationMinutes: 60 | null): Promise<void>;
};

export type RuleSettings = {
  enabled: boolean;
  emailEnabled: boolean;
  minOccurrences: number;
  cooldownSeconds: number | null;
};

export type NotificationRule = RuleSettings & {
  id: string;
  revision: number;
  condition: AlertCondition;
  severity: Severity;
};

export type NotificationsAdapter = {
  read(signal?: AbortSignal): Promise<{
    recipientConfigured: boolean | null;
    timezone: string | null;
    quietStart: string | null;
    quietEnd: string | null;
    rules: readonly NotificationRule[];
  }>;
  saveRule(id: string, revision: number, settings: RuleSettings): Promise<void>;
  startEmailTest(idempotencyKey: string): Promise<void>;
  readEmailTest(
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<Delivery | null>;
};

export type DriveBackupObservation = {
  state: 'verified' | 'degraded';
  observedAt: string | null;
  lastRecoverableAt: string | null;
  lastFullAt: string | null;
  lastHourlyAt: string | null;
  lastDrill: {
    finishedAt: string;
    passed: boolean;
    recoverableAt?: string;
  } | null;
};

export type DriveBackup =
  | { state: 'disabled' }
  | { state: 'unavailable'; alert: boolean }
  | (DriveBackupObservation & {
      ageSeconds: number | null;
      alert: boolean;
      overdue: boolean;
    });

export const backupMaxAgeSeconds = 3600;

export type SystemDetails = {
  sources: readonly {
    id: IntegrationId;
    name: string;
    status: CheckOutcome | 'disabled' | 'disabled_by_profile';
    permissions: readonly IntegrationCheck[];
    lines: { inUse: number; limit: number } | null;
    depth: { inUse: number; limit: number } | null;
    lastEventAt: string | null;
    gap: {
      start: string;
      end: string;
      status: 'bar_only' | 'unrecoverable';
    } | null;
    durableAt: string | null;
    projectedAt: string | null;
  }[];
  backup: DriveBackup;
  email: {
    status: 'idle' | 'healthy' | 'degraded' | 'unavailable';
    lastAttempt: Delivery | null;
  };
};

export type OperationsAdapter = {
  integrations: IntegrationsAdapter;
  alerts: AlertsAdapter;
  notifications: NotificationsAdapter;
  readSystem(): Promise<SystemDetails>;
};

export class OperationError extends Error {
  constructor(
    readonly code:
      | 'conflict'
      | 'invalid'
      | 'unavailable'
      | 'forbidden'
      | 'uncertain',
  ) {
    super(code);
  }
}
