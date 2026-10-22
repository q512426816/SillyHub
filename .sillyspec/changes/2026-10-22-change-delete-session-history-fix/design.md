---
author: zcode-agent
created_at: 2026-10-22T08:41:48.999Z
---
# 设计记录（Design Record）— 2026-10-22-change-delete-session-history-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

根因是三个独立事实叠加：① `agent_runs.change_id` 外键为 `ON DELETE CASCADE`；② reparse 在磁盘 change 目录消失时会物理删除 `changes` 行；③ `turn_count` 只在 inject 时 +1、从不随 run 删除回退。于是「删变更」这个与聊天无关的动作会级联物理删除会话 run 与日志，左栏计数却保持虚高。

修复分三层：DB 语义层把 `AgentRun.change_id` 改为 `ON DELETE SET NULL`（与 `AgentSession.change_id` 既有语义一致），保证任何物理删 change 的路径都不再带走 run/日志；应用层在 reparse 删除环内先显式解绑锚定 run 再删行（部署顺序无关、行为可观测），占坑回滚路径由 FK 语义兜底；数据层新增一次性回灌脚本，从 daemon 引擎原始 JSONL 重建本次丢失的 13 轮，并对账 `turn_count`。前端与列表查询不改（避免把 `turn_count` 改成实时聚合带来的性能与 tool_report 零语义风险）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

对外 API：无变更。
模型/DB：`AgentRun.change_id` 外键 `ondelete` 由 `CASCADE` 改为 `SET NULL`；新增 Alembic 迁移改写生产库既有约束，`downgrade` 恢复 `CASCADE`。
`ChangeService.reparse`：删除环在 `session.delete(row)` 前执行 `UPDATE agent_runs SET change_id=NULL WHERE change_id IN (候选 change ids)`；`stats` 字段语义不变，新增日志字段 `detached_runs`（可观测，不对外）。
新增脚本 CLI（默认 dry-run）：
`python backend/scripts/restore_lost_session_turns.py --session <uuid> --jsonl <path> [--turn-ids 10-22] [--apply] [--reconcile-turn-count]`
- `--apply` 才写库；退出码 0=成功，2=参数/数据错误。
- run id = `uuid5(NAMESPACE, f"{session_id}:restore:{turn_id}")`；日志 `dedup_key = restore:{turn_id}:{seq}:{channel}:{n}`，靠 `(run_id, dedup_key)` 唯一索引幂等。
- run 字段：`change_id=NULL`、`status='completed'`、`agent_session_id=目标会话`、`user_id=会话属主`、`created_at/started_at/finished_at` 取该轮首末消息时间；`metadata={"restored_from":"agent-log-jsonl","restored_turn_id":N}`。
对账纯函数（迁移与脚本共用）：`expected = count(distinct run)`，仅统计存在 `channel='user_input'` 日志的 run；仅 `turn_count > expected` 时下调。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。回灌按 `turn_id` + `seq`/`ts` 稳定排序，不依赖接口分页到达顺序；run id 与 dedup_key 确定性，重复/迟到执行只跳过不重复插入。reparse 的解绑与删行在同一事务内，不存在「行已删、解绑未落」窗口。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

两个 reparse 并发删除同一 change 时，第二个 `DELETE` 命中 0 行，解绑 UPDATE 幂等；两个回灌进程并发时，`(run_id, dedup_key)` 唯一索引使一方插入、另一方冲突跳过。生产执行前以单实例运行并先做 dry-run。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。回灌只插入 `completed` run，不产生活跃 run，不会与当前正在执行的轮冲突；`change_id=NULL` 使这些历史轮不再被任何后续 change 删除波及。迁移只改约束并做一次保守 UPDATE，DDL 需要短暂表锁，安排在低峰执行。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。解绑与对账均限定在候选 change id 集/单 workspace；回灌严格限定 `--session`，校验会话存在且未软删；JSONL 的 `turn_id` 与目标 session 显式绑定。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：改为 SET NULL 后，被删 change 的执行 run 会保留但失去 change 归属；`_change_run_ids` 的无锚分支可能把这些 run 归到同会话其它 change，导致用量报表轻微漂移。缓解：仅在 change 物理删除（低概率）时发生，用量按 run 去重不重复计数；在 `agent.md`/`change.md` 文档登记该语义。
回灌格式风险：引擎 JSONL 与 daemon 线上上报格式存在细微差异，渲染可能不完全一致。缓解：严格对齐 `_persist_agent_event` 的 `[ASSISTANT]/[THINKING]/[TOOL_USE]/[TOOL_RESULT]` 前缀与 `metadata.agent_event` 形状；回灌行带 `restored_from` 标记，便于按 run id 回收；生产先 dry-run 再 apply。
迁移对账误伤：全局 `turn_count` 下调可能影响未知会话。缓解：只下调（`turn_count > expected`），expected 只统计有 user_input 日志的 run，`tool_report` 的 0 语义天然保留；迁移前备份 `agent_sessions`。
放弃方案 A：只把 reparse 里的 `session.delete` 改成逐条搬 run——路径多（reparse、占坑回滚、未来新增删除入口），漏一处就复发，不是根治。
放弃方案 B：把左栏轮数改为列表接口实时聚合 `count(runs)`——改动面大、每会话子查询性能风险，且会改变 `tool_report` 的 `turn_count=0` replay 语义；保留存储列 + 对账路径更稳。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/model.py | `AgentRun.change_id` FK `CASCADE`→`SET NULL` + 语义注释 |
| 新增 | backend/migrations/versions/20261022_agent_runs_change_id_set_null.py | 改写既有 FK + 保守回填虚高 `turn_count` |
| 修改 | backend/app/modules/change/service.py | reparse 删除环显式解绑锚定 run + `detached_runs` 日志 |
| 新增 | backend/app/modules/agent/tests/test_agent_run_change_fk.py | 模型外键语义回归 |
| 新增 | backend/app/modules/change/tests/test_reparse_delete_preserves_runs.py | 删 change 保留 run/日志/计数回归 |
| 新增 | backend/scripts/restore_lost_session_turns.py | 引擎 JSONL→run/日志 回灌（dry-run/幂等/对账） |
| 新增 | backend/tests/test_restore_lost_session_turns.py | 映射、幂等、对账单元测试 |
| 修改 | .sillyspec/docs/backend/modules/agent.md | 记录 `AgentRun.change_id` SET NULL 语义与影响 |
| 修改 | .sillyspec/docs/backend/modules/change.md | 记录 reparse 删行前解绑与恢复脚本 |
| 修改 | .sillyspec/docs/backend/modules/migrations.md | 记录本次迁移与保守对账 |
