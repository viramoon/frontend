# 页面路由

页面组合 trading / backtest / dashboard / blog 的公开入口，功能之间不能互相导入。TBD：URL、登录门禁、导航与错误页面，待需求确认；此处不创建 router 源码。

SPA 刷新由 web 静态托管的页面回退支持；API、健康检查和不存在的静态资源不能被页面回退吞掉。
