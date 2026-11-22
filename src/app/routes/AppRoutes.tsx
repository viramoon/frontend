import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { Backtests } from '../../features/backtest/Backtests';
import { Blog } from '../../features/blog/Blog';
import { Dashboard } from '../../features/dashboard/Dashboard';
import { Trading } from '../../features/trading/Trading';

const navigation = [
  { path: '/dashboard', label: '仪表盘' },
  { path: '/trading', label: '交易' },
  { path: '/backtests', label: '回测' },
  { path: '/blog', label: '博客' },
];

export function AppRoutes() {
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
      </header>
      <main id="workspace" className="workspace" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/trading" element={<Trading />} />
          <Route path="/backtests" element={<Backtests />} />
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
