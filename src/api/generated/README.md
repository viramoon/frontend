# 生成的 web 客户端

Hey API 0.99.0 从 web 的 OpenAPI 生成 TypeScript 类型、Fetch SDK 和 TanStack Query 查询选项。生成器保留此说明，其余文件仅通过脚本更新。

在 frontend 根目录执行 `pnpm install --frozen-lockfile`。更新来源时，从已取回的 web 提交实际导出契约：

```sh
scripts/gen-web-client.sh from-web ../web "$(git -C ../web rev-parse HEAD)"
```

[web.commit](../../../openapi/web.commit) 记录完整提交，[web.openapi.json](../../../openapi/web.openapi.json) 保留导出字节。单仓执行 `pnpm generate:client` 可离线使用已安装的生成器和冻结输入。已有总仓导出时，可运行 `scripts/gen-web-client.sh from-snapshot ../contracts/web.openapi.json <完整的web提交>`。

`pnpm check:client` 在临时目录重复生成并比较整棵目录。在 fertile 的 frontend 子模块内运行 `pnpm check:client ../contracts/web.openapi.json` 还会逐字节验证总仓契约。页面使用 `src/api` 的统一入口。WebSocket / SSE 协议见 [架构说明](../../../docs/architecture.md)。
