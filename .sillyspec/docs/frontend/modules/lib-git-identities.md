---
schema_version: 1
doc_type: module-card
module_id: lib-git-identities
author: qinyi
created_at: 2026-08-18 01:45:00
---

# Git 身份凭据客户端（lib-git-identities）

## 定位
Git 身份凭据管理的前端 API 客户端（当前用户维度）。登记/列出/吊销托管在平台侧的 git 身份（provider 凭据），并校验某身份对某仓库的访问权限。类型全部从 OpenAPI 生成（`@/lib/api-types`，后端 `git/schema.py`），已消手写漂移。消费方为 `/settings/git-identities` 设置页。

## 契约摘要
| 函数 | 语义 | HTTP |
|---|---|---|
| `listGitIdentities()` | 列出当前用户已登记的 git 身份 | GET `/api/git/identities` |
| `createGitIdentity(data)` | 新登记身份（credential 明文进 body，服务端加密托管） | POST `/api/git/identities` |
| `revokeGitIdentity(identityId)` | 吊销身份 | DELETE `/api/git/identities/{id}` |
| `checkGitAccess(data)` | 校验身份是否可访问指定 repo_url | POST `/api/git/check-access` |

类型再导出（均为生成版）：`GitIdentityRead` / `GitIdentityList` / `GitIdentityCreate` / `AccessCheckRequest` / `AccessCheckResult`。

## 关键逻辑
```
create: credential 明文仅前端→后端单向传递，后端加密存储返回 key_id
check-access: { identity_id, repo_url } → { accessible, reason }
list: { items, total } 包装
```

## 注意事项
- **无 `getGitIdentity` 单条查询**：当前文件只有 list/create/revoke/check 四函数（索引残留符号）；详情从 list 结果取。
- `credential` 不回显：`GitIdentityRead` 只含 `key_id`，列表/详情无明文。
- revoke 后 `revoked_at` 置位，UI 需据此禁用；凭据有 `expires_at` 时效，过期后 check-access 大概率失败。
- 字段细节（allowed_repositories 等）以生成版 `api-types.ts` 为单一真相，本卡不复制，后端 schema 改动经 `pnpm gen:types` 暴露。
- 端点是 `/api/git/identities`（带斜杠分段），非 `/api/git-identities`。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
