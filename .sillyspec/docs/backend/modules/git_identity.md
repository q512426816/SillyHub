---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# git_identity

> 最后更新：2026-05-31
> 最近变更：feat(git_identity): encrypted credential storage + PAT access check
> 模块路径：`app/modules/git_identity/**`

## 职责

管理用户的 Git 身份凭证（PAT/OAuth/SSH Key/App Token）：CRUD 创建与吊销、加密存储、Provider 适配器模式验证仓库访问权限。

## 当前设计

### 架构

```
GitIdentityService（业务层）
  ├── CRUD — list / get / create / revoke
  ├── check_access() — Provider 验证仓库访问
  ├── CredentialCipher — AES 加解密（encrypted_credential + key_id）
  └── PROVIDERS 注册表 — provider → ProviderAdapter 映射

providers/（Provider 适配器）
  ├── base.py — AccessResult / BaseProvider
  ├── github.py — GitHub PAT 验证（GET /repos/{owner}/{repo}）
  └── PROVIDERS dict — {"github": GitHubProvider, ...}
```

### 关键逻辑

1. **创建**：接收明文 credential → `cipher.encrypt()` 得到 `(ciphertext, key_id)` → 存入 DB
2. **访问检查**：查找 identity → 校验可用性 → 解密 credential → 调用 Provider API 验证 → 更新 `last_used_at`
3. **吊销**：设置 `revoked_at` 时间戳，不删除行（审计追踪）
4. **Provider 适配器**：`PROVIDERS` 字典映射 provider 名称到具体实现，支持 github/gitlab/gitea/generic
5. **所有权校验**：所有操作先验证 `row.user_id == user_id`，防止跨用户访问

## 对外接口

| 接口 | 方法 | 说明 | 调用方 |
|------|------|------|--------|
| `GET /git/identities` | `list_identities()` | 列出当前用户的 Git 身份 | 前端 |
| `POST /git/identities` | `create_identity()` | 创建 Git 身份（加密存储凭证） | 前端 |
| `GET /git/identities/{id}` | `get_identity()` | 获取单个身份详情 | 前端 |
| `DELETE /git/identities/{id}` | `revoke_identity()` | 吊销身份（软删除） | 前端 |
| `POST /git/check-access` | `check_access()` | 验证身份对仓库的访问权限 | 前端 |

## 关键数据流

```
POST /git/identities → GitIdentityService.create()
  → cipher.encrypt(credential)        # AES 加密
    → (encrypted_credential, key_id)
  → INSERT GitIdentity row             # 密文存 DB
  → COMMIT
```

```
POST /git/check-access → GitIdentityService.check_access()
  → get(identity_id, user_id)         # 校验所有权
  → _assert_usable()                  # 未吊销、未过期
  → PROVIDERS[provider] → provider.check_pat_access(token, repo_url)
    → GitHub: GET https://api.github.com/repos/{owner}/{repo}
  → UPDATE last_used_at
  → COMMIT
```

```
DELETE /git/identities/{id} → GitIdentityService.revoke()
  → get(identity_id, user_id)         # 校验所有权 + 存在性
  → 检查 revoked_at IS NULL            # 防止重复吊销
  → UPDATE revoked_at = now()
  → COMMIT
```

## 设计决策

| 决策 | 理由 | 来源 |
|------|------|------|
| 凭证 AES 加密存储 | DB 泄露时攻击者无法直接使用凭证 | model.py `encrypted_credential` |
| Provider 适配器模式 | 支持 github/gitlab/gitea/generic 多种 Git 平台 | providers/ 目录 |
| 吊销不删除 | 审计追踪，保留历史记录 | service.py `revoke` |
| key_id 字段 | 支持密钥轮换，不同身份可用不同加密密钥 | model.py `key_id` |
| allowed_repositories JSON 数组 | 限制凭证使用范围，最小权限原则 | model.py `allowed_repositories` |

## 依赖关系

### 依赖本模块
- `worktree/service.py`：acquire 时验证 Git Identity 并解密凭证
- 前端 Git 身份管理页面

### 本模块依赖
- `core/crypto`：CredentialCipher 加解密
- `git_identity/providers`：Provider 适配器（github/gitlab/gitea）
- `core/errors`：AppError + PermissionDenied
- `auth/model`：User 关联（user_id FK）

## 注意事项

- 凭证解密后仅在内存中短暂存在，不会写入日志或返回给前端
- `check_access` 会更新 `last_used_at`，高频调用会产生 DB 写入
- Provider 验证是同步 HTTP 调用（httpx），阻塞事件循环直到响应返回
- `expires_at` 为可选字段，PAT 可设置过期时间，OAuth token 由 provider 管理
- 重复吊销会抛出 `IdentityRevoked` 错误（非幂等）
- `git_identity_id` 在 WorktreeLease 中是 NOT NULL FK，但无外键约束（model 中直接 UUID 列）

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-05-31 | 初始归档 | 从代码逆向生成模块文档 |
