import {
  adminMutationHeaders,
  privateOptions,
  privateRequest,
  requestStatus,
} from './adminWeb';
import {
  activate,
  catalog,
  create,
  deleteCredential,
  getIntegration,
  getScopedTest,
  list2,
  putCredential,
  rollback,
  startTest,
  update,
} from './generated/sdk.gen';
import type {
  CatalogEntry,
  Connector,
  Integration,
  Settings,
  TestView,
  VersionView,
} from './generated/types.gen';
import { OperationError } from './operations';

type ManagedVersion = {
  version: VersionView['version'];
  state: VersionView['state'];
  settings: Settings;
  credential: { version: number; rotatedAt: string } | null;
};

export type ManagedIntegration = {
  id: string;
  connector: string;
  revision: number;
  latest: ManagedVersion;
  active: ManagedVersion | null;
  rollbackVersions: readonly number[];
  lastTestId: string | null;
};

export type ManagedChange =
  | { kind: 'configure'; settings: Settings }
  | { kind: 'replaceCredential'; secret: string }
  | { kind: 'clearCredential' }
  | { kind: 'test' }
  | { kind: 'activate'; testId: string }
  | { kind: 'rollback'; version: number }
  | { kind: 'disable' };

export type WebIntegrationsAdapter = {
  list(signal?: AbortSignal): Promise<{
    catalog: readonly CatalogEntry[];
    items: readonly ManagedIntegration[];
  }>;
  create(connector: Connector, settings: Settings): Promise<void>;
  test(id: string, testId: string, signal?: AbortSignal): Promise<TestView>;
  change(integration: ManagedIntegration, change: ManagedChange): Promise<void>;
};

function versionView(version: VersionView): ManagedVersion {
  return {
    version: version.version,
    state: version.state,
    settings: {
      symbol: version.settings.symbol,
      profile: version.settings.profile,
    },
    credential: version.credential
      ? {
          version: version.credential.version,
          rotatedAt: version.credential.rotated_at,
        }
      : null,
  };
}

function view(integration: Integration): ManagedIntegration {
  return {
    id: integration.id,
    connector: integration.connector,
    revision: integration.revision,
    latest: versionView(integration.latest),
    active: integration.active ? versionView(integration.active) : null,
    rollbackVersions: integration.rollback_versions,
    lastTestId: integration.last_test_id ?? null,
  };
}

async function changeIntegration(
  integration: ManagedIntegration,
  change: ManagedChange,
) {
  if (!Number.isSafeInteger(integration.revision) || integration.revision < 1) {
    throw new OperationError('invalid');
  }
  const path = { id: integration.id };
  const headers = {
    ...(await adminMutationHeaders('integrations')),
    'If-Match': `"${integration.revision}"`,
  };
  const options = {
    ...privateOptions,
    path,
    headers,
    signal: AbortSignal.timeout(10_000),
  };
  try {
    switch (change.kind) {
      case 'configure':
        await update({
          ...options,
          body: { action: 'configure', settings: change.settings },
        });
        break;
      case 'disable':
        await update({ ...options, body: { action: 'disable' } });
        break;
      case 'replaceCredential':
        await putCredential({ ...options, body: { api_token: change.secret } });
        break;
      case 'clearCredential':
        await deleteCredential(options);
        break;
      case 'test':
        await startTest(options);
        break;
      case 'activate':
        await activate({ ...options, body: { test_id: change.testId } });
        break;
      case 'rollback':
        await rollback({ ...options, body: { version: change.version } });
        break;
    }
  } catch (error) {
    const status = requestStatus(error);
    if (status !== 504 && status !== undefined) throw error;
    // Inspect the stored revision before any further operator action. Do not replay writes.
    const { data } = await getIntegration({
      ...privateOptions,
      path,
      signal: AbortSignal.timeout(10_000),
    });
    if (
      change.kind === 'test' &&
      data.revision > integration.revision &&
      data.last_test_id &&
      data.last_test_id !== integration.lastTestId
    ) {
      const { data: test } = await getScopedTest({
        ...privateOptions,
        path: { id: integration.id, testId: data.last_test_id },
        signal: AbortSignal.timeout(10_000),
      });
      if (test.config_version === integration.latest.version) return;
    }
    if (
      change.kind === 'activate' &&
      data.revision > integration.revision &&
      data.active?.version === integration.latest.version
    )
      return;
    throw new OperationError('uncertain');
  }
}

export const webIntegrations: WebIntegrationsAdapter = {
  list: (signal) =>
    privateRequest(async () => {
      const [catalogResult, integrations] = await Promise.all([
        catalog({ ...privateOptions, signal }),
        list2({ ...privateOptions, signal }),
      ]);
      return {
        catalog: catalogResult.data,
        items: integrations.data.map(view),
      };
    }),
  create: (connector, settings) =>
    privateRequest(async () => {
      const headers = await adminMutationHeaders('integrations');
      try {
        await create({
          ...privateOptions,
          body: { connector, settings },
          headers,
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        if (
          requestStatus(error) === 504 ||
          requestStatus(error) === undefined
        ) {
          throw new OperationError('uncertain');
        }
        throw error;
      }
    }),
  test: (id, testId, signal) =>
    privateRequest(async () => {
      const { data } = await getScopedTest({
        ...privateOptions,
        path: { id, testId },
        signal,
      });
      if (data.id !== testId || data.integration_id !== id) {
        throw new OperationError('invalid');
      }
      return data;
    }),
  change: (integration, change) =>
    privateRequest(() => changeIntegration(integration, change)),
};
