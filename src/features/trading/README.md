# 交易

`/trading` 是只读市场微观结构入口。应用层将行情终端组成该页面，展示综合 L1、Nasdaq 与加密场所订单簿、独立逐笔成交和永续读数。SPY 仅展示综合 L1。管理员会话通过同源 web 读取行情、券商线路预算和 Web 订阅槽位。`?market=replay` 打开合成回放。[运行手册](../../../RUNBOOK.md#验证行情终端) · [Trading](Trading.tsx) · [页面地图](../../../docs/architecture.md#页面与功能)
