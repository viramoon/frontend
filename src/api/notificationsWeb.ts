import { WebRequestError } from './index';
import {
  adminMutationHeaders,
  privateOptions as options,
  privateRequest as request,
  requestStatus as status,
} from './adminWeb';
import {
  ackAlert,
  deleteAlertSilence,
  deleteRuleSilence,
  getAlert,
  getAlertSilence,
  getChannelTest,
  getRule,
  getRuleSilence,
  listAlerts,
  listRules,
  putAlertSilence,
  putRule,
  putRuleSilence,
  startChannelTest,
} from './generated/sdk.gen';
import type {
  Alert as WebAlert,
  ChannelTestDelivery,
  Rule as WebRule,
  SilenceRequest,
  SilenceStatus,
} from './generated/types.gen';
import {
  OperationError,
  type DriveBackup,
  type Alert,
  type AlertsAdapter,
  type Delivery,
  type ManualSilenceActions,
  type NotificationRule,
  type NotificationsAdapter,
} from './operations';
import { webRecovery } from './recoveryWeb';

async function allPages<T>(
  read: (
    cursor?: string,
  ) => Promise<{ items: T[]; next_cursor?: string | null }>,
) {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await read(cursor);
    items.push(...page.items);
    cursor = page.next_cursor ?? undefined;
    if (cursor !== undefined) {
      if (seen.has(cursor)) throw new OperationError('unavailable');
      seen.add(cursor);
    }
  } while (cursor !== undefined);
  return items;
}

function deliveryView(delivery: ChannelTestDelivery): Delivery {
  return {
    status: delivery.status,
    updatedAt: delivery.updated_at,
    attempts: delivery.attempts.map(({ started_at, outcome }) => ({
      startedAt: started_at,
      outcome,
    })),
  };
}

function activeUntil({ active, silence }: SilenceStatus) {
  return active ? (silence?.until ?? null) : null;
}

// W5 exposes one read per target. Keep list hydration within web's read pool.
async function mapSilences<T extends { id: string }, View>(
  entries: T[],
  read: (id: string) => Promise<SilenceStatus>,
  view: (entry: T, silence: SilenceStatus) => View,
) {
  const items: View[] = [];
  for (let index = 0; index < entries.length; index += 4) {
    const batch = entries.slice(index, index + 4);
    items.push(
      ...(await Promise.all(
        batch.map(async (entry) => view(entry, await read(entry.id))),
      )),
    );
  }
  return items;
}

const readAlertSilence = (id: string, signal?: AbortSignal) =>
  getAlertSilence({ ...options, path: { id }, signal }).then(
    ({ data }) => data,
  );

const readRuleSilence = (id: string, signal?: AbortSignal) =>
  getRuleSilence({ ...options, path: { id }, signal }).then(({ data }) => data);

function manualSilence(target: 'alert' | 'rule'): ManualSilenceActions {
  const put = target === 'alert' ? putAlertSilence : putRuleSilence;
  const remove = target === 'alert' ? deleteAlertSilence : deleteRuleSilence;
  const read = target === 'alert' ? readAlertSilence : readRuleSilence;

  function change(id: string, body?: SilenceRequest) {
    return request(async () => {
      const headers = await adminMutationHeaders('notifications');
      const write = {
        ...options,
        path: { id },
        headers,
        signal: AbortSignal.timeout(10_000),
      };
      try {
        await (body ? put({ ...write, body }) : remove(write));
      } catch (error) {
        const code = status(error);
        if (code !== 504 && code !== undefined) throw error;
        // A timed-out write may have committed. Confirm against W5 before retrying.
        const current = await read(id, AbortSignal.timeout(10_000)).catch(
          () => null,
        );
        if (
          !current ||
          (body
            ? !current.active ||
              !current.silence ||
              Date.parse(current.silence.until) !== Date.parse(body.until) ||
              current.silence.reason !== body.reason
            : current.active)
        ) {
          throw new OperationError('uncertain');
        }
      }
    });
  }

  return {
    silence: (id, until, reason) =>
      change(id, { until, reason: reason.trim() }),
    unsilence: (id) => change(id),
  };
}

function backupForAlerts(alerts: WebAlert[], signal?: AbortSignal) {
  return alerts.some(
    (alert) =>
      alert.condition === 'backup_stale' && alert.phase === 'triggered',
  )
    ? webRecovery.backup(signal).catch(() => null)
    : null;
}

function alertView(
  alert: WebAlert,
  backup: DriveBackup | null,
  silence: SilenceStatus,
): Alert {
  const backupEvent = alert.condition === 'backup_stale';
  const active =
    alert.phase === 'recovered'
      ? false
      : backupEvent
        ? backup?.state === 'disabled'
          ? false
          : backup &&
              backup.state !== 'unavailable' &&
              backup.ageSeconds !== null
            ? backup.overdue
            : null
        : alert.disposition === 'observed' || alert.disposition === 'ignored'
          ? null
          : true;
  return {
    id: alert.id,
    condition: alert.condition,
    severity: alert.severity,
    active,
    inactiveReason:
      backupEvent && alert.phase === 'triggered' && active === false
        ? backup?.state === 'disabled'
          ? 'backup_disabled'
          : backup?.alert
            ? 'backup_timeout_unconfirmed'
            : 'backup_no_alert'
        : undefined,
    observedAt: alert.observed_at,
    acknowledgedAt: alert.acknowledged_at ?? null,
    silencedUntil: activeUntil(silence),
    deliveries: alert.deliveries.map(deliveryView),
  };
}

function ruleView(rule: WebRule, silence: SilenceStatus): NotificationRule {
  return {
    id: rule.id,
    condition: rule.condition,
    severity: rule.severity,
    revision: rule.revision,
    enabled: rule.enabled,
    emailEnabled: rule.email_enabled,
    minOccurrences: rule.min_occurrences,
    cooldownSeconds: rule.cooldown_seconds ?? null,
    silencedUntil: activeUntil(silence),
  };
}

export const webAlerts = {
  list: (signal?: AbortSignal) =>
    request(async () => {
      const alerts = await allPages((cursor) =>
        listAlerts({ ...options, signal, query: { cursor, limit: 100 } }).then(
          ({ data }) => data,
        ),
      );
      const backup = await backupForAlerts(alerts, signal);
      return mapSilences(
        alerts,
        (id) => readAlertSilence(id, signal),
        (alert, silence) => alertView(alert, backup, silence),
      );
    }),
  detail: (id, signal?: AbortSignal) =>
    request(async () => {
      const { data: alert } = await getAlert({
        ...options,
        path: { id },
        signal,
      });
      const [backup, silence] = await Promise.all([
        backupForAlerts([alert], signal),
        readAlertSilence(id, signal),
      ]);
      return alertView(alert, backup, silence);
    }),
  manualSilence: manualSilence('alert'),
  acknowledge: (id) =>
    request(async () => {
      const headers = await adminMutationHeaders('notifications');
      try {
        await ackAlert({
          ...options,
          path: { id },
          headers,
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        const code = status(error);
        if (code !== 504 && code !== undefined) throw error;
        const { data } = await getAlert({ ...options, path: { id } });
        if (!data.acknowledged_at) throw error;
      }
    }),
} satisfies AlertsAdapter;

export const webNotifications = {
  read: (signal?: AbortSignal) =>
    request(async () => {
      const rules = await allPages((cursor) =>
        listRules({ ...options, signal, query: { cursor, limit: 100 } }).then(
          ({ data }) => data,
        ),
      );
      return {
        // W3 reads rules and test records. Channel settings are managed by web.
        recipientConfigured: null,
        timezone: null,
        quietStart: null,
        quietEnd: null,
        rules: await mapSilences(
          rules,
          (id) => readRuleSilence(id, signal),
          ruleView,
        ),
      };
    }),
  detail: (id, signal?: AbortSignal) =>
    request(async () => {
      const [rule, silence] = await Promise.all([
        getRule({ ...options, path: { id }, signal }),
        readRuleSilence(id, signal),
      ]);
      return ruleView(rule.data, silence);
    }),
  manualSilence: manualSilence('rule'),
  saveRule: (id, revision, settings) =>
    request(async () => {
      if (!Number.isSafeInteger(revision) || revision < 1)
        throw new OperationError('invalid');
      const headers = await adminMutationHeaders('notifications');
      const path = { id };
      const { data: current } = await getRule({ ...options, path });
      if (current.revision !== revision) throw new OperationError('conflict');
      const body = {
        condition: current.condition,
        severity: current.severity,
        reminder_seconds: current.reminder_seconds ?? null,
        enabled: settings.enabled,
        email_enabled: settings.emailEnabled,
        min_occurrences: settings.minOccurrences,
        cooldown_seconds: settings.cooldownSeconds,
      };
      try {
        await putRule({
          ...options,
          path,
          headers: { ...headers, 'If-Match': `"${revision}"` },
          body,
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        const code = status(error);
        if (code !== 504 && code !== undefined) throw error;
        const { data: confirmed } = await getRule({ ...options, path });
        if (
          confirmed.revision <= revision ||
          confirmed.condition !== body.condition ||
          confirmed.severity !== body.severity ||
          (confirmed.reminder_seconds ?? null) !== body.reminder_seconds ||
          confirmed.enabled !== body.enabled ||
          confirmed.email_enabled !== body.email_enabled ||
          confirmed.min_occurrences !== body.min_occurrences ||
          (confirmed.cooldown_seconds ?? null) !== body.cooldown_seconds
        )
          throw error;
      }
    }),
  startEmailTest: (key) =>
    request(async () => {
      const headers = await adminMutationHeaders('notifications');
      await startChannelTest({
        ...options,
        path: { id: 'email' },
        headers: { ...headers, 'Idempotency-Key': key },
        signal: AbortSignal.timeout(10_000),
      });
    }),
  readEmailTest: (key, signal) =>
    request(async () => {
      try {
        const { data } = await getChannelTest({
          ...options,
          path: { id: 'email', testId: key },
          signal,
        });
        return deliveryView(data);
      } catch (error) {
        if (
          error instanceof WebRequestError &&
          error.status === 404 &&
          error.code === 'notification_not_found'
        )
          return null;
        throw error;
      }
    }),
} satisfies NotificationsAdapter;
