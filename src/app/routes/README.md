# 页面路由

首页 `/` 转到 `/dashboard`，未知路径显示找不到页面与返回入口。导航可进入期权、策略、因子、告警、设置及系统页面。策略详情按 `:id` 匹配，可从策略列表进入。回测保留 `?job=` 深链。预留页面说明所对应的后续工作。[AppRoutes](AppRoutes.tsx) · [页面地图](../../../docs/architecture.md#页面与功能)

导航采用浏览器 History API。生产环境由 web 提供 SPA 回退，API、健康检查及缺失静态资源保留各自的 HTTP 语义。
