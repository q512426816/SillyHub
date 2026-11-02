---
author: flow-machine-draft
created_at: 2026-11-02T03:24:59.978Z
---
# 决策记录（Decisions）— 2026-11-02-daemon-resume-gate-fix

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是保留旧 `lastActiveAt` 后，显式启用 idle 回收（`SESSION_IDLE_TIMEOUT_SEC>0`）的部署会把刚恢复的会话立即回收——以 `restoredAt` 起算空闲时长封闭该路径（boot 恢复路径顺带修复既有同形态隐患）；默认关闭形态零影响。次风险：record-less 兜底 `Date.now()` 在「跨机移交全量 reopen」的罕见形态下仍可顶闸——接受（规模受 backend 24h GC 约束；彻底封死需协议加 last_active_at 字段，本期不做，留作后续升级位：daemon 已按 payload 显式值优先实现，backend 未来补发即生效，零 daemon 改动）。 放弃的方案：① 改闸计数口径（如排除「恢复后从未 inject」的会话）——需新增跨路径状态位且改动防风暴闸本体，风险面大于收益；改时间戳源头一处即闭环。② backend 全量恢复改分批/限速下发——治标不治本（30 分钟窗口仍在，只是推迟），且改动 backend 调度节奏牵连重连收敛时序。③ 用 `turnCount===0` 判恢复态——新会话首轮未完成前同为 0，误伤新建会话判据，弃。
