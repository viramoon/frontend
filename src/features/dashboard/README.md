# 仪表盘

[Dashboard](Dashboard.tsx) 通过 [api](../../api/README.md) 的查询读取系统状态与示例回测，分别处理加载、HTTP 错误和示例 404。状态面板显示 web 版本、提交、启动时间，数据库及 finance 延迟，熔断状态，行情来源、标的数量与陈旧数。业务时间以 UTC 展示，盈亏和币种直接使用接口文本。

浏览器将 JSON 数字解析为 JavaScript number。超过安全整数范围的计数显示“超出精确显示范围”，避免展示已舍入的值。查询数据、错误反馈及测试见 [架构](../../../docs/architecture.md) 和 [验收](../../testing/README.md)。
