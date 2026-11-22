# Web API 入口

[index.ts](index.ts) 配置唯一的 Hey API 客户端，baseUrl 取页面 origin；replay 或 paper 等运行模式由服务端决定。页面使用此模块导出的 statusOptions、sampleOptions 与契约类型。生成文件位于 [generated](generated/README.md)，通过项目生成命令更新。

TanStack Query 全局 staleTime 为 15 秒，界面不额外重试失败的读取。系统状态每 30 秒重新获取，也可用仪表盘的刷新按钮立即重新获取两项数据。HTTP 错误保留状态码和 web 错误代码；网络异常另行显示。示例接口 404 进入空结果界面。
