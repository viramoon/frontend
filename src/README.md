# 前端目录规划

本次只有说明文档，不创建 package.json 或任何 TS / JS 源码。React + TypeScript + Vite 单页应用按功能组织，页面只组合功能，禁止功能之间互相引用。

| 目录 | 边界 |
| --- | --- |
| [app](app/README.md) | 页面路由、provider 与应用组合 |
| [features](features/README.md) | trading / backtest / dashboard / blog 的内聚功能 |
| [api](api/README.md) | 生成客户端归属；generated 禁止手改 |
| [lib](lib/README.md) | 唯一 API client 与实时流封装 |
| [components](components/README.md)、[hooks](hooks/README.md) | 无功能依赖的通用 UI 与 hook |
| [stores](stores/README.md) | 必要的共享客户端状态 |
| [config](config/README.md) | 允许公开的浏览器配置 |
| [types](types/README.md)、[utils](utils/README.md) | 稳定共享类型和无业务依赖工具 |
| [testing](testing/README.md) | 隔离的测试支持规划 |

依赖方向：app → features → 共享目录；共享目录不能反向依赖 features，功能间不能导入。所有 HTTP 调用只面向 web，见 [架构](../docs/architecture.md)。
