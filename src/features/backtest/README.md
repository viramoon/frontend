# 回测

[Backtests](Backtests.tsx) 是 /backtests 的历史数据工作台。选择已导入标的、日期和均线参数，临时输入提交令牌，提交并查看作业队列、状态和审计结果。在未知响应时先核对原提交，再按确认结果操作。浏览器只在会话中保存未确认请求的参数和幂等键。

`/backtests?job=<id>` 可直接打开作业详情。示例回测继续显示在仪表盘，也可在 `/system` 查看。app 将 `?view=strategy` 和 `?run=<id>` 路由到配置回测视图。[页面地图](../../../docs/architecture.md#页面与功能) · [配置回测](../research/README.md)
