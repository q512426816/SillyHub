---
id: task-01
title: scan_generate 幂等返回进行中 scan run
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-05]
allowed_paths:
  - backend/app/modules/workspace/service.py
author: WhaleFall
created_at: 2026-06-03 15:21:37
---

# task-01 scan_generate 幂等返回进行中 scan run

## 背景

把「生成项目规范」统一为 Bootstrap 流程后，前端可能在多标签页 / 重复点击 / 并发场景下多次调用 `POST /api/workspaces/scan-generate`。当前 `WorkspaceService.scan_generate` 只在「同 root_path 已有 active workspace」时复用 workspace，但仍会无条件调用 `agent_service.start_scan_dispatch` 新建一条 scan AgentRun，导致同一 workspace 出现多条并行 scan run。

本任务把「防重复」下沉到后端：在调用 `start_scan_dispatch` 之前，先查询该 workspace 是否已有「进行中」（status ∈ {pending, running}）的 scan run（通过 `AgentRunWorkspace` 关联 `workspace_id` + `AgentRun.change_id IS NULL`）。若存在，幂等返回该 run，不再新建。无进行中 run 时行为保持不变。

依据文档：
- `design.md` 决策 3「后端 scan_generate 幂等返回进行中 run」
- `plan.md` task-01

## 修改文件（精确路径）

- `backend/app/modules/workspace/service.py`
  - 修改方法：`WorkspaceService.scan_generate`（约 647 行起）
  - 新增私有方法：`WorkspaceService._find_active_scan_run`（建议紧跟 `_find_active_by_root_path` 之后，约 752 行附近）
  - 新增导入：在文件顶部从 agent / workspace model 引入 `AgentRun`、`AgentRunWorkspace`

只允许改这一个文件。不要动 `agent/service.py`、不要动任何前端文件、不要写测试（测试是 task-05）。

## 关键事实（已核对源码，execute 直接用）

- `scan_generate` 签名（service.py:647-653）：
  ```python
  async def scan_generate(
      self,
      *,
      root_path: str,
      user_id: uuid.UUID,
      agent_service: "AgentService",
  ) -> tuple[uuid.UUID, uuid.UUID]:
  ```
  返回 `(workspace_id, agent_run_id)`，签名与返回类型本任务**不变**。

- 现有触发点（service.py:722-728），即插入幂等检查的位置——**在这段之前**插入：
  ```python
  # 6. Trigger agent scan dispatch
  agent_run = await agent_service.start_scan_dispatch(...)
  ```

- `AgentRun` 模型（`backend/app/modules/agent/model.py:14`）字段：
  - `id: uuid.UUID`（主键）
  - `status: str`，取值 `pending / running / completed / failed / killed`（model.py:61-64）
  - `change_id: uuid.UUID | None`，scan run 恒为 `None`（agent/service.py:1040 `change_id=None`）
  - `started_at: datetime | None`，pending 时为 `None`，running 后被赋值（用于排序）
  - **注意**：`AgentRun` 无 `created_at` 字段（BaseModel 无任何时间列），不要按 `created_at` 排序。

- `AgentRunWorkspace` 模型（`backend/app/modules/workspace/model.py:217`）字段：
  - `agent_run_id: uuid.UUID`（PK，FK→agent_runs.id）
  - `workspace_id: uuid.UUID`（PK，FK→workspaces.id）
  - 这是 AgentRun ↔ Workspace 的 M:N 关联表。

- 现成可参考的关联查询写法（`agent/service.py:441-455` `list_runs`）：
  ```python
  arw_subq = select(AgentRunWorkspace.agent_run_id).where(
      col(AgentRunWorkspace.workspace_id) == workspace_id,
  )
  stmt = select(AgentRun).where(col(AgentRun.id).in_(arw_subq))
  ```
  本文件已 `from sqlmodel import col`（service.py:22）、`from sqlalchemy import or_, select`（service.py:19），可直接复用。

## 实现要求（具体步骤）

1. **新增导入**（文件顶部 import 区，约 service.py:35 附近）：
   ```python
   from app.modules.agent.model import AgentRun
   from app.modules.workspace.model import (
       AgentRunWorkspace,
       Workspace,
       WorkspaceRelation,
   )
   ```
   （现有第 35 行已 `from app.modules.workspace.model import Workspace, WorkspaceRelation`，把 `AgentRunWorkspace` 合并进去即可；`AgentRun` 来自 agent.model 单独一行。`AgentRun` 仅运行时查询使用，可放普通 import，无需放进 `TYPE_CHECKING`。）

2. **新增私有查询方法 `_find_active_scan_run`**，封装查询逻辑：
   - 用子查询从 `AgentRunWorkspace` 取该 `workspace_id` 关联的所有 `agent_run_id`。
   - 主查询 `select(AgentRun)`，过滤条件：
     - `col(AgentRun.id).in_(arw_subq)`（属于该 workspace）
     - `col(AgentRun.change_id).is_(None)`（是 scan/bootstrap run，非 change 执行 run）
     - `col(AgentRun.status).in_(["pending", "running"])`（进行中）
   - 排序：`order_by(col(AgentRun.started_at).desc())`，`.limit(1)`，取最近一条。
   - 返回 `AgentRun | None`。

   查询 SQL 思路（等价 SQL）：
   ```sql
   SELECT agent_runs.*
   FROM agent_runs
   WHERE agent_runs.id IN (
           SELECT agent_run_workspaces.agent_run_id
           FROM agent_run_workspaces
           WHERE agent_run_workspaces.workspace_id = :workspace_id
         )
     AND agent_runs.change_id IS NULL
     AND agent_runs.status IN ('pending', 'running')
   ORDER BY agent_runs.started_at DESC
   LIMIT 1;
   ```

3. **在 `scan_generate` 中接入幂等分支**：在「步骤 6 Trigger agent scan dispatch」（service.py:722，`agent_run = await agent_service.start_scan_dispatch(...)`）**之前**插入：
   ```python
   # 6a. Idempotency: reuse in-progress scan run if one exists
   existing_run = await self._find_active_scan_run(workspace.id)
   if existing_run is not None:
       log.info(
           "workspace.scan_generate.idempotent_hit",
           workspace_id=str(workspace.id),
           agent_run_id=str(existing_run.id),
           status=existing_run.status,
       )
       return (workspace.id, existing_run.id)
   ```
   命中时**直接 return**，不调用 `start_scan_dispatch`，不新建 run。

4. **未命中时行为完全不变**：继续执行原步骤 5/6/7（取 spec_root → `start_scan_dispatch` → 返回新 run）。不要删除或改动原有逻辑。

5. **注意 spec_root 获取顺序**：原代码步骤 5（取 spec_root，service.py:715-720）在步骤 6 之前。幂等检查放在「步骤 6 之前」即可——可放在步骤 5 之前，避免命中幂等时还多查一次 SpecWorkspace（更优，但非强制）。建议把幂等检查放在拿到 `workspace` 对象之后、取 spec_root 之前。

## 接口定义

### scan_generate（签名不变）
```python
async def scan_generate(
    self,
    *,
    root_path: str,
    user_id: uuid.UUID,
    agent_service: "AgentService",
) -> tuple[uuid.UUID, uuid.UUID]:
    ...
    # workspace 已确定（复用或新建）后：
    existing_run = await self._find_active_scan_run(workspace.id)
    if existing_run is not None:
        return (workspace.id, existing_run.id)
    # 无进行中 run -> 原有逻辑：取 spec_root -> start_scan_dispatch -> return
```

### 新增 _find_active_scan_run（伪代码）
```python
async def _find_active_scan_run(
    self, workspace_id: uuid.UUID
) -> AgentRun | None:
    """Find the most recent in-progress (pending/running) scan run
    associated with the given workspace.

    A scan run is identified by change_id IS NULL (it is not tied to a
    change execution). Returns None if no in-progress scan run exists.
    """
    arw_subq = select(AgentRunWorkspace.agent_run_id).where(
        col(AgentRunWorkspace.workspace_id) == workspace_id,
    )
    stmt = (
        select(AgentRun)
        .where(col(AgentRun.id).in_(arw_subq))
        .where(col(AgentRun.change_id).is_(None))
        .where(col(AgentRun.status).in_(["pending", "running"]))
        .order_by(col(AgentRun.started_at).desc())
        .limit(1)
    )
    return (await self._session.execute(stmt)).scalars().first()
```

## 边界处理（至少 5 条）

1. **无进行中 run 时行为不变**：`_find_active_scan_run` 返回 `None`，`scan_generate` 走原路径（取 spec_root → `start_scan_dispatch` → 返回新建 run 的 id）。这是兼容性硬约束（design.md 兼容策略）。
2. **多条进行中 run 取最近一条**：理论上不应出现多条（本任务正是防止它），但历史脏数据或并发可能产生。查询用 `order_by(started_at desc).limit(1)`，取最近一条返回；幂等语义下返回任意一条进行中 run 都可接受，不报错。
3. **已完成 / 失败 / killed 的 run 不算进行中**：status ∈ {completed, failed, killed} 一律排除（只匹配 `pending`/`running`）。这些历史 run 存在时，`scan_generate` 应正常新建一条新 scan run，而不是返回旧的终态 run。
4. **workspace 刚创建尚无任何 run**：新建分支下 workspace 刚 flush，`AgentRunWorkspace` 关联为空，子查询返回空集，`_find_active_scan_run` 返回 `None`，正常新建——与无进行中 run 同一路径。
5. **并发幂等**：两个请求几乎同时进入。本任务在应用层做查询-判断，无法 100% 防住「两个请求都查到空、都新建」的竞态（需 DB 唯一约束才能彻底兜住，超出本任务范围）。本任务保证：只要前一条 run 已落库且处于 pending/running，后续请求即命中幂等。竞态窗口残留由前端禁用按钮（task-03/04）+ 后续可选的 DB 约束兜底，本任务不引入新约束。
6. **change_id 必须为 None 才算 scan run**：该 workspace 可能同时存在「change 执行 run」（`change_id` 非空，例如 spec-bootstrap/execute）。这些 run 即使 pending/running 也**不**应触发幂等命中，必须用 `change_id IS NULL` 过滤，避免把 change 执行 run 误当作 scan run 返回。
7. **started_at 为 None 的 pending run 仍能命中**：pending run 的 `started_at` 为 `None`，过滤条件只看 `status`，不依赖 `started_at` 是否有值；排序仅影响多条时取哪一条，不影响是否命中。

## 非目标

- **不改 `start_scan_dispatch` 内部实现**（agent/service.py:991 起）：本任务只在调用方决定「调或不调」，不动其建 run / 建关联 / 起后台任务的逻辑。
- **不动前端**：弹窗跳转（task-03）与详情页恢复回显（task-04）是独立任务。
- **不引入新表 / 新字段 / 新 DB 约束**（design.md 自审：无新增表/字段）。
- **不写测试**：幂等单测是 task-05（本任务的 blocks）。
- **不改 `scan_generate` 的签名与返回类型**，保持 `tuple[uuid.UUID, uuid.UUID]`。
- **不处理 change 执行 run 的去重**（只管 change_id IS NULL 的 scan run）。

## 参考

- `WorkspaceService._find_active_by_root_path`（service.py:739-751）——参考其私有查询方法的结构（`select(...).where(...).limit(1)` → `.scalars().first()`），`_find_active_scan_run` 照此风格写。
- `AgentService.list_runs`（agent/service.py:435-455）——参考经 `AgentRunWorkspace` 子查询关联 `workspace_id` 的写法（`arw_subq = select(AgentRunWorkspace.agent_run_id).where(...)` + `col(AgentRun.id).in_(arw_subq)`）。
- `AgentService.start_scan_dispatch`（agent/service.py:991-1057）——确认 scan run 建立时 `change_id=None`、`status="pending"`、并写入 `AgentRunWorkspace`，与本任务查询条件对应。

## TDD 步骤

> 本任务不落地测试文件（属 task-05），但实现须按可测设计推进。建议按以下顺序自验：

1. **写实现前先想清断言**：
   - 已存在一条 `change_id=None` 且 `status="pending"` 的 run + 对应 `AgentRunWorkspace` 时，`scan_generate` 返回的 run_id == 该已存在 run 的 id，且 `agent_service.start_scan_dispatch` 未被调用。
   - 无进行中 run 时，`start_scan_dispatch` 被调用一次，返回新 run id。
2. **实现 `_find_active_scan_run`**：先单独验证查询——在 session 里造 workspace + 一条 pending scan run + 关联，断言方法返回该 run；再造一条 `status="completed"` 的，断言不被命中。
3. **接入 `scan_generate` 幂等分支**：用 mock/stub 的 `agent_service`，断言命中分支下 `start_scan_dispatch` 未被 await（调用计数为 0）。
4. **回归无进行中 run 路径**：断言原行为不变（新建 run、返回其 id）。
5. **change_id 非空隔离**：造一条 `change_id=<某change>` 且 `status="running"` 的 run，断言**不**命中幂等（仍会新建 scan run）。
6. 跑 `pytest backend/app/modules/workspace/tests/`（task-05 落地后），确保全绿。

## 验收标准

| AC | 验收点 | 验证方式 | 通过条件 |
|----|--------|----------|----------|
| AC-1 | 存在 pending/running 的 scan run 时幂等返回 | 造一条 `change_id=None`、`status="pending"` 的 run + `AgentRunWorkspace` 关联，调用 `scan_generate` | 返回的 run_id == 已存在 run 的 id；`start_scan_dispatch` 调用次数为 0 |
| AC-2 | 无进行中 run 时行为不变 | 无任何关联 scan run，调用 `scan_generate` | `start_scan_dispatch` 被调用一次，返回新建 run 的 id；原步骤 5/6/7 逻辑未改动 |
| AC-3 | 终态 run 不触发幂等 | 仅存在 `status ∈ {completed, failed, killed}` 的 run，调用 `scan_generate` | 不命中幂等，正常新建并返回新 run id |
| AC-4 | change 执行 run 不被误判为 scan run | 存在 `change_id` 非空、`status="running"` 的 run，调用 `scan_generate` | 不命中幂等（仍新建 scan run）；查询条件含 `change_id IS NULL` |
| AC-5 | 多条进行中 run 取最近一条且不报错 | 造两条 pending/running scan run | 返回其中最近一条（按 started_at desc），不抛异常 |
| AC-6 | 签名 / 返回类型不变 | 检查 `scan_generate` 定义与 import | 签名仍为关键字参数 `root_path/user_id/agent_service`，返回 `tuple[uuid.UUID, uuid.UUID]`；仅改 `backend/app/modules/workspace/service.py` |
