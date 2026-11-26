import { useState } from 'react';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom';
import { createOperationsFixture } from '../../api/operationsFixture';
import { DataState } from '../../components/TerminalStates';
import { Backtests } from '../../features/backtest/Backtests';
import { Blog } from '../../features/blog/Blog';
import {
  SystemOverview,
  SystemStatusStrip,
} from '../../features/dashboard/Dashboard';
import { Integrations } from '../../features/integrations/Integrations';
import { Alerts } from '../../features/notifications/Alerts';
import { Notifications } from '../../features/notifications/Notifications';
import { SystemDetails } from '../../features/system/SystemDetails';
import { MarketTerminal } from '../../features/market/MarketTerminal';
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

const futurePages = [
  {
    path: '/options/flow',
    title: '期权流水',
    detail: '后续 U2 将接入期权成交流水、筛选条件和数据来源。',
  },
  {
    path: '/options/exposure',
    title: '期权敞口',
    detail: '后续 U2 将按行权价与到期日展示敞口、模型和数据覆盖。',
  },
  {
    path: '/factors',
    title: '因子',
    detail: '后续 U3 将展示可引用因子版本、覆盖率、IC 和换手。',
  },
];

function FuturePage({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="simple-page">
      <h1>{title}</h1>
      <DataState kind="empty" title="功能待接入" detail={detail} illustrated />
    </section>
  );
}

function Strategies() {
  return (
    <>
      <FuturePage
        title="策略"
        detail="后续 U3 将接入配置校验、不可变版本和策略依赖。"
      />
      <p className="route-action">
        <Link to="/strategies/example">查看策略详情骨架</Link>
      </p>
    </>
  );
}

function StrategyDetail() {
  const { id } = useParams();
  return (
    <>
      <FuturePage
        title="策略详情"
        detail={`路径中的策略 ID 为 ${id}。后续 U3 将显示策略版本、校验结果与依赖。`}
      />
      <p className="route-action">
        <Link to="/strategies">返回策略</Link>
      </p>
    </>
  );
}

export function AppRoutes() {
  const { pathname } = useLocation();
  const [operations] = useState(createOperationsFixture);
  const [emailTestKey, setEmailTestKey] = useState<string | null>(null);
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
                to={path}
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
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="/dashboard"
            element={
              <>
                <h1 className="terminal-title">仪表盘</h1>
                <MarketTerminal />
                <SystemOverview />
              </>
            }
          />
          <Route
            path="/trading"
            element={
              <Trading>
                <MarketTerminal trading />
              </Trading>
            }
          />
          {futurePages.map(({ path, title, detail }) => (
            <Route
              key={path}
              path={path}
              element={<FuturePage title={title} detail={detail} />}
            />
          ))}
          <Route path="/strategies" element={<Strategies />} />
          <Route path="/strategies/:id" element={<StrategyDetail />} />
          <Route path="/backtests" element={<Backtests />} />
          <Route
            path="/settings/integrations"
            element={<Integrations adapter={operations.integrations} />}
          />
          <Route
            path="/alerts"
            element={<Alerts adapter={operations.alerts} />}
          />
          <Route
            path="/settings/notifications"
            element={
              <Notifications
                adapter={operations.notifications}
                testKey={emailTestKey}
                setTestKey={setEmailTestKey}
              />
            }
          />
          <Route
            path="/system"
            element={
              <>
                <SystemOverview standalone />
                <SystemDetails read={operations.readSystem} />
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
