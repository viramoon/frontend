import { useEffect, useState, useSyncExternalStore } from 'react';
import { createWebMarketAdapter } from '../../api/marketWeb';
import { DataState } from '../../components/TerminalStates';
import { MarketTerminal } from '../../features/market/MarketTerminal';
import { WebOptions } from '../../features/options/WebOptions';
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
