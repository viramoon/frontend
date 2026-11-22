# frontend 架构

采用 React + TypeScript + Vite 单页应用。frontend 是 fertile submodule，只调用 web 的交易、回测、看板和博客 API，不直接连接 finance。产物由 web（axum）托管，不单独起服务，也不提供独立 service.yaml 或 /healthz。

## 页面与功能

| 路由 | 功能 |
| --- | --- |
| /dashboard | 仪表盘读取系统状态、数据库与 finance 探测、行情新鲜度及示例回测摘要。根路径进入此页。 |
| /trading | 交易页面入口，当前仅提供状态说明。 |
| /backtests | 回测页面入口，示例摘要在仪表盘读取。 |
| /blog | 博客页面入口，当前仅提供页面骨架。 |

页面在 app 层组合各 feature。feature 之间的直接导入、相对跨目录导入和重导出由 ESLint 校验。页面通过 src/api 的生成客户端配合 TanStack Query 访问 web；加载、请求失败和 sample 的 404 空状态分别呈现。PnL 作为服务返回的十进制文本直接显示，避免经过 Number 或 parseFloat。

## 请求、状态与刷新

src/api 配置唯一的同源 web client，并将 HTTP 出错状态传给界面。Hey API 与 TanStack Query 插件读取 openapi/web.openapi.json，写入 src/api/generated。TanStack Query 缓存系统状态和示例回测两个独立查询，staleTime 为 15 秒。行情新鲜度另由 web 根据 collector 的时间与阈值报告。

客户端共享 store 只保存界面状态，不保存第二份服务端真相。价格、数量、金额展示保留协议精度；交易写超时先查状态，不自动盲重发。具体交互与权限由接口和功能需求验证。

## 实时消息与陈旧提示

WebSocket / SSE 不在 OpenAPI 范围内，消息协议单独约定。TBD：选择 WS 或 SSE、消息版本、事件类型、标的 / 频道、精确数值编码、事件时间与接收时间单位、序列号 / 恢复游标、快照与增量、错误和重连恢复语义。以上只是设计字段，不创建假消息 schema。

界面显示数据来源时间、连接状态和“行情陈旧”提示；缺口、断线或超阈值时保留最后更新时间，受影响操作应按权限与风控规则限制。阈值、告警样式和恢复交互 TBD；是否可交易最终由 finance 风控决定，UI 不能用刷新清除错误来宣称恢复。

构建、托管与 tag 追溯见 [build.md](build.md)，系统约定见 [README](README.md)。
