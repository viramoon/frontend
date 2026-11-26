# 行情终端

`/dashboard` 的行情工作区包含自选和搜索、主 K 线及成交量、指标位置、报价和数据说明。桌面同时显示两侧面板，视口宽度不超过 960 像素时由按钮打开自选和报价深度抽屉。通过标的、1 小时或 4 小时周期及历史选择控件可查看对应读数。[MarketTerminal](MarketTerminal.tsx)

fixture 以固定合成数据演示回放和延迟（BTC-USD、ETH-USD）、陈旧（QQQ.XNAS）、无权（NDX）和空态（VIX）。1 小时 K 线由精确定点整数生成，4 小时 K 线由同一数据聚合。价格与数量以十进制字符串传给 UI，新鲜度与来源时间采用样本元数据。[行情 fixture](marketFixture.ts) · [共享组件](../../components/README.md)

终端根节点的 `data-fixture-seed` 标识渲染使用的合成种子。生成参数和视觉测试入口见[样本防护](../../../docs/data-guard.md)。

U2 在 web 提供并锁定对应契约后接入真实行情、自选、指标和盘口。系统状态与样例回测经已有 web 契约由 app 另外组合。[页面地图](../../../docs/architecture.md#页面与功能)
