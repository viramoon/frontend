# 应用组合层

负责 router、provider、页面和顶层错误边界；页面只组合 features 与共享 UI，不重复实现功能请求。路由说明见 [routes](routes/README.md)。

统一挂载 TanStack Query provider 和唯一 API client，鉴权与公共配置由共享边界输入。TBD：页面路径、权限门禁、布局与 provider 顺序，由具体功能 issue 确定。
