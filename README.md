# frontend

fertile 的前端界面与 submodule。采用 React + TypeScript + Vite SPA，按功能组织。API 由 web 同源提供，构建静态文件也由 web 托管。

`/dashboard` 提供带 fixture 标记的行情终端，可搜索自选、切换 K 线周期，查看成交量、报价和数据来源。系统状态和示例回测也可在 `/system` 查看。`/backtests` 可从已导入的日线数据中选择标的，填写日期、均线周期和股数，提交后查看作业状态、覆盖区间和成交审计。其余入口和后续接入计划见 [页面地图](docs/architecture.md#页面与功能)，操作与异常恢复见 [运行手册](RUNBOOK.md)，开发流程见 [AGENTS.md](AGENTS.md)。

## 本地启动

在仓库根目录加载 fertile 的工具链，执行下列命令。启动 web 后，浏览器打开 Vite 输出的本地地址即可查看仪表盘。

```sh
source /home/box/fertile/env.sh
pnpm install --frozen-lockfile
pnpm dev
```

开发服务器默认将 `/api` 与 `/healthz` 代理到 `http://127.0.0.1:8090`。盒子上的 web 同样监听 `127.0.0.1:8090`，现有站点使用 `8080`，公网入口 `https://fertile.viramoon.com` 由 Ruler 管理。构建和部署验证见 [运行手册](RUNBOOK.md)。

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
├── src/                    应用、页面与测试
│   ├── app/routes/         页面、provider 与 router
│   ├── features/           market / trading / backtest / dashboard / blog
│   ├── api/generated/      Hey API + TanStack Query，禁止手改
│   ├── lib/                通用设施说明
│   └── components/ hooks/ stores/ config/ types/ utils/ testing/
├── docs/                   架构、实时协议占位、构建与 ADR
└── .github/                模板、文档检查与前端 CI
```

目录中的 README 说明职责和边界。src/api 是页面请求入口，客户端由锁定的 web 契约生成。

## 文档索引

- [AGENTS.md](AGENTS.md)：开发流程与硬规则
- [docs/README.md](docs/README.md)：知识放置、系统约定与文档索引
- [功能、数据与实时边界](docs/architecture.md)
- [构建与 web 托管](docs/build.md)
- [技术栈决策](docs/adr/ADR-0001-tech-stack.md)
- [目录索引](src/README.md)
- [功能边界](src/features/README.md)
- [生成客户端](src/api/generated/README.md)
- [请求入口](src/api/README.md)
- [发布与回滚手册](RUNBOOK.md)

## 协作与检查

一个任务对应一个 issue，使用 issue-<号>-<简述> 分支和 PR，CI 通过后合并，禁止直接推送 main。PR 需含 Closes #<号>、测试结果和逐条验收自检；开发问题在原分支解决，文档随行为在同一 PR 更新。文档 CI 检查必需文件、非空内容、YAML、相对链接及 PR 描述，前端 CI 验证类型、格式、lint、生成结果、组件测试与生产构建。

克隆后按[运行手册](RUNBOOK.md#安装提交与推送钩子)启用本地 Git 钩子。行情渲染测试使用可追溯的合成数据，截图只保留在测试进程内存中。[行情样本与截图防护](docs/data-guard.md)
