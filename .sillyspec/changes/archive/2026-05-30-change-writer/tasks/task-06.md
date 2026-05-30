---
id: task-06
title: "create_pull_request 测试 — mock httpx 和 CredentialCipher，验证各种响应"
priority: P0
estimated_hours: 1.5
depends_on: [task-05]
blocks: [task-07]
allowed_paths:
  - backend/app/modules/change_writer/tests/test_service.py
  - backend/app/modules/change_writer/tests/test_router.py
author: qinyi
created_at: 2026-05-30 16:30:00
---

# Task-06: create_pull_request 测试

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/change_writer/tests/test_service.py` | 新增/修改 | service 层单元测试：mock httpx.AsyncClient + CredentialCipher，覆盖成功/无 GitIdentity/PAT 无效/GitHub 422/PAT 不落日志 |
| `backend/app/modules/change_writer/tests/test_router.py` | 修改 | 新增 PR 端点的 HTTP 层测试：验证请求路由、认证、错误响应格式 |

## 实现要求

### 1. test_service.py — service 层 create_pull_request 单元测试

**前置说明**: `test_service.py` 文件可能已被 task-04 创建（用于 git_commit_and_push 测试）。如果已存在，则在此文件末尾追加新的测试类/函数；如果不存在，则新建文件。

文件顶部需要以下 import：

```python
"""Service-level tests for ChangeWriterService.create_pull_request."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.change_writer.service import ChangeWriterService
```

#### 1.1 共享 fixture

在 test_service.py 中定义以下 fixture 或辅助函数，复用 DB 记录创建逻辑：

```python
async def _create_prerequisites(db_session) -> dict:
    """创建 workspace + change + user + git_identity + active lease，返回所有 ID。"""
    from app.core.security import password_hasher
    from app.modules.auth.model import User
    from app.modules.change.model import Change
    from app.modules.git_identity.model import GitIdentity
    from app.modules.task.model import Task
    from app.modules.worktree.model import WorktreeLease
    from app.modules.workspace.model import Workspace

    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Test WS",
        slug=f"test-ws-{ws_id.hex[:8]}",
        root_path="/tmp/test",
        status="active",
        component_key="backend",
        repo_url="https://github.com/testorg/testrepo.git",
        default_branch="main",
        source_yaml_path="projects/backend.yaml",
    )
    db_session.add(ws)

    change_id = uuid.uuid4()
    change = Change(
        id=change_id,
        workspace_id=ws_id,
        change_key="2026-05-30-test-pr",
        title="Test PR Change",
        status="draft",
        location="active",
        path=".sillyspec/changes/change/2026-05-30-test-pr",
    )
    db_session.add(change)

    task_id = uuid.uuid4()
    task = Task(
        id=task_id,
        workspace_id=ws_id,
        change_id=change_id,
        task_key="task-pr",
        title="PR Task",
        status="in_progress",
    )
    db_session.add(task)

    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email=f"test-{user_id.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Test",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(user)

    identity_id = uuid.uuid4()
    identity = GitIdentity(
        id=identity_id,
        user_id=user_id,
        provider="github",
        credential_type="pat",
        encrypted_credential=b"\x00" * 32,
        key_id="v1",
        allowed_repositories=[],
    )
    db_session.add(identity)

    lease_id = uuid.uuid4()
    lease_root = f"/tmp/lease-{lease_id.hex[:8]}"
    lease = WorktreeLease(
        id=lease_id,
        workspace_id=ws_id,
        component_id=ws_id,
        change_id=change_id,
        task_id=task_id,
        user_id=user_id,
        run_id=uuid.uuid4(),
        git_identity_id=identity_id,
        path=lease_root,
        branch_name="feature-branch",
        status="locked",
        locked_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(hours=1),
    )
    db_session.add(lease)
    await db_session.commit()

    return {
        "ws_id": ws_id,
        "change_id": change_id,
        "user_id": user_id,
        "identity_id": identity_id,
        "lease_id": lease_id,
    }
```

**注意**: 如果 task-04 已在 test_service.py 中创建了类似的辅助函数，直接复用，不要重复定义。

#### 1.2 测试用例

##### test_create_pr_success

**目的**: 验证正常流程：解密 PAT → 调用 GitHub API → 返回 PRCreateResponse。

```python
async def test_create_pr_success(db_session):
    refs = await _create_prerequisites(db_session)
    service = ChangeWriterService(db_session)

    # Mock httpx.AsyncClient
    mock_response = MagicMock()
    mock_response.status_code = 201
    mock_response.json.return_value = {
        "number": 42,
        "html_url": "https://github.com/testorg/testrepo/pull/42",
    }

    mock_client_instance = AsyncMock()
    mock_client_instance.post = AsyncMock(return_value=mock_response)
    # __aenter__ 和 __aexit__ 支持 async with
    mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
    mock_client_instance.__aexit__ = AsyncMock(return_value=False)

    with patch("app.modules.change_writer.service.httpx.AsyncClient", return_value=mock_client_instance), \
         patch("app.modules.change_writer.service.get_cipher") as mock_get_cipher:
        mock_cipher = MagicMock()
        mock_cipher.decrypt.return_value = "ghp_test_token_value"
        mock_get_cipher.return_value = mock_cipher

        result = await service.create_pull_request(
            refs["ws_id"],
            refs["user_id"],
            change_id=refs["change_id"],
            lease_id=refs["lease_id"],
            title="Test PR",
            body="PR body",
            head_branch="feature-branch",
            base_branch="main",
        )

    assert result.pr_number == 42
    assert result.pr_url == "https://github.com/testorg/testrepo/pull/42"
    assert result.status == 201

    # 验证 httpx.AsyncClient.post 被正确调用
    mock_client_instance.post.assert_awaited_once()
    call_args = mock_client_instance.post.call_args
    assert "repos/testorg/testrepo/pulls" in call_args.kwargs.get("url", call_args[0][0] if call_args[0] else "")
    request_body = call_args.kwargs.get("json", {})
    assert request_body["title"] == "Test PR"
    assert request_body["head"] == "feature-branch"
    assert request_body["base"] == "main"

    # 验证 PAT 传入了 Authorization header
    call_headers = call_args.kwargs.get("headers", {})
    assert "Bearer ghp_test_token_value" in call_headers.get("Authorization", "")
```

**重要**: 以上代码中的 `patch` 路径 `"app.modules.change_writer.service.httpx.AsyncClient"` 假设 task-05 在 `service.py` 中通过 `import httpx` 引入了 httpx。如果 task-05 采用其他导入方式，需要相应调整 patch 路径。同理，`"app.modules.change_writer.service.get_cipher"` 假设 service.py 中导入了 `get_cipher`。执行时需根据 task-05 的实际导入路径调整。

##### test_create_pr_no_git_identity

**目的**: 用户没有有效的 GitIdentity → 返回 AppError(http_status=400)。

```python
async def test_create_pr_no_git_identity(db_session):
    """用户无 GitIdentity 时应抛出 400 错误。"""
    from app.core.errors import AppError

    refs = await _create_prerequisites(db_session)
    # 删除 GitIdentity 模拟用户无凭证的场景
    from app.modules.git_identity.model import GitIdentity
    from sqlalchemy import delete as sql_delete
    await db_session.execute(sql_delete(GitIdentity).where(GitIdentity.id == refs["identity_id"]))
    await db_session.commit()

    service = ChangeWriterService(db_session)

    with pytest.raises(AppError) as exc_info:
        await service.create_pull_request(
            refs["ws_id"],
            refs["user_id"],
            change_id=refs["change_id"],
            lease_id=refs["lease_id"],
            title="Test PR",
            body="body",
            head_branch="feature-branch",
            base_branch="main",
        )

    assert exc_info.value.http_status == 400
    # 错误消息应包含提示信息（如"Git 凭证"或"GitIdentity"）
    error_msg = str(exc_info.value.message).lower()
    assert "git" in error_msg or "credential" in error_msg or "identity" in error_msg
```

##### test_create_pr_invalid_pat_403

**目的**: PAT 无效导致 GitHub API 返回 401 → 系统返回 403。

```python
async def test_create_pr_invalid_pat_403(db_session):
    """PAT 无效时 GitHub 返回 401，系统应转为 403。"""
    from app.core.errors import AppError

    refs = await _create_prerequisites(db_session)
    service = ChangeWriterService(db_session)

    mock_response = MagicMock()
    mock_response.status_code = 401
    mock_response.json.return_value = {"message": "Bad credentials"}

    mock_client_instance = AsyncMock()
    mock_client_instance.post = AsyncMock(return_value=mock_response)
    mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
    mock_client_instance.__aexit__ = AsyncMock(return_value=False)

    with patch("app.modules.change_writer.service.httpx.AsyncClient", return_value=mock_client_instance), \
         patch("app.modules.change_writer.service.get_cipher") as mock_get_cipher:
        mock_cipher = MagicMock()
        mock_cipher.decrypt.return_value = "ghp_invalid_token"
        mock_get_cipher.return_value = mock_cipher

        with pytest.raises(AppError) as exc_info:
            await service.create_pull_request(
                refs["ws_id"],
                refs["user_id"],
                change_id=refs["change_id"],
                lease_id=refs["lease_id"],
                title="Test PR",
                body="body",
                head_branch="feature-branch",
                base_branch="main",
            )

    assert exc_info.value.http_status == 403
```

##### test_create_pr_github_422

**目的**: GitHub API 返回 422（分支不存在等）→ 透传错误信息。

```python
async def test_create_pr_github_422(db_session):
    """GitHub 422 错误应透传。"""
    from app.core.errors import AppError

    refs = await _create_prerequisites(db_session)
    service = ChangeWriterService(db_session)

    mock_response = MagicMock()
    mock_response.status_code = 422
    mock_response.json.return_value = {
        "message": "Validation Failed",
        "errors": [{"message": "No commits between main and non-existent-branch"}],
    }

    mock_client_instance = AsyncMock()
    mock_client_instance.post = AsyncMock(return_value=mock_response)
    mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
    mock_client_instance.__aexit__ = AsyncMock(return_value=False)

    with patch("app.modules.change_writer.service.httpx.AsyncClient", return_value=mock_client_instance), \
         patch("app.modules.change_writer.service.get_cipher") as mock_get_cipher:
        mock_cipher = MagicMock()
        mock_cipher.decrypt.return_value = "ghp_valid_token"
        mock_get_cipher.return_value = mock_cipher

        with pytest.raises(AppError) as exc_info:
            await service.create_pull_request(
                refs["ws_id"],
                refs["user_id"],
                change_id=refs["change_id"],
                lease_id=refs["lease_id"],
                title="Test PR",
                body="body",
                head_branch="non-existent-branch",
                base_branch="main",
            )

    assert exc_info.value.http_status == 422
```

##### test_create_pr_pat_not_in_logs

**目的**: PAT 明文不落日志。验证 service 调用过程中不会将 PAT 明文传给 logger。

```python
async def test_create_pr_pat_not_in_logs(db_session, capfd):
    """PAT 明文不应出现在日志或 stdout 中。"""
    refs = await _create_prerequisites(db_session)
    service = ChangeWriterService(db_session)

    mock_response = MagicMock()
    mock_response.status_code = 201
    mock_response.json.return_value = {
        "number": 1,
        "html_url": "https://github.com/testorg/testrepo/pull/1",
    }

    mock_client_instance = AsyncMock()
    mock_client_instance.post = AsyncMock(return_value=mock_response)
    mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
    mock_client_instance.__aexit__ = AsyncMock(return_value=False)

    test_pat = "ghp_SUPER_SECRET_TOKEN_NOT_TO_BE_LOGGED_12345"

    with patch("app.modules.change_writer.service.httpx.AsyncClient", return_value=mock_client_instance), \
         patch("app.modules.change_writer.service.get_cipher") as mock_get_cipher, \
         patch("app.modules.change_writer.service.log") as mock_log:
        mock_cipher = MagicMock()
        mock_cipher.decrypt.return_value = test_pat
        mock_get_cipher.return_value = mock_cipher

        await service.create_pull_request(
            refs["ws_id"],
            refs["user_id"],
            change_id=refs["change_id"],
            lease_id=refs["lease_id"],
            title="Test PR",
            body="body",
            head_branch="feature-branch",
            base_branch="main",
        )

    # 检查所有 log 调用，确保 PAT 不在其中
    for call in mock_log.info.call_args_list + mock_log.warning.call_args_list + mock_log.error.call_args_list:
        # call[0] 是位置参数，call[1] 是关键字参数
        all_args = " ".join(str(a) for a in call[0]) + " ".join(str(v) for v in call[1].values())
        assert test_pat not in all_args, f"PAT 明文泄露到日志: {all_args}"
```

##### test_create_pr_pat_not_in_response

**目的**: 验证返回的 PRCreateResponse 中不包含 PAT 明文。

```python
async def test_create_pr_pat_not_in_response(db_session):
    """返回结果中不应包含 PAT 明文。"""
    refs = await _create_prerequisites(db_session)
    service = ChangeWriterService(db_session)

    test_pat = "ghp_ANOTHER_SECRET_TOKEN_67890"

    mock_response = MagicMock()
    mock_response.status_code = 201
    mock_response.json.return_value = {
        "number": 5,
        "html_url": "https://github.com/testorg/testrepo/pull/5",
    }

    mock_client_instance = AsyncMock()
    mock_client_instance.post = AsyncMock(return_value=mock_response)
    mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
    mock_client_instance.__aexit__ = AsyncMock(return_value=False)

    with patch("app.modules.change_writer.service.httpx.AsyncClient", return_value=mock_client_instance), \
         patch("app.modules.change_writer.service.get_cipher") as mock_get_cipher:
        mock_cipher = MagicMock()
        mock_cipher.decrypt.return_value = test_pat
        mock_get_cipher.return_value = mock_cipher

        result = await service.create_pull_request(
            refs["ws_id"],
            refs["user_id"],
            change_id=refs["change_id"],
            lease_id=refs["lease_id"],
            title="Test PR",
            body="body",
            head_branch="feature-branch",
            base_branch="main",
        )

    # 返回对象应只有 pr_number, pr_url, status 字段，不含 PAT
    result_dict = result.model_dump() if hasattr(result, "model_dump") else result.dict()
    result_str = str(result_dict)
    assert test_pat not in result_str
```

### 2. test_router.py — HTTP 层 PR 端点测试

在已有的 `test_router.py` 末尾追加以下测试用例。

#### 2.1 test_create_pr_endpoint_success

**目的**: 验证 PR 端点 HTTP 层能正确路由并返回响应。

```python
async def test_create_pr_endpoint_success(client, db_session, mock_repo_dir):
    refs = await _setup_prerequisites(db_session)

    mock_response = MagicMock()
    mock_response.status_code = 201
    mock_response.json.return_value = {
        "number": 7,
        "html_url": "https://github.com/org/repo/pull/7",
    }

    mock_client_instance = AsyncMock()
    mock_client_instance.post = AsyncMock(return_value=mock_response)
    mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
    mock_client_instance.__aexit__ = AsyncMock(return_value=False)

    with patch("app.modules.change_writer.service.httpx.AsyncClient", return_value=mock_client_instance), \
         patch("app.modules.change_writer.service.get_cipher") as mock_get_cipher:
        mock_cipher = MagicMock()
        mock_cipher.decrypt.return_value = "ghp_test_token"
        mock_get_cipher.return_value = mock_cipher

        resp = await client.post(
            f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/pr",
            json={
                "lease_id": str(refs["lease_id"]),
                "title": "My PR",
                "body": "PR description",
                "head_branch": "feature-branch",
                "base_branch": "main",
            },
            headers=_auth(refs["token"]),
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["pr_number"] == 7
    assert "pull/7" in body["pr_url"]
```

#### 2.2 test_create_pr_endpoint_no_auth

**目的**: 不带 Auth header → 返回 401。

```python
async def test_create_pr_endpoint_no_auth(client, db_session, mock_repo_dir):
    refs = await _setup_prerequisites(db_session)

    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/pr",
        json={
            "lease_id": str(refs["lease_id"]),
            "title": "My PR",
            "body": "desc",
            "head_branch": "feature",
            "base_branch": "main",
        },
    )
    assert resp.status_code == 401
```

#### 2.3 test_create_pr_endpoint_no_git_identity

**目的**: 用户无 GitIdentity → 返回 400。

```python
async def test_create_pr_endpoint_no_git_identity(client, db_session, mock_repo_dir):
    refs = await _setup_prerequisites(db_session)

    # 删除 GitIdentity
    from app.modules.git_identity.model import GitIdentity
    from sqlalchemy import delete as sql_delete
    await db_session.execute(sql_delete(GitIdentity).where(GitIdentity.id == refs["identity_id"]))
    await db_session.commit()

    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/pr",
        json={
            "lease_id": str(refs["lease_id"]),
            "title": "My PR",
            "body": "desc",
            "head_branch": "feature",
            "base_branch": "main",
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 400
```

#### 2.4 test_create_pr_endpoint_validation_error

**目的**: 缺少必填字段（如 title）→ 返回 422 验证错误。

```python
async def test_create_pr_endpoint_validation_error(client, db_session, mock_repo_dir):
    refs = await _setup_prerequisites(db_session)

    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/pr",
        json={
            "lease_id": str(refs["lease_id"]),
            # 缺少 title（必填）
            "body": "desc",
            "head_branch": "feature",
            "base_branch": "main",
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 422
```

## 接口定义

### ChangeWriterService.create_pull_request 签名（task-05 实现）

```python
async def create_pull_request(
    self,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    change_id: uuid.UUID,
    lease_id: uuid.UUID,
    title: str,
    body: str = "",
    head_branch: str = ...,
    base_branch: str = "main",
) -> PRCreateResponse:
    """
    流程:
    1. 验证 lease（_get_active_lease）和 change（_get_change）
    2. 解析 workspace.repo_url → owner/repo
    3. 查找用户的 GitIdentity（未撤销的 PAT）
    4. 解密 PAT: get_cipher().decrypt(identity.encrypted_credential, identity.key_id)
    5. httpx.AsyncClient POST https://api.github.com/repos/{owner}/{repo}/pulls
    6. PAT 用后立即丢弃（局部变量）
    7. 返回 PRCreateResponse

    错误处理:
    - 无 GitIdentity → AppError(http_status=400)
    - GitHub API 401 → AppError(http_status=403)（不暴露 PAT）
    - GitHub API 422 → AppError(http_status=422)（透传 GitHub 错误信息）
    - GitHub API 其他非 2xx → AppError(http_status=502)
    """
```

### PRCreateRequest schema（task-05 实现）

```python
class PRCreateRequest(BaseModel):
    lease_id: uuid.UUID
    title: str = Field(..., min_length=1, max_length=500)
    body: str = Field(default="", max_length=10000)
    head_branch: str = Field(..., min_length=1)
    base_branch: str = Field(default="main")
```

### PRCreateResponse schema（task-05 实现）

```python
class PRCreateResponse(BaseModel):
    pr_number: int
    pr_url: str
    status: int  # HTTP status code from GitHub API
```

### PR 端点路由（task-05 实现）

```python
@router.post(
    "/changes/{change_id}/pr",
    response_model=PRCreateResponse,
)
async def create_pull_request(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    data: PRCreateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> PRCreateResponse:
    service = ChangeWriterService(session)
    return await service.create_pull_request(
        workspace_id,
        user.id,
        change_id=change_id,
        lease_id=data.lease_id,
        title=data.title,
        body=data.body,
        head_branch=data.head_branch,
        base_branch=data.base_branch,
    )
```

### GitHub API 调用方式（service 内部实现参考）

```python
# task-05 在 service.py 中的 httpx 调用大致如下：
async with httpx.AsyncClient() as http:
    resp = await http.post(
        f"https://api.github.com/repos/{owner}/{repo}/pulls",
        json={"title": title, "body": body, "head": head_branch, "base": base_branch},
        headers={
            "Authorization": f"Bearer {decrypted_pat}",
            "Accept": "application/vnd.github+json",
        },
        timeout=10.0,
    )
```

### Mock 策略

| Mock 目标 | Patch 路径 | 替换方式 |
|---|---|---|
| `httpx.AsyncClient` | `app.modules.change_writer.service.httpx.AsyncClient` | 返回预配置的 `AsyncMock` 实例，控制 `post` 返回值 |
| `CredentialCipher` / `get_cipher` | `app.modules.change_writer.service.get_cipher` | 返回 `MagicMock`，`decrypt.return_value` 为测试用 PAT 字符串 |
| `log` | `app.modules.change_writer.service.log` | `MagicMock`，检查调用参数中不含 PAT |

**注意**: patch 路径必须在 service 实际 import 处进行 patch。如果 task-05 使用了不同的导入方式（如 `from app.core.crypto import get_cipher`），则 patch 路径需调整为 `app.modules.change_writer.service.get_cipher`。同理，httpx 的 patch 路径取决于 service.py 中的导入语句。

## 边界处理

1. **无 GitIdentity 时返回 400**: 当用户没有未撤销的 GitIdentity 记录时，service 层应抛出 `AppError(http_status=400)`，消息提示需要配置 Git 凭证。测试 `test_create_pr_no_git_identity` 覆盖。

2. **PAT 无效（GitHub 返回 401）转为 403**: GitHub API 返回 401 表示 token 无效或过期，系统不能直接暴露 "认证失败" 给前端（可能泄露 PAT 使用信息），应转为 403 返回。测试 `test_create_pr_invalid_pat_403` 覆盖。

3. **GitHub API 返回 422 透传**: 分支不存在、PR 已存在等场景，GitHub 返回 422，系统应透传该状态码和 GitHub 的错误消息，让前端能够展示具体原因。测试 `test_create_pr_github_422` 覆盖。

4. **PAT 明文不落日志**: service 层所有 `log.info/warning/error` 调用的参数中不得包含 PAT 明文。这是安全红线。通过 mock `service.log` 并检查所有调用参数来验证。测试 `test_create_pr_pat_not_in_logs` 覆盖。

5. **PAT 明文不出现在 HTTP 响应中**: `PRCreateResponse` 只包含 `pr_number`、`pr_url`、`status` 三个字段，不含任何凭证信息。验证返回的 model 序列化结果中不含 PAT。测试 `test_create_pr_pat_not_in_response` 覆盖。

6. **lease_id 无效或不属于当前用户**: 复用 `_get_active_lease` 的鉴权逻辑，返回 404。已有 `_get_active_lease` 内部校验覆盖，本 task 不需要额外测试（task-04 已覆盖 lease 鉴权）。

7. **repo_url 解析失败**: workspace.repo_url 格式不是 `https://github.com/owner/repo.git` 时，service 应返回明确的错误（如 400）。执行时可酌情增加一个测试用例 `test_create_pr_invalid_repo_url` 验证此场景。

## 非目标

- 不实现 `create_pull_request` 的业务逻辑（由 task-05 完成）
- 不修改 `service.py`、`router.py`、`schema.py` 的任何代码
- 不测试 GitGatewayService（task-04 已覆盖）
- 不测试 httpx 连接超时/网络错误（可由后续 task 补充）
- 不测试 GitHub API 返回 rate limit（429）场景
- 不修改 conftest.py 或添加新的全局 fixture

## 参考

- design.md: "内部方法设计" → `create_pull_request()` 流程和错误处理
- design.md AD-2: GitHub API 调用用 httpx 直接发请求
- design.md AD-3: PAT 解密复用 `app.core.crypto.CredentialCipher`
- design.md API 设计: `POST /workspaces/{ws_id}/changes/{id}/pr`
- design.md 风险登记: PAT 解密失败 → CipherKeyMismatch → 500
- requirements.md FR-06: 创建 Pull Request 的所有 Given/When/Then 场景
- requirements.md FR-07: PAT 安全处理要求
- `backend/app/core/crypto.py`: `CredentialCipher.decrypt()` 签名和 `get_cipher()` 工厂方法
- `backend/app/modules/git_identity/service.py`: L123 已有解密路径参考
- `backend/app/modules/git_identity/model.py`: GitIdentity 表结构
- `backend/app/modules/change_writer/tests/test_router.py`: 已有测试模式（`_setup_prerequisites`、`_auth`、`mock_repo_dir` fixture）
- `backend/conftest.py`: `db_session`、`client` fixture，SILLYSPEC_MASTER_KEY 环境变量已设置为 `v1:` + 64 个 `aa`

## TDD 步骤

**前提**: task-05 已完成，`create_pull_request` 方法已存在于 `ChangeWriterService` 中，`PRCreateRequest`/`PRCreateResponse` schema 已定义，PR 端点已注册到 router。

1. **先写 service 层测试**: 在 `test_service.py` 中依次编写 6 个测试函数：
   - `test_create_pr_success`
   - `test_create_pr_no_git_identity`
   - `test_create_pr_invalid_pat_403`
   - `test_create_pr_github_422`
   - `test_create_pr_pat_not_in_logs`
   - `test_create_pr_pat_not_in_response`

2. **运行 service 层测试**: `pytest backend/app/modules/change_writer/tests/test_service.py -v`，确认全部通过。

3. **再写 router 层测试**: 在 `test_router.py` 中追加 4 个测试函数：
   - `test_create_pr_endpoint_success`
   - `test_create_pr_endpoint_no_auth`
   - `test_create_pr_endpoint_no_git_identity`
   - `test_create_pr_endpoint_validation_error`

4. **运行 router 层测试**: `pytest backend/app/modules/change_writer/tests/test_router.py -v`，确认全部通过。

5. **运行全量**: `pytest backend/ -v --tb=short`，确认所有测试（含已有）无回归。

6. **统计新增测试数**: 确认本 task 至少新增 10 个测试（6 个 service + 4 个 router）。

## 验收标准

| 序号 | 验收项 | 预期结果 | 验证方式 |
|---|---|---|---|
| 1 | 成功创建 PR 的 service 测试 | mock httpx 返回 201 + PR 数据，`PRCreateResponse` 字段正确（pr_number=42, pr_url 含 pull/42, status=201） | `test_create_pr_success` 通过 |
| 2 | 无 GitIdentity 返回 400 | 删除 GitIdentity 后调用，抛出 `AppError(http_status=400)`，消息含 "git" 或 "credential" 或 "identity" | `test_create_pr_no_git_identity` 通过 |
| 3 | PAT 无效返回 403 | mock httpx 返回 401，系统抛出 `AppError(http_status=403)` | `test_create_pr_invalid_pat_403` 通过 |
| 4 | GitHub 422 透传 | mock httpx 返回 422，系统抛出 `AppError(http_status=422)` | `test_create_pr_github_422` 通过 |
| 5 | PAT 不落日志 | mock service.log，检查所有 info/warning/error 调用参数不含 PAT 明文 | `test_create_pr_pat_not_in_logs` 通过 |
| 6 | PAT 不出现在响应中 | 返回的 `PRCreateResponse` 序列化字符串不含 PAT 明文 | `test_create_pr_pat_not_in_response` 通过 |
| 7 | PR 端点 HTTP 成功响应 | POST `/changes/{id}/pr` 返回 200，body 含 `pr_number` 和 `pr_url` | `test_create_pr_endpoint_success` 通过 |
| 8 | PR 端点未认证返回 401 | 不带 Auth header 请求，返回 HTTP 401 | `test_create_pr_endpoint_no_auth` 通过 |
| 9 | PR 端点无 GitIdentity 返回 400 | 删除 GitIdentity 后请求，返回 HTTP 400 | `test_create_pr_endpoint_no_git_identity` 通过 |
| 10 | PR 端点参数校验返回 422 | 缺少 title 字段，返回 HTTP 422 | `test_create_pr_endpoint_validation_error` 通过 |
| 11 | httpx.AsyncClient 被正确调用 | post 方法的 URL 为 `repos/{owner}/{repo}/pulls`，json 含 title/head/base，headers 含 Bearer token | `test_create_pr_success` 中的断言 |
| 12 | 全量测试无回归 | `pytest backend/` 全绿，无新增失败 | 执行全量 pytest |
| 13 | 新增测试数 ≥ 10 | test_service.py 6 个 + test_router.py 4 个 | `pytest --co -q` 统计 |
