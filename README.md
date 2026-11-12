# frontend

fertile 的前端界面与 submodule。采用 React + TypeScript + Vite SPA，按 trading / backtest / dashboard / blog 功能组织，只调用 web；构建静态文件由 web 托管，不独立起服务。

本仓库按 [issue #1 方案 v2](https://github.com/viramoon/frontend/issues/1#issuecomment-6834604707) 初始化。目前只有中文文档、组织结构与最小文档检查 CI，没有业务实现；TBD 项都需后续 issue 明确后再实施。开发从 [AGENTS.md](AGENTS.md) 开始。

## 系统中的位置

| 仓库 | 在 fertile 系统中的职责 |
| --- | --- |
| [fertile](https://github.com/viramoon/fertile) | 金融看板 + 自动交易系统的总仓库；初始化、集成、监控、运维和发布 |
| [finance](https://github.com/viramoon/finance) | 主项目；基于 NautilusTrader 的策略、数据采集、交易、回测和 HTTP API |
| [web](https://github.com/viramoon/web) | axum 后端网关；调用 finance HTTP API，管理 PostgreSQL 业务与博客数据，托管前端静态文件 |
| [frontend](https://github.com/viramoon/frontend) | React + TypeScript + Vite 单页应用；只调用 web |
| [agent](https://github.com/viramoon/agent) | 独立的开发流程知识库；通用 skill、prompt、工作流、评估和复盘 |


系统关系、版本、契约、配置、健康和环境规则见 [docs/README.md](docs/README.md)。服务部署唯一来源是 fertile deploy/，agent 只分发知识；只有 fertile 对外发版，Maas · Ruler 只按 fertile tag 部署 / 回滚。
## 目录说明

```text
frontend/
├── README.md / AGENTS.md / RUNBOOK.md
├── .agents/skills/          本仓库专属 skill 约定
├── src/                    仅 README 的结构说明
│   ├── app/routes/         页面、provider 与 router
│   ├── features/           trading / backtest / dashboard / blog
│   │                       各含 api / components / hooks / types
│   ├── api/generated/      Hey API + TanStack Query，禁止手改
│   ├── lib/                唯一 API client 与实时封装
│   └── components/ hooks/ stores/ config/ types/ utils/ testing/
├── docs/                   架构、实时协议占位、构建与 ADR
└── .github/                模板与文档检查
```

目录中的 README 说明职责和边界。未来源码目录只含 README，不创建源码、构建配置或伪造生成文件。

## 文档索引

- [AGENTS.md](AGENTS.md)：开发流程与硬规则
- [docs/README.md](docs/README.md)：知识放置、系统约定与文档索引
- [功能、数据与实时边界](docs/architecture.md)
- [构建与 web 托管](docs/build.md)
- [技术栈决策](docs/adr/ADR-0001-tech-stack.md)
- [目录索引](src/README.md)
- [功能边界](src/features/README.md)
- [生成客户端](src/api/generated/README.md)
- [唯一 client](src/lib/README.md)
- [发布与回滚手册](RUNBOOK.md)

## 协作与检查

一个任务对应一个 issue，使用 issue-<号>-<简述> 分支和 PR，CI 通过后合并，禁止直接推送 main。PR 需含 Closes #<号>、测试结果和逐条验收自检；开发问题在原分支解决，文档随行为在同一 PR 更新。文档 CI 检查必需文件、非空内容、YAML、相对链接及 PR 描述，不编译业务代码；这不代表已经完成运行或真实交易验证。
