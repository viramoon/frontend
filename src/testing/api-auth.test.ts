import { afterEach, expect, it, vi } from 'vitest';
import { bearerAuth, byKey, submit } from '../api';
import {
  capabilities,
  catalog,
  create,
  deleteCredential,
  deleteSession,
  getTest,
  list2,
  putCredential,
  startTest,
  update,
} from '../api/generated/sdk.gen';

const token = 'test-bearer-token';
const auth = bearerAuth(token);
const backtestHeaders = { 'Idempotency-Key': 'test-key' };
const revisionHeaders = { 'If-Match': '"1"' };
const path = { id: 'test-id' };

function mockFetch() {
  const fetch = vi.fn<(request: Request) => Promise<Response>>(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

it.each<[string, () => Promise<unknown>]>([
  ['submit', () => submit({ auth, headers: backtestHeaders })],
  ['byKey', () => byKey({ auth, headers: backtestHeaders })],
  ['capabilities', () => capabilities({ auth })],
  ['catalog', () => catalog({ auth })],
  ['list2', () => list2({ auth })],
  [
    'create',
    () =>
      create({
        auth,
        body: { connector: 'binance_spot', settings: { symbol: 'BTCUSDT' } },
      }),
  ],
  [
    'update',
    () =>
      update({
        auth,
        path,
        headers: revisionHeaders,
        body: { action: 'disable' },
      }),
  ],
  [
    'putCredential',
    () =>
      putCredential({
        auth,
        path,
        headers: revisionHeaders,
        body: { api_token: 'test-connector-token' },
      }),
  ],
  [
    'deleteCredential',
    () => deleteCredential({ auth, path, headers: revisionHeaders }),
  ],
  ['startTest', () => startTest({ auth, path, headers: revisionHeaders })],
  ['getTest', () => getTest({ auth, path })],
])('%s sends the Bearer token only in Authorization', async (_, send) => {
  const fetch = mockFetch();
  await send();
  expect(fetch).toHaveBeenCalledTimes(1);
  const [[request]] = fetch.mock.calls;
  expect(request.headers.get('Authorization')).toBe(`Bearer ${token}`);
  expect(request.headers.has('Cookie')).toBe(false);
});

it('leaves the session cookie to the browser when deleting a session', async () => {
  const fetch = mockFetch();
  await deleteSession({
    auth,
    headers: { Origin: window.location.origin, 'X-CSRF-Token': 'test-csrf' },
  });

  expect(fetch).toHaveBeenCalledTimes(1);
  const [[request]] = fetch.mock.calls;
  expect(request.headers.has('Authorization')).toBe(false);
  expect(request.headers.has('Cookie')).toBe(false);
  expect(request.credentials).toBe('same-origin');
});
