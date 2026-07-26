---
author: qinyi
created_at: 2026-07-26 11:50:00
---

# 模块影响分析（Module Impact）— LLM 供应商管理

> 基于 design.md §6 文件清单 + git diff（commit 5f8fbeb9 feat + 411c84e5 X-10 修复）三重交叉验证。以 git diff 为准。

## 模块影响矩阵

| 模块 | 影响类型 | 文件 | 说明 |
|---|---|---|---|
| **backend/llm_provider（新模块）** | 新增 | `__init__.py` / `model.py`（LlmProvider 表）/ `schema.py`（Create/Update/Read+masked）/ `service.py`（CRUD+CredentialCipher 加解密+is_default 互斥+owner 过滤）/ `router.py`（/api/llm-providers 6 端点）/ `tests/test_llm_provider.py`（24 用例） | 平台 LLM 供应商管理核心：用户级 provider + core/crypto.py 加密 SSOT（D-001/D-002/D-008/D-009） |
| **backend/migrations** | 数据结构变更 | `migrations/env.py`（注册 LlmProvider model）+ `migrations/versions/20260725_create_llm_providers.py`（建表 revision 202607251100） | llm_providers 表（17 列 + 2 索引）+ env.py eager-import 防 autogenerate 误判 |
| **backend/agent** | 接口变更 + 逻辑变更 | `router.py`（get_execution_context 调 _inject_provider_config 注入 provider_config + 覆盖 model，X-10）/ `schema.py`（ExecutionContextResponse 加 provider_config 字段） | claude SDK 走 /execution-context 拿 execPayload.model，X-10 覆盖为 provider.model（修 opus[1m] 透传 bug） |
| **backend/daemon** | 逻辑变更 | `lease/context.py`（build_claim_payload + _inject_provider_config 按 lease.runtime_id→DaemonRuntime.user_id 解析默认 provider + 解密 + 8 字段 provider_config + X-10 model 覆盖） | lease 下发用户默认供应商配置给 daemon |
| **sillyhub-daemon** | 接口变更 + 逻辑变更 | `credential-injector.ts`（新：CredentialInjector 接口 + ClaudeCredentialInjector 6 映射 + getInjector 注册表）/ `spawn-env.ts`（buildSpawnEnv 第0层 provider_config→injector→env 最高优先级 + redactProviderConfig）/ `types.ts`（ProviderConfig + LeaseCtx/ExecutionContextPayload 加 provider_config）/ `daemon.ts`（interactive buildSpawnEnv 门控独立化 X-02）/ `tests/credential-injector.test.ts` + `spawn-env.test.ts`（52 用例） | daemon 注入器抽象（agent_kind + per-agent injector，D-006）+ spawn env 第0层（D-004/D-007） |
| **frontend** | 新增 | `components/llm-providers/`（llm-provider-list 容器 + llm-provider-form 表单含模型角色映射表格/认证字段/env 编辑器）/ `lib/api/llm-providers.ts`（API 封装 + types + formToCreate/formToUpdate）/ `app/(dashboard)/settings/page.tsx`（挂载「我的供应商」tab）/ `components/llm-providers/__tests__/` + `lib/api/__tests__/`（24 用例） | 供应商管理页（CRUD + 设默认，D-003 纯自定义） |
| **deploy** | 配置变更 | `deploy/.env.example`（补 SILLYSPEC_MASTER_KEY 文档，R-03 文档债） | crypto 加密主键 use-time 503 文档 |

## 关联变更（非本变更，记录边界）

- **CLAUDE_CONFIG_DIR 隔离**（spawn claude 不读宿主机 ~/.claude）：独立 quick `ql-20260726-002-1180`（commit `13fc1dc9`），非本变更范围。但与本变更 e2e 强相关（cc-switch settings.json 污染平台注入），记忆 `claude-code-config-dir-isolation-under-daemon.md`。
- **code-quality-hardening-2026-07-24**：另一变更（commit `1686a208`），baseline overlay 带入，非本变更。

## 未匹配文件

无——所有 git diff 文件都匹配到上述 7 个模块。规范文件（.sillyspec/changes/2026-07-25-llm-provider-management/* + docs/backend/modules/llm_provider.md）属 sillyspec 模块（变更管理），不计业务模块影响。
