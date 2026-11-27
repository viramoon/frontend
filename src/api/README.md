# Web API 入口

[index.ts](index.ts) 配置唯一的 Hey API 客户端，baseUrl 取页面 origin。replay 或 paper 等运行模式由服务端决定。生成文件位于 [generated](generated/README.md)，来源和校验方法见 [构建说明](../../docs/build.md#更新生成客户端)。

离线浏览器用例只从本地构建和模拟的系统状态及示例回测响应取数。[浏览器测试边界](../../docs/data-guard.md#浏览器测试)

仪表盘使用 `statusOptions` 和 `sampleOptions` 获取系统与示例摘要。回测工作台使用 `datasetsOptions`、`listOptions` 和 `detailOptions` 读取目录、作业列表和详情。写入通过 `submit` 提交 `POST /api/v1/backtests`，`byKey` 调用 `GET /api/v1/backtests/by-key` 确认原提交。两者都带临时 Bearer 令牌与同一 `Idempotency-Key`。

调用生成客户端时，用 `auth: bearerAuth(token)` 按契约的认证方案传入令牌。回调只向 HTTP Bearer 方案提供令牌，由客户端写入 `Authorization`。管理员会话 Cookie 由浏览器随同源请求管理。

TanStack Query 默认在 15 秒内将读取结果视为新鲜，读取失败由页面提示和提供重新读取。HTTP 错误保留状态码与 web 错误代码。示例接口的 404 显示空结果。提交或确认请求的客户端超时为 10 秒。只有按键查询返回 `404 job_not_found` 时，页面才提供同键同参数重试。[操作与状态说明](../../RUNBOOK.md#验证历史回测工作台)

## 行情视图适配层

[W2a web 适配器](marketWeb.ts) 实现 [MarketDataAdapter](../features/market/marketData.ts)。正式行情路由先检查 `restricted_market_data` 管理员会话，再经唯一生成客户端读取标的和产品、WAL 与水位、K 线、指标列、最优报价、盘口、逐笔和永续上下文。读取使用 `no-store`。自选 GET/PUT 使用 `default` 自选 ID 和服务端 revision，409 后读回服务器状态。深度焦点可设置或清除，写入带 Origin 和 CSRF。券商线路可返回 `finance_contract_pending`，Web 订阅槽位使用接口返回的计数。

`BookSource.availableFrom` 和 `MarketReading.tradesAvailableFrom` 取同一分区可用的首个快照或逐笔 `first_available_ts` 的 UTC 日期。样本时间以交易所时间为准，缺少交易所时间时按接收时间显示。适配器以产品持久水位为固定截止位置，从零开始沿 `next_after` 校验授权 WAL 的连续页。已验证检查点和数据仅驻留在当前授权视图内存中，刷新从该位置续读，撤权或离开页面时清除。

逐笔在 UTC 半开区间内使用与显示一致的时间。适配器先从已验证 WAL 查出覆盖所选记录的位置范围，再携带同一个 `through` 翻完逐笔 REST 页。W2a REST 的日期参数只匹配交易所时间。缺少交易所时间的记录按接收时间筛选，再从已验证 WAL 按位置合并，界面显示实际扫描范围。盘口有结束日时用该日午夜前一纳秒作为 `as_of`。默认视图和日期筛选共用重建规则，快照和连续增量跨越单个 REST 页时，从已验证 WAL 重放至选定位置，再建立实时订阅。完全早于对应采集起点的区间跳过该细节请求。调整日期时取消旧读取。[日期与覆盖语义](../features/market/README.md#数据类别与覆盖)

[同源行情 WebSocket](marketWebStream.ts) 读取 `/api/v1/stream/market` 的 F1 帧和 web 控制帧；用 WAL checkpoint 续接，使用 bigint 校验分区序号，快照后才应用连续盘口增量。断连、缺口或重置时清除盘口，重新用 REST 与 WAL 建立快照。原生 EventSource 读取 `/api/v1/events` 的 `permissions` 与 `reset`；权限撤回清除可见数据、关闭两个流并取消 REST。合成适配器用于显式回放和测试。契约锁定于 web `9132c5dc2e40f94d96151fbcc2989abbbb53d778`。[生成流程](../../docs/build.md#更新生成客户端)

## 期权视图适配层

[OptionsDataAdapter](../features/options/optionsData.ts) 定义浏览器内部视图接口。两页通过 `underlyings` 获取可选标的，用 `read(underlying, signal)` 读取含来源、流水与敞口的快照。切换标的或卸载时取消读取并丢弃迟到结果。允许两块内容独立为空，区分读取失败、确认无数据、未知分母和未评估 flip。十进制读数用经过验证的普通十进制字符串，时间以 UTC 字符串传入，交易业务日和 OI 基准日用独立日期。当前快照完整提供可浏览的合成结果，筛选在浏览器内进行。

生产路由调用 W2a 的流水或敞口端点，按响应呈现 `finance_contract_pending`。含证据、历史核验、GEX 与网格的 U2b 界面可经 `?market=replay` 查看。正式数据待 finance 期权契约接入。[合成数据](../features/options/README.md)

## 研究工作台适配层

策略、因子与配置作业通过 [ResearchAdapter](../features/research/adapter.ts) 读取合成 fixture。W2b 接入时，在此请求边界复用生成客户端并把 web 响应转换为页面模型。[接口和接入约定](../features/research/README.md)

## U4 适配层

[W3 通知](notificationsWeb.ts)、[W4 集成](integrationsWeb.ts) 和 [W4 备份及质量](recoveryWeb.ts) 使用同一个生成的 web 客户端。管理员使用同源会话，写入带 Origin 与 CSRF。规则和集成更新携带引号包住的 revision，邮件测试携带 UUID 幂等键。

集成从 catalog 读取允许标的和部署配置槽。测试绑定候选版本与 scoped test ID。失败和生产者 `adapter_unavailable` 展示为测试结果，原活动配置继续显示。启用使用最新通过的测试 ID，回滚使用 web 列出的版本。超时先检查服务端 revision 与最新测试，前端不自动重放写入。读取模型只保留凭据版本和轮换时间，界面使用固定掩码。

备份与质量接口需要管理员会话。Drive 恢复点年龄使用 web 按当前时刻计算的 `age_seconds`，告警使用 `alert`。`observed_at` 是状态文件修改时间，只用于展示，文件停止更新时服务端年龄仍会增长。web 以精确时长判定严格超过 3600 秒，再返回整秒年龄。返回 3600 秒且告警开启、生产者未降级时，界面显示超时。缺失、降级和停用分别展示。系统页展示 web 的综合告警。历史 `backup_stale` 事件只有在同一水位判定确认超时时才标为持续。仅有降级或缺少恢复点时，历史事件保留在完整列表，并排除在持续告警筛选之外。当前水位未告警、无法核验和 W3 恢复事件分别展示。缺口翻页比较快照时间，变化时回首屏重读。WAL 位置和计数保留十进制文本。

锁定快照中的 `MarketWatermarks` 名称也用于 W2a 包装结构。W4 `/quality/gaps` 的实际响应仍直接嵌入水位，恢复适配器兼容两种形状并保留十进制文本。

W3 的收件地址和邮件静默策略由 web 配置。主动静默和解除静默等待相应接口。[合成实现](operationsFixture.ts) 只在测试或故事中显式注入。升级契约使用 [生成流程](../../docs/build.md#更新生成客户端)。
