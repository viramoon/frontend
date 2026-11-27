# Web API 入口

[index.ts](index.ts) 配置唯一的 Hey API 客户端，baseUrl 取页面 origin。replay 或 paper 等运行模式由服务端决定。生成文件位于 [generated](generated/README.md)，来源和校验方法见 [构建说明](../../docs/build.md#更新生成客户端)。

离线浏览器用例只从本地构建和模拟的系统状态及示例回测响应取数。[浏览器测试边界](../../docs/data-guard.md#浏览器测试)

仪表盘使用 `statusOptions` 和 `sampleOptions` 获取系统与示例摘要。历史回测工作台读取公共目录、列表与详情。历史提交与原键确认携带临时 Bearer 令牌，配置回测使用管理会话。两种工作台都用同一 `Idempotency-Key` 提交和确认。[作业请求](backtestsWeb.ts)

调用生成客户端时，用 `auth: bearerAuth(token)` 按契约的认证方案传入令牌。回调只向 HTTP Bearer 方案提供令牌，由客户端写入 `Authorization`。管理员会话 Cookie 由浏览器随同源请求管理。

TanStack Query 默认在 15 秒内将读取结果视为新鲜，读取失败由页面提示和提供重新读取。HTTP 错误保留状态码与 web 错误代码。示例接口的 404 显示空结果。提交或确认请求的客户端超时为 10 秒。只有按键查询返回 `404 job_not_found` 时，页面才提供同键同参数重试。[操作与状态说明](../../RUNBOOK.md#验证历史回测工作台)

## 第 2 批契约差异

[web 来源提交](../../openapi/web.commit) 从 `6e5fd80a56c3ab2fd0634fd69ecec3b7315dcd06` 前移到 `fcfda737d5152518d1d77cd55a5287c7185f3fb7`。锁定 web 的 finance 来源为 `86dcc8604b6881d648418a25e6cd13c24d4a9b01`。两版 [OpenAPI](../../openapi/web.openapi.json) 的 JSON 结构差异如下。路径使用 `/api/v1` 前缀。

| 范围 | 变化 |
| --- | --- |
| W2b 策略 | 新增 `GET /strategies`（版本页）、`POST /strategies`（登记）、`POST /strategies/validate`（带计划预览的校验）和 `GET /strategies/{id}/versions/{version}`（固定版本的计划预览）。同源会话写入要求 Origin 和 CSRF。单份源文件 UTF-8 上限 256 KiB。 |
| W2b 因子 | 新增 `GET /factors`、`GET /factors/{id}/evaluations`、`GET /factors/{id}/evaluations/{evaluation_id}`，分别返回目录、评价分页及指定因子版本的评价详情。鉴权只对管理员开放。 |
| W2b 回测 | `POST /backtests` 接受 `JobRequest \| BundleSubmission`，新增 404、413 响应及同源会话 Origin 说明。`GET /backtests` 和 `GET /backtests/{id}` 区分公开历史作业与管理会话可见的配置作业。游标保持 int64，指向本页末个可见作业。原按键查询路径与历史深链沿用。 |
| W8 期权链 | `GET /options/chain` 增加 `underlying_con_id`、`expiry`、`after_con_id`，成功返回 `OptionChainPage`。只有旧 `instrument_id` 的查询仍可收到 `finance_contract_pending`。 |
| W8 敞口 | `GET /options/exposure` 支持 `underlying_id`、估值时点与四种 `scenario`，成功返回 `OptionExposureResponse`。无法解释的旧情景令牌可返回 `finance_contract_pending`。 |
| W8 场所、历史与调度 | 新增 `GET /market/depth`（股票场所档位）、`GET /options/history`（采用纳秒字符串表示区间）、`GET /market/subscriptions/budget`（券商额度）、`GET /market/subscriptions/coverage`（合约订阅区间）。上述路由都需授权。 |
| W9 流水 | `GET /options/flow` 增加合约 ID 与时间窗支持，响应区分观察页与历史核验页；只传旧 `instrument_id` 需升级查询。新增 `GET /options/flow/observations` 和 `GET /options/flow/verification`，使用合约 ID、UTC 半开时间窗和 offset。 |
| W12 同源鉴权 | 调整 `POST/DELETE /admin/session`、`POST /alerts/{id}/ack`、`PUT/DELETE /alerts/{id}/silence`、`POST /integrations`、`PATCH /integrations/{id}`、`PUT/DELETE /integrations/{id}/credential`、`POST /integrations/{id}/tests`、`POST /notification-channels/{id}/tests`、`PUT /notification-rules/{id}`、`PUT/DELETE /notification-rules/{id}/silence` 的 Origin 参数说明。SSE `GET /events` 和 WS `GET /stream/market` 更新连接鉴权说明。 |
| 既有 schema | `ErrorDetail` 增加可选 JSON Pointer `path` 和一基 `location`。`Product` 增加 `strategy_research`。`Subscriptions.finance_lines` 注明是旧标记，实际额度从独立接口读取。 |
| 新增 schema | 110 个新定义覆盖策略源、计划、诊断、因子、配置提交、期权链、W9 证据、历史 bar、场所深度、额度与覆盖，以及 OI、GEX、wall 和过零区间。HTTP 路径、既有 schema 和鉴权方案没有删除。 |

本仓库此次只锁定 web 的 HTTP 导出和生成客户端。既有 WS 与 SSE 订阅继续使用已部署的 1.0 帧。frontend 无独立的 `service.yaml`、迁移、环境变量、端口或进程；T3b 应匹配 web 与 finance 的完整提交并部署对应 dist。[构建与生成流程](../../docs/build.md)

## W6 契约差异

[web 来源提交](../../openapi/web.commit) 从 `9132c5dc2e40f94d96151fbcc2989abbbb53d778` 前移到 `6e5fd80a56c3ab2fd0634fd69ecec3b7315dcd06`。W6 的 finance 来源为 `fc5e153e9727181f5748659c0610b2fbc2b49769`。以下各项来自两版 [web OpenAPI](../../openapi/web.openapi.json) 的比较。

| 变化 | 接口或 schema | 含义 |
| --- | --- | --- |
| 现有定义 | HTTP 路径与操作 | 沿用现有操作、参数、权限、状态码和响应引用。 |
| 更新引用 | `QualityCoverage.watermarks` | `GET /api/v1/quality/gaps` 的覆盖项水位引用 `QualityWatermarks`，可空。 |
| 新增组件 | `QualityWatermarks` | 直接包含 `local_durable`、`projected`、可空的 `remote_verified` 和 `source_latest`。 |
| 新增组件 | `QualitySourceObservation` | `source_latest` 的观测包含 `channel`、`instrument_id`、`epoch`、`seq`、`receive_ts` 和可空的 `exchange_ts`。 |
| 现有定义 | `MarketWatermarks`、`SourceObservation` | `GET /api/v1/market/watermarks` 继续返回含 `access`、`as_of` 和 `watermarks` 的行情包装结构。 |
| 新增组件 | `FundingRate`、`OpenInterest` | 独立负载分别携带 `rate` 与可空的 `next_funding_ts`，以及 `quantity`。 |
| 更新分支 | `Message` | 加入 `funding_rate` 和 `open_interest`。 |
| 更新版本条件 | `Event` | 1.0 延续原消息集合。2.0 永续事件要求 `revision` 为 `"0"`，允许 `perpetual_context`、`funding_rate`、`open_interest`、`gap`、`reset`、`heartbeat` 和 `status`。 |

W2a REST WAL 可返回新事件。永续摘要沿用 `/market/derivatives` 中的 `perpetual_context`，保留标记价格、资金费率和持仓量的精确文本。行情 WebSocket 仍发送 1.0 帧，遇到 2.0 时由 web 发送 `unsupported_version` 重置。运维 SSE 沿用原协议。frontend 构建后仍由 web 托管。[生成流程](../../docs/build.md#更新生成客户端)

## 行情视图适配层

[W2a web 适配器](marketWeb.ts) 实现 [MarketDataAdapter](../features/market/marketData.ts)。正式行情路由先检查 `restricted_market_data` 管理员会话，再经唯一生成客户端读取标的和产品、WAL 与水位、K 线、指标列、最优报价、盘口、逐笔和永续上下文。读取使用 `no-store`。自选 GET/PUT 使用 `default` 自选 ID 和服务端 revision，409 后读回服务器状态。深度焦点可设置或清除，写入带 Origin 和 CSRF。券商线路可返回 `finance_contract_pending`，Web 订阅槽位使用接口返回的计数。

`BookSource.availableFrom` 和 `MarketReading.tradesAvailableFrom` 取同一分区可用的首个快照或逐笔 `first_available_ts` 的 UTC 日期。样本时间以交易所时间为准，缺少交易所时间时按接收时间显示。适配器以产品持久水位为固定截止位置，从零开始沿 `next_after` 校验授权 WAL 的连续页。已验证检查点和数据仅驻留在当前授权视图内存中，刷新从该位置续读，撤权或离开页面时清除。

逐笔在 UTC 半开区间内使用与显示一致的时间。适配器先从已验证 WAL 查出覆盖所选记录的位置范围，再携带同一个 `through` 翻完逐笔 REST 页。W2a REST 的日期参数只匹配交易所时间。缺少交易所时间的记录按接收时间筛选，再从已验证 WAL 按位置合并，界面显示实际扫描范围。盘口有结束日时用该日午夜前一纳秒作为 `as_of`。默认视图和日期筛选共用重建规则，快照和连续增量跨越单个 REST 页时，从已验证 WAL 重放至选定位置，再建立实时订阅。完全早于对应采集起点的区间跳过该细节请求。调整日期时取消旧读取。[日期与覆盖语义](../features/market/README.md#数据类别与覆盖)

[同源行情 WebSocket](marketWebStream.ts) 读取 `/api/v1/stream/market` 的 F1 帧和 web 控制帧；用 WAL checkpoint 续接，使用 bigint 校验分区序号，快照后才应用连续盘口增量。断连、缺口或重置时清除盘口，重新用 REST 与 WAL 建立快照。原生 EventSource 读取 `/api/v1/events` 的 `permissions` 与 `reset`；权限撤回清除可见数据、关闭两个流并取消 REST。合成适配器用于显式回放和测试。[W6 契约差异](#w6-契约差异)

## 期权视图适配层

[OptionsDataAdapter](../features/options/optionsData.ts) 定义浏览器内部视图接口。两页通过 `underlyings` 获取可选标的，用 `read(underlying, signal)` 读取含来源、流水与敞口的快照。切换标的或卸载时取消读取并丢弃迟到结果。允许两块内容独立为空，区分读取失败、确认无数据、未知分母和未评估 flip。十进制读数用经过验证的普通十进制字符串，时间以 UTC 字符串传入，交易业务日和 OI 基准日用独立日期。当前快照完整提供可浏览的合成结果，筛选在浏览器内进行。

[实时期权页](../features/options/WebOptions.tsx) 使用生成 SDK 读取 W8 链、标的场所深度和敞口，以及 W9 两类流水。选定 W8 合约后可直接填入 W9 流水查询。页面保留来源、产品许可、实测覆盖、后端情景与原始十进制值。发生 `finance_contract_pending` 时显示「待接入」。授权拒绝、上游错误和成功空数据各自呈现。历史期权链、独立额度和覆盖接口随契约生成，当前页面使用链、深度、敞口与流水的返回值。[合成数据与回放](../features/options/README.md)

## 研究工作台适配层

[W2b 适配层](researchWeb.ts) 使用生成 SDK 映射策略计划、因子、作业与报告。配置提交使用已登记引用、半开 UTC 时间窗和幂等键，版本内容由 finance 固定。旧公开均线列表向 web 匿名读取，使用服务提供的 int64 游标。由于 JavaScript `number` 无法精确承载全部 int64，读取作业相关 JSON 时保留游标和作业 ID 的数字原文，并按十进制文本构造同源请求。浏览器需要支持 JSON 解析器的原始数字文本才能读取超出安全整数范围的 ID。[研究工作台接口](../features/research/README.md)

## U4 适配层

[W3 通知](notificationsWeb.ts)、[W4 集成](integrationsWeb.ts) 和 [W4 备份及质量](recoveryWeb.ts) 使用同一个生成的 web 客户端。管理员使用同源会话，写入带 Origin 与 CSRF。规则和集成更新携带引号包住的 revision，邮件测试携带 UUID 幂等键。

集成从 catalog 读取允许标的和部署配置槽。测试绑定候选版本与 scoped test ID。失败和生产者 `adapter_unavailable` 展示为测试结果，原活动配置继续显示。启用使用最新通过的测试 ID，回滚使用 web 列出的版本。超时先检查服务端 revision 与最新测试，前端不自动重放写入。读取模型只保留凭据版本和轮换时间，界面使用固定掩码。

备份与质量接口需要管理员会话。Drive 恢复点年龄使用 web 按当前时刻计算的 `age_seconds`，告警使用 `alert`。`observed_at` 是状态文件修改时间，只用于展示，文件停止更新时服务端年龄仍会增长。web 以精确时长判定严格超过 3600 秒，再返回整秒年龄。返回 3600 秒且告警开启、生产者未降级时，界面显示超时。缺失、降级和停用分别展示。系统页展示 web 的综合告警。历史 `backup_stale` 事件只有在同一水位判定确认超时时才标为持续。仅有降级或缺少恢复点时，历史事件保留在完整列表，并排除在持续告警筛选之外。当前水位未告警、无法核验和 W3 恢复事件分别展示。缺口翻页比较快照时间，变化时回首屏重读。WAL 位置和计数保留十进制文本。

恢复适配器把生成的 `QualityGapsPage` 直接交给系统页。系统页从覆盖项读取 `QualityWatermarks`，逐字展示位置、序号及接收时间。缺少观测时显示「未知」。[离线验收](../../RUNBOOK.md#离线验证设置通知与系统页)

W3 的收件地址和邮件静默策略由 web 配置。主动静默和解除静默等待相应接口。[合成实现](operationsFixture.ts) 只在测试或故事中显式注入。升级契约使用 [生成流程](../../docs/build.md#更新生成客户端)。
