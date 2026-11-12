# 浏览器公开配置

规划 web API 同源 / 公开地址、实时流地址、数据陈旧阈值与界面开关；不能包含 Gateway 凭据、数据库密钥或 finance 直连地址。浏览器只调用 web。

部署 profile 为 cloudbox / stable，与交易运行模式和账户独立；构建时或启动时注入公开配置的机制 TBD。运行目录与 /home/box 路径属于 web / fertile 配置，不能暴露为浏览器文件访问能力。
