# frontend 架构

采用 React + TypeScript + Vite 单页应用。frontend 是 fertile submodule，只调用 web 的交易、回测、看板和博客 API，不直接连接 finance。产物由 web（axum）托管，不单独起服务，也不提供独立 service.yaml 或 /healthz。

## 页面与功能

| app 页面职责 | 功能 | web API 组 |
| --- | --- | --- |
| 交易状态与受控操作组合 | trading | 交易；具体路径、权限与交互 TBD |
| 回测任务与结果组合 | backtest | 回测；进度与结果协议 TBD |
| 数据看板组合 | dashboard | 看板；刷新、数据时间和陈旧标识 TBD |
| 博客阅读与受控写入组合 | blog | 博客；模型和发布权限 TBD |

每个功能含 api / components / hooks / types 的说明。禁止功能之间互相引用；app 负责组合，features 只依赖自身和共享目录。参考 [bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)，代码与公开入口在未来 issue 明确。

## 请求、状态与刷新

全局只有一个 API client，由 lib 配置。Hey API（@hey-api/openapi-ts）加 TanStack Query 插件消费 fertile contracts/web.openapi.json，输出 src/api/generated，禁止手改。TanStack Query 管理服务端缓存；查询键按功能 / 资源 / 参数分组，写成功后只失效相关查询。刷新间隔、staleTime、退避和重连重拉策略 TBD，按真实数据新鲜度确定，不将缓存命中视为最新行情。

客户端共享 store 只保存界面状态，不保存第二份服务端真相。价格、数量、金额展示保留协议精度；交易写超时先查状态，不自动盲重发。具体交互与权限由接口和功能需求验证。

## 实时消息与陈旧提示

WebSocket / SSE 不在 OpenAPI 范围内，消息协议单独约定。TBD：选择 WS 或 SSE、消息版本、事件类型、标的 / 频道、精确数值编码、事件时间与接收时间单位、序列号 / 恢复游标、快照与增量、错误和重连恢复语义。以上只是设计字段，不创建假消息 schema。

界面显示数据来源时间、连接状态和“行情陈旧”提示；缺口、断线或超阈值时保留最后更新时间，受影响操作应按权限与风控规则限制。阈值、告警样式和恢复交互 TBD；是否可交易最终由 finance 风控决定，UI 不能用刷新清除错误来宣称恢复。

构建、托管与 tag 追溯见 [build.md](build.md)，系统约定见 [README](README.md)。
