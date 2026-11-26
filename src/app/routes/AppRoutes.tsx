import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom';
import { DataState } from '../../components/TerminalStates';
import { Backtests } from '../../features/backtest/Backtests';
import { Blog } from '../../features/blog/Blog';
import {
  SystemOverview,
  SystemStatusStrip,
} from '../../features/dashboard/Dashboard';
import { MarketTerminal } from '../../features/market/MarketTerminal';
import { OptionsTerminal } from '../../features/options/OptionsTerminal';
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
    path: '/factors',
    title: '因子',
    detail: '后续 U3 将展示可引用因子版本、覆盖率、IC 和换手。',
  },
  {
    path: '/settings/integrations',
    title: '接口设置',
    detail: '后续 U4 将接入配置版本、权限、预算状态与连接验证。',
  },
  {
    path: '/alerts',
    title: '事件',
    detail: '后续 U4 将提供事件确认、静默与投递记录。',
  },
  {
    path: '/settings/notifications',
    title: '通知设置',
    detail: '后续 U4 将提供通知目的地验证与测试发送。',
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
          <Route
            path="/options/flow"
            element={<OptionsTerminal page="flow" />}
          />
          <Route
            path="/options/exposure"
            element={<OptionsTerminal page="exposure" />}
          />
          <Route path="/strategies/:id" element={<StrategyDetail />} />
          <Route path="/backtests" element={<Backtests />} />
          <Route
            path="/system"
            element={
              <>
                <SystemOverview standalone />
                <section
                  className="dashboard-section"
                  aria-labelledby="quality-heading"
                >
                  <h2 id="quality-heading">数据质量</h2>
                  <DataState
                    kind="empty"
                    title="数据质量摘要待接入"
                    detail="后续 U2 将接入分区水位与数据缺口。"
                  />
                </section>
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
