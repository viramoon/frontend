# 前端目录

React、TypeScript 与 Vite 组成单页应用。入口安装 BrowserRouter 与 TanStack Query，由 app 路由组合行情终端、系统状态、回测和各页面入口。[main.tsx](main.tsx) · [路由结构](app/routes/README.md)

| 目录 | 职责 |
| --- | --- |
| [app](app/README.md) | 主导航、路由、布局及响应式样式 |
| [features](features/README.md) | 行情、交易、回测、系统状态和博客的业务数据及界面 |
| [api](api/README.md) | 配置一个同源客户端、导出已生成的查询选项与类型 |
| [components](components/README.md)、[hooks](hooks/README.md) | 公共 UI 与 hooks 的组织位置 |
| [stores](stores/README.md)、[config](config/README.md) | 共享客户端状态和公开配置的组织位置 |
| [lib](lib/README.md)、[types](types/README.md)、[utils](utils/README.md) | 公共工具和共享类型的组织位置 |
| [testing](testing/README.md) | 路由、行情终端、系统状态和回测验收 |

features 只导入同功能或共享目录，循 [架构](../docs/architecture.md) 约定。HTTP 请求统一经 web 提供的接口。
