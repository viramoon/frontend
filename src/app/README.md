# 应用组合

[AppRoutes](routes/AppRoutes.tsx) 提供主导航及页面路由。[main.tsx](../main.tsx) 安装 BrowserRouter、QueryClientProvider 和 [样式](styles.css)。测试可传独立 QueryClient 与内存路由。

移动端导航与桌面使用相同链接，当前导航项有 `aria-current`，键盘可以从页首跳至主内容。应用在仪表盘和系统页显示 web 状态，行情终端另外标明 fixture。系统状态和示例回测的加载提示采用静态符号与文字，使用 `role="status"` 通知辅助技术。
