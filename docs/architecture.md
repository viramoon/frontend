# frontend 架构

采用 React + TypeScript + Vite 单页应用。frontend 是 fertile submodule，通过 web 读取系统与行情状态并提交回测。web（axum）同源托管静态产物与 API，使用 `127.0.0.1:8090`。Ruler 管理公网入口 `https://fertile.viramoon.com`，现有站点使用 `8080`。

## 页面与功能

| 路由 | 当前功能 | 后续接入的 web 接口 |
| --- | --- | --- |
| `/`、`/dashboard` | 根路径进入行情终端。左侧自选和搜索，中央 K 线、成交量和指标面板位，右侧报价、来源、深度与说明。终端下方保留 web 系统状态和示例回测。 | U2 · `/watchlists/{id}`、`/market/instruments`、`/market/bars`、`/indicators`、`/indicators/series`、`/market/book`、`/market/trades`、`/stream/market` |
| `/trading` | 只读盘口、逐笔成交和衍生品数据的页面骨架。 | U2 · `/market/book`、`/market/trades`、`/market/derivatives`、`/stream/market` |
| `/options/flow` | 期权成交流页面骨架。 | U2 · `/options/flow` |
| `/options/exposure` | 期权敞口、行权价和到期分布页面骨架。 | U2 · `/options/exposure` |
| `/strategies`、`/strategies/:id` | 策略列表、版本与详情的页面骨架，列表可打开示例详情。 | U3 · `/strategies`、`/strategies/validate`、`/strategies/{id}/versions/{version}`、`/strategy-schema/{major}` |
| `/factors` | 因子目录和质量报告页面骨架。 | U3 · `/factors`、`/factors/{id}/versions/{version}/report` |
| `/backtests` | 现有历史回测工作台读取 `/backtests` 系列接口。可读取标的和日期覆盖，提交单标的均线作业，也可经 `?job=` 查看作业状态、绩效覆盖和成交审计。 | U3 · `/strategy-runs`、`/strategy-runs/{id}`、`/strategy-runs/by-key`、`/strategy-runs/{id}/artifacts`、`/datasets/imports`、`/datasets/imports/{id}` |
| `/settings/integrations` | 合成接口卡支持查看产品和权限、保存草稿、写入和清除示例凭据、测试、启用、回滚和停用。 | W1 会话、权限和配置版本，W4 提供实际连接、测试证据与配置应用 |
| `/alerts` | 合成告警列表支持确认、按事件静默和投递状态查看。 | W3 · `/alerts`、`/alerts/{id}`、`/alerts/{id}/ack`；主动静默待 web 契约 |
| `/settings/notifications` | 合成邮件规则、本人收件地址配置状态与测试发送。 | W3 · `/notification-rules`、`/notification-rules/{id}`、`/notification-channels/email/tests` 与测试详情 |
| `/system` | 保留现有系统状态和示例回测，另有合成采集质量、SMTP 状态和 Drive 恢复水位。 | U2 分区水位与缺口，W3 邮件健康，T2b 备份状态由 web 提供安全摘要 |
| `/blog` | 保留文章列表入口及空态。 | 博客后续 issue 待排期，当前契约草案未定义博客接口。 |

表中的 API 路径以 `/api/v1` 为前缀。后续列记录设计与当前开发中的接入点，实际接入以合入并锁定的 web 契约为准。现有页面继续调用系统和回测接口。

页面在 app 层组合各 feature。feature 之间的直接导入、相对跨目录导入和重导出由 ESLint 及 `scripts/verify-boundaries.mjs` 校验。页面通过生成客户端配合 TanStack Query 访问 web。系统状态和示例回测各有加载提示。系统状态的请求失败（含 404）显示错误提示。示例回测的 404 显示「暂无示例回测」，其余请求失败显示错误提示。盈亏直接显示接口返回的十进制文本。[请求入口](../src/api/README.md)

## 行情终端与 fixture

行情和自选示例保存在 market feature 内。价格、成交量和深度数量使用原始十进制字符串，精确读数直接展示这些字符串。图表坐标在渲染时使用数值近似，报价和读数仍使用源文本。数据源、时间、新鲜度、回放和延迟均显示文字。陈旧行情保留示例读数及陈旧提示，无权和空态显示各自原因。样式使用深靛底和低饱和粉紫，原创简笔只用于空态或说明区。[行情终端](../src/features/market/README.md) · [共享组件](../src/components/README.md)

窄屏使用自选和报价深度抽屉，导航和操作控件支持键盘与可见焦点。顶部状态条显示 web 服务状态，终端在行情区域显示 fixture 标记。

## 请求、状态与刷新

src/api 配置唯一的同源 web client，并将 HTTP 出错状态传给界面。Hey API 与 TanStack Query 插件从 `openapi/web.openapi.json` 生成客户端。`openapi/web.commit` 当前锁定 web main 的 `90662dbb904724f119814576cb98128d8cb9ed05`，包含 W1 会话、数据权限和配置生命周期（web #15）及 finance 契约升级（web #18）。管理员会话、当前用户能力和集成配置接口已生成客户端。U4 页面通过只在内存运行的适配层演示，实际接线等待 W3、W4 与 T2b 契约。[U4 适配层](../src/api/README.md#u4-适配层)

查询结果默认在 15 秒内视为新鲜。系统状态每 30 秒刷新，作业列表每 5 秒刷新，排队或运行中的详情每 2 秒刷新。行情新鲜度由 web 根据采集器的时间和阈值报告。

工作台使用服务端标的和日期覆盖验证请求，提交与按幂等键查询使用临时 Bearer 令牌。响应未知时查询原提交，服务确认该键没有作业后才提供同键重试。未确认请求的参数与键只存于浏览器会话，令牌仅随授权请求发送。排队、运行、业务失败、作业超时和浏览器离线分别显示。数据来源、实际覆盖、模拟成本和审计随成功结果显示。操作步骤与当前研究限制见 [运行手册](../RUNBOOK.md#验证历史回测工作台)。

## 实时消息与陈旧提示

WebSocket 与 SSE 消息协议单独版本化。v1 草案由 WS 承载行情订阅，SSE 承载通知、质量及作业事件。消息版本、频道、事件时间、接收时间、序列和恢复游标等字段以 finance 输出和 web 消费契约为准。本阶段使用本地 fixture 演示行情状态。

系统面板通过轮询更新服务探测、行情源、更新时间和陈旧标的统计。顶部状态条复用同一查询的缓存并显示摘要。回测页在浏览器离线时保留最近读取的数据并显示离线提示，恢复后支持重新读取。

构建、托管与 tag 追溯见 [build.md](build.md)，系统约定见 [README](README.md)。
