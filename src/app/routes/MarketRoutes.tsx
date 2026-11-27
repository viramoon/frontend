import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { privateOptions } from '../../api/adminWeb';
import { optionsExposure, optionsFlow } from '../../api/generated/sdk.gen';
import { WebRequestError } from '../../api';
import { createWebMarketAdapter } from '../../api/marketWeb';
import { DataState } from '../../components/TerminalStates';
import { MarketTerminal } from '../../features/market/MarketTerminal';
import { OptionsTerminal } from '../../features/options/OptionsTerminal';
import { AdminProductAccess } from './AdminProductAccess';

function LiveMarket({ trading }: { trading?: boolean }) {
  const [adapter] = useState(createWebMarketAdapter);
  useSyncExternalStore(adapter.subscribe, adapter.revision);
  useEffect(() => adapter.start(), [adapter]);
  if (adapter.web?.catalog === 'loading') {
    return <DataState kind="loading" title="正在读取 web 行情目录" />;
  }
  return <MarketTerminal adapter={adapter} trading={trading} />;
}

export function MarketRoute({
  replay,
  trading,
}: {
  replay: boolean;
  trading?: boolean;
}) {
  if (replay) return <MarketTerminal trading={trading} />;
  return (
    <AdminProductAccess
      title="行情权限"
      heading="h2"
      product="restricted_market_data"
    >
      <LiveMarket trading={trading} />
    </AdminProductAccess>
  );
}

function WebOptions({ page }: { page: 'flow' | 'exposure' }) {
  const read = useQuery({
    queryKey: ['options-web', page],
    queryFn: async ({ signal }) => {
      const request = page === 'flow' ? optionsFlow : optionsExposure;
      return request({
        ...privateOptions,
        signal,
        query: { instrument_id: 'SPY.ARCA' },
      });
    },
  });
  const pending =
    read.error instanceof WebRequestError &&
    read.error.code === 'finance_contract_pending';
  return (
    <section className="simple-page">
      <h1>{page === 'flow' ? '期权流水' : '期权敞口'}</h1>
      {read.isPending ? (
        <DataState kind="loading" title="正在读取期权状态" />
      ) : pending ? (
        <DataState
          kind="empty"
          title="期权数据待接入"
          detail="finance_contract_pending"
        />
      ) : (
        <DataState kind="empty" title="期权数据暂不可用" />
      )}
    </section>
  );
}

export function OptionsMarketRoute({
  replay,
  page,
}: {
  replay: boolean;
  page: 'flow' | 'exposure';
}) {
  if (replay) return <OptionsTerminal page={page} />;
  return (
    <AdminProductAccess
      title={page === 'flow' ? '期权流水' : '期权敞口'}
      product="restricted_market_data"
    >
      <WebOptions page={page} />
    </AdminProductAccess>
  );
}
