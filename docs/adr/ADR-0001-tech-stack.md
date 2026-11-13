# ADR-0001：前端技术栈与功能边界

状态：已采纳（设计，尚未实现）

依据：issue #1 方案 v2

适用范围：frontend

## 决策

采用 TypeScript + React + Vite SPA，按功能组织 src/features/<功能>，每个功能规划 api / components / hooks / types；app 页面只组合功能，禁止功能之间互相引用。

HTTP 客户端使用 Hey API（@hey-api/openapi-ts）加 TanStack Query 插件，从 fertile contracts/web.openapi.json 生成，产物禁止手改。全局只有一个 API client，frontend 只调用 web。实时消息协议另定，不依赖 OpenAPI 覆盖。

构建后的静态文件由 web（axum）托管，不起独立服务，不保留 v1 的 service.yaml。

## 理由与后果

参考 [bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) 保持功能内聚；生成客户端减少接口漂移，TanStack Query 统一服务端状态；静态托管减少云电脑进程和隧道。需要验证生成流程、精度、功能依赖方向、缓存和实时恢复。

TBD：工具版本、生成命令、实时协议和构建交付方式，在实现 issue 确认。当前无源码或构建依赖文件。
