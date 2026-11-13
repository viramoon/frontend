# 功能边界

四个功能：[trading](trading/README.md)、[backtest](backtest/README.md)、[dashboard](dashboard/README.md)、[blog](blog/README.md)。每个功能内规划 api / components / hooks / types，业务尽量内聚，页面由 app 组合。

禁止功能之间互相引用；共同能力抽到无功能依赖的共享目录，并在对应 issue 评审。功能 API 只封装唯一的全局 web client，不新建请求实例。TBD：每个功能的公开入口和接口细节，在后续功能 issue 中定义。
