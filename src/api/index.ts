import { QueryClient } from '@tanstack/react-query';
import { client } from './generated/client.gen';

export {
  sampleOptions,
  statusOptions,
} from './generated/@tanstack/react-query.gen';
export type { BacktestSummary, SystemStatus } from './generated/types.gen';

export class WebRequestError extends Error {
  constructor(
    readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'WebRequestError';
  }
}

// The SDK and all generated query options share this client. The Vite proxy
// and production web server both expose the API on the page's own origin.
client.setConfig({ baseUrl: window.location.origin });
client.interceptors.error.use((error, response) => {
  if (!response) {
    if (error instanceof DOMException && error.name === 'AbortError')
      return error;
    return new WebRequestError(undefined, '网络连接失败');
  }
  const suffix =
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof error.error === 'object' &&
    error.error !== null &&
    'code' in error.error &&
    typeof error.error.code === 'string'
      ? ' · ' + error.error.code
      : '';
  return new WebRequestError(
    response.status,
    'HTTP ' + response.status + suffix,
  );
});

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 15_000 } },
});
