---
author: flow-machine-draft
created_at: 2026-10-11T14:28:40.364Z
---
# 决策记录（Decisions）— 2026-10-10-duration-api-cumulative-fix

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是各 CLI 构建的 duration_api_ms 语义不一（真 Anthropic 可能为 per-query 纯 API 时长）——差分逻辑对「真 per-query」值也正确（第二轮起 snapshot≥base 时差值=snapshot−base 会把 per-query 值误差分！）。缓解：差分仅在 snapshot ≥ base 时做，per-query 形态下 snapshot 无单调性（12s→9s 走复位分支报 全量）→ 不会误差分；单调递增的 per-query 序列理论上会被误差分，但 DB 实证本 部署形态是累计量，真 per-query 序列含工具等待通常非单调——留档该假设。 放弃方案：仅做 backend 守卫不做 daemon 差分（守卫后合法累计增量被整段拒收， 正确数据也进不来）；仅做 daemon 差分不做 backend 守卫（防线单薄，其他引擎再犯 无兜底）。
