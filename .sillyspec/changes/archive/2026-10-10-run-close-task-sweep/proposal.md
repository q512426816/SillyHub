---
author: flow-machine-draft
created_at: 2026-10-10T15:51:05.941Z
---
# 提案书（Proposal）— 2026-10-10-run-close-task-sweep

## 动机

任务原话转写：会话已结束但子代理任务仍显示「进行中」（线上会话 47e2ff1a 实证：两个 run 均 completed，agent_session_task 表 17 条卡 running，最后更新停在 run 结束前 20+ 分钟）。根因：agent_session_task 只按 agent_task_status 事件 upsert（agent_task_store），run 终态收口（close_interactive_run）与后端重启判死（cleanup_stale_runs）均不清理该 run 的非终态任务行——子代理未上报终态（被放弃/中断）时永远卡 running。
成功标准：
- close_interactive_run 收口时同事务把该 run 的非终态 agent_session_task 行批量收口为 stopped（附可读 message，finished_at/updated_at 同步置位）
- 后端启动清理（cleanup_stale_runs）追加兜底清扫：run 已终态但其任务仍 running 的行全量收口（自愈存量脏数据，47e2ff1a 的 17 条在下次部署重启后自动修复）
- 已终态任务行不被清扫触碰；running run 的任务不被误扫
- 新单测覆盖：finalize 单 run 收口 / 启动兜底清扫（终态 run 扫、running run 不扫）/ close 链路接入；既有 agent_session_tasks 测试全绿 + ruff/mypy 过

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. close_interactive_run 收口时同事务把该 run 的非终态 agent_session_task 行批量收口为 stopped（附可读 message，finished_at/updated_at 同步置位）
2. 后端启动清理（cleanup_stale_runs）追加兜底清扫：run 已终态但其任务仍 running 的行全量收口（自愈存量脏数据，47e2ff1a 的 17 条在下次部署重启后自动修复）
3. 已终态任务行不被清扫触碰；running run 的任务不被误扫
4. 新单测覆盖：finalize 单 run 收口 / 启动兜底清扫（终态 run 扫、running run 不扫）/ close 链路接入；既有 agent_session_tasks 测试全绿 + ruff/mypy 过

## 成功标准（可验证）

1. close_interactive_run 收口时同事务把该 run 的非终态 agent_session_task 行批量收口为 stopped（附可读 message，finished_at/updated_at 同步置位）
2. 后端启动清理（cleanup_stale_runs）追加兜底清扫：run 已终态但其任务仍 running 的行全量收口（自愈存量脏数据，47e2ff1a 的 17 条在下次部署重启后自动修复）
3. 已终态任务行不被清扫触碰；running run 的任务不被误扫
4. 新单测覆盖：finalize 单 run 收口 / 启动兜底清扫（终态 run 扫、running run 不扫）/ close 链路接入；既有 agent_session_tasks 测试全绿 + ruff/mypy 过
