---
author: qinyi
created_at: 2026-05-30 16:45:00
id: task-04
title: "git_commit_and_push 测试 — mock GitGatewayService，验证调用顺序和参数"
priority: P0
estimated_hours: 1.5
depends_on:
  - task-03
blocks:
  - task-07
allowed_paths:
  - backend/app/modules/change_writer/tests/test_service.py
  - backend/app/modules/change_writer/tests/test_router.py
---

# Task-04: git_commit_and_push 测试

## 修改文件

| 文件路径 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/change_writer/tests/test_service.py` | **新建** | service 层单元测试，mock `GitGatewayService`，测试 `git_commit_and_push` 的调用顺序、参数传递、错误处理 |
| `backend/app/modules/change_writer/tests/test_router.py` | **追加** | 新增 commit 端点的 HTTP 层测试（成功 201、未认证 401、change 不存在 404、lease 不存在 404） |

## 实现要求

### 1. test_service.py — service 层单元测试

**核心策略**: mock `GitGatewayService` 的 `execute` 方法，验证 `git_commit_and_push` 内部串行调用了 add → commit → push 三个操作，并正确传递参数和组装返回值。

**测试用例清单（≥7 个）**:

| # | 测试函数名 | 验证目标 |
|---|---|---|
| 1 | `test_commit_success_calls_add_commit_push_in_order` | 成功时按顺序调用 add → commit → push，验证每次调用的 operation 和 args |
| 2 | `test_commit_success_returns_git_commit_response` | 返回 `GitCommitResponse` 包含 `commit_sha`, `branch`, `pushed=True`, `operation_log_ids` |
| 3 | `test_commit_push_failure_still_returns_partial_result` | push 失败时返回 `pushed=False`，commit_sha 为 None（或上一步的 SHA），operation_log_ids 包含已执行的操作日志 ID |
| 4 | `test_commit_add_failure_raises_error` | add 失败时抛出 `ChangeWriteError`，后续 commit 和 push 不被调用 |
| 5 | `test_commit_invalid_lease_raises` | 传入不存在的 lease_id，`_get_active_lease` 抛出 `WorktreeLeaseNotFound` |
| 6 | `test_commit_change_not_found_raises` | 传入不存在的 change_id，`_get_change` 抛出 `ChangeWriteError` |
| 7 | `test_commit_push_to_protected_branch_raises` | push 操作目标为 main 分支时，GitGatewayService 返回 403 `GitOperationForbidden`，`git_commit_and_push` 透传该错误 |

**mock 模式**:

```python
from unittest.mock import AsyncMock, patch, MagicMock

# 方式一：patch GitGatewayService 类
# 在 test_service.py 中 patch "app.modules.change_writer.service.GitGatewayService"
# 因为 task-03 的实现会在 ChangeWriterService.git_commit_and_push 内部导入 GitGatewayService

async def test_commit_success_calls_add_commit_push_in_order():
    """验证 git_commit_and_push 串行调用 add → commit → push。"""
    with patch("app.modules.change_writer.service.GitGatewayService") as MockGitGateway:
        mock_instance = MockGitGateway.return_value
        # 模拟三次 execute 调用分别返回 add/commit/push 的 GitOperationLog
        mock_add_log = MagicMock()
        mock_add_log.id = uuid.uuid4()
        mock_add_log.result_code = 0
        mock_add_log.redacted_output = ""

        mock_commit_log = MagicMock()
        mock_commit_log.id = uuid.uuid4()
        mock_commit_log.result_code = 0
        mock_commit_log.redacted_output = "[main abc1234] my message"

        mock_push_log = MagicMock()
        mock_push_log.id = uuid.uuid4()
        mock_push_log.result_code = 0
        mock_push_log.redacted_output = "To github.com:org/repo.git\n   abc1234..def5678  HEAD -> feature-branch"

        mock_instance.execute = AsyncMock(side_effect=[mock_add_log, mock_commit_log, mock_push_log])

        service = ChangeWriterService(db_session)
        # 需要先在 DB 中创建 workspace, change, active lease（复用 _setup_prerequisites 模式）
        result = await service.git_commit_and_push(
            workspace_id, user_id,
            change_id=change_id,
            lease_id=lease_id,
            message="feat: add new feature",
            branch_name="feature-branch",
        )

        # 验证调用次数
        assert mock_instance.execute.call_count == 3

        # 验证调用顺序和参数
        calls = mock_instance.execute.call_args_list
        # 第一次调用：git add .
        assert calls[0].kwargs["operation"] == "add" or calls[0].args[2] == "add"
        # 第二次调用：git commit -m {message}
        assert calls[1].kwargs["operation"] == "commit" or calls[1].args[2] == "commit"
        # 第三次调用：git push origin {branch_name}
        assert calls[2].kwargs["operation"] == "push" or calls[2].args[2] == "push"
```

**注意**: `GitGatewayService.execute` 的签名是:
```python
async def execute(self, lease_id, user_id, operation, args, retry_policy=None) -> GitOperationLog
```
所以 mock `execute` 时，需要验证 `lease_id`、`user_id`、`operation`、`args` 四个位置参数。

**DB 准备**: 每个测试用例需要在内存 SQLite 中创建:
- `Workspace`（含 `repo_url`）
- `Change`（绑定 workspace）
- `WorktreeLease`（status="locked"，绑定 workspace + change + user）
- `User`（用于 user_id）

复用已有的 `_setup_prerequisites` 模式（参考 `test_router.py` 中的实现）。

### 2. test_router.py 追加 — commit 端点 HTTP 测试

**测试用例清单（≥4 个）**:

| # | 测试函数名 | 验证目标 |
|---|---|---|
| 1 | `test_commit_endpoint_success_201` | POST `/api/workspaces/{ws_id}/changes/{id}/commit` 带合法参数返回 201 |
| 2 | `test_commit_endpoint_no_auth_401` | 不带 Authorization header 返回 401 |
| 3 | `test_commit_endpoint_change_not_found_404` | 传入不存在的 change_id 返回 404 |
| 4 | `test_commit_endpoint_lease_not_found_404` | 传入不存在的 lease_id 返回 404 |

**mock 策略**: router 测试中 mock `ChangeWriterService.git_commit_and_push`，只测 HTTP 层。

```python
async def test_commit_endpoint_success_201(client, db_session):
    refs = await _setup_prerequisites(db_session)
    with patch(
        "app.modules.change_writer.router.ChangeWriterService"
    ) as MockService:
        mock_instance = MockService.return_value
        mock_response = MagicMock()
        mock_response.commit_sha = "abc1234def5678"
        mock_response.branch = "feature-branch"
        mock_response.pushed = True
        mock_response.operation_log_ids = [uuid.uuid4()]
        mock_instance.git_commit_and_push = AsyncMock(return_value=mock_response)

        resp = await client.post(
            f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/commit",
            json={
                "lease_id": str(refs["lease_id"]),
                "message": "feat: test commit",
                "branch_name": "feature-branch",
            },
            headers=_auth(refs["token"]),
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["commit_sha"] == "abc1234def5678"
    assert body["branch"] == "feature-branch"
    assert body["pushed"] is True
```

**重要**: router 测试不需要 mock `GitGatewayService`，只需 mock `ChangeWriterService` 即可。因为 router 层只调用 service 层。

## 接口定义

### ChangeWriterService.git_commit_and_push

```python
async def git_commit_and_push(
    self,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    change_id: uuid.UUID,
    lease_id: uuid.UUID,
    message: str,          # commit message, 1~500 字符
    branch_name: str,      # 目标分支名, 1~100 字符
) -> GitCommitResponse:
    """
    流程:
    1. self._get_active_lease(lease_id, user_id) — 验证 lease 存在且属于用户
    2. self._get_change(change_id, workspace_id) — 验证 change 存在且属于 workspace
    3. GitGatewayService(self._session) — 创建 GitGateway 实例
    4. await git_gateway.execute(lease_id, user_id, "add", ["."]) — git add .
    5. await git_gateway.execute(lease_id, user_id, "commit", ["-m", message]) — git commit
    6. await git_gateway.execute(lease_id, user_id, "push", ["origin", branch_name]) — git push
    7. 从 push 的 redacted_output 中提取 commit SHA（可选，正则匹配）
    8. 收集三次操作的 GitOperationLog.id 作为 operation_log_ids
    9. 返回 GitCommitResponse

    错误处理:
    - _get_active_lease 失败 → 抛出 WorktreeLeaseNotFound (http 404)
    - _get_change 失败 → 抛出 ChangeWriteError (http 400)
    - add 失败 → 抛出 ChangeWriteError，commit 和 push 不执行
    - commit 失败 → 抛出 ChangeWriteError，push 不执行
    - push 失败 → 返回 GitCommitResponse(pushed=False)，不抛异常
    - push 到受保护分支 → GitGatewayService 抛出 GitOperationForbidden (http 403)
    """
```

### GitCommitRequest（schema.py，由 task-03 新增）

```python
class GitCommitRequest(BaseModel):
    lease_id: uuid.UUID
    message: str = Field(..., min_length=1, max_length=500)
    branch_name: str = Field(..., min_length=1, max_length=100)
```

### GitCommitResponse（schema.py，由 task-03 新增）

```python
class GitCommitResponse(BaseModel):
    commit_sha: str | None = None
    branch: str
    pushed: bool
    operation_log_ids: list[uuid.UUID]
```

### Router 端点（router.py，由 task-03 新增）

```python
@router.post(
    "/changes/{change_id}/commit",
    response_model=GitCommitResponse,
    status_code=status.HTTP_201_CREATED,
)
async def commit_change(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    data: GitCommitRequest,
    session: SessionDep,
    user: CurrentUser,
) -> GitCommitResponse:
    service = ChangeWriterService(session)
    return await service.git_commit_and_push(
        workspace_id,
        user.id,
        change_id=change_id,
        lease_id=data.lease_id,
        message=data.message,
        branch_name=data.branch_name,
    )
```

## 边界处理

1. **lease 不属于当前 workspace**: `_get_active_lease` 校验通过但 lease.workspace_id != workspace_id 时，`git_commit_and_push` 应抛出 `ChangeWriteError("Lease does not belong to this workspace.")`。测试中应创建一个属于不同 workspace 的 lease 来验证。

2. **lease 状态非 locked**: 如果 lease.status 不是 "locked"（如 "released"），`_get_active_lease` 应抛出 `ChangeWriteError("Lease is not active.")`。测试中应创建 status="released" 的 lease 来验证。

3. **commit message 为空字符串**: `GitCommitRequest` schema 中 `message` 有 `min_length=1` 约束，所以空字符串会被 FastAPI 自动拦截返回 422。router 测试中应验证此验证行为。

4. **push 部分失败（网络超时）**: 当 `GitGatewayService.execute` 在 push 阶段抛出 `GitOperationFailed("timed out")` 时，`git_commit_and_push` 应捕获该异常并返回 `GitCommitResponse(pushed=False, commit_sha=None)`，而不是让异常透传到 router 层变成 502。

5. **push 到受保护分支（main/master）**: GitGatewayService 的 `validate_operation` 会拦截 `push origin main`，抛出 `GitOperationForbidden(403)`。`git_commit_and_push` 应让此异常透传，router 层返回 403。测试中需要 mock `execute` 在 push 调用时抛出此异常。

6. **change_id 和 workspace_id 不匹配**: 如果 change 存在但不属于请求路径中的 workspace，`_get_change` 应抛出 `ChangeWriteError("Change not found.")`，HTTP 层映射为 400。

7. **operation_log_ids 汇聚**: 即使某步失败返回了部分结果（如 add 成功但 commit 失败），`operation_log_ids` 应只包含已成功执行的 GitOperationLog 的 ID，不应包含失败步骤的 ID。

## 非目标

- 不测试 `GitGatewayService.execute` 内部实现（已有独立测试覆盖）
- 不测试真实 git 子进程调用（全部 mock）
- 不测试 `create_pull_request`（task-05/06 的范围）
- 不测试 PAT 解密逻辑（task-05/06 的范围）
- 不测试 markdown_builder 或 batch_generate（task-01/02 的范围）
- 不测试 Change 状态机（task-13 的范围）

## 参考

| 参考文件 | 用途 |
|---|---|
| `design.md` 的 "git_commit_and_push()" 小节 | 方法签名、流程步骤、错误处理策略 |
| `requirements.md` FR-05 | Git 提交并推送的功能需求 |
| `plan.md` task-04 说明 | 任务概述 |
| `backend/app/modules/git_gateway/tests/test_router.py` | HTTP 测试模式参考（mock subprocess + DB setup） |
| `backend/app/modules/git_gateway/service.py` | GitGatewayService.execute 签名和参数 |
| `backend/app/modules/change_writer/tests/test_router.py` | `_setup_prerequisites` 辅助函数和 fixture 模式 |
| `backend/app/modules/git_gateway/tests/test_service.py` | service 层纯单元测试模式参考 |
| `backend/conftest.py` | `db_session`, `client`, `auth_admin_token` fixture |

## TDD 步骤

### Step 1: 创建 test_service.py 骨架

```python
# backend/app/modules/change_writer/tests/test_service.py
"""Service-level tests for git_commit_and_push.

GitGatewayService is mocked — no real git subprocess.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.change_writer.service import ChangeWriterService
```

### Step 2: 实现 DB 辅助函数 `_make_prerequisites`

在 test_service.py 中创建一个辅助函数（类似 test_router.py 中的 `_setup_prerequisites`），在 db_session 中插入:
- Workspace（含 repo_url）
- User
- Change（绑定 workspace）
- WorktreeLease（status="locked"，绑定 workspace + user + change）

返回包含所有 id 的 dict。

### Step 3: 编写第 1 个测试 — 成功路径

`test_commit_success_calls_add_commit_push_in_order`:
- patch `GitGatewayService` 类
- mock `execute` 返回三次成功的 `GitOperationLog`
- 调用 `git_commit_and_push`
- 用 `mock_instance.execute.call_args_list` 验证调用顺序是 add → commit → push
- 验证每次调用的 lease_id、user_id、operation、args 参数正确

### Step 4: 编写第 2 个测试 — 返回值验证

`test_commit_success_returns_git_commit_response`:
- 同上成功场景
- 验证返回对象是 `GitCommitResponse` 类型
- 验证 `pushed=True`
- 验证 `branch` 等于传入的 branch_name
- 验证 `operation_log_ids` 长度为 3

### Step 5: 编写失败路径测试

依次实现:
- `test_commit_push_failure_returns_partial_result` — push 返回非零 result_code 或抛异常
- `test_commit_add_failure_raises_error` — add 阶段抛异常，验证 commit 和 push 没有被调用
- `test_commit_invalid_lease_raises` — 不存在的 lease_id
- `test_commit_change_not_found_raises` — 不存在的 change_id
- `test_commit_push_to_protected_branch_raises` — push 被拦截

### Step 6: 追加 router 测试

在 `test_router.py` 末尾追加:
- `test_commit_endpoint_success_201`
- `test_commit_endpoint_no_auth_401`
- `test_commit_endpoint_change_not_found_404`
- `test_commit_endpoint_lease_not_found_404`

每个 router 测试 mock `ChangeWriterService`（在 `app.modules.change_writer.router.ChangeWriterService`），只验证 HTTP 层行为。

### Step 7: 运行测试验证

```bash
cd backend
pytest app/modules/change_writer/tests/test_service.py -v
pytest app/modules/change_writer/tests/test_router.py -v
pytest app/modules/change_writer/tests/ -v   # 全部 change_writer 测试无回归
```

## 验收标准

| # | 验收项 | 通过条件 |
|---|---|---|
| 1 | test_service.py 文件创建 | 文件存在于 `backend/app/modules/change_writer/tests/test_service.py` |
| 2 | 成功路径 — 调用顺序 | `test_commit_success_calls_add_commit_push_in_order` 通过，验证 execute 被调用 3 次，顺序为 add → commit → push |
| 3 | 成功路径 — 参数传递 | 验证 add 传 `["."]`、commit 传 `["-m", message]`、push 传 `["origin", branch_name]` |
| 4 | 成功路径 — 返回值 | `test_commit_success_returns_git_commit_response` 通过，验证 `pushed=True`、`branch` 和 `operation_log_ids` 正确 |
| 5 | push 失败部分返回 | `test_commit_push_failure_returns_partial_result` 通过，验证 `pushed=False` |
| 6 | add 失败提前终止 | `test_commit_add_failure_raises_error` 通过，验证后续 commit/push 未被调用 |
| 7 | lease 不存在 | `test_commit_invalid_lease_raises` 通过，抛出 WorktreeLeaseNotFound |
| 8 | change 不存在 | `test_commit_change_not_found_raises` 通过，抛出 ChangeWriteError |
| 9 | 受保护分支拦截 | `test_commit_push_to_protected_branch_raises` 通过，透传 GitOperationForbidden |
| 10 | commit 端点成功 | `test_commit_endpoint_success_201` 通过，HTTP 201 + 正确 JSON body |
| 11 | commit 端点无认证 | `test_commit_endpoint_no_auth_401` 通过，HTTP 401 |
| 12 | commit 端点 change 不存在 | `test_commit_endpoint_change_not_found_404` 通过，HTTP 404 |
| 13 | commit 端点 lease 不存在 | `test_commit_endpoint_lease_not_found_404` 通过，HTTP 404 |
| 14 | 新增测试数量 | test_service.py ≥ 7 个 + test_router.py 新增 ≥ 4 个 = ≥ 11 个新测试 |
| 15 | 已有测试无回归 | `pytest app/modules/change_writer/tests/ -v` 全部通过，无失败 |
| 16 | 不依赖外部服务 | 所有测试使用 mock，不调用真实 git 进程或网络 |
