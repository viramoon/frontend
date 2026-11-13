# frontend 运行手册（设计）

本仓库只规划静态产物，无可运行前端服务。构建与生成命令、交付方式、缓存及回滚验证为 TBD。具体产物见 [build.md](docs/build.md)，部署以 fertile deploy/ 为唯一准绳，只按 fertile tag 交付和回滚。

## 构建与发布

确认 tag 对应 frontend、web 和 OpenAPI 快照 → 用锁定的 Hey API 工具生成客户端 → 运行相关验证和 Vite 构建 → 记录 frontend commit 与摘要 → 把 dist 交给 web 的配置化版本目录 → 验证后切换 → 公网检查页面、API、资源与刷新。TBD：具体命令、产物元信息及自动化实现。

## 回滚与常见问题

| 场景 | 处理设计 |
| --- | --- |
| 客户端与 web 不兼容 | 核对输入快照、生成工具与 frontend 指针，不手改生成文件；按 fertile tag 恢复兼容组合 |
| 静态资源 404 或旧缓存 | 核对版本目录、资源摘要、index 缓存和 SPA 回退；不以清空所有缓存代替定位问题 |
| 刷新页面失败 | 检查 web 的页面回退，确保不吞 API / 健康 / 资源错误 |
| 行情陈旧或实时断开 | 显示时间和陈旧状态，检查 web 数据流；不直接连 finance，不宣称 UI 重连代表交易恢复 |
| 需要回滚 | 由 Maas · Ruler 选择已验证 fertile tag，同步恢复匹配 web 与静态资源，检查缓存和外部可达性 |

不启停单独 frontend 进程，没有独立 /healthz。现网问题记录 fertile tag、浏览器证据、web 状态与原 issue；开发分支内问题在原分支修复。
