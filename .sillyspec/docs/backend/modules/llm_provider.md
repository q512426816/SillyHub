---
schema_version: 1
doc_type: module-card
module_id: llm_provider
source_commit: 5815d286
author: qinyi
created_at: 2026-07-25 23:42:38
---
# llm_provider
## 定位
用户级 LLM 供应商管理（D-002 用户级作用域）。负责用户自己的 LLM 供应商配置（接口地址 / API 密钥 / 模型 / 角色映射）的加密存储、CRUD、设默认/取消默认（cc-switch 式「启动/停止」），并经 lease 下发给 daemon 注入为 agent 环境变量。复用 `core/crypto.py` 的 `CredentialCipher` 加密（D-001 平台 SSOT，同 git_identity 范式 D-009）。
## 契约摘要
- `GET /api/llm-providers` → LlmProviderList：当前用户供应商（api_key masked）。
- `POST /api/llm-providers` → LlmProviderRead：新建（api_key 加密入库）。
- `GET /api/llm-providers/{id}` → LlmProviderRead：详情（masked）。
- `PATCH /api/llm-providers/{id}` → LlmProviderRead：编辑（api_key 不传则不动）。
- `DELETE /api/llm-providers/{id}` → 204。
- `POST /api/llm-providers/{id}/set-default` → LlmProviderRead：设默认/「启动」（同 user×agent_kind 互斥，R-05）。
- `POST /api/llm-providers/{id}/unset-default` → LlmProviderRead：取消默认/「停止」（对称 set-default；不清兄弟；全停则 lease 不注入 provider_config，daemon 回归本机，D-007）。
- `LlmProviderService`：list_/get/create/update/delete/set_default/unset_default + 加解密 + is_default 互斥 + owner 过滤。
- 模型：`LlmProvider`（user_id/name/agent_kind/base_url/encrypted_api_key/key_id/model/notes/website_url/auth_field/model_role_mappings/default_fallback_model/extra_env/is_default）。
- lease 下发：`build_claim_payload` 按 `lease.runtime_id → DaemonRuntime.user_id`（主）解析用户默认 provider，解密后注入 `provider_config`（8 字段，D-005）。
## 关键逻辑
```
create/update: CredentialCipher.encrypt(api_key) → 存 encrypted_api_key + key_id（明文不入 ORM）
set_default: 事务内 UPDATE 同 (user_id, agent_kind) 清 is_default 再置（R-05 互斥）
unset_default: 置本行 is_default=False（不清兄弟，幂等；cc-switch「停止」，全停→lease 不注入→daemon 回归本机 D-007）
get/list: WHERE user_id = current_user.id（D-008 owner 过滤）
_to_read: decrypt → X-09 masked（首4...尾4 / <8位**** / 空None）→ LlmProviderRead
lease 下发: 命中默认 provider → 解密 api_key → provider_config（D-007 未配则 absent，daemon 走本机 env 兜底）
```
## 注意事项
- 凭证必须经 `CredentialCipher` 加密，明文绝不入库/出库；`SILLYSPEC_MASTER_KEY` 丢失则历史凭证不可解（同 git_identity，crypto.py:37-44 use-time 503）。
- api_key 全链路脱敏：API 仅返回 masked，provider_config 严禁落 submitMessages/complete_lease/AuditLog/日志（R-02，audit_hooks 只读 ORM 列故捕获不到明文，R-04）。
- agent_kind 抽象（D-006）：第一版只 "claude"，加 codex/gemini 只动 daemon credential-injector + 此处枚举值，表/lease 协议不变。
- is_default 互斥：每 (user_id, agent_kind) 至多 1 条（R-05 并发由事务 + 索引保证）。
- 未配供应商：lease 不下发 provider_config，daemon 走本机 env（D-007 零回归）。
- 反代相关字段（User-Agent/Header/Body 覆盖/API 格式转换）明确不做（D-012 非目标）。
## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->

## 变更索引
- ql-20260726-005-a43f | 加 cc-switch 式「启动/停止」：新增 unset-default 端点 + service.unset_default（全停→lease 不注入→daemon 回归本机）+ 前端启动/停止按钮 UI。
