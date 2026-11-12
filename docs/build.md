# Vite 构建与 web 托管（设计）

当前没有 package.json、构建配置或 TS / JS 源码；构建命令与依赖锁定为 TBD，由首个实现 issue 补齐。

## 产物约定

规划 Vite 输出 `dist/index.html` 和 `dist/assets/<名称>-<内容摘要>.<扩展名>`；产物记录 frontend commit、输入 web OpenAPI 快照版本、工具链与文件摘要。TBD：元信息文件格式、源码映射发布策略、构建命令和具体快照路径，实施前验证。dist 产物不提交为源码。

## 交给 web

按选定 fertile tag 的 frontend 指针构建，经摘要与完整性检查后交付 web 的版本化静态目录；路径由 web 配置读取，默认在 /home/box 下，不能硬编码系统目录。web 托管 index 与 assets，带摘要资源长期缓存，入口短缓存 / 重新验证，具体时长 TBD。SPA 页面回退不覆盖 API、健康或缺失资源。

没有独立 frontend 服务、端口、隧道或健康端点。健康与外部端到端检查由 web / fertile 负责，构建产物设计由 [web static](https://github.com/viramoon/web/tree/main/src/static) 与 fertile deploy/ 引用。

## 发版关系

只有 fertile 对外带版本。发布更新 frontend 指针并与 web、契约一起集成，Maas · Ruler 按 fertile tag 部署和回滚匹配的 web 与静态资源。TBD：实际构建 / 打包 / 原子切换实现，在后续发版 issue 确定；规则只引用 [fertile docs/release.md](https://github.com/viramoon/fertile/blob/main/docs/release.md)，不另建前端发版规则。
