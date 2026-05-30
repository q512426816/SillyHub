---
author: qinyi
created_at: 2026-05-30 16:30:00
id: task-05
title: "实现 create_pull_request — 解密 PAT + httpx 调 GitHub API + schema + router 端点"
priority: P0
estimated_hours: 2
depends_on:
  - task-03
blocks:
  - task-06
  - task-07
allowed_paths:
  - backend/app/modules/change_writer/schema.py
  - backend/app/modules/change_writer/service.py
  - backend/app/modules/change_writer/router.py
---

# Task-05: 实现 create_pull_request

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/change_writer/schema.py` | 修改 | 新增 `PRCreateRequest` 和 `PRCreateResponse` |
| `backend/app/modules/change_writer/service.py` | 修改 | 新增 `create_pull_request()` 方法 |
| `backend/app/modules/change_writer/router.py` | 修改 | 新增 `POST /workspaces/{ws_id}/changes/{id}/pr` 端点 |

## 实现要求

### 1. schema.py — 新增两个 Pydantic 模型

在文件末尾追加（不修改已有的 schema 类）：

```python
class PRCreateRequest(BaseModel):
    lease_id: uuid.UUID
    title: str = Field(..., min_length=1, max_length=500)
    body: str = Field(default="", max_length=10000)
    head_branch: str = Field(..., min_length=1, max_length=200)
    base_branch: str = Field(default="main", min_length=1, max_length=200)


class PRCreateResponse(BaseModel):
    pr_number: int
    pr_url: str
    status: int  # GitHub API 返回的 HTTP status code，成功时为 201
```

### 2. service.py — 新增 `create_pull_request()` 方法

#### 方法签名

```python
async def create_pull_request(
    self,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    change_id: uuid.UUID,
    lease_id: uuid.UUID,
    title: str,
    body: str,
    head_branch: str,
    base_branch: str,
) -> PRCreateResponse:
```

#### 控制流伪代码

```
1. lease = self._get_active_lease(lease_id, user_id)
   - 失败 → 抛出 WorktreeLeaseNotFound (404)

2. 验证 lease.workspace_id == workspace_id
   - 不匹配 → 抛出 ChangeWriteError (400)

3. change = self._get_change(change_id, workspace_id)
   - 失败 → 抛出 ChangeWriteError (400)

4. workspace = self._session.get(Workspace, workspace_id)
   - 不存在 → 抛出 WorkspaceNotFound (404)

5. 解析 repo_url → owner/repo
   - workspace.repo_url 为 None → 抛出 ChangeWriteError (400, "Workspace has no repo_url configured.")
   - 解析失败 → 抛出 ChangeWriteError (400, "Cannot parse repo_url: {repo_url}")
   - 解析逻辑复用: 提取 "github.com/" 后的 owner/repo 部分，去掉 .git 后缀
     支持格式: "https://github.com/owner/repo.git", "https://github.com/owner/repo"

6. 查找用户的 GitIdentity
   stmt = select(GitIdentity).where(
       GitIdentity.user_id == user_id,
       GitIdentity.provider == "github",
       GitIdentity.revoked_at.is_(None),
   ).order_by(GitIdentity.created_at.desc()).limit(1)
   - 无结果 → 抛出 ChangeWriteError (400, "No GitHub credential found. Please configure a Git identity.")

7. 验证 GitIdentity 未过期
   if identity.expires_at and identity.expires_at < datetime.utcnow():
       → 抛出 ChangeWriteError (400, "GitHub credential has expired.")

8. 解密 PAT
   from app.core.crypto import get_cipher
   cipher = get_cipher()
   try:
       pat = cipher.decrypt(identity.encrypted_credential, identity.key_id)
   except CipherKeyMismatch:
       → 抛出 ChangeWriteError (500, "Credential decryption failed. Check SILLYSPEC_MASTER_KEY.")
   except Exception:
       → 抛出 ChangeWriteError (500, "Credential decryption failed.")

9. httpx POST GitHub API
   url = f"https://api.github.com/repos/{owner}/{repo}/pulls"
   headers = {
       "Authorization": f"token {pat}",
       "Accept": "application/vnd.github+json",
   }
   payload = {
       "title": title,
       "body": body,
       "head": head_branch,
       "base": base_branch,
   }
   async with httpx.AsyncClient(timeout=15) as client:
       resp = await client.post(url, headers=headers, json=payload)

10. PAT 用后立即从局部变量丢弃（函数退出时自动释放，无需显式 del）

11. 处理 GitHub API 响应
    - status == 201 → 解析 resp.json()，返回 PRCreateResponse
      pr_number = data["number"]
      pr_url = data["html_url"]
      status = 201
    - status == 401 → 抛出 ChangeWriteError (403, "GitHub authentication failed. Token may be invalid.")
    - status == 403 → 抛出 ChangeWriteError (403, "GitHub API forbidden. Check token permissions.")
    - status == 422 → 解析 resp.json()["message"]，抛出 ChangeWriteError (422, 透传 GitHub 消息)
    - 其他 → 抛出 ChangeWriteError (502, f"GitHub API returned {resp.status_code}")

12. 更新 identity.last_used_at
    identity.last_used_at = datetime.utcnow()
    await self._session.commit()

13. 记录日志（日志中绝不包含 PAT）
    log.info("pr_created", change_id=str(change_id), pr_number=pr_number, owner=owner, repo=repo)

14. 返回 PRCreateResponse(pr_number=pr_number, pr_url=pr_url, status=201)
```

#### 新增 import

在 service.py 顶部追加：

```python
import httpx
from app.core.crypto import CipherKeyMismatch, get_cipher
from app.modules.git_identity.model import GitIdentity
from app.modules.change_writer.schema import PRCreateResponse
```

注意：`httpx` 已是项目依赖（`git_identity/providers/github.py` 已引入）。

### 3. router.py — 新增端点

在文件末尾追加路由函数：

```python
from app.modules.change_writer.schema import PRCreateRequest, PRCreateResponse

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

## 接口定义

### POST /workspaces/{ws_id}/changes/{id}/pr

**请求体** (PRCreateRequest):
| 字段 | 类型 | 必填 | 默认值 | 约束 |
|---|---|---|---|---|
| lease_id | uuid.UUID | 是 | — | — |
| title | str | 是 | — | 1-500 字符 |
| body | str | 否 | "" | 0-10000 字符 |
| head_branch | str | 是 | — | 1-200 字符 |
| base_branch | str | 否 | "main" | 1-200 字符 |

**成功响应** 200 (PRCreateResponse):
| 字段 | 类型 | 说明 |
|---|---|---|
| pr_number | int | GitHub PR 编号 |
| pr_url | str | PR 页面 URL |
| status | int | GitHub API 返回的状态码 (201) |

**错误响应**:

| 场景 | HTTP Status | code | message |
|---|---|---|---|
| lease 不存在/不属于用户 | 404 | HTTP_404_WORKTREE_LEASE_NOT_FOUND | "Worktree lease '{id}' not found." |
| lease 不属于此 workspace | 400 | CHANGE_WRITE_ERROR | "Lease does not belong to this workspace." |
| change 不存在 | 400 | CHANGE_WRITE_ERROR | "Change '{id}' not found." |
| workspace 无 repo_url | 400 | CHANGE_WRITE_ERROR | "Workspace has no repo_url configured." |
| repo_url 无法解析 | 400 | CHANGE_WRITE_ERROR | "Cannot parse repo_url: ..." |
| 无 GitHub 凭证 | 400 | CHANGE_WRITE_ERROR | "No GitHub credential found. Please configure a Git identity." |
| 凭证已过期 | 400 | CHANGE_WRITE_ERROR | "GitHub credential has expired." |
| PAT 解密失败 | 500 | CHANGE_WRITE_ERROR | "Credential decryption failed. Check SILLYSPEC_MASTER_KEY." |
| GitHub 401 | 403 | CHANGE_WRITE_ERROR | "GitHub authentication failed. Token may be invalid." |
| GitHub 403 | 403 | CHANGE_WRITE_ERROR | "GitHub API forbidden. Check token permissions." |
| GitHub 422 | 422 | CHANGE_WRITE_ERROR | 透传 GitHub message |
| GitHub 其他错误 | 502 | CHANGE_WRITE_ERROR | "GitHub API returned {status}" |

## 边界处理

1. **PAT 安全 — 不落日志**: `log.info("pr_created", ...)` 的参数中只包含 change_id、pr_number、owner、repo 等业务字段，绝不包含 PAT 明文或 Authorization header。PAT 仅作为局部变量存在于 `create_pull_request()` 函数内，函数退出即释放。

2. **PAT 安全 — 不返回客户端**: `PRCreateResponse` 只包含 pr_number、pr_url、status 三个字段，不包含任何 token/credential 信息。即使 GitHub API 返回体中有 token 关联信息，也不透传。

3. **无 GitIdentity 或已撤销**: 查询条件 `provider == "github"` + `revoked_at.is_(None)` 确保只匹配有效的 GitHub PAT。无结果时返回明确的 400 错误，提示用户配置凭证。

4. **GitIdentity 已过期**: `expires_at` 检查在解密前执行（避免无谓的解密操作）。过期直接返回 400。

5. **repo_url 解析失败**: 如果 workspace 没有配置 repo_url 或 URL 格式无法识别（非 github.com 格式），在调 API 之前就 fail fast 返回 400，附上原始 repo_url。

6. **CipherKeyMismatch 处理**: 环境变量 `SILLYSPEC_MASTER_KEY` 变更或缺失时，`get_cipher()` 或 `cipher.decrypt()` 会抛异常。catch `CipherKeyMismatch` 返回 500，提示运维检查密钥配置。

7. **httpx 超时**: 设置 `timeout=15` 秒（与 `github.py` 中 `check_pat_access` 的 15 秒一致）。超时抛出 `httpx.TimeoutException`，被外层 try/except 捕获后返回 502。

8. **httpx 网络异常**: `httpx.ConnectError`、`httpx.TimeoutException` 等，统一 catch 为 `ChangeWriteError(502, "Failed to connect to GitHub API.")`。

9. **lease 状态检查**: `_get_active_lease` 已内建 `status == "locked"` 校验，非活跃 lease 会直接返回 400。

10. **workspace_id 一致性**: 验证 lease.workspace_id == workspace_id，防止跨 workspace 操作。

## 非目标

- 不实现 GitLab/Bitbucket PR 创建（仅 GitHub）
- 不实现 PR 自动 merge
- 不实现分支冲突自动检测/解决
- 不实现 PR 列表查询（后续任务）
- 不实现 webhook 回调通知
- 不实现 OAuth 认证方式（仅 PAT）
- 不实现 retry 逻辑（单次请求，失败直接返回错误）
- 不修改 `_get_active_lease` 或 `_get_change` 内部方法（已有实现直接复用）

## 参考

- **design.md** — AD-2 (httpx), AD-3 (CredentialCipher), PRCreateRequest/Response 定义
- **requirements.md** — FR-06 (创建 PR), FR-07 (PAT 安全)
- **git_identity/service.py:123** — 解密路径: `self._cipher.decrypt(row.encrypted_credential, row.key_id)`
- **git_identity/providers/github.py** — `_extract_owner_repo()` 解析 repo_url 的参考实现
- **app/core/crypto.py** — `CredentialCipher.decrypt()`, `get_cipher()`, `CipherKeyMismatch`
- **git_gateway/service.py:276** — `_resolve_git_identity()` 查询 GitIdentity 的参考实现
- **workspace/model.py:73** — `repo_url` 字段定义

## TDD 步骤

> 注意: task-06 专门负责测试。本任务的 TDD 步骤是 task-06 的输入规范。

### Service 层测试（test_service.py 新增）

1. **test_create_pr_success** — mock `get_cipher().decrypt()` 返回 fake PAT，mock `httpx.AsyncClient.post` 返回 201 + `{"number": 42, "html_url": "https://github.com/owner/repo/pull/42"}`。验证返回 PRCreateResponse(pr_number=42, pr_url=..., status=201)。

2. **test_create_pr_no_git_identity** — DB 中无匹配的 GitIdentity。验证抛出 ChangeWriteError(400, "No GitHub credential found")。

3. **test_create_pr_revoked_identity** — GitIdentity.revoked_at 不为 None。验证抛出 ChangeWriteError(400)。

4. **test_create_pr_expired_identity** — GitIdentity.expires_at 在过去。验证抛出 ChangeWriteError(400, "expired")。

5. **test_create_pr_no_repo_url** — workspace.repo_url 为 None。验证抛出 ChangeWriteError(400, "no repo_url")。

6. **test_create_pr_invalid_repo_url** — workspace.repo_url 格式无法解析。验证抛出 ChangeWriteError(400, "Cannot parse repo_url")。

7. **test_create_pr_github_401** — mock httpx 返回 401。验证抛出 ChangeWriteError(403, "authentication failed")。

8. **test_create_pr_github_422** — mock httpx 返回 422 + `{"message": "Validation Failed"}`。验证抛出 ChangeWriteError(422)。

9. **test_create_pr_cipher_key_mismatch** — mock cipher.decrypt 抛出 CipherKeyMismatch。验证抛出 ChangeWriteError(500, "decryption failed")。

10. **test_create_pr_httpx_timeout** — mock httpx 抛出 TimeoutException。验证抛出 ChangeWriteError(502)。

11. **test_create_pr_updates_last_used_at** — 成功创建 PR 后验证 identity.last_used_at 被更新。

### Router 层测试（test_router.py 新增）

12. **test_router_create_pr_success** — 端到端 HTTP 测试，mock service 层返回 PRCreateResponse。验证 200 + 正确 body。

13. **test_router_create_pr_no_auth** — 不带 Authorization header。验证 401。

14. **test_router_create_pr_invalid_lease** — 传入不存在的 lease_id。验证 service 层抛错被正确序列化。

### Mock 策略

- **httpx.AsyncClient**: 在 service 层测试中 mock `httpx.AsyncClient` 的 `__aenter__` 和 `post` 方法
- **get_cipher**: mock `app.core.crypto.get_cipher` 返回 mock cipher
- **CredentialCipher.decrypt**: 返回固定字符串 `"fake_pat_token"`
- Service 层测试使用真实的 AsyncSession + 内存 SQLite（与已有测试一致）
- Router 层测试 mock `ChangeWriterService.create_pull_request` 方法

## 验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | `schema.py` 新增 `PRCreateRequest` 类，包含 lease_id/title/body/head_branch/base_branch 五个字段，类型和默认值符合设计 | 代码审查 + import 成功 |
| 2 | `schema.py` 新增 `PRCreateResponse` 类，包含 pr_number/pr_url/status 三个字段 | 代码审查 + import 成功 |
| 3 | `service.py` 新增 `create_pull_request()` 方法，方法签名与本文档一致 | 代码审查 |
| 4 | `create_pull_request()` 验证 lease 归属和 change 存在性（复用 `_get_active_lease` 和 `_get_change`） | 单元测试覆盖 |
| 5 | `create_pull_request()` 从 `Workspace.repo_url` 解析出 owner/repo | 单元测试: test_create_pr_no_repo_url + test_create_pr_invalid_repo_url |
| 6 | `create_pull_request()` 查询非撤销的 GitHub GitIdentity，无结果返回 400 | 单元测试: test_create_pr_no_git_identity + test_create_pr_revoked_identity |
| 7 | `create_pull_request()` 使用 `get_cipher().decrypt()` 解密 PAT | 代码审查 + test_create_pr_cipher_key_mismatch |
| 8 | `create_pull_request()` 使用 `httpx.AsyncClient` POST GitHub API | 代码审查 + test_create_pr_success |
| 9 | PAT 明文不出现在任何日志输出中 | 代码审查: log.info 参数不含 pat/token |
| 10 | PAT 明文不出现在 HTTP 响应中 | 代码审查: PRCreateResponse 字段定义 |
| 11 | GitHub 401/403 映射为本地 403 错误 | 单元测试: test_create_pr_github_401 |
| 12 | GitHub 422 错误透传 | 单元测试: test_create_pr_github_422 |
| 13 | PAT 解密失败返回 500 | 单元测试: test_create_pr_cipher_key_mismatch |
| 14 | httpx 超时/网络异常返回 502 | 单元测试: test_create_pr_httpx_timeout |
| 15 | 成功后更新 `identity.last_used_at` | 单元测试: test_create_pr_updates_last_used_at |
| 16 | router 新增 `POST /workspaces/{ws_id}/changes/{id}/pr` 端点，参数正确传递 | test_router_create_pr_success |
| 17 | 未认证请求返回 401 | test_router_create_pr_no_auth |
| 18 | 已有测试全部通过（无回归） | `pytest backend/` 全绿 |
