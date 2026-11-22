# frontend 运行手册

frontend 交付给 web 的产物是 dist/。在盒子运行服务时，Ruler 使用 fertile 的部署命令统一选择前后端构建。前端开发和本地验证步骤见 [构建说明](docs/build.md)。

## 验证 web 托管

在 web 启动前将 WEB_STATIC_ROOT 设为已完成构建的 dist 绝对路径。用本地入口检查静态文件、刷新回落和数据接口：

```sh
curl -fsSI http://127.0.0.1:8080/
curl -fsS http://127.0.0.1:8080/dashboard
curl -fsS http://127.0.0.1:8080/api/v1/system/status
curl -i http://127.0.0.1:8080/api/v1/backtests/sample
```

在浏览器进入仪表盘，核对 web 提供的数据库、finance 和行情状态，再核对示例回测摘要的币种与金额。依次打开交易、回测、博客并刷新。若检查生产公网入口，先核实 Ruler 配置的 public_origin。

## 故障与回滚

| 现象 | 检查和恢复 |
| --- | --- |
| API 失败 | 检查浏览器请求、web 状态端点及 request id。开发模式核对 WEB_PROXY_TARGET。 |
| 示例回测无结果 | sample 的 404 会显示空状态。在 finance 上按运行手册生成示例，再刷新页面。 |
| 刷新路由或资源 404 | 确认 web 指向同一份完整 dist，核对 index 引用的资源名和缓存头。 |
| 客户端与服务不匹配 | 比较 openapi/web.commit 与实际部署的 web 提交，运行 pnpm check:client。按同一组已验证的 fertile 指针恢复。 |
| 行情陈旧 | 查看仪表盘的数据源、更新时间和陈旧标的数。检查 finance collector、Gateway 或回放源。 |

回滚通过 fertile 的运行手册切换匹配的服务与静态资源。记录部署提交、浏览器访问路径、HTTP 状态、request id 和实际恢复时间。勿在浏览器存放管理员令牌或 IBKR 凭据。
