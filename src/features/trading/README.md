# trading 功能

负责交易状态与受控操作；页面由 app 组合，不导入其他功能。只通过全局唯一 client 调用 web 的对应接口，具体路由、权限和交互 TBD，由独立功能 issue 确认。

[api](api/README.md) 封装查询边界，[components](components/README.md) 放专属 UI，[hooks](hooks/README.md) 组合状态，[types](types/README.md) 放专属类型。本次无实现。
