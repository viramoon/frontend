# 页面路由

[AppRoutes](AppRoutes.tsx) 将 /dashboard、/trading、/backtests 和 /blog 分别映射到仪表盘、交易、回测及博客。首页 / 转到仪表盘，未知路径显示找不到页面与返回入口。所有页面使用同一主导航。

导航采用浏览器 History API。生产环境由 web 提供 SPA 回退，API、健康检查及缺失静态资源保留各自的 HTTP 语义。
