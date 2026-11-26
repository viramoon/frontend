import { bearerAuth, WebRequestError } from './index';
import { capabilities, createSession } from './generated/sdk.gen';
import type { Product } from './generated/types.gen';
import { OperationError } from './operations';

export const privateOptions = {
  throwOnError: true,
  cache: 'no-store',
  credentials: 'same-origin',
} as const;

export function requestStatus(error: unknown) {
  return error instanceof WebRequestError ? error.status : undefined;
}

export async function privateRequest<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OperationError) throw error;
    switch (requestStatus(error)) {
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
  capabilities({ ...privateOptions, signal }).then(({ data }) => data);

export async function hasAdminProduct(product: Product, signal?: AbortSignal) {
  return privateRequest(async () => {
    const data = await readCapabilities(signal);
    return data.subject === 'admin' && data.products.includes(product);
  });
}

export async function openAdminSession(token: string) {
  await privateRequest(() =>
    createSession({
      ...privateOptions,
      auth: bearerAuth(token),
      headers: { Origin: window.location.origin },
      signal: AbortSignal.timeout(10_000),
    }),
  );
}

export async function adminMutationHeaders(product: Product) {
  const data = await readCapabilities(AbortSignal.timeout(10_000));
  if (
    data.subject !== 'admin' ||
    !data.products.includes(product) ||
    !data.csrf_token
  ) {
    throw new OperationError('forbidden');
  }
  return { Origin: window.location.origin, 'X-CSRF-Token': data.csrf_token };
}
