import { QueryClientContext } from '@tanstack/react-query';
import { useContext, useState } from 'react';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import type { OperationsAdapter } from '../../api/operations';
import { webAlerts, webNotifications } from '../../api/notificationsWeb';
import { webIntegrations } from '../../api/integrationsWeb';
import { webRecovery } from '../../api/recoveryWeb';
import { Backtests } from '../../features/backtest/Backtests';
import { Blog } from '../../features/blog/Blog';
import {
  SystemOverview,
  SystemStatusStrip,
} from '../../features/dashboard/Dashboard';
import { Integrations } from '../../features/integrations/Integrations';
import { WebIntegrations } from '../../features/integrations/WebIntegrations';
import { Alerts } from '../../features/notifications/Alerts';
import { Notifications } from '../../features/notifications/Notifications';
import {
  SystemDetails,
  WebSystemDetails,
} from '../../features/system/SystemDetails';
import { WebRecovery } from '../../features/system/WebRecovery';
import { AdminProductAccess } from './AdminProductAccess';
import { MarketRoute, OptionsMarketRoute } from './MarketRoutes';
import type { ResearchAdapter } from '../../features/research/adapter';
import { FactorCatalog } from '../../features/research/FactorCatalog';
import { fixtureResearch } from '../../features/research/fixtureAdapter';
import { RunWorkbench } from '../../features/research/RunWorkbench';
import { StrategyWorkbench } from '../../features/research/StrategyWorkbench';
import '../../features/research/research.css';
import {
  useRunSubmission,
  type RunSubmission,
} from '../../features/research/useRunSubmission';
import { Trading } from '../../features/trading/Trading';

const navigation = [
  { path: '/dashboard', label: '仪表盘' },
  { path: '/trading', label: '交易' },
  { path: '/options/flow', label: '期权流水' },
  { path: '/options/exposure', label: '期权敞口' },
  { path: '/strategies', label: '策略' },
  { path: '/factors', label: '因子' },
  { path: '/backtests', label: '回测' },
  { path: '/settings/integrations', label: '接口设置' },
  { path: '/alerts', label: '事件' },
  { path: '/settings/notifications', label: '通知设置' },
  { path: '/system', label: '系统' },
  { path: '/blog', label: '博客' },
];

type ResearchProps = { adapter: ResearchAdapter; submission: RunSubmission };

function StrategyDetail({ adapter, submission }: ResearchProps) {
  const { id } = useParams();
  return (
    <StrategyWorkbench
      key={id}
      adapter={adapter}
      routeId={id}
      submission={submission}
    />
  );
}

function BacktestRoute({ adapter, submission }: ResearchProps) {
  const [search] = useSearchParams();
  const configured =
    !search.has('job') &&
    (search.has('run') || search.get('view') === 'strategy');
  return (
    <>
      <nav className="research-nav" aria-label="回测模式">
        <Link to="/backtests" aria-current={configured ? undefined : 'page'}>
          历史均线回测
        </Link>
        <Link
          to="/backtests?view=strategy"
          aria-current={configured ? 'page' : undefined}
        >
          配置策略回测
        </Link>
      </nav>
      {configured ? (
        <RunWorkbench adapter={adapter} submission={submission} />
      ) : (
        <Backtests />
      )}
    </>
  );
}

export function AppRoutes({
  research = fixtureResearch,
  operations,
  marketReplay = false,
}: {
  research?: ResearchAdapter;
  operations?: OperationsAdapter;
  marketReplay?: boolean;
} = {}) {
  const { pathname, search } = useLocation();
  const replayInUrl = new URLSearchParams(search).get('market') === 'replay';
  const replay = marketReplay || replayInUrl;
  const navigate = useNavigate();
  const queryClient = useContext(QueryClientContext);
  const submission = useRunSubmission(research, (run) => {
    void queryClient?.invalidateQueries({
      queryKey: ['research', research.source, 'runs'],
    });
    void navigate(`/backtests?run=${encodeURIComponent(run)}`);
  });
  const [emailTestKey, setEmailTestKey] = useState<string | null>(null);

  const resetTest = () => setEmailTestKey(null);
  const alerts = (
    <Alerts
      adapter={operations?.alerts ?? webAlerts}
      fixture={Boolean(operations)}
    />
  );
  const notifications = (
    <Notifications
      adapter={operations?.notifications ?? webNotifications}
      fixture={Boolean(operations)}
      testKey={emailTestKey}
      setTestKey={setEmailTestKey}
    />
  );
  const showStatus = /^\/(?:dashboard|system)\/?$/i.test(pathname);
  return (
    <>
      <a className="skip-link" href="#workspace">
        跳至主要内容
      </a>
      <header className="masthead">
        <div className="masthead-inner">
          <Link
            to="/dashboard"
            className="brand"
            aria-label="Fertile 工作台首页"
          >
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span lang="en">Fertile</span>
          </Link>
          <nav aria-label="主导航" className="navigation">
            {navigation.map(({ path, label }) => (
              <NavLink
                key={path}
                to={
                  replayInUrl &&
                  /^(?:\/dashboard$|\/trading$|\/options\/)/.test(path)
                    ? path + '?market=replay'
                    : path
                }
                className={({ isActive }) =>
                  isActive ? 'nav-link current' : 'nav-link'
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        {showStatus && <SystemStatusStrip />}
      </header>
      <main id="workspace" className="workspace" tabIndex={-1}>
        <Routes>
          <Route
            path="/"
            element={
              <Navigate
                to={replayInUrl ? '/dashboard?market=replay' : '/dashboard'}
                replace
              />
            }
          />
          <Route
            path="/dashboard"
            element={
              <>
                <h1 className="terminal-title">仪表盘</h1>
                <MarketRoute replay={replay} />
                <SystemOverview />
              </>
            }
          />
          <Route
            path="/trading"
            element={
              <Trading>
                <MarketRoute replay={replay} trading />
              </Trading>
            }
          />
          <Route
            path="/options/flow"
            element={<OptionsMarketRoute replay={replay} page="flow" />}
          />
          <Route
            path="/options/exposure"
            element={<OptionsMarketRoute replay={replay} page="exposure" />}
          />
          <Route
            path="/strategies"
            element={
              <StrategyWorkbench adapter={research} submission={submission} />
            }
          />
          <Route
            path="/strategies/:id"
            element={
              <StrategyDetail adapter={research} submission={submission} />
            }
          />
          <Route
            path="/factors"
            element={<FactorCatalog adapter={research} />}
          />
          <Route
            path="/backtests"
            element={
              <BacktestRoute adapter={research} submission={submission} />
            }
          />
          <Route
            path="/settings/integrations"
            element={
              operations ? (
                <Integrations adapter={operations.integrations} fixture />
              ) : (
                <AdminProductAccess
                  title="接口设置"
                  product="integrations"
                  resetTest={resetTest}
                >
                  <WebIntegrations adapter={webIntegrations} />
                </AdminProductAccess>
              )
            }
          />
          <Route
            path="/alerts"
            element={
              operations ? (
                alerts
              ) : (
                <AdminProductAccess
                  title="事件"
                  product="notifications"
                  resetTest={resetTest}
                >
                  {alerts}
                </AdminProductAccess>
              )
            }
          />
          <Route
            path="/settings/notifications"
            element={
              operations ? (
                notifications
              ) : (
                <AdminProductAccess
                  title="通知设置"
                  product="notifications"
                  resetTest={resetTest}
                >
                  {notifications}
                </AdminProductAccess>
              )
            }
          />
          <Route
            path="/system"
            element={
              <>
                <SystemOverview standalone />
                {operations ? (
                  <SystemDetails read={operations.readSystem} fixture />
                ) : (
                  <>
                    <WebSystemDetails />
                    <AdminProductAccess
                      title="备份与采集质量"
                      product="integrations"
                      heading="h2"
                      resetTest={resetTest}
                    >
                      <WebRecovery adapter={webRecovery} />
                    </AdminProductAccess>
                  </>
                )}
              </>
            }
          />
          <Route path="/blog" element={<Blog />} />
          <Route
            path="*"
            element={
              <>
                <h1>页面不存在</h1>
                <Link to="/dashboard">返回仪表盘</Link>
              </>
            }
          />
        </Routes>
      </main>
    </>
  );
}
