import { QueryClient } from '@tanstack/react-query';
import { client } from './generated/client.gen';

export {
  datasetsOptions,
  detailOptions,
  listOptions,
  sampleOptions,
  statusOptions,
} from './generated/@tanstack/react-query.gen';
export { byKey, submit } from './generated/sdk.gen';
export type {
  BacktestSummary,
  Dataset,
  Job,
  JobRequest,
  JobStatus,
  ResearchReport,
  SystemStatus,
} from './generated/types.gen';

export class WebRequestError extends Error {
  constructor(
    readonly status: number | undefined,
    message: string,
    readonly code?: string,
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
  const code =
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof error.error === 'object' &&
    error.error !== null &&
    'code' in error.error &&
    typeof error.error.code === 'string'
      ? error.error.code
      : undefined;
  return new WebRequestError(
    response.status,
    'HTTP ' + response.status + (code ? ' · ' + code : ''),
    code,
  );
});

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 15_000 } },
});
