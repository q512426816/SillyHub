---
author: flow-machine-draft
created_at: 2026-10-13T03:30:35.880Z
---
# 提案书（Proposal）— 2026-10-13-turn-live-visibility

## 动机

任务原话转写：会话运行中用户感知不到 agent 真实状态：TaskOutput 阻塞等待后台任务时时间线只显示原始 JSON 且静默可达十分钟；后台任务完成后「后台运行中」徽标/任务卡片偶发残留不消失；轮 token 统计（↑↓数字）刷新频次低。
成功标准：
- TaskOutput（block=true）运行中时，时间线该工具行显示人话摘要「等待后台任务：<任务名>」+ 每秒跳动的已等时长（mm:ss），任务名/最后活跃时间经任务快照（agent_session_task）对账获得，查不到时优雅回退不崩
- 后台任务派发段（含子代理容器段）的 running 任务元数据在任务快照为终态时收敛为终态徽标，治理 [TASK_*] 终态事件丢失导致的永久「后台运行中」残留
- 任务面板清单在轮完成对账点（schedulePostTurnReconcile）同步重拉任务快照，终态残留卡片收敛
- daemon usage_update 估算推送从「累计 ≥20 token」改为「≥20 token 或距上次推送 ≥500ms」双门限，低速生成时 token 数字约每 0.5 秒一跳；真 usage 到达后 API call 进行中估算继续推送（仍被 message_delta 真值覆盖校正）
- 既有工具行/子代理块/任务卡片其余渲染与既有测试不回归
- 相关单测新增/更新并跑通

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. TaskOutput（block=true）运行中时，时间线该工具行显示人话摘要「等待后台任务：<任务名>」+ 每秒跳动的已等时长（mm:ss），任务名/最后活跃时间经任务快照（agent_session_task）对账获得，查不到时优雅回退不崩
2. 后台任务派发段（含子代理容器段）的 running 任务元数据在任务快照为终态时收敛为终态徽标，治理 [TASK_*] 终态事件丢失导致的永久「后台运行中」残留
3. 任务面板清单在轮完成对账点（schedulePostTurnReconcile）同步重拉任务快照，终态残留卡片收敛
4. daemon usage_update 估算推送从「累计 ≥20 token」改为「≥20 token 或距上次推送 ≥500ms」双门限，低速生成时 token 数字约每 0.5 秒一跳；真 usage 到达后 API call 进行中估算继续推送（仍被 message_delta 真值覆盖校正）
5. 既有工具行/子代理块/任务卡片其余渲染与既有测试不回归
6. 相关单测新增/更新并跑通

## 成功标准（可验证）

1. TaskOutput（block=true）运行中时，时间线该工具行显示人话摘要「等待后台任务：<任务名>」+ 每秒跳动的已等时长（mm:ss），任务名/最后活跃时间经任务快照（agent_session_task）对账获得，查不到时优雅回退不崩
2. 后台任务派发段（含子代理容器段）的 running 任务元数据在任务快照为终态时收敛为终态徽标，治理 [TASK_*] 终态事件丢失导致的永久「后台运行中」残留
3. 任务面板清单在轮完成对账点（schedulePostTurnReconcile）同步重拉任务快照，终态残留卡片收敛
4. daemon usage_update 估算推送从「累计 ≥20 token」改为「≥20 token 或距上次推送 ≥500ms」双门限，低速生成时 token 数字约每 0.5 秒一跳；真 usage 到达后 API call 进行中估算继续推送（仍被 message_delta 真值覆盖校正）
5. 既有工具行/子代理块/任务卡片其余渲染与既有测试不回归
6. 相关单测新增/更新并跑通
