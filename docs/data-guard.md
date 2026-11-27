# 行情样本与截图防护

v1 的付费数据、真实行情及衍生样本、截图、录屏、数据库和日志导出留在获准的私有环境。GitHub 仓库、PR、issue、LFS 和 CI artifact 均在该数据边界之外。前端测试使用合成输入或以合成数据生成的本地回放。IBKR 实际接入限 paper 只读，前端测试无需账户或券商连接。现有回测提交是历史仿真入口。

## 合成来源

| 种子 | 生成方式 | 使用位置 |
| --- | --- | --- |
| `market-terminal-v1` | 固定的虚构基价、价格步长、48 个收盘偏移及成交量公式。U2a 的扩展标的按数值种子用 32 位线性同余序列扰动偏移。以固定 UTC 时钟生成 1 小时 K 线及报价，以 BigInt 聚合 4 小时 K 线。价格和数量分别以十进制字符串保存精度。 | 终端、自选列表、精确读数、组件与浏览器渲染测试 |
| `options-terminal-v1` | SPY 和 AAPL 分别使用 1801 和 1802 的 32 位线性同余序列，由 BigInt 生成虚构报价、流量、IV、gamma、权利金和 GEX。时钟、OI、缺口与条件码由代码设定，flip 由合成情景网格点推导。QQQ 使用固定空态。 | 期权流水、敞口、组件和离线浏览器测试。[期权生成器](../src/features/options/optionsFixture.ts) |
| W2a 测试 WAL | 固定 UTC 时间和虚构的 SYNTH.XNAS 定点价格与数量，按位置生成事件和超过安全整数的序号，含分离的交易所、接收及首次可用时钟，无交易所时间的逐笔，以及跨页盘口与逐笔的固定位置用例。完全替换 HTTP、WebSocket 和 SSE。 | 正式路由接入用例。[测试生成器](../src/testing/market-web.test.tsx) |
| U3 合成研究 | finance `b21f241` 的三份配置样例与仓库内的固定演示结果，生成方式见 [研究工作台](../src/features/research/README.md)。 | 策略配置校验、因子报告和作业恢复 |
| `u4-operations-v1` | 手工定义权限、投递、恢复和采集状态，以 UTC 2000-01-03 12:00 为基准加减固定时长。 | 离线用例，使用显式注入的合成适配器。无提供商样本、邮箱地址或密钥。 |

种子的全部原始参数都在代码内可审查。回放适配器生成合成指标、盘口事件和逐笔，和 OHLCV 生成器分别登记。新增测试样本时，提交生成器及来源说明，列明种子、算法和数据范围，并在检查器登记生成器路径。变更来源由代码审查核对。视觉用例从终端的 `data-fixture-seed` 和可见的 Fixture 标记验证来源。[合成生成器](../src/features/market/marketFixture.ts) · [回放适配器](../src/features/market/fixtureAdapter.ts) · [U4 合成实现](../src/api/operationsFixture.ts) · [登记与校验](../scripts/check-data-guard.mjs)

U3 的首个提交早于 UG 合并。历史范围检查使用首个提交的 SHA 与六个已核对的 blob ID 识别其来源。暂存区及后续快照要求源文件标记，所有快照继续检查正文和数据特征。

## 浏览器测试

渲染用例用 `?market=replay` 显式进入回放，只读取本地 `dist` 的页面、脚本和样式，系统状态及示例回测接口分别返回固定的 503 和 404。Playwright 在浏览器上下文内完成全部路由响应，拒绝其他 HTTP 方法、地址和 WebSocket，阻止 service worker 和下载。测试用的 origin 走内存拦截，浏览器禁用代理和主机名解析。

宽屏用例验证 K 线 Canvas、周期切换和合成报价，窄屏用例验证抽屉中的合成报价、键盘焦点和采集前的盘口提示。两种视口的 PNG 只在内存验证签名和尺寸。CI 禁止保存或上传截图、录屏、trace 和测试报告。私有环境留存获准的资料时，使用工作树外的私有目录。[渲染用例](../scripts/visual-market.test.mjs)

期权浏览器用例沿用同一内存路由拦截，核对种子和首屏摘要、情景切换、移动端的证据键盘操作及表格溢出。期权只读取构建静态资源。

## Git 对象检查

| 入口 | 检查范围 | 生效的白名单 |
| --- | --- | --- |
| `pre-commit` | Git 索引中的路径和暂存 blob。 | 当前 `HEAD`。 |
| `pre-push` | 每个非删除 ref 的待推送提交和 tip。缺少可用的历史边界时扫描全部可达提交。 | 推送远端在本机记录的 `main`。推送目标为 `main` 本身时，使用远端报告的更新前 SHA。 |
| 前端 CI | 检查基准之外的提交和检出的 tip，包括后来删除的内容。PR 的 tip 为 CI 合并结果。 | PR 的目标基准 SHA。push 事件使用更新前 SHA。 |

找不到可信基准时，白名单为空。一次范围检查始终使用同一基准，推送过的功能分支提交也不会为同一 PR 授权。待检查的白名单发生变更会输出 `allowlist-change`，有效的清单变更可以独立提交和审查。新增或修改的条目只在进入对应可信基准后授权文件。文件内容仍按实际 Git blob 匹配 SHA-256。

检查器以稳定规则名和转义后的路径报告违规，不回显 blob 内容。每个 blob 上限为 256 KiB。普通放行要求文件是已知源码、配置或文档类型，正文为 UTF-8 纯文本，同时通过文件特征检查。识别项包含带 XML 序言的 SVG、XPM、XBM 和 Netpbm 光栅，改名后仍会检查正文。二进制、媒体和无法归类的文件默认拒绝。数据、截图、录屏和报告目录受路径规则保护。LFS 指针和常见行情导出也会被拦截。具名 fixture、sample 和 replay 源须有登记及可审查的合成来源。

检查器用锁定的 YAML 解析器读取工作流和仓库任意目录中的 `action.yml` 或 `action.yaml`，检查有效的 `uses` 字段。遇到 `./` 引用时，从同一个 Git 快照查找本地 composite action 或声明了 `workflow_call` 的工作流，最多跟随 8 层引用。缺失、歧义、越出仓库、YAML 无法解析、循环和超深引用均会失败。GitHub artifact 与 release asset 的上传动作在这些定义中会被拦截。

本地钩子依赖每个克隆启用，CI 负责阻止违规变更合并。GitHub 网页附件和手工粘贴由提交者遵守同一数据边界。FG、WG、TG 可对齐检查维度、违规规则名称、合成来源登记及日志约定。[钩子安装](../RUNBOOK.md#安装提交与推送钩子)

## 文件白名单

确需提交获准分发的静态资产时，先合入仅包含白名单更新的 PR，再通过后续 PR 提交文件。

1. 核对来源和分发许可。白名单适用于图标、第三方许可证等获准文件。真实行情、衍生样本和截图仍受 v1 数据边界约束。
2. 在工作树外用 `sha256sum` 计算文件摘要。在清单写入仓库相对路径 `path`、64 位小写十六进制 `sha256` 和说明来源及用途的 `source`。第一个 PR 只提交这项清单更新，由维护者核对来源及摘要。
3. 清单 PR 合入后，从包含批准记录的目标分支开始后续 PR，再加入文件并运行 `node scripts/check-data-guard.mjs --staged`。改名或改内容须重新审批。工作流、本地 action 和行情 fixture 继续走各自的规则。

[白名单清单](../scripts/data-guard-allowlist.json)

## 本地复测

```sh
node scripts/check-data-guard.mjs --staged
node scripts/check-data-guard.mjs --range origin/main HEAD
node --test --test-isolation=none scripts/check-data-guard.test.mjs
pnpm test
pnpm build
pnpm test:visual
```

浏览器用例使用已安装的 Google Chrome。前端 CI 同时执行契约再生成校验、类型检查、lint、格式检查与构建。frontend 静态文件由 web 托管，服务清单由 fertile 维护。[构建说明](build.md)
