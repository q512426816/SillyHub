---
author: qinyi
created_at: 2026-06-14T17:57:00
change: 2026-06-14-unified-agent-execution
stage: plan
id: task-13
title: 清理孤儿变更 unified-agent-execution + 全量回归
priority: P0
depends_on: [task-11, task-12]
blocks: []
allowed_paths: []
---

# task-13: 清理孤儿变更 unified-agent-execution + 全量回归

> 对应 plan §Wave 5（48-52）、任务总表 task-13（70）；全局验收 1-11 全量复核。
> 对应 design §Phase 5（213-216，清理孤儿变更 id=264 scan 阶段空存根）。

> **allowed_paths 为空**：本任务不修改代码文件，仅（a）清理 DB 记录 + 空目录、（b）跑全量回归命令。无源码 diff。

## 孤儿变更核实（execute 前已核实，非臆断）

| 维度 | 实际值 | 核实命令 |
|---|---|---|
| 变更名 | `unified-agent-execution`（无日期前缀） | `ls .sillyspec/changes/` |
| DB 记录 | `changes` 表 id=**264**，current_stage=`scan`，status=`active`，created_at=2026-06-14T08:49:58 | `sqlite3 .sillyspec/.runtime/sillyspec.db "SELECT id,name,current_stage,status FROM changes WHERE name='unified-agent-execution';"` |
| 目录内容 | `.sillyspec/changes/unified-agent-execution/` **空目录**（无任何文件，find 无输出） | `find .sillyspec/changes/unified-agent-execution -type f` → 无输出 |
| 关联 stages/steps | stages 表 stage=`scan` 行（ON DELETE CASCADE 会级联删） | `sqlite3 ... "SELECT * FROM stages WHERE change_id=264;"` |
| 与新变更关系 | 新变更 `2026-06-14-unified-agent-execution` id=266，current_stage=plan；孤儿与新变更**仅名字相似**，无 DB 外键关联 | 对比两条 changes 行 |

> **重要路径纠正**：plan/design 写的「`.sillyspec/sillyspec.db`」不准确。根目录 `.sillyspec/sillyspec.db` 是 **0 字节空文件**（非 sqlite）；真实进度 DB 在 **`.sillyspec/.runtime/sillyspec.db`**（122KB sqlite，含 changes/stages/steps 等表）。execute 时操作 `.runtime/sillyspec.db`，非根目录那个空文件。

## 修改文件

无源码文件修改。本任务产出：
1. DB 记录删除（`.sillyspec/.runtime/sillyspec.db` 的 changes id=264 行 + 级联 stages/steps）。
2. 空目录删除（`.sillyspec/changes/unified-agent-execution/`）。
3. 全量回归执行（backend pytest + daemon vitest），回归报告（口头/commit message，不单独写 .md）。

## 实现要求

### 步骤 1：清理孤儿变更

#### 1a. 删除 DB 记录（`.sillyspec/.runtime/sillyspec.db`）

```bash
# 先确认孤儿记录仍在（id=264, name=unified-agent-execution, stage=scan）
sqlite3 .sillyspec/.runtime/sillyspec.db \
  "SELECT id, name, current_stage, status FROM changes WHERE id=264;"
# 预期输出：264|unified-agent-execution|scan|active

# 删除 changes 行（stages/steps 经 ON DELETE CASCADE 级联删除）
sqlite3 .sillyspec/.runtime/sillyspec.db \
  "DELETE FROM changes WHERE id=264 AND name='unified-agent-execution';"

# 确认删除
sqlite3 .sillyspec/.runtime/sillyspec.db \
  "SELECT id, name FROM changes WHERE name='unified-agent-execution';"
# 预期：无输出（已删）

# 确认级联删除（stages/steps 无残留）
sqlite3 .sillyspec/.runtime/sillyspec.db \
  "SELECT COUNT(*) FROM stages WHERE change_id=264;"
# 预期：0
```

> **WHERE 双条件**（id=264 AND name=...）：防止误删（若 id 被复用或记录已不在，DELETE 影响 0 行而非误删其他）。
> **不**用 `sillyspec progress reset`：reset 是重置当前变更进度，不删变更记录；孤儿需直接 DB 操作（sillyspec CLI 无「删除变更」命令，核实 sillyspec --help 输出）。

#### 1b. 删除空目录

```bash
# 确认目录空（find 无文件）
find .sillyspec/changes/unified-agent-execution -type f
# 预期：无输出（空目录）

# 删除空目录
rmdir .sillyspec/changes/unified-agent-execution
# 若 rmdir 报「directory not empty」，说明有隐藏文件，先 ls -la 检查再决定
```

> **只删孤儿目录**：`.sillyspec/changes/2026-06-14-unified-agent-execution/`（本变更，带日期前缀）**不删**，那是当前活跃变更。

#### 1c. 确认 sillyspec CLI 视图清爽

```bash
sillyspec progress show
# 预期：活跃变更列表中无 `unified-agent-execution`（仅剩 `2026-06-14-unified-agent-execution` 等）
```

### 步骤 2：全量回归

#### 2a. 后端全量测试

```bash
cd backend && uv run pytest -q --cov=app --cov-fail-under=60
```
- **通过标准**：全绿 + 覆盖率 ≥ 60%（`.sillyspec/.runtime/local.yaml:12` `backend_test` 命令）。
- **风险 R-01 应对**：task-01 删除面广（claude_code.py 902 行 + service.py 三条执行体），全量回归确保无连带破坏。

#### 2b. daemon 全量测试

```bash
cd sillyhub-daemon && pnpm test
```
- **通过标准**：全绿（`vitest run --passWithNoTests`，package.json:16）。
- **风险 R-12 应对**：Phase 4.5 改动面（task-runner/workspace/daemon/spawn 多点），全量回归确保既有 20 测试 + task-12 新增 4 文件全绿。

#### 2c. 后端 lint（可选，若 backend_lint 配置存在）

```bash
cd backend && uv run ruff check . && uv run ruff format --check .
```
- **注意**：`local.yaml:13` backend_lint 还含 mypy，但 mypy 可能因既有代码报错；**本任务只跑 ruff**（格式 + lint），mypy 失败不阻塞本任务（单独 follow-up）。

### 步骤 3：全局验收 1-11 复核

逐条核对 plan §全局验收标准（107-119），每条给「通过/未通过 + 证据命令」：

| 验收# | 核对方式 | 通过标准 |
|---|---|---|
| 1 | `grep -rn "_build_claude_command\|_exec_stream\|_execute_.*_background\|_proc_registry\|dispatch_to_server" backend/app` | 无命中（task-01） |
| 2 | `cd backend && uv run pytest app/modules/agent/tests/test_execution_context.py -q`（task-11 三种 run 类型 + 401/403） | 全绿 |
| 3 | task-11 单测 `test_start_run_failed_when_no_daemon` | AgentRun.status=failed + error_code=no_online_daemon |
| 4 | `grep "_proc_registry\|SIGTERM" backend/app/modules/agent/service.py` + task-11 `test_kill_calls_cancel_lease` | 无命中 + cancel_lease 被调 |
| 5 | task-11 `test_claimed_maps_to_running` 等四映射 | 全绿 |
| 6 | task-12 `test_submit_messages_called`（mock）+ 后端 daemon/service.py:612 publish 存在 | 链路验证（联调可选） |
| 7 | task-12 `test_extract_result_stats_splits_usage` + `test_finish_passes_stats_to_complete_lease` | 全绿 |
| 8 | task-11 `test_complete_lease_redacts_diff`（后端 redact）+ task-12 `test_collect_diff_truncates_at_50kb`（daemon 截断） | 全绿 |
| 9 | task-12 spawn-env.test.ts 4 用例 | 全绿 |
| 10 | task-12 task-runner-retry-timeout.test.ts B3 用例 | 全绿 |
| 11 | `grep -rn "preferred_backend" backend/app`（调用方传 "server" 被忽略或 422）+ task-01 AC-06 | 行为变更确认 |

> **验收 6（实时流）完整验证**：单元测试只覆盖 submitMessages 被调用；完整链路（前端订阅 `agent_run:{id}` 拿实时流）需手动联调或集成测试。本任务记录「单元测试通过 + 链路设计已等价（design A1 核实）」，完整联调列为 follow-up（不阻塞本变更收尾）。

## 边界处理

1. **（DB 路径纠正）** 操作 `.sillyspec/.runtime/sillyspec.db`（真实进度 DB），**不**碰根目录 `.sillyspec/sillyspec.db`（0 字节空文件，无意义）。plan/design 写的路径不准确，本任务以核实值为准。
2. **（DB id 复用风险）** DELETE 用 `WHERE id=264 AND name='unified-agent-execution'` 双条件，防止 id 被 sillyspec 复用后误删新记录。删除前先 SELECT 确认 name 匹配。
3. **（孤儿目录非空意外）** 若 `find .sillyspec/changes/unified-agent-execution -type f` 有输出（意外有文件），**不**直接 rmdir，先人工检查内容再决定（可能误判，或有人放了文档）。
4. **（不删新变更）** `.sillyspec/changes/2026-06-14-unified-agent-execution/`（带日期前缀，本变更）**绝对不删**；清理只针对无日期前缀的孤儿。execute 时双重确认目录名。
5. **（回归失败处理）** 若 backend/daemon 全量回归有红用例：①先判断是否本变更引入（git diff 范围内）→ 修；②若既有代码问题（与本变更无关）→ 记录但不阻塞本任务（单独 issue）。**禁止**为让回归过而 skip 测试或降 coverage 门槛。
6. **（lint 不阻塞）** ruff check 失败应修（格式/lint 问题通常简单）；mypy 失败不阻塞（既有技术债，单独 follow-up）。
7. **（验收 6 联调范围）** 实时流完整联调（前端订阅 channel）不在本任务自动化范围；记录「单元测试通过 + design A1 已核实等价」即可，联调列为可选 follow-up。
8. **（commit 粒度）** 本任务的清理（DB + 空目录）与回归验证可分两个 commit：①`chore: remove orphan change unified-agent-execution`；②回归报告体现在 PR 描述或 task-11/12 测试通过的 commit 里。

## 非目标

- **不**修改任何源码文件（task-01~12 已完成实现 + 测试）。
- **不**跑前端测试（本变更不涉及 frontend 改动；`local.yaml:20` frontend_test 若需跑属独立验证，不强制）。
- **不**做前端联调（验收 6 完整链路列为可选 follow-up）。
- **不**改 sillyspec CLI 工具本身（孤儿清理用 DB 直接操作 + rmdir，因 CLI 无删除变更命令）。
- **不**处理根目录 `.sillyspec/sillyspec.db`（0 字节空文件，无数据，保留不动）。
- **不**归档本变更 `2026-06-14-unified-agent-execution`（归档是 sillyspec-archive 流程，属变更收尾的后续步骤，不在本任务范围；本任务完成后变更进入 verify/archive 阶段）。
- **不**修 mypy 既有报错（技术债，单独 follow-up）。

## TDD 步骤

本任务无 TDD（清理 + 回归性质，不写测试）。

1. **核实孤儿仍在**：步骤 1a 的 SELECT 确认 id=264 name=unified-agent-execution 存在。
2. **清理 DB + 目录**：按步骤 1a/1b/1c 执行。
3. **跑全量回归**：按步骤 2a/2b 执行。
4. **全局验收复核**：按步骤 3 逐条核对验收 1-11。
5. **记录结果**：回归结果 + 验收复核表体现在 commit message / PR 描述（不单独写 .md 报告，遵循「不主动创建文档」原则）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `sqlite3 .sillyspec/.runtime/sillyspec.db "SELECT id,name FROM changes WHERE name='unified-agent-execution';"` | 无输出（孤儿 DB 记录已删） |
| AC-02 | `sqlite3 .sillyspec/.runtime/sillyspec.db "SELECT COUNT(*) FROM stages WHERE change_id=264;"` | 0（级联删除，无残留） |
| AC-03 | `ls .sillyspec/changes/unified-agent-execution 2>&1` | 报「No such file or directory」（空目录已删） |
| AC-04 | `ls .sillyspec/changes/2026-06-14-unified-agent-execution/` | 本变更目录仍在（确认未误删新变更） |
| AC-05 | `sillyspec progress show` | 活跃变更列表无 `unified-agent-execution`（仅 `2026-06-14-unified-agent-execution` 等带日期前缀的） |
| AC-06 | `cd backend && uv run pytest -q --cov=app --cov-fail-under=60` | 全绿且覆盖率 ≥ 60%（风险 R-01 应对） |
| AC-07 | `cd sillyhub-daemon && pnpm test` | 全绿（既有 20 + task-12 新增 4 文件，风险 R-12 应对） |
| AC-08 | 全局验收 1：`grep -rn "_build_claude_command\|_exec_stream\|_execute_.*_background\|_proc_registry\|dispatch_to_server" backend/app` | 无命中（task-01） |
| AC-09 | 全局验收 4：`grep "_proc_registry\|SIGTERM" backend/app/modules/agent/service.py` | 无命中（task-04） |
| AC-10 | 全局验收 1-11 复核表（步骤 3） | 全部「通过」或有明确 follow-up 记录 |
| AC-11 | `cd backend && uv run ruff check . && uv run ruff format --check .` | 全绿（mypy 不在本任务范围） |
