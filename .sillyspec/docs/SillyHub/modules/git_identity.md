---
schema_version: 1
doc_type: module-card
module_id: git_identity
author: qinyi
created_at: 2026-08-18 01:45:00
---

# Git 身份与凭证管理（git_identity）

## 定位
后端「Git 身份与凭证管理」：用户级 git 提交署名（git_username/git_email）与访问凭证（PAT 等）的 CRUD。凭证经 core.crypto 的 CredentialCipher 对称加密（密文 + key_id）落库，明文仅在使用瞬间内存解密。为 git_gateway 署名、worktree 拉取私有仓库、agent 执行 git 提供身份与凭证来源。是 llm_provider 凭证加密范式的参照原型（两模块同构）。

## 契约摘要
- 端点（prefix=/git，tag=git_identity，全部 `require_permission_any(Permission.GIT_IDENTITY_ADMIN)`）：
  - `GET /git/identities` — 本人身份列表（创建时间倒序）
  - `POST /git/identities` — 新建（201）
  - `GET /git/identities/{id}` — 详情
  - `DELETE /git/identities/{id}` — 吊销（软删，置 revoked_at，200）
  - `POST /git/check-access` — 校验某身份对 repo_url 的访问权
- `GitIdentityService`：`list_` / `get` / `create` / `revoke` / `check_access`；构造可注入 cipher（测试用 in-memory，生产 lazy `get_cipher()`）。
- `GitIdentity` 字段：provider / git_username / git_email / credential_type / encrypted_credential + key_id / allowed_repositories / expires_at / revoked_at / last_used_at。
- providers/：`GitProvider` 基类（`check_pat_access(token, repo_url) → AccessResult`）、`GitHubProvider`（解析 owner/repo 调 GitHub API）；`PROVIDERS` 注册表按 provider 名分发。
- 错误：`IdentityNotFound`（404）/ `IdentityRevoked`（400）/ `IdentityExpired`（400）/ PermissionDenied（403）。

## 关键逻辑
```
create: cipher.encrypt(credential) → (密文,key_id) 落库（明文永不入 ORM）
get(id,user): 先按 id 查 → 无则 404 → user_id 不匹配则 403（两段式，
  不向越权者确认 id 存在性）
check_access: get → _assert_usable（已吊销/已过期拦截）
  → PROVIDERS[provider].check_pat_access(解密 token, repo_url)
  → 更新 last_used_at
```

## 注意事项
- 明文凭证只在 `check_access` 解密瞬间存在于局部变量，永不入日志/响应/审计。
- owner 两段式（404 与 403 语义区分）是防枚举设计，跨用户访问不得合并成同一错误。
- `allowed_repositories` 是仓库级授权清单，消费方（worktree/agent）取凭证时应校验目标仓库在清单内。
- 吊销是软删除（revoked_at 时间戳），保留审计痕迹；重复吊销抛 IdentityRevoked。
- 新增托管平台（GitLab/Gitee 等）只需实现 `GitProvider.check_pat_access` 并注册进 PROVIDERS，service 层不改。
- 改本模块加密/owner 过滤范式时同步审视 llm_provider（同构模块，双向保持一致）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
