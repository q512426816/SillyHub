---
schema_version: 1
doc_type: module-card
module_id: git_identity
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# git_identity

## 定位
后端「Git 身份与凭证管理」功能域：管理用户的 git 提交身份（name/email）与 PAT 等访问凭证，凭证经 `core.crypto` 对称加密落库；通过 provider 校验凭证对目标仓库的访问权限。为 git_gateway 署名、worktree 拉取私有仓库提供身份与凭证来源。

## 契约摘要
- API（prefix=/git, tag=git_identity）：身份 CRUD（list/get/create/revoke）、访问校验 `POST /git/identities/{id}/check-access`。
- `GitIdentityService`：`list_/get/create/revoke`、`check_access(identity_id, repo_url)`（调 provider 校验 PAT）、`_assert_usable`（未吊销/未过期）、`_default_cipher`（CredentialCipher）。
- `GitIdentity(BaseModel, table=True)`：name/email + 加密的 PAT（带 key_id）+ provider 类型 + 状态/过期。
- providers：`GitProvider`（基类，`check_pat_access(token, repo_url) → AccessResult`）、`GitHubProvider`（解析 owner/repo 调 GitHub API 校验）。扩展其他平台（GitLab 等）新增 provider 子类。
- 错误：`IdentityNotFound` / `IdentityRevoked` / `IdentityExpired`。
- 依赖 core.crypto（加密）、workspace（归属）。

## 关键逻辑
```
# 凭证加解密
create(name,email,pat,provider) → CredentialCipher.encrypt(pat) → 落库密文+key_id
check_access → _assert_usable → 解密 PAT → provider.check_pat_access(token, repo_url)
# 署名消费（git_gateway）
_resolve_git_identity(user_id) → 取 GitIdentity.name/email 注入 git env
```

## 注意事项
- PAT 仅以加密形态落库，密文带 key_id 与 master key 匹配；明文永不出库（check_access 时内存解密即用即弃）。
- `_assert_usable` 在使用前拦截已吊销/已过期身份，避免用失效凭证。
- 新增代码托管平台只需实现 `GitProvider.check_pat_access`，在 service 按 provider 类型分发。
- 吊销（revoke）是软删除，保留审计痕迹。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
