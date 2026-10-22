---
author: zcode-agent
created_at: 2026-10-22T08:41:48.999Z
---
# 需求规格（Requirements）— 2026-10-22-change-delete-session-history-fix

## 功能需求

### FR-01: 删除 change（含 reparse 物理删行）不再删除任何 agent_runs/agent_run_logs，run.change_id 变为 NULL

- 任何物理删除 `changes` 行的路径（`ChangeService.reparse` 删除环、change-writer 占坑回滚）**必须**先把锚定到该 change 的 `agent_runs.change_id` 置 NULL；删除前后 `agent_runs` / `agent_run_logs` 行数与 `agent_sessions.turn_count` **必须**保持不变。

#### 场景：reparse 删除磁盘消失的 change
- Given 一个 change 行，有 2 个 `agent_runs` 锚定（`change_id=该 change`）且各自有日志，所在会话 `turn_count=N`
- When scoped reparse 判定该 change 目录已消失并进入删除环
- Then change 行被删除；2 个 run 仍在且 `change_id IS NULL`；日志一行不少；会话 `turn_count` 仍为 N

#### 场景：墓碑行与非候选行零动作
- Given change 行 `location='deleted'`，或不在本次 scoped 候选集内
- When reparse 执行
- Then 删除环跳过该行，run/日志/计数不变（既有语义回归）

#### 场景：change-writer 占坑回滚
- Given 占坑 change 已有会话轮次锚定
- When change-write 失败/超时触发 `_rollback_preempted_change`
- Then 占坑 change 行删除，锚定 run 保留且 `change_id IS NULL`，日志保留

### FR-02: 模型与外键迁移一致（SET NULL），并有删除 change 后 run/日志保留的回归测试

- `AgentRun.change_id` 的外键 `ondelete` **必须**为 `SET NULL`（与 `AgentSession.change_id` 既有语义一致）；**必须**提供 Alembic 迁移改写生产库既有外键，且 downgrade 可回到 `CASCADE`；**必须**有测试锁定「直接删除 change 后 run/日志保留」。

#### 场景：模型与库一致
- Given 模型定义与迁移已执行
- When 检查 `AgentRun.__table__.c.change_id` 外键与 `pg_constraint`
- Then 两处均为 `ON DELETE SET NULL`

#### 场景：数据库级删除不带走 run
- Given 一个 change 与锚定 run/日志
- When 直接 `DELETE` change 行（ORM 或 SQL）
- Then run 保留、`change_id IS NULL`、日志保留

### FR-03: bbdbecc9 会话从导出的 JSONL 回灌 13 轮后，时间线与左栏 turn_count（59）一致

- **必须**提供 `backend/scripts/restore_lost_session_turns.py`，按 `turn_id` 把 agent-log 归一化 JSONL 重建为 `agent_runs` + `agent_run_logs`；默认 dry-run，`--apply` 才写库；同一 session+turn 重复执行**禁止**产生重复行；回灌 run 的 `change_id` 恒为 NULL。
- 映射**必须**对齐线上格式：`user_input`→`user_input`；`reply`→`stdout` `[ASSISTANT] …`；`thinking`→`stdout` `[THINKING] …`；`tool_use`→`stdout` `[TOOL_USE] …` + `tool_call` JSON；`tool_result`→`stdout` `[TOOL_RESULT] …`；并写 `metadata.agent_event` 结构化事件与原始时间戳。

#### 场景：dry-run 零写入
- Given 含 13 轮/571 段的 JSONL
- When 不带 `--apply` 运行
- Then 不写任何行，打印计划插入的 run/日志数与目标 turn 列表

#### 场景：apply 后会话完整
- Given 生产会话 bbdbecc9 当前 46 个 run、`turn_count=59`
- When `--apply` 回灌 turn 10–22
- Then 写入 13 个 run 与 571 条日志，`turn_count` 对账为 59，会话大纲/时间线返回 59 轮

#### 场景：重复执行幂等
- Given 已回灌完成
- When 再次 `--apply`
- Then 新增 0 行（确定性 run id + `(run_id, dedup_key)` 唯一索引兜底）

### FR-04: turn_count 与实际 run 数的漂移有对账/修复路径，不再出现计数虚高

- **必须**提供保守对账：`expected = count(distinct 有 user_input 日志的 run)`；仅当 `turn_count > expected` 时下调；`turn_count <= expected`（如 tool_report 会话的 0 语义）**禁止**改动；迁移中执行一次全库对账，回灌脚本 `--apply` 后对目标会话重算。

#### 场景：虚高下调
- Given 会话 `turn_count=59`、实际有 user_input 的 run=46
- When 对账执行
- Then `turn_count=46`（若随后回灌 13 轮则重算为 59）

#### 场景：tool_report 零语义保留
- Given 会话 `turn_count=0`、实际 run=1（本地 Agent 日志会话）
- When 对账执行
- Then `turn_count` 保持 0

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_reparse_delete_preserves_runs.py「reparse 物理删 change 时保留锚定 run 与日志」
FR-02: backend/app/modules/agent/tests/test_agent_run_change_fk.py「AgentRun.change_id 外键为 SET NULL」
FR-03: backend/tests/test_restore_lost_session_turns.py「JSONL 按 turn_id 映射为 run/log 且重复执行幂等」
FR-04: backend/tests/test_restore_lost_session_turns.py「turn_count 对账仅下调虚高、保留 tool_report 零语义」
