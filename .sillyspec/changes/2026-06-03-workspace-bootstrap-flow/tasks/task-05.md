---
id: task-05
title: 后端 scan_generate 幂等返回单测
priority: P1
estimated_hours: 2
created_at: 2026-06-03 15:22:01
author: WhaleFall
depends_on: [task-01]
blocks: []
allowed_paths:
  - backend/tests/modules/workspace/test_scan_generate_service.py
---

# task-05 后端 scan_generate 幂等返回单测

## 概述

为 task-01 在 `WorkspaceService.scan_generate` 中实现的「幂等返回进行中 scan run」逻辑编写单元测试。

task-01 的核心语义（见 design.md 决策 3）：`scan_generate` 在调用 `start_scan_dispatch` 之前，先查询该 workspace 是否已存在「进行中」的 scan run——判定条件为经 `AgentRunWorkspace` 关联到该 workspace，且 `AgentRun.change_id IS NULL`（scan/bootstrap run），且 `AgentRun.status` 属于 `pending` / `running`。若存在，直接返回该 run 的 `(workspace_id, run_id)`，**不调用** `start_scan_dispatch`、**不新建** AgentRun；若不存在（无 run，或仅有 completed / failed / killed 的历史 run），则走原有路径新建并触发 dispatch。

本任务只新增测试，**不改任何源代码**。测试落在现有文件 `backend/tests/modules/workspace/test_scan_generate_service.py` 末尾追加，复用其既有 fixture 与风格。

## 修改文件（精确路径）

| 文件 | 变更 | 说明 |
|---|---|---|
| `backend/tests/modules/workspace/test_scan_generate_service.py` | 增（追加测试用例 + 一个本地 helper） | 新增 4 个幂等相关测试函数及构造进行中 run 的 helper；复用现有 `mock_agent_service` fixture 与 `db_session` / `tmp_path` |

不修改：
- `backend/app/modules/workspace/service.py`（由 task-01 实现，本任务只测）
- 任何前端文件
- 任何 `_execute_scan_run` / reparse 相关文件（task-06 负责）

## 实现要求（逐用例 Arrange / Act / Assert）

所有测试为 `@pytest.mark.asyncio`，签名形如
`async def test_xxx(db_session: AsyncSession, mock_agent_service, tmp_path):`。

### 用例 1：无进行中 run 时正常新建并触发 dispatch

- **Arrange**：建临时项目目录 `project_dir = tmp_path / "p1"; project_dir.mkdir()`。`fake_run.id = uuid.uuid4()`；`mock_agent_service.start_scan_dispatch.return_value = fake_run`。不预置任何 AgentRun。
- **Act**：`ws_id, run_id = await svc.scan_generate(root_path=str(project_dir), user_id=uuid.uuid4(), agent_service=mock_agent_service)`。
- **Assert**：`run_id == fake_run.id`；`mock_agent_service.start_scan_dispatch.assert_awaited_once()`。（兜底回归：与现有 `test_scan_generate_creates_workspace_and_spec` 同义，确认幂等改动未破坏无 run 路径。）

### 用例 2：已有 pending/running scan run 时幂等返回，不触发 dispatch

- **Arrange**：
  1. 先调用一次 `scan_generate` 创建 workspace（第一次会触发 dispatch），记下 `ws_id` 与 `run_id_existing`；或直接用 helper 造数据（见「接口定义」）：手动建 Workspace（或复用第一次调用产生的）+ `AgentRun(agent_type="claude_code", status="running", change_id=None)` + `AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws_id)`，`await db_session.flush()`。
  2. 重置 mock：`mock_agent_service.start_scan_dispatch.reset_mock()`，使 `assert_not_awaited()` 不被第一次调用污染。
- **Act**：对同一 `root_path` 再次 `await svc.scan_generate(...)`，得 `ws_id_2, run_id_2`。
- **Assert**：`ws_id_2 == ws_id`；`run_id_2 == run_id_existing`（返回的是进行中那条 run）；`mock_agent_service.start_scan_dispatch.assert_not_awaited()`。
- 对 `status="pending"` 重复同样断言（参数化或单独函数），覆盖两种进行中状态。

### 用例 3：仅有 completed / failed run 时仍新建并触发 dispatch

- **Arrange**：建 workspace；造一条 `AgentRun(agent_type="claude_code", status="completed", change_id=None)` + 对应 `AgentRunWorkspace` 关联；`flush`。`start_scan_dispatch.return_value = fake_run_new`（`fake_run_new.id = uuid.uuid4()`）；`reset_mock()`。
- **Act**：对该 workspace 的 `root_path` 调 `scan_generate`。
- **Assert**：`run_id == fake_run_new.id`（新 run，而非已完成的那条）；`start_scan_dispatch.assert_awaited_once()`。
- 对 `status="failed"` 重复同样断言（参数化或单独函数）。

### 用例 4：多条进行中 run 时取最近一条返回

- **Arrange**：建 workspace；造两条 `status="running"`、`change_id=None` 的 AgentRun，分别 `older` / `newer`，`started_at`（或 `created_at`）`newer` 晚于 `older`（如 `older.started_at = now - timedelta(minutes=5)`，`newer.started_at = now`）；两条都建 `AgentRunWorkspace` 关联；`flush`。`reset_mock()`。
- **Act**：对该 workspace 的 `root_path` 调 `scan_generate`。
- **Assert**：`run_id == newer.id`（返回最近一条）；`start_scan_dispatch.assert_not_awaited()`。

> 排序键约定：task-01 以 `AgentRun.started_at`（或缺省时 `created_at`）降序取第一条作为「最近」。测试两个字段都赋值以避免对实现细节耦合（若 task-01 用 `created_at`，则也令 `newer.created_at > older.created_at`）。

## 接口定义（fixture / mock / 数据构造，照此实现）

### 复用已有 fixture（文件顶部已存在）

```python
@pytest.fixture
def mock_agent_service():
    svc = MagicMock(spec=AgentService)
    svc.start_scan_dispatch = AsyncMock()
    return svc
```

`db_session: AsyncSession` 与 `tmp_path` 由 `backend/conftest.py` / pytest 提供，无需改动。

### 顶部补充 import（若尚未存在）

```python
from datetime import datetime, timedelta

from app.modules.agent.model import AgentRun
from app.modules.workspace.model import AgentRunWorkspace
```

（现有文件已 import `uuid`、`pytest`、`AsyncSession`、`MagicMock`、`AsyncMock`、`Workspace`、`WorkspaceService`。）

### 构造「进行中 scan run」的本地 helper

放在文件中部，供用例 2/3/4 复用：

```python
async def _make_scan_run(
    db_session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    status: str = "running",
    started_at: datetime | None = None,
) -> AgentRun:
    """造一条 scan/bootstrap run（change_id=None）并关联到 workspace。"""
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",   # NOT NULL，必须显式赋值
        status=status,
        change_id=None,             # scan/bootstrap run 的判定关键
        started_at=started_at or datetime.utcnow(),
    )
    db_session.add(run)
    await db_session.flush()
    db_session.add(
        AgentRunWorkspace(agent_run_id=run.id, workspace_id=workspace_id)
    )
    await db_session.flush()
    return run
```

要点：
- `agent_type` 在模型里 **无默认值且 NOT NULL**（`backend/app/modules/agent/model.py:60`），必须传值。
- `change_id=None` 是 scan run 与 change-bound run 的区分点；务必显式设 None。
- 通过 `AgentRunWorkspace`（`backend/app/modules/workspace/model.py:217`）建立 run↔workspace 关联，task-01 的查询走该关联表。
- 用 `flush()` 而非 `commit()`，与现有测试一致（session 在 fixture 内自然回收）。

### 获取 workspace_id 的两种方式

- 方式 A（推荐，最贴近真实路径）：先 `await svc.scan_generate(...)` 触发一次创建拿到 `ws_id`，再对同一 `root_path` 造进行中 run、`reset_mock()`、再次调用断言幂等。
- 方式 B：手动建 `Workspace(...)`（参考现有测试 import 的 `Workspace`，至少给 `id/name/slug/root_path/status/created_by/created_at/updated_at`）并 flush，再造 run。优先用方式 A，减少与 Workspace 必填字段的耦合。

### mock 与 monkeypatch 约定

- 不需要 monkeypatch 模块级函数；`start_scan_dispatch` 已是注入的 `mock_agent_service` 的 AsyncMock，直接断言 `assert_awaited_once()` / `assert_not_awaited()`。
- 用例 2/3/4 在「预置 run / 第一次触发」之后、被测调用之前，调用 `mock_agent_service.start_scan_dispatch.reset_mock()` 清除调用计数。
- 幂等命中分支返回值来自 DB 中的 run，**不**经过 `start_scan_dispatch`，因此该分支无需设置 `return_value`。

## 边界处理（≥5 条测试场景）

1. **无任何 run**：仅触发新建 + dispatch 一次（用例 1）。
2. **pending run 存在**：幂等返回该 run id，dispatch 不被调用（用例 2 子场景）。
3. **running run 存在**：幂等返回该 run id，dispatch 不被调用（用例 2 子场景）。
4. **completed run 存在**：忽略历史完成 run，新建并 dispatch（用例 3 子场景）。
5. **failed run 存在**：忽略历史失败 run，新建并 dispatch（用例 3 子场景）。
6. **多条进行中 run**：取 `started_at`/`created_at` 最近一条返回，dispatch 不被调用（用例 4）。
7. **隔离性边界**：进行中 run 关联到「另一个」workspace（不同 `root_path`）时，当前 workspace 的 `scan_generate` 不应命中幂等——应正常新建并 dispatch。（造 run 关联到一个无关 `other_ws_id`，断言被测 workspace 仍 `assert_awaited_once()`。可选加固用例。）
8. **change-bound run 不算 scan run 边界**：造一条 `status="running"` 但 `change_id=uuid.uuid4()`（非 None）的 run 关联到本 workspace，断言 `scan_generate` **不**命中幂等、仍新建并 dispatch——证明 `change_id IS NULL` 过滤生效。（可选加固用例。）

至少实现 1–6；7、8 作为加固边界建议一并实现以锁定判定条件。

## 非目标

- 不测前端（弹窗跳转、详情页 SSE 恢复由 task-03/04 及其前端测试覆盖）。
- 不测 `_execute_scan_run` 的收尾 reparse 逻辑（task-06 负责）。
- 不测 HTTP 端点层（`test_scan_generate.py` 已覆盖路由/鉴权/校验）。
- 不测真实 agent 调度、真实 SSE、真实数据库（仍用内存 SQLite + mock）。
- 不测 slug 冲突 / 路径校验 / 名称取值（现有测试已覆盖）。

## 参考

- 现有写法范本：`backend/tests/modules/workspace/test_scan_generate_service.py`
  - `mock_agent_service` fixture（顶部）：`MagicMock(spec=AgentService)` + `start_scan_dispatch = AsyncMock()`。
  - `test_scan_generate_creates_workspace_and_spec`：标准新建 + `assert_awaited_once()` 范式。
  - `test_scan_generate_idempotent_reuse`：用 `side_effect=[fake_run_1, fake_run_2]` 处理两次调用、复用 workspace 的范式（本任务用例 2/3 可借鉴该「先调一次再调一次」结构）。
- 被测实现：`backend/app/modules/workspace/service.py:647`（`scan_generate`），task-01 将在 step 5 调用 `start_scan_dispatch` 之前插入幂等查询。
- 模型：
  - `AgentRun`：`backend/app/modules/agent/model.py:14`（`agent_type` NOT NULL；`status` 默认 `pending`；`change_id` 可空）。
  - `AgentRunWorkspace`：`backend/app/modules/workspace/model.py:217`（`agent_run_id` + `workspace_id` 复合主键）。
- fixture 来源：`backend/conftest.py`（`db_engine` 注册 agent / workspace 等模型表，`db_session` 提供内存会话）。

## TDD 步骤

1. 在 `test_scan_generate_service.py` 顶部补充 `datetime/timedelta`、`AgentRun`、`AgentRunWorkspace` 的 import。
2. 加入 `_make_scan_run` helper。
3. 写用例 2（running 幂等）→ 运行 `pytest backend/tests/modules/workspace/test_scan_generate_service.py -k idempotent_active -q`。此时 task-01 若未实现，应 **失败**（dispatch 仍被调用 / 返回新 run id）——红。
4. 待 task-01 实现后再次运行 → 绿。（若 task-01 已合入，则写完即应转绿。）
5. 依次补齐用例 1、3（completed/failed）、4（多条取最近），每个先跑确认覆盖到预期分支。
6. 补加固用例 7、8（隔离性 / change-bound 排除）。
7. 全量跑 `pytest backend/tests/modules/workspace/test_scan_generate_service.py -q` 全绿。
8. 跑 `ruff check` / 项目既有 lint，确保 import 排序与风格一致。

## 验收标准

| AC | 验收点 | 验证方式 |
|---|---|---|
| AC-1 | 无进行中 run 时，`scan_generate` 新建并 `start_scan_dispatch` 被 await 恰一次 | 用例 1 通过：`assert_awaited_once()` |
| AC-2 | 存在 pending **或** running 的 scan run（change_id IS NULL）时，返回该 run id 且 `start_scan_dispatch` **不**被调用 | 用例 2（两状态）通过：`run_id == 既有 run.id` 且 `assert_not_awaited()` |
| AC-3 | 仅有 completed **或** failed run 时，仍新建并 `start_scan_dispatch` 被 await 一次，返回新 run id | 用例 3（两状态）通过：`run_id == 新 run.id` 且 `assert_awaited_once()` |
| AC-4 | 多条进行中 run 时，返回 `started_at`/`created_at` 最近一条；dispatch 不被调用 | 用例 4 通过：`run_id == newer.id` 且 `assert_not_awaited()` |
| AC-5 | 进行中 run 仅关联到「其他 workspace」或为 change-bound（change_id 非 None）时不命中幂等，本 workspace 正常新建并 dispatch | 加固用例 7/8 通过：`assert_awaited_once()` |
| AC-6 | 全文件测试通过，无源代码改动，lint 通过 | `pytest backend/tests/modules/workspace/test_scan_generate_service.py -q` 全绿 + `ruff check` 无报错 |
