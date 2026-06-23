---
schema_version: 1
doc_type: module-card
module_id: git_identity
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:08:51
---
# git_identity
## 定位
Git 凭证身份（PAT/Token）管理。负责用户级 git identity 的加密存储、吊销、可用性校验与远端仓库访问探测。为 worktree/git_gateway/agent 提供 clone/push 所需凭证。
## 契约摘要
- `GET /api/git/identities` → GitIdentityList：当前用户身份列表（不回显明文）。
- `POST /api/git/identities` → GitIdentityRead：创建（凭证加密入库）。
- `GET /api/git/identities/{id}` → GitIdentityRead：详情。
- `DELETE /api/git/identities/{id}`：吊销（revoke，软删置 revoked_at）。
- `POST /api/git/identities/check-access` → AccessCheckResult：用该 identity 探测对某 repo_url 的访问权。
- `GitIdentityService`：list_/get/create/revoke/check_access + _assert_usable/_default_cipher。
- 模型：GitIdentity（provider/git_username/encrypted_credential/key_id/expires_at/revoked_at/last_used_at）。
## 关键逻辑
```
create: CredentialCipher.encrypt(明文 PAT) → 存 encrypted_credential + key_id
check_access:
  _assert_usable（未吊销/未过期）
  token = cipher.decrypt(row.encrypted_credential, row.key_id)
  PROVIDERS[provider].check_pat_access(token, repo_url)
  更新 last_used_at → commit
```
## 注意事项
- 凭证必须经 `CredentialCipher` 加密，明文绝不入库/出库；密钥丢失则历史凭证不可解。
- `_assert_usable` 是所有使用前的统一闸：revoked → IdentityRevoked，过期 → IdentityExpired。
- check_access 会真实用 token 调用远端（GitHub 等），有外部 IO 与速率风险。
- 吊销是软删（revoked_at），关联的 worktree lease 引用历史 identity 需注意失效。
## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
