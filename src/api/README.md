# Web API 入口

[index.ts](index.ts) 配置唯一的 Hey API 客户端，baseUrl 取页面 origin。replay 或 paper 等运行模式由服务端决定。生成文件位于 [generated](generated/README.md)，来源和校验方法见 [构建说明](../../docs/build.md#更新生成客户端)。

离线浏览器用例只从本地构建和模拟的系统状态及示例回测响应取数。[浏览器测试边界](../../docs/data-guard.md#浏览器测试)

仪表盘使用 `statusOptions` 和 `sampleOptions` 获取系统与示例摘要。回测工作台使用 `datasetsOptions`、`listOptions` 和 `detailOptions` 读取目录、作业列表和详情。写入通过 `submit` 提交 `POST /api/v1/backtests`，`byKey` 调用 `GET /api/v1/backtests/by-key` 确认原提交。两者都带临时 Bearer 令牌与同一 `Idempotency-Key`。

调用生成客户端时，用 `auth: bearerAuth(token)` 按契约的认证方案传入令牌。回调只向 HTTP Bearer 方案提供令牌，由客户端写入 `Authorization`。管理员会话 Cookie 由浏览器随同源请求管理。

TanStack Query 默认在 15 秒内将读取结果视为新鲜，读取失败由页面提示和提供重新读取。HTTP 错误保留状态码与 web 错误代码。示例接口的 404 显示空结果。提交或确认请求的客户端超时为 10 秒。只有按键查询返回 `404 job_not_found` 时，页面才提供同键同参数重试。[操作与状态说明](../../RUNBOOK.md#验证历史回测工作台)

## 行情视图适配层

[MarketDataAdapter](../features/market/marketData.ts) 是 U2a 的浏览器内部 TypeScript 接口。组件同步读 `read` / `history`，可用 `watch` 声明当前标的、产品、周期及深度 focus，变化通过 `subscribe` / `revision` 通知。每个 `BookSource` 对应单一标的和场所产品的订阅，订阅回调接收快照、连续增量、重置、不可用事件并可取消。适配器在发布前按 web 契约校验标的与产品身份、精确十进制、序列及权限。epoch 和 seq 在视图中以 bigint 比较，切换订阅后丢弃旧回调。恢复要求高于当前水位的可信快照。验收同水位的重新授权快照时，可由 W2a 适配器建立新的已确认订阅生命周期。

W2a 合并后，HTTP 经唯一同源生成客户端接入 watchlist、行情、指标、额度与 focus，WS 只接同源 web。适配器须将 web 流分区、序号、心跳、缺口和授权撤回映射为单盘口的生命周期和连续位置。F6 的参数、版本化列、OHLCV 和指标十进制原文及 `provisional` 分别用于适配器视图。HTTP OpenAPI 和流 schema 仍由上游维护，沿用 [生成流程](../../docs/build.md#更新生成客户端)。本次构建只打包合成回放，无新增服务配置。

## 研究工作台适配层

策略、因子与配置作业通过 [ResearchAdapter](../features/research/adapter.ts) 读取合成 fixture。W2b 接入时，在此请求边界复用生成客户端并把 web 响应转换为页面模型。[接口和接入约定](../features/research/README.md)

## U4 适配层

[W3 通知](notificationsWeb.ts)、[W4 集成](integrationsWeb.ts) 和 [W4 备份及质量](recoveryWeb.ts) 使用同一个生成的 web 客户端。管理员使用同源会话，写入带 Origin 与 CSRF。规则和集成更新携带引号包住的 revision，邮件测试携带 UUID 幂等键。

集成从 catalog 读取允许标的和部署配置槽。测试绑定候选版本与 scoped test ID。失败和生产者 `adapter_unavailable` 展示为测试结果，原活动配置继续显示。启用使用最新通过的测试 ID，回滚使用 web 列出的版本。超时先检查服务端 revision 与最新测试，前端不自动重放写入。读取模型只保留凭据版本和轮换时间，界面使用固定掩码。

备份与质量接口需要管理员会话。Drive 恢复点年龄以 web 返回的最后已验证截点和观测时间计算，保留 RFC 3339 的纳秒精度。严格超过 3600 秒才显示超时告警，缺失、降级和停用各自显示。历史备份事件使用同一水位规则核验持续状态。缺口翻页比较快照时间，变化时回首屏重读。WAL 位置和计数保留十进制文本。

W3 的收件地址和邮件静默策略由 web 配置。主动静默和解除静默等待相应接口。[合成实现](operationsFixture.ts) 只在测试或故事中显式注入。升级契约使用 [生成流程](../../docs/build.md#更新生成客户端)。
