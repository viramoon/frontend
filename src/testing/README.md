# 前端组件测试

从仓库根目录运行 `pnpm test`。Vitest 在 jsdom 中启动 React，Testing Library 通过页面角色、文本和导航链接读取用户可见的结果。使用查询的用例各自创建 TanStack Query 客户端，并在结束时清理视图和缓存。

仪表盘测试使用正式路由和生成的 web 客户端，仅替换同源 HTTP 响应。覆盖等待、下游出错、单个请求失败时保留另一部分数据、示例 404、完整结果以及四个页面间的导航。成功用例逐字检查长十进制金额，并核对客户端实际请求的地址。[组件用例](dashboard.test.tsx)

浏览器访问实际 web 服务的代理配置和构建步骤见 [构建说明](../../docs/build.md)。

行情终端测试在 jsdom 下检查 fixture、状态标记和来源。图表用例验证精确读数、交互及 Canvas 不可用时的降级。[终端测试](market.test.tsx) · [图表测试](chart.test.tsx)

Git 防护测试在临时仓库生成合规和违规样本。浏览器渲染用例单独使用本地构建，检查宽屏与窄屏渲染。执行方式见[防护本地复测](../../docs/data-guard.md#本地复测)。

路由用例覆盖新旧深链、策略详情及系统和示例回测的 404 处理。键盘用例用 Testing Library 的 user-event 模拟 `Tab` 和 `Enter`，验证焦点顺序和导航结果。焦点样式用例将实际样式表的 `:focus-visible` 映射为 jsdom 支持的 `:focus`，再检查计算出的轮廓。在浏览器中验收实际 Canvas、焦点轮廓和窄屏抽屉焦点。[路由测试](routes.test.tsx) · [终端验收](../../RUNBOOK.md#验证行情终端)

U2a 覆盖十二个自选标的、SPY 的 L1 限制、marketDataType 与独立新鲜度、市场时区与周期持久化、合成指标列、Binance 部署开关和区域限制、深度额度、盘口失同步、恢复与迟到事件。订单簿单元测试使用超过 JS 安全整数的序号和价格。[U2a 行情用例](market-u2a.test.tsx) · [订单簿状态用例](order-book.test.ts)
