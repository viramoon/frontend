# 从 web 契约构建静态页面

从仓库根目录运行。Node 24.22.3 和 pnpm 12.18.0 与 fertile/deploy/toolchain.env 一致。pnpm-lock.yaml 锁定 React、Vite、TypeScript 和 Hey API 的依赖。

```sh
source /home/box/fertile/env.sh
pnpm install --frozen-lockfile
pnpm check:client
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

运行 `pnpm dev` 可从浏览器打开开发服务器。Vite 将 /api 和 /healthz 代理给本机 web。如需连接另一个本地实例，设置 `WEB_PROXY_TARGET=http://127.0.0.1:18080` 后再启动 Vite。生产构建使用同源相对路径，浏览器调用托管页面的 web。

## 更新生成客户端

```sh
web_sha=$(git -C ../web rev-parse HEAD)
scripts/gen-web-client.sh from-web ../web "$web_sha"
pnpm check:client
```

脚本从指定 Git 提交导出 web OpenAPI，用 Hey API 和 TanStack Query 插件生成 src/api/generated。openapi/web.commit 记录完整提交，openapi/web.openapi.json 保存该提交的代码导出。单仓更新使用 `pnpm generate:client`，CI 用 `pnpm check:client` 在临时目录再生成并核对。集成仓库可用 `scripts/gen-web-client.sh --check /path/to/contracts/web.openapi.json` 同时比较外部快照与生成结果。

## 将 dist 交给 web

`pnpm build` 产出 dist/index.html 和 dist/assets 中带摘要的脚本与样式。将完整 dist 作为同一批构建交给 web 的 WEB_STATIC_ROOT。web 对首页和 SPA 回落使用 no-cache，对带摘要的资源使用一年 immutable 缓存，缺失的资源返回 404。代码库只保存输入、源码和锁文件。

只有 fertile 对外发版。Ruler 使用总仓库的部署入口选择匹配的 web 和静态资源，检查后整体切换或回滚。详见 [fertile 发版规则](https://github.com/viramoon/fertile/blob/main/docs/release.md)。
