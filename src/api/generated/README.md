# 生成的 web 客户端

选型为 Hey API（@hey-api/openapi-ts）加 TanStack Query 插件。输入是 fertile `contracts/web.openapi.json`，输出在 `src/api/generated/`；禁止手改生成文件。README 是组织说明，不是生成产物。

TBD：输入快照的本地相对路径、工具锁定版本、生成命令和可重复校验，由首个接口实现 issue 确定。上游变更后更新 fertile 快照并重生成，通过差异与类型 / 集成检查；快照尚不存在时不制造空客户端。

WebSocket / SSE 消息不在 OpenAPI 范围内，单独协议见 [architecture.md](../../../docs/architecture.md)。
