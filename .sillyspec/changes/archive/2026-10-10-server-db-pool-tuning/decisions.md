---
author: flow-machine-draft
created_at: 2026-10-10T15:25:30.056Z
---
# 决策记录（Decisions）— 2026-10-10-server-db-pool-tuning

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：把服务器池调太小导致高峰期请求排队等连接（`pool_timeout=30s` 后抛超时）。缓解：服务器配 5+10=15 上限，对当前低负载（load 0.29、13 idle 已是历史峰值水位）足够；真不够时改 `.env` 重启即可，无需改代码。放弃的方案：a) 直接把默认值改成 5——会改变开发机/大机器行为，且注释说明 20 是按 multi-agent 负载（daemon websocket + mission 轮询 + worker 回调并发）调的，砍默认值风险大于收益；b) db.py 里 `os.getenv` 直读——违反 config.py 模块规约；c) 非法值静默回退默认——掩盖配置错误，运维难察觉（本仓库 .env 手工维护，错值静默等于埋雷）。
