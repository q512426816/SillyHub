---
schema_version: 1
doc_type: module-card
module_id: lib-git-identities
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:25
---
# lib-git-identities

## 定位
Git 身份凭据管理的前端 API 客户端，全局域（当前用户维度）。负责登记/列出/吊销托管在平台侧的 git 身份（provider 凭据），并在提交/拉取前校验某身份对某仓库的访问权限。对应 `/api/git/identities` 与 `/api/git/check-access`。

## 契约摘要
| 函数 | 语义 | HTTP |
|---|---|---|
| `listGitIdentities()` | 列出当前用户已登记的 git 身份 | GET `/api/git/identities` |
| `createGitIdentity(input)` | 新登记身份（含明文 credential，服务端托管） | POST `/api/git/identities` |
| `getGitIdentity(identityId)` | 取单个身份详情 | GET `/api/git/identities/{id}` |
| `revokeGitIdentity(identityId)` | 吊销身份 | DELETE `/api/git/identities/{id}` |
| `checkGitAccess(input)` | 校验身份是否可访问指定 repo_url | POST `/api/git/check-access` |

类型：
- `GitIdentityRead`：`id/user_id/provider/git_username/git_email/credential_type/key_id/allowed_repositories/expires_at/revoked_at/last_used_at`。
- `GitIdentityCreate`：`provider`（必填）、`credential`（明文）、`credential_type/git_username/git_email/allowed_repositories/expires_at` 可选。
- `AccessCheckRequest`：`{ identity_id, repo_url }`；`AccessCheckResult`：`{ accessible: boolean; reason: string|null }`。

## 关键逻辑
```
create 时 credential 以明文进 POST body，由后端加密存储并返回 key_id
check-access 返回 accessible 布尔 + 失败原因 reason
list 返回 { items, total } 包装结构
```

## 注意事项
- `credential`（token/密钥）仅前端→后端单向传递，不回显；`GitIdentityRead` 不含明文，只含 `key_id`。
- revoke 后 `revoked_at` 置位，前端需据此禁用选项。
- `allowed_repositories` 为空数组通常表示不限制。
- 凭据有时效 `expires_at`，过期后 check-access 大概率失败。
- 端点是 `/api/git/identities`（带斜杠分段），非 `/api/git-identities`。
- 仅依赖 `lib-api`。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
