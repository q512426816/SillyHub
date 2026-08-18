---
schema_version: 1
doc_type: module-card
module_id: git_identity
author: qinyi
created_at: 2026-08-18 01:45:00
---

# Git 凭证管理（git_identity）

## 定位
用户级 Git 凭证身份（PAT/Token）管理：加密存储、吊销、可用性校验、远端仓库访问探测。为 worktree / git_gateway / agent 提供 clone/push 凭证来源；provider 可插拔（当前仅 github）。

## 契约摘要
- `GET /api/git/identities` → 当前用户身份列表（不回显明文凭证）。
- `POST /api/git/identities` → 创建（凭证加密入库）；`GET /{id}` 详情；`DELETE /{id}` 吊销（软删置 revoked_at）。
- `POST /api/git/identities/check-access` → `AccessCheckResult`：用指定 identity 真实探测对某 repo_url 的访问权。
- `GitIdentityService`：`list_` / `get` / `create` / `revoke` / `check_access` + `_assert_usable`；全部按 user_id 库层隔离。
- providers：`PROVIDERS` 注册表（providers/base.py `GitProvider` 协议 + providers/github.py `GitHubProvider.check_pat_access`）。
- 模型：git_identities（provider/git_username/encrypted_credential/key_id/expires_at/revoked_at/last_used_at）。

## 关键逻辑
```
create: CredentialCipher.encrypt(明文 PAT) → 存 encrypted_credential + key_id
check_access:
  _assert_usable（revoked → IdentityRevoked; 过期 → IdentityExpired）
  token = cipher.decrypt(row.encrypted_credential, row.key_id)
  PROVIDERS[provider].check_pat_access(token, repo_url)
  更新 last_used_at → commit
```

## 注意事项
- 凭证必须经 core 的 `CredentialCipher`（NaCl SecretBox）加密，明文绝不入库/出库；加密主密钥丢失则历史凭证不可解（core 卡片运维高危项），key_id 记录密钥版本。
- `_assert_usable` 是所有使用前的统一闸；吊销为软删（revoked_at），已吊销/过期 identity 被引用时报错语义由使用方（git_gateway/worktree）承接。
- check_access 真实调用远端 API（GitHub 等），有外部 IO 与速率限制风险；成功后写 last_used_at。
- 新增 provider：实现 `GitProvider.check_pat_access` 并注册进 `PROVIDERS`，模型 provider 字段为字符串自由度。
- 查询/写入均限定 user_id，用户之间凭证严格隔离。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
