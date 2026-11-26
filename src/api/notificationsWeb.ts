import { WebRequestError } from './index';
import {
  adminMutationHeaders,
  privateOptions as options,
  privateRequest as request,
  requestStatus as status,
} from './adminWeb';
import {
  ackAlert,
  getAlert,
  getChannelTest,
  getRule,
  listAlerts,
  listRules,
  putRule,
  startChannelTest,
} from './generated/sdk.gen';
import type {
  Alert as WebAlert,
  ChannelTestDelivery,
  Rule as WebRule,
} from './generated/types.gen';
import {
  OperationError,
  isBackupOverdue,
  backupAgeNs,
  type DriveBackup,
  type Alert,
  type AlertsAdapter,
  type Delivery,
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

function alertView(alert: WebAlert, backup: DriveBackup | null): Alert {
  const backupEvent = alert.condition === 'backup_stale';
  const active =
    alert.phase === 'recovered'
      ? false
      : backupEvent
        ? backup?.state === 'disabled'
          ? false
          : backup && backupAgeNs(backup) !== null
            ? isBackupOverdue(backup)
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
      backupEvent && backup?.state === 'disabled'
        ? 'backup_disabled'
        : undefined,
    observedAt: alert.observed_at,
    acknowledgedAt: alert.acknowledged_at ?? null,
    silencedUntil: null,
    deliveries: alert.deliveries.map(deliveryView),
  };
}

function ruleView(rule: WebRule): NotificationRule {
  return {
    id: rule.id,
    condition: rule.condition,
    severity: rule.severity,
    revision: rule.revision,
    enabled: rule.enabled,
    emailEnabled: rule.email_enabled,
    minOccurrences: rule.min_occurrences,
    cooldownSeconds: rule.cooldown_seconds ?? null,
  };
}

export const webAlerts: AlertsAdapter = {
  list: (signal) =>
    request(async () => {
      const alerts = await allPages((cursor) =>
        listAlerts({ ...options, signal, query: { cursor, limit: 100 } }).then(
          ({ data }) => data,
        ),
      );
      const backup = alerts.some(
        (alert) =>
          alert.condition === 'backup_stale' && alert.phase === 'triggered',
      )
        ? await webRecovery.backup(signal).catch(() => null)
        : null;
      return alerts.map((alert) => alertView(alert, backup));
    }),
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
};

export const webNotifications: NotificationsAdapter = {
  read: (signal) =>
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
        rules: rules.map(ruleView),
      };
    }),
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
};
