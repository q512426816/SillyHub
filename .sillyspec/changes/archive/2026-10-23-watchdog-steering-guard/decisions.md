---
author: flow-machine-draft
created_at: 2026-10-23T08:42:17.505Z
---
# 决策记录（Decisions）— 2026-10-23-watchdog-steering-guard

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答： - 最大风险：`observedRunIds` 无界增长。用 256 上限 FIFO 驱逐；单个 UUID 约 36 字节，单会话上限约 9KB。 - 风险：同 runId inject 跳过 stale-reset 后，若 backend 重启导致旧 turn 已死但 currentRunId 残留，会不会永远不收敛？不会：该形态下不会布防看门狗，但 backend 的 pending run 300 秒清扫仍兜底；且真正的「新 run 被吞」runId 与残留 currentRunId 不同，仍会正常布防。 - 放弃方案：只提高 60 秒/90 秒阈值。治标不治本，长 turn + 慢模型仍会命中，且会延迟真僵尸轮的收敛。 - 放弃方案：在看门狗触发时再检查 `lastTurnEventAt`。此时错误布防已经发生，根因在布防前；前置守卫比事后补救更可靠。
