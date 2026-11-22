import { Link } from 'react-router-dom';

export function Backtests() {
  return (
    <section className="simple-page">
      <h1>回测</h1>
      <div className="placeholder-panel">
        <h2>回测任务</h2>
        <p>任务列表尚未接入工作台。</p>
        <Link to="/dashboard">查看仪表盘上的示例回测</Link>
      </div>
    </section>
  );
}
