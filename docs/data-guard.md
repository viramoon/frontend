# 行情样本与截图防护

v1 的付费数据、真实行情及衍生样本、截图、录屏、数据库和日志导出留在获准的私有环境。GitHub 仓库、PR、issue、LFS 和 CI artifact 均在该数据边界之外。前端测试使用合成输入或以合成数据生成的本地回放。IBKR 实际接入限 paper 只读，前端测试无需账户或券商连接。现有回测提交是历史仿真入口。

## 合成来源

| 种子 | 生成方式 | 使用位置 |
| --- | --- | --- |
| `market-terminal-v1` | 固定的虚构基价、价格步长、48 个收盘偏移及成交量公式。以固定 UTC 时钟生成 1 小时 K 线及报价，以 BigInt 聚合 4 小时 K 线。价格和数量分别以十进制字符串保存精度。 | 终端、自选列表、精确读数、组件与浏览器渲染测试 |

种子的全部原始参数都在代码内可审查。新增测试样本时，提交生成器及来源说明，列明种子、算法和数据范围，并在检查器登记生成器路径。变更来源由代码审查核对。视觉用例从终端的 `data-fixture-seed` 和可见的 Fixture 标记验证来源。[合成生成器](../src/features/market/marketFixture.ts) · [登记与校验](../scripts/check-data-guard.mjs)

## 浏览器测试

渲染用例只读取本地 `dist` 的页面、脚本和样式，系统状态及示例回测接口分别返回固定的 503 和 404。Playwright 在浏览器上下文内完成全部路由响应，拒绝其他 HTTP 方法、地址和 WebSocket，阻止 service worker 和下载。测试用的 origin 走内存拦截，浏览器禁用代理和主机名解析。

宽屏用例验证 K 线 Canvas、周期切换和合成报价，窄屏用例验证抽屉中的合成报价及键盘焦点。两种视口的 PNG 只在内存验证签名和尺寸。CI 禁止保存或上传截图、录屏、trace 和测试报告。私有环境留存获准的资料时，使用工作树外的私有目录。[渲染用例](../scripts/visual-market.test.mjs)

## Git 对象检查

| 入口 | 检查范围 |
| --- | --- |
| `pre-commit` | Git 索引中的路径和暂存 blob。 |
| `pre-push` | 每个非删除 ref 的待推送提交和 tip。新 ref 或远端 tip 在本机不可用时，检查所有本机可达的提交。 |
| 前端 CI | 有基准时检查基准之外的提交和检出的 tip。PR 的 tip 为 CI 的合并结果。使用完整历史，因而会检查分支中已被后续提交移除的内容。 |

检查器以稳定规则名和转义后的路径报告违规，不回显 blob 内容。它拒绝数据、截图、录屏、报告等路径，限制每个 blob 为 256 KiB，拦截常见媒体与导出后缀、二进制签名、嵌入媒体、LFS 指针、改名的常见行情表和工作流中的 GitHub artifact 上传动作。具名 fixture、sample 和 replay 源须有登记及可审查的合成来源。路径与内容共同检查，因此扩展名改动或压缩也会纳入检查。

文本图像也按文件内容检查，覆盖带 XML 声明、导出注释的 SVG 和改名的 Netpbm 图像（如 ASCII PPM）。GitHub 工作流及本地 action 配置中的上传动作引用按字面名称拦截，涵盖 YAML 为 `uses` 键加引号的写法。

本地钩子依赖每个克隆启用，CI 负责阻止违规变更合并。GitHub 网页附件和手工粘贴由提交者遵守同一数据边界。FG、WG、TG 可对齐检查维度、违规规则名称、合成来源登记及日志约定。[钩子安装](../RUNBOOK.md#安装提交与推送钩子)

## 本地复测

```sh
node scripts/check-data-guard.mjs --staged
node scripts/check-data-guard.mjs --range main HEAD
node --test --test-isolation=none scripts/check-data-guard.test.mjs
pnpm test
pnpm build
pnpm test:visual
```

浏览器用例使用已安装的 Google Chrome。前端 CI 同时执行契约再生成校验、类型检查、lint、格式检查与构建。frontend 静态文件由 web 托管，服务清单由 fertile 维护。[构建说明](build.md)
