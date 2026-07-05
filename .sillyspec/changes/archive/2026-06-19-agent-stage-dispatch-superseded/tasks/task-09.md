---
id: task-09
title: 实现 sync_stage_status 状态同步逻辑
priority: P0
estimated_hours: 4
depends_on: [task-07]
blocks: [task-10, task-20]
allowed_paths:
  - backend/app/modules/change/dispatch.py
author: qinyi
created_at: 2026-06-01 18:52:00
---

# task-09: 实现 sync_stage_status 状态同步逻辑

## 修改文件（必填）

- `backend/app/modules/change/dispatch.py` — 在 `SillySpecStageDispatchService` 类中新增 `sync_stage_status()` 方法和 `StageSyncResult` 数据类。需新增 `import sqlite3` 和 `from dataclasses import dataclass, field`（如尚未导入）。依赖 `app.core.spec_paths.SpecPathResolver` 定位 `sillyspec.db` 路径，依赖 `app.modules.change.model.Change` 读写 `current_stage` 和 `stages` 字段。

## 实现要求

根据 design.md Phase 4 "sync_stage_status 逻辑" + "三字段边界" + "状态同步数据流" + "错误处理"，以及 requirements.md FR-06、FR-07：

1. **在 `dispatch.py` 中新增 `StageSyncResult` dataclass**，作为 `sync_stage_status` 的返回值，包含以下字段：

   ```python
   @dataclass
   class StageSyncResult:
       synced: bool                          # 本次同步是否成功
       change_id: uuid.UUID                  # 变更 ID
       run_id: uuid.UUID                     # 触发同步的 AgentRun ID
       current_stage: str | None = None      # sillyspec.db 中的 current_stage
       current_step: str | None = None       # 当前 stage 中第一个 pending step 的名称
       stage_completed: bool = False         # 当前 stage 是否已完成
       has_pending_step: bool = False        # 当前 stage 是否还有 pending step
       steps_completed: list[str] = field(default_factory=list)   # 已完成的 step 名称列表
       steps_pending: list[str] = field(default_factory=list)     # 待完成的 step 名称列表
       error: str | None = None              # 错误信息（仅在 synced=False 时有值）
   ```

2. **在 `SillySpecStageDispatchService` 类中新增 `sync_stage_status` 方法**：

   ```python
   async def sync_stage_status(
       self,
       session: AsyncSession,
       change_id: UUID,
       run_id: UUID,
   ) -> StageSyncResult:
   ```

3. **`sync_stage_status` 完整控制流**：

   ```
   sync_stage_status(session, change_id, run_id):
       ── Step 1: 加载 Change 记录 ──
       change = session.get(Change, change_id)
       IF change is None:
           RAISE ChangeNotFound  (调用方负责处理)

       ── Step 2: 定位 sillyspec.db 路径 ──
       通过 Change.workspace_id 获取 workspace
       通过 workspace 解析 spec_root（参考 RuntimeService._resolve_runtime_dir）
       db_path = SpecPathResolver(spec_root).db_path()

       IF NOT db_path.is_file():
           LOG warning "sync_stage_status.db_not_found"
           RETURN StageSyncResult(synced=False, change_id=change_id, run_id=run_id,
                                  error="sillyspec.db not found")

       ── Step 3: 读取 sillyspec.db ──
       TRY:
           conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
           conn.row_factory = sqlite3.Row
       EXCEPT sqlite3.Error AS exc:
           LOG incident "sync_stage_status.db_connect_failed"
           RETURN StageSyncResult(synced=False, change_id=change_id, run_id=run_id,
                                  error=f"db_connect_failed: {exc}")

       TRY:
           ── Step 3a: 查找 change_key 对应的 changes 记录 ──
           row = conn.execute(
               "SELECT current_stage, status FROM changes WHERE name = ?",
               (change.change_key,)
           ).fetchone()

           IF row is None:
               LOG warning "sync_stage_status.change_not_in_db"
               conn.close()
               RETURN StageSyncResult(synced=False, change_id=change_id, run_id=run_id,
                                      error="change_key not found in sillyspec.db")

           db_current_stage = row["current_stage"]

           ── Step 3b: 查找当前 stage 的 stages 记录 ──
           stage_row = conn.execute(
               "SELECT id, status, completed_at FROM stages "
               "WHERE change_id = (SELECT id FROM changes WHERE name = ?) "
               "AND stage = ?",
               (change.change_key, db_current_stage)
           ).fetchone()

           stage_completed = False
           steps_completed = []
           steps_pending = []
           current_step = None

           IF stage_row is NOT None:
               stage_completed = (stage_row["status"] == "completed")

               ── Step 3c: 查找该 stage 下所有 steps ──
               step_rows = conn.execute(
                   "SELECT name, status FROM steps "
                   "WHERE stage_id = ? ORDER BY ordering",
                   (stage_row["id"],)
               ).fetchall()

               FOR step IN step_rows:
                   IF step["status"] == "completed":
                       steps_completed.append(step["name"])
                   ELSE:
                       steps_pending.append(step["name"])

               ── Step 3d: 确定 current_step（第一个非 completed 的 step）──
               has_pending = len(steps_pending) > 0
               IF has_pending:
                   current_step = steps_pending[0]
           ELSE:
               ── stage 记录不存在，说明该 stage 尚未开始 ──
               has_pending = True
               current_step = None

       EXCEPT sqlite3.Error AS exc:
           LOG incident "sync_stage_status.db_read_failed"
           conn.close()
           RETURN StageSyncResult(synced=False, change_id=change_id, run_id=run_id,
                                  error=f"db_read_failed: {exc}")

       FINALLY:
           conn.close()

       ── Step 4: 同步到 Change 记录 ──
       IF change.current_stage != db_current_stage:
           LOG info "sync_stage_status.stage_updated",
                    old=change.current_stage, new=db_current_stage
           change.current_stage = db_current_stage

       ── Step 5: 同步步骤状态到 Change.stages JSON ──
       stages_json = change.stages or {}
       stage_key = db_current_stage
       stages_json[stage_key] = {
           "status": "completed" if stage_completed else "in_progress",
           "steps": {
               "completed": steps_completed,
               "pending": steps_pending,
           },
           "current_step": current_step,
           "synced_at": datetime.now(timezone.utc).isoformat(),
           "synced_from_run": str(run_id),
       }
       change.stages = stages_json
       change.updated_at = datetime.now(timezone.utc)
       session.add(change)
       await session.commit()

       ── Step 6: 构造并返回 StageSyncResult ──
       RETURN StageSyncResult(
           synced=True,
           change_id=change_id,
           run_id=run_id,
           current_stage=db_current_stage,
           current_step=current_step,
           stage_completed=stage_completed,
           has_pending_step=len(steps_pending) > 0,
           steps_completed=steps_completed,
           steps_pending=steps_pending,
       )
   ```

4. **辅助方法 `_resolve_db_path`**：抽取 sillyspec.db 路径解析为私有方法，复用 `SpecPathResolver`：

   ```python
   async def _resolve_db_path(
       self,
       session: AsyncSession,
       change: Change,
   ) -> Path | None:
       """解析 sillyspec.db 的文件路径。

       优先使用 SpecWorkspace.spec_root，fallback 到 workspace.root_path。
       返回 None 表示无法确定路径。
       """
       from app.modules.spec_workspace.model import SpecWorkspace

       stmt = select(SpecWorkspace).where(
           SpecWorkspace.workspace_id == change.workspace_id
       )
       spec_ws = (await session.execute(stmt)).scalars().first()

       if spec_ws and spec_ws.strategy != "repo-native":
           resolver_root = spec_ws.spec_root
       else:
           from app.modules.workspace.service import WorkspaceService
           ws_service = WorkspaceService(session)
           workspace = await ws_service.get(change.workspace_id)
           if not workspace.root_path:
               return None
           resolver_root = workspace.root_path

       return SpecPathResolver(resolver_root).db_path()
   ```

5. **三字段边界严格遵守**：
   - `Change.status`：本方法**绝不修改**。由 `ChangeService` 管理
   - `Change.current_stage`：本方法**唯一写入点**之一（另一个是 `ChangeService.transition`）。仅从 `sillyspec.db` 的 `changes.current_stage` 投影
   - `sillyspec.db`：本方法**只读不写**。以 `?mode=ro` URI 参数打开 SQLite

## 接口定义（代码类任务必填）

### StageSyncResult dataclass

```python
@dataclass
class StageSyncResult:
    """sync_stage_status 的返回值，携带同步结果和步骤状态摘要。"""

    synced: bool                              # 同步是否成功
    change_id: uuid.UUID                      # 变更 ID
    run_id: uuid.UUID                         # 触发同步的 AgentRun ID
    current_stage: str | None = None          # sillyspec.db 中的 current_stage
    current_step: str | None = None           # 第一个 pending step 名称
    stage_completed: bool = False             # 当前 stage 全部 steps 已完成
    has_pending_step: bool = False            # 当前 stage 还有 pending step
    steps_completed: list[str] = field(default_factory=list)
    steps_pending: list[str] = field(default_factory=list)
    error: str | None = None                  # synced=False 时的错误描述
```

### SillySpecStageDispatchService 新增方法签名

```python
class SillySpecStageDispatchService:
    # ... 已有 dispatch_next_step() ...

    async def sync_stage_status(
        self,
        session: AsyncSession,
        change_id: uuid.UUID,
        run_id: uuid.UUID,
    ) -> StageSyncResult:
        """AgentRun 完成后从 sillyspec.db 同步阶段/步骤状态到 Hub。

        读取 sillyspec.db 的 changes + stages + steps 表，投影到
        Change.current_stage 和 Change.stages JSON。

        Args:
            session: SQLAlchemy async session。
            change_id: 目标变更的 UUID。
            run_id: 刚完成的 AgentRun 的 UUID（用于审计追踪）。

        Returns:
            StageSyncResult 包含同步状态和步骤信息。
            synced=True 表示同步成功。
            synced=False 表示跳过（db 不存在、读取失败等），不中断主流程。

        Raises:
            ChangeNotFound: 当 change_id 在 Hub DB 中不存在时。
            （其他异常不抛出，均走 synced=False + 日志路径）
        """

    async def _resolve_db_path(
        self,
        session: AsyncSession,
        change: Change,
    ) -> Path | None:
        """解析 sillyspec.db 文件路径。返回 None 表示无法定位。"""
```

### sillyspec.db 表结构（只读依赖）

```
changes 表:
  - id INTEGER PK
  - name TEXT UNIQUE          ← 对应 Change.change_key
  - current_stage TEXT        ← 投影到 Change.current_stage
  - status TEXT

stages 表:
  - id INTEGER PK
  - change_id INTEGER FK → changes.id
  - stage TEXT
  - status TEXT               ← pending / in-progress / completed
  - started_at TEXT
  - completed_at TEXT

steps 表:
  - id INTEGER PK
  - stage_id INTEGER FK → stages.id
  - name TEXT                 ← step 名称
  - status TEXT               ← pending / completed
  - output TEXT
  - completed_at TEXT
  - ordering INTEGER
```

### 关键 SQL 查询

```sql
-- 查找 change 记录
SELECT current_stage, status FROM changes WHERE name = ?;

-- 查找当前 stage 的 stages 记录
SELECT id, status, completed_at FROM stages
WHERE change_id = (SELECT id FROM changes WHERE name = ?)
AND stage = ?;

-- 查找该 stage 下所有 steps
SELECT name, status FROM steps WHERE stage_id = ? ORDER BY ordering;
```

## 边界处理（必填，至少5条）

1. **sillyspec.db 文件不存在**：`db_path.is_file()` 返回 `False`。记录 `warning` 日志（含 `change_id`、`db_path`），返回 `StageSyncResult(synced=False, error="sillyspec.db not found")`。不抛异常，不中断调用方主流程。

2. **sillyspec.db 连接失败（文件损坏/权限不足/SQLite 版本不兼容）**：`sqlite3.connect()` 抛出 `sqlite3.Error`。记录 `incident` 级别日志（含 `error` 详情），返回 `StageSyncResult(synced=False, error="db_connect_failed: ...")`。不抛异常。

3. **sillyspec.db 读取失败（表不存在/列缺失/SQL 执行错误）**：`conn.execute()` 抛出 `sqlite3.Error`。记录 `incident` 级别日志，确保 `conn.close()` 在 `finally` 中执行，返回 `StageSyncResult(synced=False, error="db_read_failed: ...")`。不抛异常。

4. **changes 表中无对应 change_key**：`fetchone()` 返回 `None`。记录 `warning` 日志（含 `change_key`），返回 `StageSyncResult(synced=False, error="change_key not found in sillyspec.db")`。不更新 `Change` 记录。

5. **stages 表中无当前 stage 记录**：`stage_row` 为 `None`。表示该 stage 尚未在 sillyspec.db 中创建。设置 `stage_completed=False`、`has_pending_step=True`、`current_step=None`、`steps_completed=[]`、`steps_pending=[]`。正常同步 `Change.current_stage`（从 `changes` 表获得），同步 `Change.stages` JSON 中该 stage 的 `status="pending"`。返回 `synced=True`。

6. **Change 记录不存在（Hub DB）**：`session.get(Change, change_id)` 返回 `None`。直接抛出 `ChangeNotFound`（来自 `app.core.errors`）。这是唯一的异常抛出场景，因为如果 Change 不存在，整个操作无意义。

7. **workspace 无 root_path 且无 SpecWorkspace**：`_resolve_db_path()` 返回 `None`。记录 `warning` 日志，返回 `StageSyncResult(synced=False, error="cannot_resolve_spec_root")`。

8. **steps 表为空（stage 已创建但无 steps）**：`step_rows` 为空列表。`steps_completed=[]`、`steps_pending=[]`、`has_pending_step=False`、`stage_completed` 根据 `stage_row["status"]` 判断。这是合法状态（如 stage 刚创建还未展开 steps）。

9. **step 状态非标准值**：sillyspec.db 的 `steps.status` 可能的值为 `pending`/`completed`/`in-progress`/`skipped` 等。分类逻辑：`status == "completed"` 归入 `steps_completed`，其余全部归入 `steps_pending`。这与设计文档"以 sillyspec.db 为准"一致。如果出现非预期值，不做特殊处理，自然归入 pending。

10. **并发 sync 同一 change**：两个 AgentRun 同时完成，同时调用 `sync_stage_status`。由于 SQLAlchemy 的 session 级别锁和 `await session.commit()` 的序列化，后一个 commit 会覆盖前一个。这是可接受的，因为两次 sync 读取的 sillyspec.db 状态应该是一致的（或后者更新）。如果需要严格防并发，应由上层（task-10）控制串行调度，本方法不负责。

## 非目标（本任务不做的事）

- **不实现**自动调度下一个 step 的逻辑。`sync_stage_status` 返回 `StageSyncResult` 后，由 task-10 的 `dispatch_next_step` 根据 `has_pending_step` 决定是否继续调度
- **不修改** sillyspec.db 中的任何数据。本方法严格只读
- **不更新** `Change.status`。该字段由 `ChangeService` 管理（active/done/archived），本方法不碰
- **不更新** `AgentRun` 的状态。`AgentRun` 的状态由 `AgentService._execute_stage_run` 管理
- **不新增** `_resolve_db_path` 对 workspace 缓存的优化。每次 sync 都查询 DB 获取最新路径
- **不实现** sillyspec.db 中 `changes` 表 `current_stage` 与 Hub `Change.current_stage` 不一致时的"修复"逻辑。以 sillyspec.db 为准，直接覆盖 Hub 值

## 参考

- **design.md Phase 4** "sync_stage_status 逻辑" + "三字段边界" + "状态同步数据流" + "错误处理"
- **requirements.md FR-06**（状态同步）+ **FR-07**（三字段边界）
- **runtime/service.py `_read_sqlite_progress()`**：已有的 sillyspec.db 读取参考实现（SQLite 连接、SQL 查询、错误处理模式）
- **core/spec_paths.py `SpecPathResolver.db_path()`**：sillyspec.db 路径解析
- **change/model.py `Change`**：`current_stage`（String, nullable）和 `stages`（JSON）字段定义
- **core/errors.py `ChangeNotFound`**：变更不存在时的异常类型
- **agent/model.py `AgentRun`**：AgentRun 模型（`change_id` 外键关联）

## TDD 步骤

1. **写测试验证同步逻辑**：在 `backend/tests/modules/change/test_dispatch.py` 中新增测试用例：

   ```python
   # 测试 1: 正常同步 — sillyspec.db 中有 change_key、stage in-progress、部分 steps completed
   # 测试 2: stage completed — 所有 steps 状态为 completed
   # 测试 3: sillyspec.db 不存在 — synced=False，无异常
   # 测试 4: sillyspec.db 连接失败（mock sqlite3.connect 抛异常）— synced=False
   # 测试 5: sillyspec.db 读取失败（mock conn.execute 抛异常）— synced=False
   # 测试 6: changes 表中无 change_key — synced=False
   # 测试 7: Change 不存在 — 抛出 ChangeNotFound
   # 测试 8: stages 表无当前 stage 记录 — synced=True, stage_completed=False
   # 测试 9: steps 表为空 — synced=True, has_pending_step=False
   # 测试 10: current_stage 发生变化 — Change.current_stage 已更新
   # 测试 11: Change.stages JSON 已更新包含 steps 投影
   ```

2. **确认失败**：运行测试，所有 `sync_stage_status` 相关测试报 `AttributeError`（方法不存在）

3. **实现 `StageSyncResult` + `sync_stage_status` + `_resolve_db_path`**：按上述控制流实现

4. **确认通过**：运行 `pytest backend/tests/modules/change/test_dispatch.py -v`，全部通过

5. **验证错误场景**：确认 AC-03 ~ AC-06 的边界场景测试通过

### 具体验证命令

```bash
# 运行 dispatch 相关测试
pytest backend/tests/modules/change/test_dispatch.py -v

# 运行全部测试（确认无回归）
pytest backend/tests/ -v

# 代码检查：确认 sync_stage_status 不修改 sillyspec.db
grep -n "INSERT\|UPDATE\|DELETE" backend/app/modules/change/dispatch.py
# 应无匹配（或仅在 dispatch_next_step 等其他方法中）

# 代码检查：确认 sync_stage_status 不修改 Change.status
# 在 sync_stage_status 方法体中
grep -n "change\.status\s*=" backend/app/modules/change/dispatch.py
# 应无匹配（或仅在 dispatch_next_step 等其他方法中）

# 代码检查：确认 SQLite 以只读模式打开
grep -n "mode=ro" backend/app/modules/change/dispatch.py
# 应有匹配
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 正常同步后检查 `Change.current_stage` | 已更新为 sillyspec.db `changes` 表中的 `current_stage` 值 |
| AC-02 | 正常同步后检查 `Change.stages` JSON | 包含 `steps.completed` 和 `steps.pending` 列表，以及 `current_step` 和 `synced_at` |
| AC-03 | sillyspec.db 不存在时调用 `sync_stage_status` | 返回 `synced=False`，记录 warning 日志，不抛异常 |
| AC-04 | sillyspec.db 连接或读取失败时 | 返回 `synced=False`，记录 incident 日志，不中断主流程 |
| AC-05 | stage completed（所有 steps 状态为 completed）时 `StageSyncResult` | `stage_completed=True`，`has_pending_step=False`，`steps_pending=[]` |
| AC-06 | 有 pending step 时 `StageSyncResult` | `has_pending_step=True`，`current_step` 为第一个 pending step 名称 |
| AC-07 | `Change` 记录不存在时 | 抛出 `ChangeNotFound` 异常 |
| AC-08 | sillyspec.db 以只读模式打开 | SQLite URI 包含 `?mode=ro`，无写操作 |
| AC-09 | `sync_stage_status` 不修改 `Change.status` | 方法体中无 `change.status = ...` 赋值 |
| AC-10 | changes 表无对应 change_key 时 | 返回 `synced=False`，记录 warning 日志，`Change` 记录不被修改 |
| AC-11 | stages 表无当前 stage 记录时 | 返回 `synced=True`，`stage_completed=False`，`Change.current_stage` 已同步 |
| AC-12 | 运行 `pytest backend/tests/modules/change/test_dispatch.py -v` | 所有 `sync_stage_status` 相关测试通过 |
| AC-13 | 运行 `pytest backend/tests/ -v` | 全部测试通过，无回归 |
