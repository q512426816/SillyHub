---
id: task-05
title: 新增 build_stage_bundle() 上下文构建函数
author: qinyi
created_at: 2026-06-01 06:55:30
priority: P0
estimated_hours: 3
depends_on: [task-02, task-03]
blocks: [task-07, task-18]
allowed_paths:
  - backend/app/modules/agent/context_builder.py
---

# task-05: 新增 build_stage_bundle() 上下文构建函数

## 修改文件（必填）
- `backend/app/modules/agent/context_builder.py` — 新增 `build_stage_bundle()` 异步函数

## 实现要求

根据 design.md Phase 2 "构造阶段级 bundle" 章节，在 `backend/app/modules/agent/context_builder.py` 中新增 `build_stage_bundle()` 函数。该函数是阶段级 Agent 调度的核心上下文构建入口，负责从数据库加载 Change 记录和已有文档内容，组装为完整的 `AgentSpecBundle`。

### 函数签名

```python
async def build_stage_bundle(
    session: AsyncSession,
    change_id: UUID,
    stage: str,
    workspace_id: UUID,
    *,
    read_only: bool = False,
    step_prompt: str | None = None,
) -> AgentSpecBundle:
```

### 具体实现步骤

1. 在 `context_builder.py` 文件末尾（`_read_file_safe` 函数之前或之后均可），新增 `build_stage_bundle()` 函数
2. 函数体按以下顺序执行：

   **Step 1 — 校验 Workspace 存在性**
   ```python
   workspace = await session.get(Workspace, workspace_id)
   if workspace is None:
       raise WorkspaceNotFound(f"Workspace '{workspace_id}' not found.")
   ```

   **Step 2 — 加载 Change 记录**
   ```python
   change = await session.get(Change, change_id)
   if change is None:
       raise ChangeNotFound(f"Change '{change_id}' not found.")
   ```

   **Step 3 — 加载已有文档内容**
   ```python
   stmt = select(ChangeDocument).where(
       col(ChangeDocument.change_id) == change_id,
       col(ChangeDocument.exists).is_(True),
   )
   docs = list((await session.execute(stmt)).scalars().all())

   doc_content: dict[str, str | None] = {}
   for doc in docs:
       doc_content[doc.doc_type] = _read_file_safe(doc.path)
   ```

   **Step 4 — 读取 spec_root 路径**
   ```python
   sw_stmt = select(SpecWorkspace).where(
       col(SpecWorkspace.workspace_id) == workspace_id,
   )
   spec_ws = (await session.execute(sw_stmt)).scalar_one_or_none()
   spec_root: str | None = spec_ws.spec_root if spec_ws else None
   ```

   **Step 5 — 组装 AgentSpecBundle**
   ```python
   bundle = AgentSpecBundle(
       # 核心 context
       change_summary=change.title or change.change_key,
       task_key=f"stage:{stage}",
       task_title=f"Stage dispatch: {stage}",
       # 已有文档内容
       proposal=doc_content.get("proposal"),
       requirements=doc_content.get("requirements"),
       design=doc_content.get("design"),
       plan=doc_content.get("plan"),
       task_markdown=doc_content.get("tasks"),
       # 约束（阶段级调度无 task 级 allowed_paths）
       allowed_paths=[],
       denied_paths=[],
       # 工具
       available_tools=["sillyspec"],
       # 元数据
       platform_metadata={
           "workspace_id": str(workspace_id),
           "change_id": str(change_id),
           "change_key": change.change_key,
           "stage": stage,
       },
       # Stage dispatch 扩展字段（task-02 新增）
       stage_dispatch=True,
       change_key=change.change_key,
       stage=stage,
       spec_root=spec_root,
       step_prompt=step_prompt,
       read_only=read_only,
   )
   ```

   **Step 6 — 记录日志并返回**
   ```python
   log.info(
       "stage_bundle_built",
       change_key=bundle.change_key,
       stage=bundle.stage,
       spec_root=bundle.spec_root,
       doc_types=list(doc_content.keys()),
       read_only=read_only,
   )
   return bundle
   ```

### 注意事项

- 文档内容使用 `_read_file_safe()` 读取，文件不存在或读取出错时返回 `None`，不报错
- `task_markdown` 对应 `ChangeDocument.doc_type == "tasks"` 的文档内容
- `task_key` 使用 `stage:{stage}` 格式（如 `stage:propose`），与 task-level 的 `task-01` 格式区分
- `change_summary` 优先用 `change.title`，若为 `None` 则 fallback 到 `change.change_key`

## 接口定义（代码类任务必填）

### 函数签名

```python
async def build_stage_bundle(
    session: AsyncSession,
    change_id: UUID,
    stage: str,
    workspace_id: UUID,
    *,
    read_only: bool = False,
    step_prompt: str | None = None,
) -> AgentSpecBundle:
    """构造阶段级 AgentSpecBundle，用于 SillySpec 阶段调度。

    Args:
        session: 异步数据库会话。
        change_id: 变更 ID。
        stage: 目标 SillySpec 阶段名称（如 "propose"、"plan"）。
        workspace_id: 工作区 ID。
        read_only: 是否只读模式。默认 False。
        step_prompt: SillySpec CLI 当前 step 输出的 prompt。默认 None。

    Returns:
        完整的 AgentSpecBundle，stage_dispatch=True。

    Raises:
        ChangeNotFound: change_id 对应的 Change 记录不存在。
        WorkspaceNotFound: workspace_id 对应的 Workspace 不存在。
    """
```

### 控制流伪代码

```
build_stage_bundle(session, change_id, stage, workspace_id, read_only, step_prompt):
    1. session.get(Workspace, workspace_id)
       - None → raise WorkspaceNotFound
    2. session.get(Change, change_id)
       - None → raise ChangeNotFound
    3. 查询 ChangeDocument WHERE change_id AND exists=True
       - 遍历 docs，用 _read_file_safe(path) 读内容 → doc_content dict
       - 文件不存在/读取失败 → 对应值为 None（不报错）
    4. 查询 SpecWorkspace WHERE workspace_id
       - 存在 → spec_root = spec_ws.spec_root
       - 不存在 → spec_root = None
    5. 组装 AgentSpecBundle:
       - change_summary = change.title ?? change.change_key
       - task_key = "stage:{stage}"
       - task_title = "Stage dispatch: {stage}"
       - proposal/requirements/design/plan/task_markdown = doc_content 对应值（可能为 None）
       - stage_dispatch = True
       - change_key = change.change_key
       - stage = stage
       - spec_root = spec_root（可能为 None）
       - step_prompt = step_prompt（可能为 None）
       - read_only = read_only
    6. log.info("stage_bundle_built", ...)
    7. return bundle
```

### 需要的 import

函数体依赖以下已有 import（`context_builder.py` 已包含）：
- `uuid.UUID` — 通过参数类型使用
- `sqlalchemy.select` — 已导入
- `sqlalchemy.ext.asyncio.AsyncSession` — 已导入
- `sqlmodel.col` — 已导入
- `Change`, `ChangeDocument` — 已从 `app.modules.change.model` 导入
- `AgentSpecBundle` — 已从 `app.modules.agent.base` 导入
- `SpecWorkspace` — 已从 `app.modules.spec_workspace.model` 导入
- `Workspace` — 已从 `app.modules.workspace.model` 导入
- `ChangeNotFound`, `WorkspaceNotFound` — 需新增从 `app.core.errors` 导入

**需要新增的 import 行**：

在文件顶部的 import 区域，添加：
```python
from app.core.errors import ChangeNotFound, WorkspaceNotFound
```

## 边界处理（必填，至少5条）

1. **Change 不存在时**：`session.get(Change, change_id)` 返回 `None` → 抛出 `ChangeNotFound` 异常，包含 change_id 信息。调用方（`SillySpecStageDispatchService`）捕获此异常并返回错误响应。
2. **Workspace 不存在时**：`session.get(Workspace, workspace_id)` 返回 `None` → 抛出 `WorkspaceNotFound` 异常。先于 Change 校验，因为 workspace_id 是外键来源。
3. **文档内容不存在时**：`ChangeDocument` 查询结果为空列表，或 `_read_file_safe()` 返回 `None`（文件路径不存在、文件读取出错、编码错误等） → 对应 `doc_content` 字段为 `None`，不报错。这是正常场景（如变更刚创建时还没有 proposal 文档）。
4. **spec_root 路径不存在时**：`SpecWorkspace` 行不存在，或 `spec_root` 对应的磁盘路径不存在 → bundle 的 `spec_root` 为 `None`。不报错，由下游 `SillySpecStageDispatchService` 和 adapter 决定如何处理。
5. **step_prompt 为 None 时**：这是默认值场景（初始 dispatch 时还没有 CLI 输出的 step prompt） → bundle 的 `step_prompt` 为 `None`。adapter 生成 prompt 时跳过 step_prompt 区块。
6. **change.title 为 None 时**：`change_summary` fallback 到 `change.change_key`，保证 bundle 的 `change_summary` 永远非空。

## 非目标

- **不修改**现有的 `build_spec_bundle()` 函数（task-level bundle 构建逻辑）
- **不修改**现有的 `render_bundle_to_claude_md()` 函数（由 task-06 负责）
- **不修改**现有的 `render_claude_md()` 函数
- **不修改** `AgentSpecBundle` dataclass 定义（由 task-02 负责）
- **不负责** sillyspec.db 的读取（由 task-09 的 `sync_stage_status` 负责）
- **不负责**创建 AgentRun（由 task-07 的 `dispatch_next_step` 负责）
- **不负责** CLAUDE.md 的写入（由 adapter 的 `run_with_bundle` 负责）

## 参考

- `design.md` Phase 2 "构造阶段级 bundle" 章节（第 172-191 行）
- `plan.md` task-05 定义（第 81 行）
- `requirements.md` FR-05 "AgentSpecBundle 含阶段上下文"（第 69-80 行）
- 现有 `build_spec_bundle()` 源码：`backend/app/modules/agent/context_builder.py` 第 206-312 行
- `AgentSpecBundle` dataclass：`backend/app/modules/agent/base.py` 第 53-89 行
- `Change` model：`backend/app/modules/change/model.py` 第 108-191 行
- `ChangeDocument` model：`backend/app/modules/change/model.py` 第 193-228 行
- `SpecWorkspace` model：`backend/app/modules/spec_workspace/model.py` 第 25-89 行

## TDD 步骤

1. **写测试**：在 `backend/tests/modules/agent/test_stage_dispatch.py`（新测试文件，与 task-18 共用）中编写以下测试：
   - `test_build_stage_bundle_returns_valid_bundle`：mock session 返回有效的 Change、Workspace、SpecWorkspace、ChangeDocument（含 proposal），调用 `build_stage_bundle()`，断言返回 bundle 的 `stage_dispatch == True`、`change_key == change.change_key`、`stage == "propose"`、`spec_root` 非空、`proposal` 非空
   - `test_build_stage_bundle_change_not_found`：mock session.get(Change, ...) 返回 `None`，断言抛出 `ChangeNotFound`
   - `test_build_stage_bundle_workspace_not_found`：mock session.get(Workspace, ...) 返回 `None`，断言抛出 `WorkspaceNotFound`
   - `test_build_stage_bundle_no_documents`：mock ChangeDocument 查询返回空列表，断言 bundle 的 `proposal`/`requirements`/`design`/`plan` 全部为 `None`，不报错
   - `test_build_stage_bundle_no_spec_workspace`：mock SpecWorkspace 查询返回 `None`，断言 bundle 的 `spec_root` 为 `None`，不报错
   - `test_build_stage_bundle_with_step_prompt`：传入 `step_prompt="Do step 1"`，断言 bundle 的 `step_prompt == "Do step 1"`
   - `test_build_stage_bundle_read_only_true`：传入 `read_only=True`，断言 bundle 的 `read_only is True`
2. **确认失败**：运行测试，因函数不存在而 `ImportError` 失败
3. **实现函数**：在 `context_builder.py` 中添加 `build_stage_bundle()` 函数，添加 `ChangeNotFound`/`WorkspaceNotFound` 的 import
4. **确认通过**：运行测试，全部通过
5. **验证现有测试不受影响**：运行 `pytest backend/tests/modules/agent/` 全量测试，确保无 breaking change

### 测试代码参考

```python
"""Tests for build_stage_bundle() — task-05."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ChangeNotFound, WorkspaceNotFound
from app.modules.agent.base import AgentSpecBundle
from app.modules.agent.context_builder import build_stage_bundle
from app.modules.change.model import Change, ChangeDocument
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace


@pytest.fixture
def fake_workspace_id():
    return uuid.uuid4()


@pytest.fixture
def fake_change_id():
    return uuid.uuid4()


@pytest.fixture
def fake_workspace(fake_workspace_id):
    ws = MagicMock(spec=Workspace)
    ws.id = fake_workspace_id
    ws.name = "test-workspace"
    return ws


@pytest.fixture
def fake_change(fake_change_id, fake_workspace_id):
    change = MagicMock(spec=Change)
    change.id = fake_change_id
    change.workspace_id = fake_workspace_id
    change.change_key = "agent-stage-dispatch"
    change.title = "Agent Stage Dispatch"
    return change


@pytest.fixture
def fake_spec_workspace(fake_workspace_id):
    sw = MagicMock(spec=SpecWorkspace)
    sw.workspace_id = fake_workspace_id
    sw.spec_root = "/data/workspaces/test/.sillyspec"
    return sw


@pytest.fixture
def fake_change_doc(fake_change_id, tmp_path):
    doc = MagicMock(spec=ChangeDocument)
    doc.change_id = fake_change_id
    doc.doc_type = "proposal"
    proposal_file = tmp_path / "proposal.md"
    proposal_file.write_text("# Proposal\n\nTest proposal content")
    doc.path = str(proposal_file)
    doc.exists = True
    return doc


async def _mock_session(fake_workspace, fake_change, fake_spec_workspace, fake_change_docs):
    """构造一个 mock session，按 get/query 调用返回预设对象。"""
    session = AsyncMock(spec=AsyncSession)

    async def _get(model, pk):
        if model is Workspace:
            return fake_workspace
        if model is Change:
            return fake_change
        return None

    session.get = AsyncMock(side_effect=_get)

    # SpecWorkspace 查询
    sw_scalar = MagicMock()
    sw_scalar.scalar_one_or_none = MagicMock(return_value=fake_spec_workspace)

    # ChangeDocument 查询
    scalars_mock = MagicMock()
    scalars_mock.all = MagicMock(return_value=fake_change_docs)
    result_mock = MagicMock()
    result_mock.scalars = MagicMock(return_value=scalars_mock)

    async def _execute(stmt):
        return result_mock

    session.execute = AsyncMock(side_effect=_execute)
    return session


@pytest.mark.asyncio
async def test_build_stage_bundle_returns_valid_bundle(
    fake_workspace, fake_change, fake_spec_workspace, fake_change_doc,
):
    """build_stage_bundle 返回包含正确 stage 字段的 bundle。"""
    session = await _mock_session(
        fake_workspace, fake_change, fake_spec_workspace, [fake_change_doc],
    )
    bundle = await build_stage_bundle(
        session, fake_change.id, "propose", fake_workspace.id,
    )

    assert isinstance(bundle, AgentSpecBundle)
    assert bundle.stage_dispatch is True
    assert bundle.change_key == "agent-stage-dispatch"
    assert bundle.stage == "propose"
    assert bundle.spec_root == "/data/workspaces/test/.sillyspec"
    assert bundle.proposal is not None
    assert "Test proposal content" in bundle.proposal
    assert bundle.read_only is False
    assert bundle.step_prompt is None


@pytest.mark.asyncio
async def test_build_stage_bundle_change_not_found(fake_workspace):
    """Change 不存在时抛出 ChangeNotFound。"""
    session = AsyncMock(spec=AsyncSession)

    async def _get(model, pk):
        if model is Workspace:
            return fake_workspace
        return None

    session.get = AsyncMock(side_effect=_get)

    with pytest.raises(ChangeNotFound):
        await build_stage_bundle(
            session, uuid.uuid4(), "propose", fake_workspace.id,
        )


@pytest.mark.asyncio
async def test_build_stage_bundle_workspace_not_found():
    """Workspace 不存在时抛出 WorkspaceNotFound。"""
    session = AsyncMock(spec=AsyncSession)
    session.get = AsyncMock(return_value=None)

    with pytest.raises(WorkspaceNotFound):
        await build_stage_bundle(
            session, uuid.uuid4(), "propose", uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_build_stage_bundle_no_documents(
    fake_workspace, fake_change, fake_spec_workspace,
):
    """文档不存在时 bundle 的文档字段为 None，不报错。"""
    session = await _mock_session(
        fake_workspace, fake_change, fake_spec_workspace, [],
    )
    bundle = await build_stage_bundle(
        session, fake_change.id, "plan", fake_workspace.id,
    )

    assert bundle.proposal is None
    assert bundle.requirements is None
    assert bundle.design is None
    assert bundle.plan is None
    assert bundle.task_markdown is None
    assert bundle.stage_dispatch is True


@pytest.mark.asyncio
async def test_build_stage_bundle_no_spec_workspace(
    fake_workspace, fake_change,
):
    """SpecWorkspace 不存在时 spec_root 为 None，不报错。"""
    session = await _mock_session(
        fake_workspace, fake_change, None, [],
    )
    bundle = await build_stage_bundle(
        session, fake_change.id, "propose", fake_workspace.id,
    )

    assert bundle.spec_root is None
    assert bundle.stage_dispatch is True


@pytest.mark.asyncio
async def test_build_stage_bundle_with_step_prompt(
    fake_workspace, fake_change, fake_spec_workspace,
):
    """传入 step_prompt 时 bundle 正确包含。"""
    session = await _mock_session(
        fake_workspace, fake_change, fake_spec_workspace, [],
    )
    bundle = await build_stage_bundle(
        session, fake_change.id, "propose", fake_workspace.id,
        step_prompt="Write the proposal document for this change",
    )

    assert bundle.step_prompt == "Write the proposal document for this change"


@pytest.mark.asyncio
async def test_build_stage_bundle_read_only_true(
    fake_workspace, fake_change, fake_spec_workspace,
):
    """read_only=True 时 bundle 正确标记。"""
    session = await _mock_session(
        fake_workspace, fake_change, fake_spec_workspace, [],
    )
    bundle = await build_stage_bundle(
        session, fake_change.id, "scan", fake_workspace.id,
        read_only=True,
    )

    assert bundle.read_only is True
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | 调用 `build_stage_bundle()` 返回的 bundle 的 `stage_dispatch` | `== True` |
| AC-02 | bundle 的 `change_key` | 不为 None，`== change.change_key` |
| AC-03 | bundle 的 `stage` | `==` 传入的 stage 参数（如 `"propose"`） |
| AC-04 | proposal 文档存在时 bundle 的 `proposal` | 包含实际文档内容（非 None） |
| AC-05 | Change 不存在时 | 抛出 `ChangeNotFound` 异常 |
| AC-06 | Workspace 不存在时 | 抛出 `WorkspaceNotFound` 异常 |
| AC-07 | 所有文档均不存在时 | 不报错，`proposal`/`requirements`/`design`/`plan`/`task_markdown` 全部为 `None` |
| AC-08 | `spec_root` 路径不存在（SpecWorkspace 行不存在）时 | bundle 的 `spec_root` 为 `None`，不报错 |
| AC-09 | 运行 `pytest backend/tests/modules/agent/test_stage_dispatch.py` | 新增测试全部通过 |
| AC-10 | 运行 `pytest backend/tests/modules/agent/test_context_builder.py` 全量通过 | 现有测试无 breaking change |
