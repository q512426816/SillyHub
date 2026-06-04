---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# git_identity
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/git_identity/**

## 职责

git_identity 管理 Git 身份凭证，负责：

- **凭证管理**：创建、查看、吊销 Git 身份（PAT、SSH Key 等）
- **凭证加密存储**：使用 AES-GCM 对凭证进行加密，密钥通过环境变量管理
- **Provider 访问检查**：通过 GitHub Provider 等验证 PAT 是否有指定仓库的访问权限
- **凭证生命周期**：支持过期时间设置、吊销标记

## 当前设计

```
router.py              HTTP 入口，5 个端点
  |
service.py             GitIdentityService — 核心业务逻辑
  |                      - create()       创建身份（加密凭证）
  |                      - list_()        列出用户身份
  |                      - get()          获取单个身份
  |                      - revoke()       吊销身份
  |                      - check_access() 检查 PAT 仓库访问权限
  |
model.py               GitIdentity (SQLModel 表)
schema.py              请求/响应 schema
providers/
  ├── base.py          GitProvider 抽象基类 + AccessResult
  ├── github.py        GitHubProvider — 调用 GitHub API 验证 PAT
  └── __init__.py      PROVIDERS 注册表
```

### 加密体系

- 使用 `app.core.crypto.CredentialCipher` 进行 AES-GCM 加密
- Master Key 从环境变量加载（`GIT_IDENTITY_MASTER_KEY`）
- 每次加密使用随机 nonce，密文存储在 `encrypted_credential` 字段
- `key_id` 字段用于密钥轮换追踪

### Provider 架构

- `GitProvider` 抽象基类定义 `check_pat_access(token, repo_url)` 接口
- `GitHubProvider` 实现通过 GitHub API (`/repos/{owner}/{repo}`) 验证 PAT 权限
- `PROVIDERS` 字典注册所有 provider，支持按 `provider` 字段名查找

### 状态管理

身份有三种不可用状态：
- `IdentityNotFound` — 身份不存在
- `IdentityRevoked` — 已被吊销（`revoked_at` 非空）
- `IdentityExpired` — 已过期（`expires_at` 早于当前时间）

## 对外接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/git/identities` | 列出当前用户所有 Git 身份 | get_current_user |
| POST | `/git/identities` | 创建新 Git 身份（加密存储凭证） | get_current_user |
| GET | `/git/identities/{identity_id}` | 获取单个身份详情 | get_current_user |
| DELETE | `/git/identities/{identity_id}` | 吊销身份（软删除） | get_current_user |
| POST | `/git/check-access` | 检查 PAT 对指定仓库的访问权限 | get_current_user |

## 关键数据流

### 创建身份

```
Client → POST /git/identities
  → GitIdentityCreate 验证
  → cipher.encrypt(credential)           # AES-GCM 加密
  → GitIdentity 写入数据库（含 encrypted_credential, key_id）
  → 返回 GitIdentityRead（不含原始凭证）
```

### 访问检查

```
Client → POST /git/check-access
  → AccessCheckRequest(provider, token, repo_url)
  → GitIdentityService.check_access()
  → PROVIDERS[provider].check_pat_access(token, repo_url)
  → GitHubProvider: GET https://api.github.com/repos/{owner}/{repo}
  → 返回 AccessCheckResult(accessible, error?)
```

## 设计决策

| 决策 | 原因 |
|------|------|
| AES-GCM 而非 AES-CBC | 提供认证加密，防止密文篡改 |
| 环境变量管理 Master Key | 避免硬编码密钥，支持不同环境使用不同密钥 |
| Provider 注册表模式 | 支持扩展其他 Git 托管平台（GitLab、Bitbucket 等） |
| 软删除（revoked_at）而非硬删除 | 审计追踪需要保留历史记录 |
| 响应中不返回原始凭证 | 安全原则——凭证一旦加密存储，API 永不返回明文 |

## 依赖关系

### 内部依赖

- `app.core.auth_deps` — get_current_user
- `app.core.crypto` — CredentialCipher, get_cipher
- `app.core.db` — get_session
- `app.core.errors` — AppError, PermissionDenied
- `app.core.logging` — get_logger
- `app.models.base` — BaseModel
- `app.modules.auth.model` — User
- `app.modules.auth.permissions` — Permission

### 外部依赖

- httpx（GitHub Provider 调用 GitHub API）

## 注意事项

- 凭证类型当前支持 `pat`，可通过 `credential_type` 字段扩展 SSH Key 等
- `allowed_repositories` 为 JSON 数组，限制身份可用的仓库范围
- 所有身份操作都按 `user_id` 隔离，用户只能管理自己的身份
- `key_id` 字段用于密钥轮换，当 Master Key 更换后可追踪哪些凭证需要重新加密
- git_gateway 模块在执行 Git 命令时会读取 git_identity 获取用户名/邮箱

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| | | （初始生成，暂无变更记录） |
