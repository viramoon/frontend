# 前端组件测试

从仓库根目录运行 `pnpm test`。Vitest 在 jsdom 中启动 React，Testing Library 通过页面角色、文本和导航链接读取用户可见的结果。每个用例独立创建 TanStack Query 客户端，结束时清理视图和缓存。

仪表盘测试使用正式路由和生成的 web 客户端，仅替换同源 HTTP 响应。覆盖等待、下游出错、单个请求失败时保留另一部分数据、示例 404、完整结果以及四个页面间的导航。成功用例逐字检查长十进制金额，并核对客户端实际请求的地址。[组件用例](dashboard.test.tsx)

浏览器访问实际 web 服务的代理配置和构建步骤见 [构建说明](../../docs/build.md)。

行情终端测试在 jsdom 下检查 fixture、状态标记和来源。图表用例验证精确读数、交互及 Canvas 不可用时的降级。路由用例覆盖新旧深链、策略详情和导航。实际 Canvas 和抽屉焦点可按运行手册在浏览器验证。[终端测试](market.test.tsx) · [图表测试](chart.test.tsx) · [路由测试](routes.test.tsx) · [终端验收](../../RUNBOOK.md#验证行情终端)
