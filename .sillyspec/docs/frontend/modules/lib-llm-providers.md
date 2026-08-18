---
schema_version: 1
doc_type: module-card
module_id: lib-llm-providers
author: qinyi
created_at: 2026-08-18 01:45:00
---

# LLM 供应商客户端（lib-llm-providers）

## 定位
LLM 供应商管理 API 客户端（`frontend/src/lib/api/llm-providers.ts`，约 485 行，`src/lib/api/` 目录首个文件）。封装 `/api/llm-providers` 的 CRUD、默认供应商启停、上游模型拉取、用量/额度查询，以及「表单值 → 请求 body」的清洗映射纯函数。供供应商设置页、会话门户、智能体档案表单消费；不含任何 React 代码（hooks 在消费方）。

## 契约摘要
CRUD 与默认启停：
- `listProviders(): Promise<LlmProviderRead[]>` — 当前用户全部供应商（created_at desc）。
- `createProvider(req: LlmProviderCreate)` — 新建（api_key 加密入库）。
- `updateProvider(id, req: LlmProviderUpdate)` — 编辑（api_key 可选，不传不动）。
- `deleteProvider(id)` — 删除（204）。
- `setDefaultProvider(id)` / `unsetDefaultProvider(id)` → `SetDefaultResult`（直接引用 OpenAPI 生成类型：`switched` / `affected_sessions` / `error`）。
  - 同 user×agent_kind 互斥，set 时后端事务内先清兄弟行；凭证探测失败回滚（switched=false + error）。
  - unset 后该用户×agent_kind 无默认 → daemon 回归本机凭证管理。

模型 / 用量 / 额度：
- `fetchProviderModels(req: FetchProviderModelsRequest)` — 双形态联合：
  - 编辑态 `{provider_id}`：后端查行解密取明文，前端只传 id；
  - 新建态 `{base_url, api_key, auth_field?, api_format?}`：直传上游凭证，用完即弃。
- `queryUsage(providerId): Promise<UsageResult>` — 两态返回：
  - `success=true + data[]`：多 tier 余额（balance）/ 套餐百分比（token_plan）；
  - `success=false`：鉴权失效（data=[{is_valid:false}]，前端翻红）或暂不支持（error，灰提示）；
  - 瞬时故障（网络/5xx/429/超时）抛 `ApiError`，由调用方（UsageFooter）keep-last-good 保留上次成功值 10 分钟。
- `getProviderQuota(providerId)` — 弱依赖：后端任何降级场景回 200 + `quota=null`，前端 null 不显示胶囊。
- `detectUsageProvider(baseUrl)` — 纯 UX 探测（balance vs token_plan），子串规则与后端 `_detect_usage_provider` 逐字一致（DeepSeek/硅基/OpenRouter → balance；Kimi/智谱/MiniMax → token_plan）；后端 detect 才是安全真相。

表单映射纯函数（表单 + 单测共用的单一真实源）：
- `formToCreate(v: LlmProviderFormValues)` / `formToUpdate(v)` — 表单值 → POST/PATCH body。
- `cleanRoleMappings` / `cleanExtraEnv` / `clean`（去前后空白，空串 → undefined/null）。

关键类型：
- `LlmProviderRead` — api_key 仅 masked：`api_key_masked` 如 "sk-1...abcd"（首4...尾4），空 key → null，短 key → "****"。
- `LlmProviderFormValues` — 表单中间形态：model_role_mappings 固定 4 行（sonnet/opus/fable/haiku）。
- `LlmProviderRoleMapping` — `{ display?, model?, one_m? }`（one_m = injector 在模型名后追加 `[1m]`）。
- `LlmProviderApiFormat = "anthropic" | "openai_chat"`；`LlmProviderAuthField` = ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY。
- `UsageData` / `UsageResult`、`LlmProviderQuotaWindow` / `LlmProviderQuotaData` / `LlmProviderQuotaResponse`。

## 关键逻辑
```
formToUpdate 铁律：api_key 留空（空串/全空白）时不出现在 PATCH body
  → 后端 exclude_unset + None = 不动原密钥
cleanRoleMappings：model 与 display 均空的行丢弃；one_m 仅在 model 有值时携带
fetchProviderModels 新建态：明文 key 只进请求 body，永不落本地存储/日志（NFR-02）
```

## 注意事项
- **类型迁移债（已登记）**：`LlmProvider*` 仍手写（对齐 `backend/app/modules/llm_provider/schema.py`）；gen:types 已产出同名生成类型，整体迁移是独立的 frontend-type-migration 坑，勿顺手混用两套。
- `SetDefaultResult` 已走生成类型引用（规则 20），新增字段以后端 schema 为准。
- `api_format: "openai_chat"`（llm-provider-openai-format 变更）经服务器 LiteLLM 网关消费；老数据迁移回填 `"anthropic"`。
- `settings_config` 高级配置片段消费方须 `?? null` 归一。
- set-default 返回 `affected_sessions>0` 表示有运行中会话需等 turn 边界生效，UI 据此区分 toast。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
