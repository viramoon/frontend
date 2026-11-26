# Web API 入口

[index.ts](index.ts) 配置唯一的 Hey API 客户端，baseUrl 取页面 origin。replay 或 paper 等运行模式由服务端决定。生成文件位于 [generated](generated/README.md)，来源和校验方法见 [构建说明](../../docs/build.md#更新生成客户端)。

仪表盘使用 `statusOptions` 和 `sampleOptions` 获取系统与示例摘要。回测工作台使用 `datasetsOptions`、`listOptions` 和 `detailOptions` 读取目录、作业列表和详情。写入通过 `submit` 提交 `POST /api/v1/backtests`，`byKey` 调用 `GET /api/v1/backtests/by-key` 确认原提交。两者都带临时 Bearer 令牌与同一 `Idempotency-Key`。

调用生成客户端时，用 `auth: bearerAuth(token)` 按契约的认证方案传入令牌。回调只向 HTTP Bearer 方案提供令牌，由客户端写入 `Authorization`。管理员会话 Cookie 由浏览器随同源请求管理。

TanStack Query 默认在 15 秒内将读取结果视为新鲜，读取失败由页面提示和提供重新读取。HTTP 错误保留状态码与 web 错误代码。示例接口的 404 显示空结果。提交或确认请求的客户端超时为 10 秒。只有按键查询返回 `404 job_not_found` 时，页面才提供同键同参数重试。[操作与状态说明](../../RUNBOOK.md#验证历史回测工作台)

策略、因子与配置作业通过 [ResearchAdapter](../features/research/adapter.ts) 读取合成 fixture。W2b 接入时，在此请求边界复用生成客户端并把 web 响应转换为页面模型。[接口和接入约定](../features/research/README.md)
