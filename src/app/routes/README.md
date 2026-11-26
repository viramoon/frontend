# 页面路由

首页 `/` 转到 `/dashboard`，未知路径显示找不到页面与返回入口。策略详情按 `:id` 匹配，可附带 `?version=` 选择登记版本。`/backtests` 和 `?job=` 使用历史均线工作台，`?view=strategy` 和 `?run=` 使用配置工作台。若 URL 同时出现两种作业参数，优先读取 `?job=`。app 将同一策略作业提交状态传给编译页和配置回测页，有查询上下文时在确认后刷新作业列表。行情合成回放可独立挂载。[AppRoutes](AppRoutes.tsx) · [页面地图](../../../docs/architecture.md#页面与功能)

导航采用浏览器 History API。生产环境由 web 提供 SPA 回退，API、健康检查及缺失静态资源保留各自的 HTTP 语义。
