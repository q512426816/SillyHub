---
author: qinyi
created_at: 2026-05-30 15:07:31
---

# Design: 写入 Change 包

## 架构决策

### AD-1: Phase B 在 ChangeWriterService 内直接封装

**决策**: `git_commit_and_push()` 和 `create_pull_request()` 直接实现在 `ChangeWriterService` 内，不拆分独立模块。

**理由**:
- 当前只有 2 个新方法，不值得拆分 `GitCommitService` + `PullRequestService` 两个独立模块
- `ChangeWriterService` 已有 `_get_active_lease` / `_get_change` 等内部方法，直接复用
- 调用方只需和一个 service 交互
- 如果 task-14 (Agent Adapter) 需要独立的 Git 提交能力，届时再提取

**Trade-off**: `ChangeWriterService` 职责变宽（文件写入 + Git 操作 + GitHub API），但当前可接受。

### AD-2: GitHub API 调用用 httpx 直接发请求

**决策**: 使用 `httpx.AsyncClient` 直接调 GitHub REST API，不引入 `PyGithub` 等重依赖。

**理由**:
- 只需要 `POST /repos/{owner}/{repo}/pulls` 一个端点
- `httpx` 已是项目依赖（`git_identity/providers/github.py` 已引入）
- 避免引入 1MB+ 的 PyGithub 库

### AD-3: PAT 解密复用 app.core.crypto.CredentialCipher

**决策**: 复用已有的 `CredentialCipher.decrypt()` 解密 `GitIdentity.encrypted_credential`。

**理由**:
- `git_identity/service.py:123` 已有解密路径: `self._cipher.decrypt(row.encrypted_credential, row.key_id)`
- `app.core.crypto.get_cipher()` 提供了从环境变量创建 cipher 的工厂方法
- 无需重复实现加解密逻辑

## 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `change_writer/markdown_builder.py` | 修改 | 新增 `build_tasks_md`, `build_verification_md`, 增强 `build_master_md` |
| `change_writer/schema.py` | 修改 | 新增 `GitCommitRequest/Response`, `PRRequest/Response`, 修复 `BatchGenerateRequest` |
| `change_writer/service.py` | 修改 | 新增 `git_commit_and_push()`, `create_pull_request()`, 新增依赖注入 |
| `change_writer/router.py` | 修改 | 新增 commit + PR 端点, 修复 batch 端点的 lease_id 传递 |
| `change_writer/tests/test_markdown_builder.py` | 修改 | 新增 tasks/verification/master 测试 |
| `change_writer/tests/test_router.py` | 修改 | 新增 commit + PR 端点测试 |
| `change_writer/tests/test_service.py` | 新增 | service 层单元测试 |

## 数据模型

无新 DB 表。复用已有:
- `Change` 表 — 已有 `status`, `path`, `change_key` 字段
- `ChangeDocument` 表 — 已有 `doc_type`, `path`, `exists` 字段
- `WorktreeLease` 表 — 隔离环境
- `GitIdentity` 表 — PAT 凭证
- `GitOperationLog` 表 — Git 操作审计（由 GitGatewayService 自动写入）

## API 设计

### 已有端点修复

| 方法 | 路径 | 修改 |
|---|---|---|
| POST | `/workspaces/{ws_id}/changes/{id}/documents/batch-generate` | 增加 `lease_id` 参数并传递给 service |

### 新增端点

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/workspaces/{ws_id}/changes/{id}/commit` | 在 lease 内 stage + commit + push |
| POST | `/workspaces/{ws_id}/changes/{id}/pr` | 调用 GitHub API 创建 PR |

### GitCommitRequest

```python
class GitCommitRequest(BaseModel):
    lease_id: uuid.UUID
    message: str = Field(..., min_length=1, max_length=500)
    branch_name: str = Field(..., min_length=1, max_length=100)
```

### GitCommitResponse

```python
class GitCommitResponse(BaseModel):
    commit_sha: str | None = None
    branch: str
    pushed: bool
    operation_log_ids: list[uuid.UUID]  # 关联的 GitOperationLog ID
```

### PRCreateRequest

```python
class PRCreateRequest(BaseModel):
    lease_id: uuid.UUID
    title: str = Field(..., min_length=1, max_length=500)
    body: str = Field(default="", max_length=10000)
    head_branch: str = Field(..., min_length=1)
    base_branch: str = Field(default="main")
```

### PRCreateResponse

```python
class PRCreateResponse(BaseModel):
    pr_number: int
    pr_url: str
    status: int  # HTTP status code from GitHub
```

## 内部方法设计

### git_commit_and_push()

```python
async def git_commit_and_push(
    self, workspace_id, user_id,
    *, change_id, lease_id, message, branch_name,
) -> GitCommitResponse:
```

**流程**:
1. 验证 lease（`_get_active_lease`）和 change（`_get_change`）
2. 创建 `GitGatewayService(self._session)` 实例
3. 串行执行: `add .` → `commit -m {message}` → `push origin {branch_name}`
4. 从 push 输出中提取 commit SHA
5. 返回 `GitCommitResponse`

**错误处理**:
- 任意步骤失败 → 后续步骤不执行，返回已执行的操作日志
- GitGatewayService 已有超时控制（30s）和重试策略

### create_pull_request()

```python
async def create_pull_request(
    self, workspace_id, user_id,
    *, change_id, lease_id, title, body, head_branch, base_branch,
) -> PRCreateResponse:
```

**流程**:
1. 验证 lease 和 change
2. 解析 workspace.repo_url → owner/repo
3. 查找用户的 GitIdentity（复用 `_resolve_git_identity` 逻辑）
4. 解密 PAT: `get_cipher().decrypt(identity.encrypted_credential, identity.key_id)`
5. `httpx.AsyncClient` POST GitHub API
6. PAT 用后立即丢弃（局部变量，函数退出即释放）
7. 返回 `PRCreateResponse`

**错误处理**:
- 无 GitIdentity → 返回 400 错误提示
- GitHub API 422（分支不存在等）→ 透传错误信息
- GitHub API 401（PAT 无效）→ 返回 403

## 兼容策略

- 不需要版本兼容（项目未上线）
- `markdown_builder.py` 新增 builder 不影响已有 builder
- `schema.py` 新增 schema 不影响已有 schema
- 已有 API 端点的签名和行为不变（仅 batch-generate 增加 lease_id 参数，但有默认值保持兼容）

## 风险登记

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| GitHub API 限流 | 低 | 中 | httpx 设置 10s 超时，记录 rate limit header |
| PAT 解密失败（环境变量缺失） | 中 | 高 | service 层 catch `CipherKeyMismatch`，返回 500 + 明确错误信息 |
| `add .` 在 lease 根目录添加意外文件 | 低 | 中 | 在 lease 创建时已有 `.gitignore`，且 lease 目录是隔离的 |
| push 到 protected branch | 低 | 中 | GitGateway 已有 `main`/`master` 推送保护 |
| httpx 不是直接依赖 | 低 | 中 | 确认 pyproject.toml 已有 httpx（git_identity 已使用） |

## 自审

- [x] 所有表名/字段名来自真实代码
- [x] 所有类名来自真实代码或标注"新增"
- [x] API 端点路径遵循已有模式 `/workspaces/{ws_id}/...`
- [x] 依赖模块全部确认可用（git_gateway, git_identity, worktree, change）
- [x] 无新 DB 表，无新迁移
