# Web API 入口

[index.ts](index.ts) 配置唯一的 Hey API 客户端，baseUrl 取页面 origin。replay 或 paper 等运行模式由服务端决定。生成文件位于 [generated](generated/README.md)，来源和校验方法见 [构建说明](../../docs/build.md#更新生成客户端)。

离线浏览器用例只从本地构建和模拟的系统状态及示例回测响应取数。[浏览器测试边界](../../docs/data-guard.md#浏览器测试)

仪表盘使用 `statusOptions` 和 `sampleOptions` 获取系统与示例摘要。回测工作台使用 `datasetsOptions`、`listOptions` 和 `detailOptions` 读取目录、作业列表和详情。写入通过 `submit` 提交 `POST /api/v1/backtests`，`byKey` 调用 `GET /api/v1/backtests/by-key` 确认原提交。两者都带临时 Bearer 令牌与同一 `Idempotency-Key`。

调用生成客户端时，用 `auth: bearerAuth(token)` 按契约的认证方案传入令牌。回调只向 HTTP Bearer 方案提供令牌，由客户端写入 `Authorization`。管理员会话 Cookie 由浏览器随同源请求管理。

TanStack Query 默认在 15 秒内将读取结果视为新鲜，读取失败由页面提示和提供重新读取。HTTP 错误保留状态码与 web 错误代码。示例接口的 404 显示空结果。提交或确认请求的客户端超时为 10 秒。只有按键查询返回 `404 job_not_found` 时，页面才提供同键同参数重试。[操作与状态说明](../../RUNBOOK.md#验证历史回测工作台)

## U4 适配层

[operations.ts](operations.ts) 定义设置、通知、告警和系统页面的视图模型及异步操作。[合成实现](operationsFixture.ts) 由 app 每次挂载时创建。配置、告警与测试记录只保存在该实例内，查询缓存只保存用于展示的状态，路由切换保留同一实例。U4 操作没有 HTTP 或 WebSocket 传输。系统页原有的 web 系统状态和示例回测继续使用上文的请求入口。

| 适配接口 | 交互约定及后续接线 |
| --- | --- |
| `IntegrationsAdapter` | 草稿、活动和可回滚版本独立展示。所有更改提交当前 revision；只有当前草稿通过验证才可启用。替换凭据仅发送一次输入，读模型仅含是否已配置、版本和轮换时间，界面使用固定掩码。清除时同时吊销相关版本，防止回滚后重新启用。W1 会话、产品能力及 `If-Match` 由实际适配器处理。W4 接线需确认测试与启用边界、显式回滚及测试结果码；页面用类型化结果展示收盘待验、权限失败等。 |
| `AlertsAdapter` | 确认可重复，保留首次确认时间；静默与确认独立。映射 W3 确认时间、事故阶段、投递与尝试。主动静默及解除静默需要 web 契约；合成版本提供一小时静默与到期。 |
| `NotificationsAdapter` | 读取是否配置本人收件地址，配置和静默时段由部署提供。规则写入携带 revision。无正文的测试请求使用一个 UUID，先按该 UUID 读取投递状态，只有查无记录才能按原键重试。映射 W3 中继接受、失败和尝试状态。 |
| `OperationsAdapter.readSystem` | 将采集质量、邮件健康与备份摘要映射到页面。W3 读取通知健康；备份由 web 提供 T2b 状态安全摘要，包含 UTC 观测时间、`last_recoverable_at`、最近全量和增量、降级状态及最近的恢复演练。备份告警以已验证恢复点的年龄为准，大于 3600 秒触发，缺失、未来时间和降级分别标明。 |

真实适配器只通过已生成的 web 客户端调用同源服务。其管理写入需由 web 会话、产品权限和 CSRF 校验保护；前端仅为显示保留分类后的错误和状态，凭据不进入状态缓存。Drive、IBKR 与 SMTP 连接由服务端部署管理，页面没有开户、订阅、下单或自定义探测目标的入口。升级契约按 [生成流程](../../docs/build.md#更新生成客户端) 执行。
