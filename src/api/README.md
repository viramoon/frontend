# Web API 入口

[index.ts](index.ts) 配置唯一的 Hey API 客户端，baseUrl 取页面 origin。replay 或 paper 等运行模式由服务端决定。生成文件位于 [generated](generated/README.md)，来源和校验方法见 [构建说明](../../docs/build.md#更新生成客户端)。

离线浏览器用例只从本地构建和模拟的系统状态及示例回测响应取数。[浏览器测试边界](../../docs/data-guard.md#浏览器测试)

仪表盘使用 `statusOptions` 和 `sampleOptions` 获取系统与示例摘要。回测工作台使用 `datasetsOptions`、`listOptions` 和 `detailOptions` 读取目录、作业列表和详情。写入通过 `submit` 提交 `POST /api/v1/backtests`，`byKey` 调用 `GET /api/v1/backtests/by-key` 确认原提交。两者都带临时 Bearer 令牌与同一 `Idempotency-Key`。

调用生成客户端时，用 `auth: bearerAuth(token)` 按契约的认证方案传入令牌。回调只向 HTTP Bearer 方案提供令牌，由客户端写入 `Authorization`。管理员会话 Cookie 由浏览器随同源请求管理。

TanStack Query 默认在 15 秒内将读取结果视为新鲜，读取失败由页面提示和提供重新读取。HTTP 错误保留状态码与 web 错误代码。示例接口的 404 显示空结果。提交或确认请求的客户端超时为 10 秒。只有按键查询返回 `404 job_not_found` 时，页面才提供同键同参数重试。[操作与状态说明](../../RUNBOOK.md#验证历史回测工作台)

## 行情视图适配层

[MarketDataAdapter](../features/market/marketData.ts) 是 U2a 的浏览器内部 TypeScript 接口。组件同步读 `read` / `history`，可用 `watch` 声明当前标的、产品、周期及深度 focus，变化通过 `subscribe` / `revision` 通知。每个 `BookSource` 对应单一标的和场所产品的订阅，订阅回调接收快照、连续增量、重置、不可用事件并可取消。适配器在发布前按 web 契约校验标的与产品身份、精确十进制、序列及权限。epoch 和 seq 在视图中以 bigint 比较，切换订阅后丢弃旧回调。恢复要求高于当前水位的可信快照。验收同水位的重新授权快照时，可由 W2a 适配器建立新的已确认订阅生命周期。

`BookSource.availableFrom` 和 `MarketReading.tradesAvailableFrom` 分别提供盘口和逐笔可用起点，格式为 UTC `YYYY-MM-DD`。适配层缺少起点时省略该字段，界面隐藏对应面板。正式行情路由沿用 U2a 的合成回放适配器，展示「Fixture · 示例数据」与合成来源，在浏览器按 UTC 半开日期区间筛选已返回的快照和逐笔。[日期与覆盖语义](../features/market/README.md#数据类别与覆盖)

F10/W2a 合并并更新 `openapi/web.commit` 后，由契约更新项接入正式行情。HTTP 经唯一同源生成客户端接入 watchlist、行情、指标、额度与 focus，WS 只接同源 web。W2a 适配器按标的、场所、产品及细节流映射起点、样本覆盖及缺口，以 UTC 半开区间向 web 查询，并将事件时间规范成 UTC `Z` 时间戳。采集起点使用契约元数据，样本覆盖使用返回记录。适配器须将 web 流分区、序号、心跳、缺口和授权撤回映射为单盘口的生命周期和连续位置。F6 的参数、版本化列、OHLCV 和指标十进制原文及 `provisional` 分别用于适配器视图。HTTP OpenAPI 和流 schema 由上游维护，沿用 [生成流程](../../docs/build.md#更新生成客户端)。
