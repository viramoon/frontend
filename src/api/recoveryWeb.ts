import { privateOptions, privateRequest } from './adminWeb';
import { backupStatus, qualityGaps } from './generated/sdk.gen';
import type { QualityGapsPage } from './generated/types.gen';
import type { DriveBackup } from './operations';

export type RecoveryAdapter = {
  backup(signal?: AbortSignal): Promise<DriveBackup>;
  gaps(offset: number, signal?: AbortSignal): Promise<QualityGapsPage>;
};

export const webRecovery: RecoveryAdapter = {
  backup: (signal) =>
    privateRequest(async () => {
      const { data } = await backupStatus({ ...privateOptions, signal });
      if (data.state === 'disabled') return { state: 'disabled' };
      if (data.state === 'unavailable') return { state: 'unavailable' };
      return {
        state:
          data.degraded || data.state === 'degraded' ? 'degraded' : 'verified',
        observedAt: data.observed_at ?? null,
        lastRecoverableAt: data.last_recoverable_at ?? null,
        lastFullAt: data.last_full_at ?? null,
        lastHourlyAt: data.last_hourly_at ?? null,
        lastDrill: data.last_isolated_restore
          ? {
              finishedAt: data.last_isolated_restore.restored_at,
              recoverableAt: data.last_isolated_restore.recoverable_at,
              passed: true,
            }
          : null,
      };
    }),
  gaps: (offset, signal) =>
    privateRequest(async () => {
      const { data } = await qualityGaps({
        ...privateOptions,
        signal,
        query: { offset, limit: 20 },
      });
      return data;
    }),
};
