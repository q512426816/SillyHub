---
author: flow-machine-draft
created_at: 2026-10-22T08:41:48.999Z
---
# 提案书（Proposal）— 2026-10-22-change-delete-session-history-fix

## 动机

任务原话转写：变更删除不再级联删会话轮次并恢复丢失轮次

动机与背景：2026-10-22 生产会话 bbdbecc9 因 reparse 物理删除 4 个 change 行，agent_runs.change_id 的 ON DELETE CASCADE 把挂在这些变更上的 13 轮 run 与日志级联物理删除，左栏 turn_count 仍为 59，会话时间线只剩 46 轮；已从 daemon 侧 Claude Code JSONL 完整导出丢失内容。需根治「删除无关实体导致会话历史丢失」这类问题，并恢复被删轮次。

成功标准：
- 删除 change（含 reparse 物理删行）不再删除任何 agent_runs/agent_run_logs，run.change_id 变为 NULL
- 模型与外键迁移一致（SET NULL），并有删除 change 后 run/日志保留的回归测试
- bbdbecc9 会话从导出的 JSONL 回灌 13 轮后，时间线与左栏 turn_count（59）一致
- turn_count 与实际 run 数的漂移有对账/修复路径，不再出现计数虚高

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 删除 change（含 reparse 物理删行）不再删除任何 agent_runs/agent_run_logs，run.change_id 变为 NULL
2. 模型与外键迁移一致（SET NULL），并有删除 change 后 run/日志保留的回归测试
3. bbdbecc9 会话从导出的 JSONL 回灌 13 轮后，时间线与左栏 turn_count（59）一致
4. turn_count 与实际 run 数的漂移有对账/修复路径，不再出现计数虚高

## 成功标准（可验证）

1. 删除 change（含 reparse 物理删行）不再删除任何 agent_runs/agent_run_logs，run.change_id 变为 NULL
2. 模型与外键迁移一致（SET NULL），并有删除 change 后 run/日志保留的回归测试
3. bbdbecc9 会话从导出的 JSONL 回灌 13 轮后，时间线与左栏 turn_count（59）一致
4. turn_count 与实际 run 数的漂移有对账/修复路径，不再出现计数虚高
