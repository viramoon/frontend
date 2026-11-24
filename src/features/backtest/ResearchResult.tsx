import type { BacktestSummary, ResearchReport } from '../../api';

const blockedReasons: Record<string, string> = {
  zero_volume: '零成交量',
  insufficient_volume: '成交量不足',
  insufficient_cash: '模拟现金不足',
};

export function ResearchResult({ summary }: { summary: BacktestSummary }) {
  const report = summary.research;
  if (!report) {
    return (
      <p className="job-note">
        此作业使用上游内置示例数据。示例盈亏 {summary.pnl} {summary.currency}。
      </p>
    );
  }
  return (
    <div className="research-result">
      <div className="result-lead">
        <div>
          <p className="metric-label">
            {report.dataset.data_kind === 'historical'
              ? '真实历史数据 · 模拟盈亏'
              : '测试数据 · 模拟盈亏'}
          </p>
          <div className="pnl-reading">
            <span className="pnl-value">{summary.pnl}</span>
            <span className="currency">{summary.currency}</span>
          </div>
        </div>
        <dl className="result-metrics">
          <div>
            <dt>期末净值</dt>
            <dd>
              {report.ending_equity} {summary.currency}
            </dd>
          </div>
          <div>
            <dt>净值变动</dt>
            <dd>{report.metrics ? `${report.metrics.return_pct}%` : '—'}</dd>
          </div>
          <div>
            <dt>最大回撤</dt>
            <dd>
              {report.metrics ? `${report.metrics.max_drawdown_pct}%` : '—'}
            </dd>
          </div>
        </dl>
      </div>
      <dl className="research-facts">
        <div>
          <dt>数据来源</dt>
          <dd>
            {report.dataset.source} · {report.dataset.calendar} 日线
          </dd>
        </div>
        <div>
          <dt>请求日期</dt>
          <dd>
            {report.requested_start} 至 {report.requested_end}
          </dd>
        </div>
        <div>
          <dt>实际样本</dt>
          <dd>
            {report.actual_start} 至 {report.actual_end}，{report.observations}{' '}
            个交易日
          </dd>
        </div>
        <div>
          <dt>预热与绩效</dt>
          <dd>
            预热 {report.warmup_sessions} 日，绩效起点{' '}
            {report.performance_start}
          </dd>
        </div>
        <div>
          <dt>成交时点</dt>
          <dd>按收盘生成信号，下一交易日收盘模拟成交</dd>
        </div>
        <div>
          <dt>成本</dt>
          <dd>
            每笔 {report.commission_per_order} {summary.currency}，滑点{' '}
            {report.slippage_bps} bp
          </dd>
        </div>
        <div>
          <dt>初始现金与无风险利率</dt>
          <dd>
            {report.initial_equity} {summary.currency}，RF=
            {report.risk_free_rate}
          </dd>
        </div>
        <div>
          <dt>价格与公司行为</dt>
          <dd>未按现金分红复权，分红不入账，区间经复核无拆股</dd>
        </div>
      </dl>
      <details className="result-provenance">
        <summary>数据批次 SHA-256</summary>
        <code>{report.dataset.source_sha256}</code>
      </details>
      <Coverage report={report} />
      <Execution report={report} />
    </div>
  );
}

function Coverage({ report }: { report: ResearchReport }) {
  return (
    <section className="result-section">
      <h3>绩效覆盖</h3>
      <div className="result-table-wrap">
        <table className="result-table">
          <thead>
            <tr>
              <th scope="col">窗口</th>
              <th scope="col">实际日期</th>
              <th scope="col">缺失 / 应有</th>
              <th scope="col">净值变动</th>
            </tr>
          </thead>
          <tbody>
            {report.windows.map((window) => (
              <tr key={window.requested_years}>
                <th scope="row">
                  {window.requested_years} 年 ·{' '}
                  {window.coverage === 'full' ? '覆盖完整' : '覆盖不足'}
                  <small>起点 {window.requested_start}</small>
                </th>
                <td>
                  {window.actual_start && window.actual_end
                    ? `${window.actual_start} 至 ${window.actual_end}`
                    : '无覆盖'}
                  {window.actual_years && (
                    <small>约 {window.actual_years} 年</small>
                  )}
                </td>
                <td>
                  {window.missing_sessions} / {window.expected_sessions}
                  {window.missing_pct && (
                    <small>缺失 {window.missing_pct}%</small>
                  )}
                </td>
                <td>
                  {window.metrics ? `${window.metrics.return_pct}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Execution({ report }: { report: ResearchReport }) {
  const audit = report.audit;
  return (
    <section className="result-section">
      <h3>成交审计</h3>
      <p className="job-note">
        {audit.fills} 笔成交 · {audit.zero_volume_bars} 根零量日线 · 阻止成交{' '}
        {audit.blocked_zero_volume +
          audit.blocked_insufficient_volume +
          audit.blocked_insufficient_cash}{' '}
        笔
      </p>
      {audit.recent_fills.length > 0 && (
        <div className="result-table-wrap">
          <table className="result-table">
            <caption>最近成交</caption>
            <thead>
              <tr>
                <th scope="col">信号日</th>
                <th scope="col">成交日</th>
                <th scope="col">方向与股数</th>
                <th scope="col">成交价</th>
              </tr>
            </thead>
            <tbody>
              {audit.recent_fills.map((fill) => (
                <tr key={fill.order_id}>
                  <td>{fill.signal_session}</td>
                  <td>{fill.execution_session}</td>
                  <td>
                    {fill.side === 'buy' ? '买入' : '卖出'} {fill.shares} 股
                  </td>
                  <td>{fill.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {audit.recent_blocked.length > 0 && (
        <details className="result-provenance">
          <summary>最近阻止成交的记录</summary>
          <ul>
            {audit.recent_blocked.map((blocked) => (
              <li key={blocked.execution_session}>
                {blocked.execution_session} ·{' '}
                {blockedReasons[blocked.reason] ?? blocked.reason} · 日成交量{' '}
                {blocked.bar_volume} 股，要求 {blocked.requested_shares} 股
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
