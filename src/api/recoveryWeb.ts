import { privateOptions, privateRequest } from './adminWeb';
import { backupStatus, qualityGaps } from './generated/sdk.gen';
import type { QualityGapsPage } from './generated/types.gen';
import { backupMaxAgeSeconds, type DriveBackup } from './operations';

export type RecoveryAdapter = {
  backup(signal?: AbortSignal): Promise<DriveBackup>;
  gaps(offset: number, signal?: AbortSignal): Promise<QualityGapsPage>;
};

export const webRecovery: RecoveryAdapter = {
  backup: (signal) =>
    privateRequest(async () => {
      const { data } = await backupStatus({ ...privateOptions, signal });
      if (data.state === 'disabled') return { state: 'disabled' };
      if (data.state === 'unavailable') {
        return { state: 'unavailable', alert: data.alert };
      }
      const ageSeconds =
        data.age_seconds != null && data.age_seconds >= 0
          ? data.age_seconds
          : null;
      // web evaluates the precise duration before truncating age_seconds.
      // At 3600 whole seconds, alert identifies a fractional overrun unless
      // producer degradation could itself have caused the alert.
      const overdue =
        data.alert &&
        ageSeconds !== null &&
        (ageSeconds > backupMaxAgeSeconds ||
          (ageSeconds === backupMaxAgeSeconds && !data.degraded));
      return {
        state: data.degraded ? 'degraded' : 'verified',
        ageSeconds,
        alert: data.alert,
        overdue,
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
