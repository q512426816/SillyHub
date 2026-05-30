---
id: task-03
title: "实现 git_commit_and_push — ChangeWriterService 新增方法 + schema + router 端点"
priority: P0
estimated_hours: 2
depends_on:
  - task-01
blocks:
  - task-04
  - task-05
  - task-07
allowed_paths:
  - backend/app/modules/change_writer/schema.py
  - backend/app/modules/change_writer/service.py
  - backend/app/modules/change_writer/router.py
author: qinyi
created_at: "2026-05-30 16:12:00"
---

# Task-03: 实现 git_commit_and_push

## 修改文件

| 文件 | 操作 | 改动摘要 |
|---|---|---|
| `backend/app/modules/change_writer/schema.py` | 修改 | 新增 `GitCommitRequest` 和 `GitCommitResponse` 两个 Pydantic model |
| `backend/app/modules/change_writer/service.py` | 修改 | 新增 `git_commit_and_push()` 方法 |
| `backend/app/modules/change_writer/router.py` | 修改 | 新增 `POST /workspaces/{ws_id}/changes/{id}/commit` 端点 |

## 实现要求

### 1. schema.py — 新增两个 Model

在文件末尾新增，不要修改已有 schema。

#### GitCommitRequest

```python
class GitCommitRequest(BaseModel):
    lease_id: uuid.UUID
    message: str = Field(..., min_length=1, max_length=500)
    branch_name: str = Field(..., min_length=1, max_length=100)
```

#### GitCommitResponse

```python
class GitCommitResponse(BaseModel):
    commit_sha: str | None = None
    branch: str
    pushed: bool
    operation_log_ids: list[uuid.UUID]
```

### 2. service.py — 新增 git_commit_and_push() 方法

在 `ChangeWriterService` 类内新增以下方法，放在 `batch_generate_templates` 方法之后、`_get_active_lease` 方法之前。

#### 方法签名

```python
async def git_commit_and_push(
    self,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    change_id: uuid.UUID,
    lease_id: uuid.UUID,
    message: str,
    branch_name: str,
) -> GitCommitResponse:
```

#### 控制流伪代码

```
1. 验证 lease
   lease = await self._get_active_lease(lease_id, user_id)
   if lease.workspace_id != workspace_id:
       raise ChangeWriteError("Lease does not belong to this workspace.")

2. 验证 change
   change = await self._get_change(change_id, workspace_id)

3. 创建 GitGatewayService 实例
   from app.modules.git_gateway.service import GitGatewayService
   gw = GitGatewayService(self._session)

4. 串行执行三步 git 操作（按顺序，每步收集 operation_log_id）
   4a. git add .
       add_log = await gw.execute(lease_id, user_id, "add", ["."])
       op_log_ids.append(add_log.id)
       if add_log.result_code != 0:
           raise ChangeWriteError("git add failed", details={"output": add_log.redacted_output})

   4b. git commit -m {message}
       commit_log = await gw.execute(lease_id, user_id, "commit", ["-m", message])
       op_log_ids.append(commit_log.id)
       if commit_log.result_code != 0:
           raise ChangeWriteError("git commit failed", details={"output": commit_log.redacted_output})

   4c. git push origin {branch_name}
       push_log = await gw.execute(lease_id, user_id, "push", ["origin", branch_name])
       op_log_ids.append(push_log.id)
       if push_log.result_code != 0:
           # push 失败不 raise，返回 pushed=False 让调用方知道
           pushed = False
       else:
           pushed = True

5. 从 commit 输出中提取 commit SHA
   commit_sha = None
   if commit_log.redacted_output:
       # 解析 "[(sha40)]" 或 "commit (sha40)" 格式
       match = re.search(r"[0-9a-f]{40}", commit_log.redacted_output)
       if match:
           commit_sha = match.group(0)

6. 记录日志
   log.info("git_commit_and_push", change_id=str(change_id), commit_sha=commit_sha, pushed=pushed)

7. 返回 GitCommitResponse
   return GitCommitResponse(
       commit_sha=commit_sha,
       branch=branch_name,
       pushed=pushed,
       operation_log_ids=op_log_ids,
   )
```

#### 关键注意

- `GitGatewayService.execute()` 每次调用会自动 commit 到 DB 并返回 `GitOperationLog` 对象，所以 `self._session` 会被多次 commit。不需要在 `git_commit_and_push` 内额外 commit。
- `GitGatewayService` 内部已做白名单校验（add/commit/push 都在 `ALLOWED_OPERATIONS` 中）和受保护分支检查（push main/master 会抛 403）。
- 每步 git 操作失败时（result_code != 0），raise `ChangeWriteError`，这样 router 层会自动转为 400 HTTP 响应。但 push 失败时**不 raise**，而是设置 `pushed=False`，因为 add 和 commit 已经执行，调用方需要知道哪些操作成功了。
- `op_log_ids` 初始化为 `list[uuid.UUID]()` 在步骤 3 之后。

### 3. router.py — 新增 commit 端点

新增 `POST /workspaces/{ws_id}/changes/{id}/commit` 端点，放在 `batch_generate_documents` 路由之后。

```python
@router.post(
    "/changes/{change_id}/commit",
    response_model=GitCommitResponse,
)
async def commit_and_push(
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

同时在文件顶部的 import 区新增：

```python
from app.modules.change_writer.schema import (
    GitCommitRequest,
    GitCommitResponse,
    # ... 保留已有 imports
)
```

## 接口定义

### 端点：POST /workspaces/{ws_id}/changes/{change_id}/commit

| 项目 | 值 |
|---|---|
| Method | POST |
| Path | `/api/workspaces/{workspace_id}/changes/{change_id}/commit` |
| Auth | Bearer token (必须) |
| Request Body | `GitCommitRequest` JSON |
| Response 200 | `GitCommitResponse` JSON |
| Response 400 | `ChangeWriteError` — lease 不属于 workspace / git 操作失败 |
| Response 401 | 未认证 |
| Response 404 | lease 不存在 / change 不存在 |

### Request Body 示例

```json
{
  "lease_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "feat: add change writer templates",
  "branch_name": "feature/change-writer"
}
```

### Response Body 示例（成功）

```json
{
  "commit_sha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  "branch": "feature/change-writer",
  "pushed": true,
  "operation_log_ids": [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "33333333-3333-3333-3333-333333333333"
  ]
}
```

### Response Body 示例（push 失败）

```json
{
  "commit_sha": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  "branch": "feature/change-writer",
  "pushed": false,
  "operation_log_ids": [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "33333333-3333-3333-3333-333333333333"
  ]
}
```

## 边界处理

1. **lease 不属于当前 workspace** — `_get_active_lease` 验证 lease 存在且属于 user 后，额外检查 `lease.workspace_id != workspace_id`，抛 `ChangeWriteError("Lease does not belong to this workspace.")` 返回 400。

2. **change 不存在或不属于 workspace** — `_get_change` 内部已按 `change_id + workspace_id` 查询，找不到时抛 `ChangeWriteError` 返回 400。

3. **git add 无变更文件（nothing to commit）** — `git add .` 正常返回 rc=0；`git commit` 会返回 rc=1 + "nothing to commit" 输出，此时 `commit_log.result_code != 0`，触发 `ChangeWriteError("git commit failed")`。调用方应先确认有文件变更再调用此端点。

4. **push 到受保护分支（main/master）** — `GitGatewayService.validate_operation` 已内置受保护分支检查，在执行 `push origin main` 时会直接抛 `GitOperationForbidden`（403），不会到达实际 push 步骤。change_writer 不需要重复检查。

5. **push 失败但 add/commit 已执行** — push 失败时**不抛异常**，而是返回 `pushed=False`。add 和 commit 的效果保留在 lease worktree 内，调用方可根据 `pushed` 字段决定是否重试 push。

6. **commit SHA 提取失败** — commit 输出可能因为 redaction 或格式变化导致正则匹配不到 40 位 hex，此时 `commit_sha` 返回 `None`。这不是致命错误，push 仍然可能成功。

7. **GitGatewayService 超时** — `GitGatewayService` 已内置 30s 超时，超时时抛 `GitOperationFailed`（502）。`git_commit_and_push` 不需要额外处理，异常会自动冒泡到 router 层。

## 非目标

- 不实现 `create_pull_request()`（task-05 的范围）
- 不实现重试逻辑（GitGatewayService 已有可选的 RetryPolicy，但 `git_commit_and_push` 不传 retry_policy）
- 不实现部分回滚（add/commit 成功但 push 失败时不 revert）
- 不实现 git 操作的并发执行（串行是设计决策，保证操作顺序）
- 不实现 commit SHA 提取失败时的 fallback 策略（返回 None 即可）
- 不修改 `GitGatewayService` 的任何代码

## 参考

- design.md: AD-1 (ChangeWriterService 直接封装), API 设计 GitCommitRequest/Response, 内部方法 git_commit_and_push()
- requirements.md: FR-05 (Git 提交并推送)
- plan.md: Wave 2 task-03
- 依赖模块: `app.modules.git_gateway.service.GitGatewayService.execute()` — 接受 (lease_id, user_id, operation, args) 返回 `GitOperationLog`
- `GitOperationLog` model: id, workspace_id, lease_id, user_id, operation, args_json, result_code, redacted_output, timestamp

## TDD 步骤

### Step 1: 编写 schema 测试（test_service.py 新建）

先写 schema 验证测试：

```python
# test_service.py

def test_git_commit_request_validates_fields():
    """GitCommitRequest 必须有 lease_id, message (1-500), branch_name (1-100)"""
    from app.modules.change_writer.schema import GitCommitRequest

    # 正常
    req = GitCommitRequest(
        lease_id=uuid.uuid4(), message="test", branch_name="feature/x"
    )
    assert req.message == "test"

    # message 为空
    with pytest.raises(ValidationError):
        GitCommitRequest(lease_id=uuid.uuid4(), message="", branch_name="f")

    # branch_name 超 100 字符
    with pytest.raises(ValidationError):
        GitCommitRequest(lease_id=uuid.uuid4(), message="x", branch_name="x" * 101)

def test_git_commit_response_defaults():
    """GitCommitResponse 的 commit_sha 默认 None, pushed 默认 False"""
    from app.modules.change_writer.schema import GitCommitResponse

    resp = GitCommitResponse(branch="main", pushed=False, operation_log_ids=[])
    assert resp.commit_sha is None
    assert resp.pushed is False
```

### Step 2: 编写 service 层 mock 测试

```python
async def test_git_commit_and_push_success(db_session):
    """成功路径: add → commit → push, 返回 commit_sha + pushed=True"""
    # mock GitGatewayService.execute 返回三个 GitOperationLog
    # 验证调用顺序: add(["."]) → commit(["-m", msg]) → push(["origin", branch])
    # 验证返回值: commit_sha 非空, pushed=True, operation_log_ids 长度=3

async def test_git_commit_and_push_push_fails(db_session):
    """push 失败: add + commit 成功, push result_code=1, 返回 pushed=False"""
    # push 的 mock 返回 result_code=1
    # 验证不抛异常, pushed=False, commit_sha 仍然有值

async def test_git_commit_and_push_add_fails(db_session):
    """add 失败: 直接抛 ChangeWriteError, 不执行 commit 和 push"""
    # add 的 mock 返回 result_code=1
    # 验证抛出 ChangeWriteError
    # 验证只调用了 1 次 execute (add)

async def test_git_commit_and_push_commit_fails(db_session):
    """commit 失败: add 成功, commit result_code=1, 抛 ChangeWriteError, 不执行 push"""
    # commit 的 mock 返回 result_code=1
    # 验证抛出 ChangeWriteError
    # 验证只调用了 2 次 execute (add + commit)

async def test_git_commit_and_push_wrong_workspace(db_session):
    """lease 不属于 workspace: 抛 ChangeWriteError"""
    # lease.workspace_id != workspace_id

async def test_git_commit_and_push_commit_sha_extraction(db_session):
    """从 commit 输出中正确提取 40 位 hex SHA"""
    # commit_log.redacted_output 包含 40 位 hex

async def test_git_commit_and_push_no_sha_in_output(db_session):
    """commit 输出无 SHA: commit_sha 返回 None"""
    # commit_log.redacted_output = "some output without sha"
```

### Step 3: 编写 router 层测试（test_router.py 新增）

```python
async def test_commit_and_push_success(client, db_session, mock_repo_dir):
    """POST /changes/{id}/commit 正常返回 GitCommitResponse"""
    # mock GitGatewayService.execute
    # 验证 status_code=200, body 包含 commit_sha, branch, pushed, operation_log_ids

async def test_commit_and_push_no_auth(client, db_session, mock_repo_dir):
    """未认证返回 401"""

async def test_commit_and_push_invalid_lease(client, db_session, mock_repo_dir):
    """不存在的 lease_id 返回 404"""
```

### Step 4: 实现 schema → service → router

按 TDD 红-绿循环，先跑测试确认红，逐步实现到全绿。

### Step 5: 运行全套测试

```bash
cd backend && python -m pytest app/modules/change_writer/ -v
```

确认已有测试无回归 + 新测试全绿。

## 验收标准

| # | 检查项 | 预期结果 | 验证方式 |
|---|---|---|---|
| 1 | `GitCommitRequest` schema 定义 | 包含 `lease_id: uuid.UUID`, `message: str (1-500)`, `branch_name: str (1-100)`，验证失败抛 ValidationError | 读取 schema.py + 运行 schema 单元测试 |
| 2 | `GitCommitResponse` schema 定义 | 包含 `commit_sha: str \| None = None`, `branch: str`, `pushed: bool`, `operation_log_ids: list[uuid.UUID]` | 读取 schema.py |
| 3 | `git_commit_and_push()` 方法存在 | 签名 `(workspace_id, user_id, *, change_id, lease_id, message, branch_name) -> GitCommitResponse` | 读取 service.py |
| 4 | 成功路径返回正确结构 | `commit_sha` 为 40 位 hex 或 None, `pushed=True`, `operation_log_ids` 包含 3 个 UUID | service 层 mock 测试 |
| 5 | add 失败时抛异常 | 抛 `ChangeWriteError("git add failed")`, 不执行 commit 和 push | service 层 mock 测试验证 execute 只调用 1 次 |
| 6 | commit 失败时抛异常 | 抛 `ChangeWriteError("git commit failed")`, 不执行 push | service 层 mock 测试验证 execute 只调用 2 次 |
| 7 | push 失败时不抛异常 | 返回 `pushed=False`, commit_sha 仍有值 | service 层 mock 测试 |
| 8 | lease 不属于 workspace | 抛 `ChangeWriteError("Lease does not belong to this workspace.")` | service 层 mock 测试 |
| 9 | commit SHA 提取 | 从 `redacted_output` 中正则提取 `[0-9a-f]{40}`，提取失败返回 None | service 层测试 |
| 10 | router 端点注册 | `POST /workspaces/{ws_id}/changes/{id}/commit` 返回 200 + `GitCommitResponse` JSON | router 层 HTTP 测试 |
| 11 | router 未认证 | 无 Bearer token 时返回 401 | router 层 HTTP 测试 |
| 12 | GitGatewayService 调用顺序 | 串行调用 `add(["."])` → `commit(["-m", message])` → `push(["origin", branch_name])` | service 层 mock 测试验证 call_args_list |
| 13 | 已有测试无回归 | 全套 change_writer 测试通过 | `pytest app/modules/change_writer/ -v` |
