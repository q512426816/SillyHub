---
author: flow-machine-draft
created_at: 2026-10-13T01:07:19.831Z
---
# 提案书（Proposal）— 2026-10-13-agent-task-stuck-running

## 动机

任务原话转写：动机:general-purpose 子代理已完成但 UI 永久显示「运行中」——完成通知在 daemon 失忆时被静默丢弃(background-tasks.ts 无处可归跳过),前端时间线装配对 run_id 错位的完成通知行整行丢弃(session-log-assembler.ts),状态卡死无法自愈。
成功标准:
- daemon 侧 task_notification 到达但内存注册表无对应条目时,不再静默丢弃:尽力归属到会话并照常上报终态事件,有日志可查
- 前端时间线装配对找不到父段的 [TASK_NOTIFICATION] 终态行,按 task_id 兜底匹配既有子代理段吸收终态,派发段不再永久转圈
- 为上述两处修复补回归测试,daemon 与 frontend 现有相关测试不回归

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. daemon 侧 task_notification 到达但内存注册表无对应条目时,不再静默丢弃:尽力归属到会话并照常上报终态事件,有日志可查
2. 前端时间线装配对找不到父段的 [TASK_NOTIFICATION] 终态行,按 task_id 兜底匹配既有子代理段吸收终态,派发段不再永久转圈
3. 为上述两处修复补回归测试,daemon 与 frontend 现有相关测试不回归

## 成功标准（可验证）

1. daemon 侧 task_notification 到达但内存注册表无对应条目时,不再静默丢弃:尽力归属到会话并照常上报终态事件,有日志可查
2. 前端时间线装配对找不到父段的 [TASK_NOTIFICATION] 终态行,按 task_id 兜底匹配既有子代理段吸收终态,派发段不再永久转圈
3. 为上述两处修复补回归测试,daemon 与 frontend 现有相关测试不回归
