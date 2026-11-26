import { bearerAuth, WebRequestError } from './index';
import {
  ackAlert,
  capabilities,
  createSession,
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
  type Alert,
  type AlertsAdapter,
  type Delivery,
  type NotificationRule,
  type NotificationsAdapter,
} from './operations';

const options = {
  throwOnError: true,
  cache: 'no-store',
  credentials: 'same-origin',
} as const;

function status(error: unknown) {
  return error instanceof WebRequestError ? error.status : undefined;
}

async function request<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OperationError) throw error;
    switch (status(error)) {
      case 401:
      case 403:
        throw new OperationError('forbidden');
      case 409:
      case 428:
        throw new OperationError('conflict');
      case 422:
        throw new OperationError('invalid');
      default:
        throw new OperationError('unavailable');
    }
  }
}

const readCapabilities = (signal?: AbortSignal) =>
  capabilities({ ...options, signal }).then(({ data }) => data);

export async function hasNotificationAccess(signal?: AbortSignal) {
  return request(async () => {
    const data = await readCapabilities(signal);
    return data.subject === 'admin' && data.products.includes('notifications');
  });
}

export async function openNotificationSession(token: string) {
  await request(() =>
    createSession({
      ...options,
      auth: bearerAuth(token),
      headers: { Origin: window.location.origin },
      signal: AbortSignal.timeout(10_000),
    }),
  );
}

async function mutationHeaders() {
  const data = await readCapabilities(AbortSignal.timeout(10_000));
  if (
    data.subject !== 'admin' ||
    !data.products.includes('notifications') ||
    !data.csrf_token
  ) {
    throw new OperationError('forbidden');
  }
  return { Origin: window.location.origin, 'X-CSRF-Token': data.csrf_token };
}

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

function alertView(alert: WebAlert): Alert {
  // A recorded backup signal is historical evidence while W4 has no live watermark.
  const active =
    alert.phase === 'recovered'
      ? false
      : alert.condition === 'backup_stale' ||
          alert.disposition === 'observed' ||
          alert.disposition === 'ignored'
        ? null
        : true;
  return {
    id: alert.id,
    condition: alert.condition,
    severity: alert.severity,
    active,
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
      return alerts.map(alertView);
    }),
  acknowledge: (id) =>
    request(async () => {
      const headers = await mutationHeaders();
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
      const headers = await mutationHeaders();
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
      const headers = await mutationHeaders();
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
