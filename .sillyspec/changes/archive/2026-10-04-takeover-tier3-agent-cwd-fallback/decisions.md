---
author: flow-machine-draft
created_at: 2026-10-04T14:14:09.394Z
---
# 决策记录（Decisions）— 2026-10-04-takeover-tier3-agent-cwd-fallback

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：回退扩大 tier3 命中面后，若两台在线机器白名单都覆盖该 agent_cwd，会从「409 无匹配」变成「409 歧义（列候选机器名）」——不静默换机的红线不变，只是拒因更准；真歧义时用户按文案清理白名单即可。试过放弃的方案：建桶/刷新时把 agent_cwd 回写会话行 cwd——只对未来上报生效，存量会话（如线上 7ea5177a，已不会再被旧 CLI 重推）救不了，且给 ingest 增加一条写路径；协议 §4 的口径本就是 entry 级匹配，故弃。
