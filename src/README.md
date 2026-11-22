# 前端目录

React、TypeScript 与 Vite 组成单页应用。入口 [main.tsx](main.tsx) 安装 BrowserRouter 与 TanStack Query；[app/routes](app/routes/README.md) 将四个 feature 组成为工作台。

| 目录 | 职责 |
| --- | --- |
| [app](app/README.md) | 主导航、路由、布局及响应式样式 |
| [features](features/README.md) | trading、backtest、dashboard、blog，各自维护页面 |
| [api](api/README.md) | 配置一个同源客户端、导出已生成的查询选项与类型 |
| [components](components/README.md)、[hooks](hooks/README.md) | 公共 UI 与 hooks 的组织位置 |
| [stores](stores/README.md)、[config](config/README.md) | 共享客户端状态和公开配置的组织位置 |
| [lib](lib/README.md)、[types](types/README.md)、[utils](utils/README.md) | 公共工具和共享类型的组织位置 |
| [testing](testing/README.md) | 路由和仪表盘验收 |

features 只导入同功能或共享目录，循 [架构](../docs/architecture.md) 约定。HTTP 请求统一经 web 提供的接口。
