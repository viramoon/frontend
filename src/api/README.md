# API 生成边界

[generated](generated/README.md) 由 Hey API 从 fertile contracts/web.openapi.json 生成，包含所选 TanStack Query 插件产物。运行时配置统一由 [lib](../lib/README.md) 注入，整个应用只有一个 API client 实例。

本层不直接连接 finance，不手写另一套协议或在功能里创建请求实例。TBD：生成器版本、具体命令与输出结构，待真实 web 快照可用后验证。
