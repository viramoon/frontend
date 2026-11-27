import { privateOptions } from './adminWeb';
import { byKey, detail, list, submit } from './generated/sdk.gen';
import type { Job, SubmitRequest } from './generated/types.gen';

export type WebJob = Omit<Job, 'id'> & { id: string };
type WebPage = { items: WebJob[]; next_cursor?: string | null };

export function isJobId(id: string) {
  return /^[1-9][0-9]{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;
}

function parseJobResponse<T>(body: unknown): T {
  if (typeof body !== 'string') throw new Error('Expected web job JSON');
  return JSON.parse(
    body,
    function (
      this: Record<string, unknown>,
      key,
      value,
      context?: { source: string },
    ) {
      const jobId =
        key === 'id' && ('request' in this || Object.keys(this).length === 1);
      const cursor = key === 'next_cursor' && 'items' in this;
      if ((!jobId && !cursor) || typeof value !== 'number') return value;
      const text =
        context?.source ?? (Number.isSafeInteger(value) ? String(value) : '');
      if (!isJobId(text)) throw new Error('Invalid web job ID or cursor');
      return text;
    },
  );
}

const http = { ...privateOptions, parseAs: 'text' } as const;
type Auth = Parameters<typeof submit>[0]['auth'];

export async function readBacktestPage(
  cursor?: string,
  signal?: AbortSignal,
  administrator = false,
) {
  const { data } = await list({
    ...http,
    credentials: administrator ? 'same-origin' : 'omit',
    signal,
    query: { limit: 20 },
    // The OpenAPI int64 is a JS number in the SDK. Forward the wire value verbatim.
    querySerializer: ({ limit }) =>
      new URLSearchParams({
        limit: String(limit),
        ...(cursor ? { cursor } : {}),
      }).toString(),
  });
  return parseJobResponse<WebPage>(data);
}

export async function readBacktestJob(
  id: string,
  signal?: AbortSignal,
  administrator = false,
) {
  if (!isJobId(id)) throw new Error('Invalid web job ID');
  const { data } = await detail({
    ...http,
    credentials: administrator ? 'same-origin' : 'omit',
    signal,
    // Path parameters are serialized as text by the generated client.
    path: { id: id as unknown as number },
  });
  return parseJobResponse<WebJob>(data);
}

export async function submitBacktest(
  body: SubmitRequest,
  key: string,
  headers?: { Origin: string; 'X-CSRF-Token': string },
  auth?: Auth,
) {
  const { data } = await submit({
    ...http,
    body,
    auth,
    headers: { ...headers, 'Idempotency-Key': key },
    signal: AbortSignal.timeout(10_000),
  });
  return parseJobResponse<{ id: string }>(data);
}

export async function lookupBacktest(key: string, auth?: Auth) {
  const { data } = await byKey({
    ...http,
    auth,
    headers: { 'Idempotency-Key': key },
    signal: AbortSignal.timeout(10_000),
  });
  return parseJobResponse<{ id: string }>(data);
}
