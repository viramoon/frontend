# frontend 架构

采用 React + TypeScript + Vite 单页应用。frontend 是 fertile submodule，通过 web 读取系统与行情状态并提交回测。web（axum）同源托管静态产物与 API，使用 `127.0.0.1:8090`。Ruler 管理公网入口 `https://fertile.viramoon.com`，现有站点使用 `8080`。

## 页面与功能

| 路由 | 当前功能 | 后续接入的 web 接口 |
| --- | --- | --- |
| `/`、`/dashboard` | 自选、价量历史、指标、报价、来源及场所订单簿使用 U2a 合成回放。下方通过 web 读取系统状态和示例回测。 | W2a · `/watchlists/{id}`、`/market/instruments`、`/market/bars`、`/market/quotes`、`/indicators`、`/indicators/values`、`/market/book`、`/stream/market` |
| `/trading` | 同一合成回放提供只读 L1、场所盘口、逐笔成交、深度名额、加密现货与永续。 | W2a · `/market/book`、`/market/trades`、`/market/derivatives`、`/market/subscriptions`、`/market/depth-focus`、`/stream/market` |
| `/options/flow` | 期权成交流页面骨架。 | U2 · `/options/flow` |
| `/options/exposure` | 期权敞口、行权价和到期分布页面骨架。 | U2 · `/options/exposure` |
| `/strategies`、`/strategies/:id` | 合成策略目录、登记版本和只读研究详情。上传 YAML 或选择登记版本后查看编译预览、行列诊断和配置回测表单。 | W2b · 策略目录、版本、校验与不可变配置引用 |
| `/factors` | 合成因子定义、版本选用状态、训练/验证/样本外覆盖与 IC 衰减，显示费前、费后和等权基准。 | W2b · 因子目录与版本评价报告 |
| `/backtests` | 历史工作台通过 `?job=` 查看均线作业。配置工作台使用 `?view=strategy` 查看合成作业、按键找回，使用 `?run=` 查看运行清单、基准与模拟成交账本。 | W2b · 配置作业提交、列表、详情、按键查询和回放数据集 |
| `/settings/integrations` | 通过 W4 目录和版本接口管理草稿、凭据、候选测试、启用和回滚。 | 实际探测以生产者可用性、权限与证据为准 |
| `/alerts` | 通过 W3 展示告警、投递与确认。Drive 持续告警由 W4 恢复水位核验。 | 主动静默待 web 契约 |
| `/settings/notifications` | 使用 W3 `/notification-rules` 与 `/notification-channels/email/tests` 读取、更新已有规则并测试邮件。 | 收件地址与 SMTP 配置由 web 部署管理 |
| `/system` | 保留系统、行情采集状态及示例回测，显示 W3 通知健康。管理员可通过 W4 查看 Drive 恢复点、采集水位与缺口。 | 备份与 F3 质量数据由部署发布 |
| `/blog` | 保留文章列表入口及空态。 | 博客后续 issue 待排期，当前契约草案未定义博客接口。 |

表中的 API 路径以 `/api/v1` 为前缀。后续列记录 v1 方案 §E2 中各页面依赖的能力和草案路径，实际接入以合入并锁定的 web 契约为准。现有页面继续调用系统和回测接口。

页面在 app 层组合各 feature。feature 之间的直接导入、相对跨目录导入和重导出由 ESLint 及 `scripts/verify-boundaries.mjs` 校验。页面通过生成客户端配合 TanStack Query 访问 web。系统状态和示例回测各有加载提示。系统状态的请求失败（含 404）显示错误提示。示例回测的 404 显示「暂无示例回测」，其余请求失败显示错误提示。盈亏直接显示接口返回的十进制文本。[请求入口](../src/api/README.md)

## 行情终端与 fixture

market feature 的合成行情保留十进制源字符串。图表仅在传入 Lightweight Charts 时转成近似坐标，报价、成交、档位及主图读数使用原始精度。行情类别、时间、来源与时效见[行情终端](../src/features/market/README.md)，图表署名见[共享组件](../src/components/README.md)。

陈旧的 L1 与历史 K 线可保留并标记陈旧。场所订单簿在断序、重置、陈旧或权限撤回时立即清空，等新快照恢复。窄屏使用自选和报价深度抽屉。顶部系统状态条继续使用 web 接口，行情面板显示 Fixture 标记。

## 请求、状态与刷新

src/api 配置唯一的同源 web client。Hey API 与 TanStack Query 插件从 `openapi/web.commit` 锁定的 OpenAPI 生成客户端。U4 通过同一客户端接入 W3 通知与 W4 集成和恢复状态，U4 合成适配器仅用于显式注入的离线用例。[U4 适配层](../src/api/README.md#u4-适配层)

查询结果默认在 15 秒内视为新鲜。系统状态每 30 秒刷新，作业列表每 5 秒刷新，排队或运行中的详情每 2 秒刷新。行情新鲜度由 web 根据采集器的时间和阈值报告。

工作台使用服务端标的和日期覆盖验证请求，提交与按幂等键查询使用临时 Bearer 令牌。响应未知时查询原提交，服务确认该键没有作业后才提供同键重试。未确认请求的参数与键只存于浏览器会话，令牌仅随授权请求发送。排队、运行、业务失败、作业超时和浏览器离线分别显示。数据来源、实际覆盖、模拟成本和审计随成功结果显示。操作步骤与当前研究限制见 [运行手册](../RUNBOOK.md#验证历史回测工作台)。

配置研究页面由 app 注入适配层。合成适配层预览已知 YAML，使用相同不可变引用提交上传与登记版本的作业，浏览器会话中只保留参数、作业键和演示作业元数据。锁定 W2b 契约后，通过既有 web client 实现适配层。[适配接口和 fixture 来源](../src/features/research/README.md)

## 实时消息与陈旧提示

WebSocket 与 SSE 消息协议单独版本化。v1 草案由 WS 承载行情订阅，SSE 承载通知、质量及作业事件。消息版本、频道、事件时间、接收时间、序列和恢复游标等字段以 finance 输出和 web 消费契约为准。U2a 的 MarketDataAdapter 接收已校验的视图数据和订单簿事件。本地 fixture 提供当前实现，W2a 合入后从同源 web 接入。具体映射见 [Web API 入口](../src/api/README.md#行情视图适配层)。

系统面板通过轮询更新服务探测、行情源、更新时间和陈旧标的统计。顶部状态条复用同一查询的缓存并显示摘要。回测页在浏览器离线时保留最近读取的数据并显示离线提示，恢复后支持重新读取。

构建、托管与 tag 追溯见 [build.md](build.md)，系统约定见 [README](README.md)。
