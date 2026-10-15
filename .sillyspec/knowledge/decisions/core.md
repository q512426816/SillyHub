# 决策知识 — core

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-server-db-pool-tuning
锚点：未记录
最近确认：e3bca7777d2c72a74e7292e1c5b98326478a7a61
理由：最大风险：把服务器池调太小导致高峰期请求排队等连接（`pool_timeout=30s` 后抛超时）。缓解：服务器配 5+10=15 上限，对当前低负载（load 0.29、13 idle 已是历史峰值水位）足够；真不够时改 `.env` 重启即可，无需改代码。放弃的方案：a) 直接把默认值改成 5——会改变开发机/大机器行为，且注释说明 20 是按 multi-agent 负载（daemon websocket + mission 轮询 + worker 回调并发）调的，砍默认值风险大于收益；b) db.py 里 `os.getenv` 直读——违反 config.py 模块规约；c) 非法值静默回退默认——掩盖配置错误，运维难察觉（本仓库 .env 手工维护，错值静默等于埋雷）。
