---
author: flow-machine-draft
created_at: 2026-11-02T02:07:22.613Z
---
# 提案书（Proposal）— 2026-11-02-daemon-resume-gate-fix

## 动机

任务原话转写：根治恢复刷新时间戳致会话闸误拒新建

动机：11-02 实证事故——断网恢复时 backend auto-recover 一拍全量下发 SESSION_RESUME，daemon reopen 路径把全部 46 条恢复会话的 lastActiveAt 刷成当下，会话闸「30 分钟内活跃」口径被顶满（46≥20），新建会话全部被 SESSION_LIMIT_REACHED 拒绝（run 落 interactive_interrupted 前端显已终止）；配置切换轮在 daemon 会话不存在时被静默丢弃无回报，run 卡 pending 300 秒才被僵尸轮清扫兜底。修复依据：2026-08-26-team-subsession-recursion design §5.D 闸的防进程风暴本意（idle 恢复会话无进程成本不应占额度）、sillyhub-daemon/src/daemon.ts:9363（reopen lastActiveAt=now）、session-manager.ts:1101-1120（闸计数）、daemon.ts _routeSessionControl switch 分支 not_found 仅 warn 无回报（INJECT 有 _reportInjectDropped 先例）。

成功标准：
- daemon reopen/恢复路径不再把 lastActiveAt 刷新为当下：存在本地持久化记录时保留原值；恢复风暴后 30 分钟内新建会话不再被会话闸拒绝
- SESSION_SWITCH_CONFIG 到达但目标会话不在 daemon store 且 payload 带 run_id 时，回报该 run 失败（对齐 INJECT 丢弃回报语义），run 秒级收敛而非等 300 秒清扫
- 两处行为均有自动化测试覆盖

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. daemon reopen/恢复路径不再把 lastActiveAt 刷新为当下：存在本地持久化记录时保留原值；恢复风暴后 30 分钟内新建会话不再被会话闸拒绝
2. SESSION_SWITCH_CONFIG 到达但目标会话不在 daemon store 且 payload 带 run_id 时，回报该 run 失败（对齐 INJECT 丢弃回报语义），run 秒级收敛而非等 300 秒清扫
3. 两处行为均有自动化测试覆盖

## 成功标准（可验证）

1. daemon reopen/恢复路径不再把 lastActiveAt 刷新为当下：存在本地持久化记录时保留原值；恢复风暴后 30 分钟内新建会话不再被会话闸拒绝
2. SESSION_SWITCH_CONFIG 到达但目标会话不在 daemon store 且 payload 带 run_id 时，回报该 run 失败（对齐 INJECT 丢弃回报语义），run 秒级收敛而非等 300 秒清扫
3. 两处行为均有自动化测试覆盖
