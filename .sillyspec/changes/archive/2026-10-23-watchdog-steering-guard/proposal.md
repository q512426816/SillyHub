---
author: flow-machine-draft
created_at: 2026-10-23T08:09:55.208Z
---
# 提案书（Proposal）— 2026-10-23-watchdog-steering-guard

## 动机

任务原话转写：修复看门狗误杀活轮与陈旧判定

动机：事故 run 3d3b0bae（会话 5fb28b2e）忙轮 steering 复用同一 run_id，daemon inject 的 >60s stale-reset 只看上次 inject 时间（lastActiveAt 不随 onMessage 刷新），把活着的轮翻成 active 并给同一 run 布防 90s 看门狗；模型 API 卡顿 4 分钟后看门狗在 15:38:12 提前判 failed（interactive_failed），引擎 15:38:58 才恢复继续干活，随后 Bash 被 PLATFORM_NO_RUNNING_TURN 拒绝。依据 daemon 日志 15:32:24/15:36:42/15:38:12 与 2026-10-21-daemon-zombie-turn design。

成功标准：
- inject 时 runId === 当前 currentRunId（mid-turn steering）不得 stale-reset、不得布防看门狗
- stale 判定改用最后轮内事件时间（onMessage 更新），不再用上次 inject 时间
- 看门狗不得对已经产生过事件的 run 布防
- 回归测试：同 runId steering + 静默 90s 不触发；新 runId 真吞消息仍触发
- daemon 现有测试与 tsc 通过

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. inject 时 runId === 当前 currentRunId（mid-turn steering）不得 stale-reset、不得布防看门狗
2. stale 判定改用最后轮内事件时间（onMessage 更新），不再用上次 inject 时间
3. 看门狗不得对已经产生过事件的 run 布防
4. 回归测试：同 runId steering + 静默 90s 不触发；新 runId 真吞消息仍触发
5. daemon 现有测试与 tsc 通过

## 成功标准（可验证）

1. inject 时 runId === 当前 currentRunId（mid-turn steering）不得 stale-reset、不得布防看门狗
2. stale 判定改用最后轮内事件时间（onMessage 更新），不再用上次 inject 时间
3. 看门狗不得对已经产生过事件的 run 布防
4. 回归测试：同 runId steering + 静默 90s 不触发；新 runId 真吞消息仍触发
5. daemon 现有测试与 tsc 通过
