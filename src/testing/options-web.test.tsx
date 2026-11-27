import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  DepthBook,
  ExposureView,
  OptionChainPage,
  OptionExposureResponse,
  OptionFlowObservationPage,
  OptionFlowVerificationPage,
} from '../api/generated/types.gen';
import { AppRoutes } from '../app/routes/AppRoutes';

const api = '/api/v1';
const time = '2026-11-19T13:30:00.000Z';
const end = '2026-11-19T14:00:00.000Z';
const exact = '123.0123456789123456789';
const interest = '9007199254740993.1234';
const access = {
  source: 'ibkr',
  product: 'opra',
  license: 'synthetic',
  display_live: true,
  record_local: false,
  derive_non_display: true,
  backup_personal_drive: false,
};
const row = {
  con_id: 9001,
  symbol: 'SYN',
  expiry: '2026-11-19',
  multiplier: '100',
  primary_exchange: 'SYNTHETIC',
  right: 'call',
  strike: exact,
} satisfies OptionChainPage['items'][number];
const book = {
  access: { ...access, product: 'nasdaq-totalview' },
  symbol: 'AAPL',
  venue: 'XNAS',
  state: 'receiving',
  received_at: time,
  market_data_type: null,
  permissions: {
    equity_l1_confirmed: true,
    totalview_confirmed: true,
    eds_confirmed: true,
  },
  requested_rows: 2,
  returned_rows: 1,
  bids: [{ price: '12.000000000001', size: '0.000000000123' }],
  asks: [],
} satisfies DepthBook;
const coverage = {
  candidate_contracts: 2,
  valid_contracts: 1,
  partial: true,
  universe_complete: false,
  eligible_open_interest: interest,
  total_open_interest: null,
  observed: { earliest: time, latest: end },
  open_interest_dates: ['2026-11-18'],
  unconfirmed_open_interest_dates: 1,
  exclusions: {
    missing_gamma: 1,
    missing_open_interest: 0,
    spot_gamma_skew: 0,
    stale_gamma: 0,
    stale_spot: 0,
  },
};
const exposure = {
  coverage,
  totals: { absolute: exact, gex: null },
  by_strike: [
    { strike: '130.25000000001', totals: { absolute: exact, gex: null } },
  ],
  by_expiry: [{ expiry: '2026-11-19', totals: { absolute: exact, gex: null } }],
  walls: { largest_absolute: { exposure: exact, strike: '130.25000000001' } },
  flip: { status: 'unavailable', reason: 'not_directional_scenario' },
} satisfies ExposureView;

const clients: QueryClient[] = [];
function mount(path: string, handle: (url: URL) => Response, admin = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  const unexpected: string[] = [];
  const fetch = vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    expect(url.origin).toBe(location.origin);
    expect(request.method).toBe('GET');
    expect(request.credentials).toBe('same-origin');
    expect(request.cache).toBe('no-store');
    if (url.pathname === api + '/me/capabilities')
      return Response.json(
        admin
          ? { subject: 'admin', products: ['restricted_market_data'] }
          : { subject: 'anonymous', products: ['system'] },
      );
    try {
      return handle(url);
    } catch (error) {
      unexpected.push(url.pathname);
      throw error;
    }
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { fetch, unexpected };
}

const failure = (status: number, code: string) =>
  Response.json({ error: { code, message: code } }, { status });

function typeInput(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

it('loads W8 paged chains, exact venue depth, and backend GEX scenarios with 0DTE, walls and OI coverage', async () => {
  const user = userEvent.setup();
  const { unexpected } = mount('/options/exposure', (url) => {
    switch (url.pathname) {
      case api + '/options/chain': {
        expect(url.searchParams.get('underlying_con_id')).toBe('9000');
        const next = url.searchParams.get('after_con_id');
        const page: OptionChainPage = {
          access,
          as_of: time,
          discovery_complete: Boolean(next),
          underlying_con_id: 9000,
          items: next
            ? [
                {
                  ...row,
                  con_id: 9002,
                  right: 'put',
                  strike: '122.00000000001',
                },
              ]
            : [row],
          next_after_con_id: next ? null : 9001,
        };
        if (next) expect(next).toBe('9001');
        return Response.json(page);
      }
      case api + '/market/depth':
        expect(url.searchParams.get('symbol')).toBe('AAPL');
        return Response.json(book);
      case api + '/options/exposure': {
        expect(url.searchParams.get('underlying_id')).toBe('SPY.ARCA');
        const scenario = url.searchParams.get('scenario');
        expect(['absolute', 'dealer_short']).toContain(scenario);
        const data: OptionExposureResponse = {
          access,
          report: {
            as_of: time,
            underlying_id: 'SPY.ARCA',
            model_version: 'synthetic-gex-v1',
            session_date: '2026-11-19',
            spot: { observed_at: time, value: '123.55' },
            scenario: scenario === 'dealer_short' ? scenario : 'absolute',
            all:
              scenario === 'dealer_short'
                ? {
                    ...exposure,
                    flip: { status: 'no_flip' },
                    totals: { absolute: exact, gex: '-0.00000000001' },
                  }
                : exposure,
            zero_dte: {
              ...exposure,
              totals: { absolute: '0', gex: '0' },
              flip: {
                status: 'crossings',
                crossings: [{ lower_spot: '120.01', upper_spot: '120.02' }],
              },
            },
            later: exposure,
            timing: {
              max_gamma_age_seconds: 20,
              max_spot_age_seconds: 20,
              max_spot_gamma_skew_seconds: 15,
            },
          },
        };
        return Response.json(data);
      }
      default:
        throw new Error('Unexpected options request');
    }
  });
  expect(await screen.findByText(/OI 基准日 2026-11-18/)).toHaveTextContent(
    `${interest} / 未知`,
  );
  expect(screen.getByText(/Gamma flip · 未评估/)).toBeVisible();
  const strike = screen.getByRole('region', { name: '按行权价敞口' });
  expect(within(strike).getByText('130.25000000001')).toBeVisible();
  expect(strike).toHaveAttribute('tabindex', '0');
  await user.selectOptions(screen.getByLabelText('敞口假设'), 'dealer_short');
  expect(await screen.findByText(/网格内无过零点/)).toBeVisible();
  expect(screen.getByText(/净 GEX -0.00000000001/)).toBeVisible();
  await user.selectOptions(screen.getByLabelText('到期范围'), 'zero_dte');
  expect(screen.getByText(/120.01–120.02/)).toBeVisible();

  typeInput('标的 IBKR ConId', '9000');
  await user.click(screen.getByRole('button', { name: '读取期权链' }));
  const chain = await screen.findByRole('region', { name: '期权合约表' });
  expect(within(chain).getByText(exact)).toBeVisible();
  await user.click(screen.getByRole('button', { name: '下一页合约' }));
  const next = await screen.findByRole('region', { name: '期权合约表' });
  expect(within(next).getByText('122.00000000001')).toBeVisible();

  await user.selectOptions(screen.getByLabelText('Nasdaq 深度标的'), 'AAPL');
  const levels = await screen.findByRole('region', { name: '场所深度档位' });
  expect(within(levels).getByText('12.000000000001')).toBeVisible();
  expect(within(levels).getByText('0.000000000123')).toBeVisible();
  expect(screen.getByText(/订单簿细节/).closest('p')).toHaveTextContent(
    '采集起点未知',
  );
  expect(unexpected).toEqual([]);
});

it('reads W9 observation evidence and independently shows verification errors and retry', async () => {
  let verificationCalls = 0;
  const { unexpected } = mount('/options/flow', (url) => {
    expect(url.searchParams.get('con_id')).toBe('9001');
    expect(url.searchParams.get('start')).toBe(time);
    expect(url.searchParams.get('end')).toBe(end);
    if (url.pathname === api + '/options/flow/observations') {
      const observation: OptionFlowObservationPage = {
        access,
        as_of: end,
        con_id: 9001,
        start: time,
        end,
        next_offset: null,
        items: [
          {
            budget: {
              account_lines: 100,
              as_of: end,
              confirmed_options: 1,
              discovery_complete: false,
              hot_lines: 16,
              observed_options: 1,
              phase: 'online',
              reserve_lines: 30,
              rotation_lines: 45,
              stock_lines: 9,
            },
            coverage: null,
            clue: {
              cohort: {
                expiry: row.expiry,
                session_segment: 1,
                underlying_con_id: 9000,
              },
              con_id: 9001,
              generation: '11',
              multiplier: '100',
              observed_at: time,
              rule_version: 'synthetic-observation-v1',
              status: 'pending_verification',
              observation: {
                kind: 'volume_increase',
                evidence: {
                  comparison: { baseline_samples: 2, elapsed_millis: 50 },
                  delta_contracts: '12',
                  estimated_premium: exact,
                  earlier_cumulative_volume: { received_at: time, value: '88' },
                  later_cumulative_volume: { received_at: end, value: '100' },
                },
              },
            },
          },
        ],
      };
      return Response.json(observation);
    }
    if (url.pathname === api + '/options/flow/verification') {
      if (++verificationCalls === 1) return failure(502, 'finance_upstream');
      const verified: OptionFlowVerificationPage = {
        access: { ...access, product: 'opra-history' },
        con_id: 9001,
        start: time,
        end,
        counts: {
          non_trade_markers: 0,
          pending_intervals: 0,
          pending_trade_rows: 0,
          unavailable_intervals: 1,
          unknown: 1,
          unresolved_amendments: 0,
          verified: 1,
        },
        durable_through: null,
        issues: [],
        max_quote_age_ms: 500,
        multiplier: '100',
        next_offset: null,
        observation_coverage: null,
        quote_start: time,
        verified_at: end,
        trades: [
          {
            trade: {
              batch: {
                kind: 'trades',
                obtained_at: end,
                page: 1,
                requested_start: time,
              },
              occurrence: 1,
              row: {
                exchange: 'SYNTHETIC',
                occurred_at: time,
                past_limit: false,
                price: exact,
                quantity: '2',
                special_conditions: 'SYN',
                unreported: false,
              },
            },
            condition: {
              mapping_version: 'synthetic-condition-v1',
              meaning: { status: 'unrecognized' },
            },
            identity: 'unknown',
            inference: {
              confidence: 'unknown',
              direction: 'unknown',
              reason: 'missing_quote',
              rule_version: 'synthetic-direction-v1',
            },
            status: 'active',
            suspected_scale: {},
          },
        ],
      };
      return Response.json(verified);
    }
    throw new Error('Unexpected options flow request');
  });
  const user = userEvent.setup();
  await screen.findByLabelText('流水合约 IBKR ConId');
  typeInput('流水合约 IBKR ConId', '9001');
  typeInput('开始时间（UTC）', '2026-11-19T13:30');
  typeInput('结束时间（UTC，不含）', '2026-11-19T14:00');
  await user.click(screen.getByRole('button', { name: '读取流水' }));
  const observation = await screen.findByText(/累计放量.*待历史核验/);
  await user.click(observation);
  expect(screen.getByText(new RegExp(`估计权利金额 ${exact}`))).toBeVisible();
  await user.selectOptions(screen.getByLabelText('流水类型'), 'verified');
  expect(await screen.findByText('HTTP 502 · finance_upstream')).toBeVisible();
  expect(screen.queryByText(/累计放量.*待历史核验/)).toBeNull();
  await user.click(screen.getByRole('button', { name: '重新读取核验流水' }));
  expect(
    await screen.findByText(/已核验 1 · 方向未知 1 · 不可用区间 1/),
  ).toBeVisible();
  await user.click(screen.getByText(/核验成交 ·/));
  expect(
    screen.getByText(/原始条件 SYN · 映射 synthetic-condition-v1/),
  ).toBeVisible();
  expect(unexpected).toEqual([]);
});

it('denies private W8 reads to an anonymous browser', async () => {
  const { fetch } = mount(
    '/options/exposure',
    () => {
      throw new Error('Unexpected private read');
    },
    false,
  );
  expect(await screen.findByText('此页面需要 web 管理员会话。')).toBeVisible();
  expect(
    fetch.mock.calls.map(([request]) => new URL(request.url).pathname),
  ).toEqual([api + '/me/capabilities']);
});
