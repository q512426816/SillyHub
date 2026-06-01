---
id: task-06
title: 后端 Agent 调度 — execute 端点 + SillySpec 命令调度
priority: P0
estimated_hours: 2
depends_on:
  - task-02
blocks:
  - task-08
allowed_paths:
  - backend/app/modules/agent/coordinator.py
  - backend/app/modules/agent/service.py
  - backend/app/modules/agent/schema.py
  - backend/app/modules/agent/router.py
  - backend/app/modules/change_writer/router.py
  - backend/app/modules/change/service.py
---

# task-06: 后端 Agent 调度

## 目标

实现变更执行能力：在 change_writer router 新增 `POST /workspaces/{id}/changes/{change_key}/execute` 端点，后端创建 AgentRun 记录并通过 `sillyspec run` 命令后台调度执行，每完成一个阶段回写 DB 进度。

## 操作步骤

### Step 1 — 新增 SillySpec 调度方法

文件：`backend/app/modules/agent/coordinator.py`

在 `ExecutionCoordinatorService` 类末尾新增：

```python
async def start_sillyspec_run(
    self,
    *,
    change_key: str,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    scope: str = "full",
    repo_dir: Path,
) -> AgentRun:
    """创建并启动一个 SillySpec AgentRun。

    Args:
        change_key: 变更 key（如 "2026-05-31-my-feature"）
        workspace_id: 工作空间 ID
        user_id: 发起用户 ID
        scope: "full" 或 "quick"
        repo_dir: 仓库根目录路径

    Returns:
        创建的 AgentRun 记录（status=pending）
    """
    import asyncio
    from app.modules.agent.model import AgentRun

    run = AgentRun(
        id=uuid.uuid4(),
        task_id=None,          # change-level run, 不关联 task
        lease_id=None,         # 不需要 lease
        agent_type=f"sillyspec_{scope}",
        status="pending",
        spec_strategy="sillyspec",
    )
    self.session.add(run)
    await self.session.commit()
    await self.session.refresh(run)

    # 后台执行
    asyncio.create_task(
        self._run_sillyspec_background(
            run_id=run.id,
            change_key=change_key,
            scope=scope,
            repo_dir=repo_dir,
            workspace_id=workspace_id,
            user_id=user_id,
        )
    )
    return run

async def _run_sillyspec_background(
    self,
    *,
    run_id: uuid.UUID,
    change_key: str,
    scope: str,
    repo_dir: Path,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """后台执行 sillyspec 命令并回写进度。"""
    from app.core.logging import get_logger
    from datetime import datetime
    from app.modules.change.service import ChangeService

    log = get_logger(__name__)
    run = await self.session.get(AgentRun, run_id)
    if run is None:
        return

    # 标记运行中
    run.status = "running"
    run.started_at = datetime.utcnow()
    self.session.add(run)
    await self.session.commit()

    try:
        # 构建命令
        cmd = (
            ["sillyspec", "run", "--change", change_key]
            if scope == "full"
            else ["sillyspec", "quick", "--change", change_key]
        )

        import asyncio
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(repo_dir),
        )
        stdout, stderr = await process.communicate()

        # 更新状态
        run.status = "completed" if process.returncode == 0 else "failed"
        run.finished_at = datetime.utcnow()
        run.exit_code = process.returncode
        run.output_redacted = (stdout or b"").decode("utf-8", errors="replace")[:10000]
        self.session.add(run)
        await self.session.commit()

        log.info(
            "sillyspec_run_completed",
            run_id=str(run_id),
            exit_code=process.returncode,
        )
    except Exception as exc:
        log.error("sillyspec_run_failed", run_id=str(run_id), error=str(exc))
        run.status = "failed"
        run.finished_at = datetime.utcnow()
        run.exit_code = 1
        run.output_redacted = str(exc)[:10000]
        self.session.add(run)
        await self.session.commit()
```

### Step 2 — 新增 execute 端点到 change_writer router

文件：`backend/app/modules/change_writer/router.py`

在现有端点之后添加新的 execute 路由：

```python
from app.modules.agent.coordinator import ExecutionCoordinatorService
from app.modules.workspace.model import Workspace
from app.modules.workspace.service import _rewrite_path

@router.post(
    "/changes/{change_key}/execute",
    response_model=dict,
)
async def execute_change(
    workspace_id: uuid.UUID,
    change_key: str,
    session: SessionDep,
    user: CurrentUser,
) -> dict:
    """启动变更执行 — 创建 SillySpec AgentRun 并后台调度。"""
    from pathlib import Path
    from sqlalchemy import select
    from sqlmodel import col
    from app.modules.change.model import Change

    # 查找 change
    stmt = select(Change).where(
        col(Change.workspace_id) == workspace_id,
        col(Change.change_key) == change_key,
    )
    change = (await session.execute(stmt)).scalars().first()
    if change is None:
        from app.core.errors import AppError
        raise AppError(f"Change '{change_key}' not found.", http_status=404)

    # 确定仓库目录
    workspace = await session.get(Workspace, workspace_id)
    if workspace is None:
        from app.core.errors import WorkspaceNotFound
        raise WorkspaceNotFound("Workspace not found.")
    repo_dir = Path(_rewrite_path(workspace.root_path))

    # 启动 sillyspec run
    coordinator = ExecutionCoordinatorService(session)
    scope = change.change_type if change.change_type in ("full", "quick") else "full"
    run = await coordinator.start_sillyspec_run(
        change_key=change_key,
        workspace_id=workspace_id,
        user_id=user.id,
        scope=scope,
        repo_dir=repo_dir,
    )

    return {"ok": True, "run_id": str(run.id)}
```

### Step 3 — 确保 AgentRun model 支持 task_id/lease_id 为空

文件：`backend/app/modules/agent/model.py`

检查 `AgentRun.task_id` 和 `AgentRun.lease_id` 是否允许 `NULL`。如果不允许，需要将其改为可空：
- `task_id: uuid.UUID | None = Field(default=None, ...)` 
- `lease_id: uuid.UUID | None = Field(default=None, ...)`

> 注意：如果 model 已经支持可空，跳过此步骤。

### Step 4 — 编写测试

文件：`backend/app/modules/agent/tests/test_sillyspec.py`（新建）

```python
"""Tests for SillySpec execution flow."""

import pytest
from unittest.mock import patch, AsyncMock

async def test_execute_change_creates_run(client, db_session, mock_repo_dir):
    """POST execute 应返回 run_id 并创建 AgentRun 记录。"""
    # ... 设置 prerequisites（复用 test_router 的 _setup_prerequisites）
    # ... mock subprocess
    # ... 断言响应包含 ok=True 和 run_id
    # ... 断言 DB 中存在 AgentRun 记录

async def test_execute_change_not_found(client, db_session):
    """对不存在的 change_key 应返回 404。"""
    # ...
```

### Step 5 — 运行测试

```bash
cd /Users/qinyi/SillyHub
.venv/bin/python -m pytest backend/app/modules/agent/tests/ -v -k "sillyspec or execute"
```

## 完成标准

- [ ] `POST /workspaces/{id}/changes/{change_key}/execute` 端点可用
- [ ] 端点创建 AgentRun 记录，`agent_type` 为 `sillyspec_full` 或 `sillyspec_quick`
- [ ] 后台通过 `asyncio.create_subprocess_exec` 执行 `sillyspec run/quick` 命令
- [ ] 执行完成后更新 AgentRun 状态为 completed/failed
- [ ] 不存在的 change_key 返回 404
- [ ] 测试通过

## 文件清单

| 文件 | 操作 |
|------|------|
| `backend/app/modules/agent/coordinator.py` | 修改 — 新增 `start_sillyspec_run` + `_run_sillyspec_background` |
| `backend/app/modules/change_writer/router.py` | 修改 — 新增 `execute_change` 端点 |
| `backend/app/modules/agent/model.py` | 可能修改 — 确保 task_id/lease_id 可空 |
| `backend/app/modules/agent/tests/test_sillyspec.py` | 新增 — SillySpec 调度测试 |
