import { DataState } from '../../components/TerminalStates';

export function Trading() {
  return (
    <section className="simple-page">
      <h1>交易</h1>
      <DataState
        kind="empty"
        title="市场微观结构待接入"
        detail="后续 U2 将提供只读盘口、逐笔成交和永续合约指标，可按场所查看。"
        illustrated
      />
    </section>
  );
}
