---
author: qinyi
created_at: 2026-08-10 09:30:00
---

# 模块影响分析（Module Impact）— 供应商管理支持完整 URL + OpenAI API 格式（经 LiteLLM 网关）

> 分析对象：change `2026-08-08-llm-provider-openai-format`。
> 真相源：git diff（execute base `b3168060`..HEAD `19700fae` + working-tree gap-A/gap-D 未提交）与 proposal.md / design.md / tasks.md 三重交叉。
> **注意**：execute base `b3168060` 距今较远，期间多个独立 change（change-center-on-demand / security-backend-guardrails / security-ppm-ownership / dispatch-worker / changes-ts-apitypes-migrate）已并入 main。下表**仅列本 change 实际拥有的文件**，其余 change 的文件（change/dispatch/mcp_gateway ssrf/auth bootstrap/ppm ownership 等）已剔除，不归本变更影响。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend | 数据结构变更 + 接口变更 + 新增 + 逻辑变更 | `backend/app/modules/llm_provider/model.py`<br>`backend/app/modules/llm_provider/schema.py`<br>`backend/app/modules/llm_provider/router.py`<br>`backend/app/modules/llm_provider/service.py`<br>`backend/app/modules/llm_provider/probe.py`<br>`backend/app/modules/llm_provider/litellm_client.py`（新）<br>`backend/app/modules/llm_provider/tests/test_api_format.py`（新）<br>`backend/app/modules/llm_provider/tests/test_litellm_client.py`（新）<br>`backend/app/modules/llm_provider/tests/test_llm_provider.py`<br>`backend/app/modules/daemon/lease/context.py`<br>`backend/app/modules/daemon/lease/service.py`<br>`backend/app/modules/daemon/tests/test_resolve_default_provider_config.py`<br>`backend/tests/modules/daemon/lease/test_provider_config_payload.py`<br>`backend/app/core/config.py`<br>`backend/migrations/versions/202608091100_add_llm_provider_api_format.py`（新）<br>`backend/openapi.json` | llm_providers 加 `api_format`（anthropic/openai_chat）列 + 完整 URL 按格式归一算法；schema 透传 api_format + litellm_registered 响应字段；router 加 openai 守护 / set-default 联动 register；service set/unset-default/delete 三事件调 litellm_client（best-effort R-09）；probe/fetch-models 按 api_format 产 Bearer 头 + 候选 URL；**新增 litellm_client.py**（register/unregister admin API + gap-A model_info.mode=chat）；lease context.py provider_config openai 形态（litellm_base_url/auth_token/model_name，不含上游 key D-003）；config 加 litellm_base_url/litellm_master_key 设置；新 alembic 迁移加列；openapi.json + api-types 重生成 | false |
| frontend | 接口变更 + 逻辑变更 + 新增 | `frontend/src/components/llm-providers/llm-provider-form.tsx`<br>`frontend/src/components/llm-providers/llm-provider-list.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx`（新）<br>`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`（新）<br>`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts`<br>`frontend/src/config/llmProviderPresets.ts`<br>`frontend/src/lib/api-types.ts`<br>`frontend/src/lib/api/llm-providers.ts`<br>`frontend/src/lib/api/__tests__/llm-providers.test.ts` | 表单加 API 格式下拉（openai 隐藏认证字段/角色映射、显示完整 URL 提示）；列表加格式徽标 + litellm_registered 状态；预设加 OpenAI 格式条目（opencode_zen_openai）；api-types 从后端 OpenAPI 重新生成（含 api_format/litellm_registered 字段）；Wave2 守护移除（FR-11 set-default openai 不再禁） | false |
| sillyhub-daemon | 接口变更 + 逻辑变更 | `sillyhub-daemon/src/types.ts`<br>`sillyhub-daemon/src/credential-injector.ts`<br>`sillyhub-daemon/tests/credential-injector.test.ts` | ProviderConfig 加 4 optional 字段（api_format/litellm_base_url/litellm_model_name/litellm_auth_token，零回归）；credential-injector.toEnv 加 openai_chat 早返回分支（BASE_URL/AUTH_TOKEN/MODEL 指向 LiteLLM + **gap-D 4 档位 DEFAULT_*_MODEL 全映射** litellm_model_name，不注入上游 key）；anthropic 分支逐字不变（NFR-02 零回归） | false |
| deploy | 配置变更 + 新增 | `deploy/litellm-config.yaml`（新）<br>`deploy/docker-compose.yml`<br>`deploy/docker-compose.dev.yml`<br>`deploy/.env.example` | 新增 litellm 服务（admin API 动态注册模式 model_list:[]，healthcheck python urllib）；docker-compose litellm + external network multi-agent-platform_default 跨 compose 打通 backend→litellm；.env.example 加 LITELLM_MASTER_KEY；dev compose 加 litellm | false |
| sillyspec | 配置变更（文档） | `.sillyspec/docs/backend/modules/llm_provider.md`<br>`.sillyspec/docs/multi-agent-platform/modules/deploy.md` | llm_provider 模块文档更新（api_format 字段 + LiteLLM 集成路径 + mode=chat）；deploy 模块文档加 litellm 服务说明 + backend 镜像 --no-cache rebuild 部署注意 | false |

## 交叉验证

- **声明范围**（proposal.md 变更范围）：数据模型 api_format 列 / 后端逻辑 fetch-models+schema / LiteLLM 网关 / daemon ProviderConfig+injector / 前端表单+预设+徽标+api-types —— 与下表逐项对应。
- **任务范围**（tasks.md task-01~12）：覆盖 model/migration（task-01/02）、schema/router（task-04）、frontend form（task-05）、presets/badge/guard（task-06/07）、deploy litellm（task-08）、litellm_client+set/unset/delete 联动（task-09）、context provider_config（task-10）、daemon injector（task-11）、Wave2 端到端+文档+守护移除（task-12）—— 与下表文件逐项对应。
- **真实变更**（git diff）：本 change 文件全部在上表，无声明/任务遗漏的真实文件。
- **零回归锚点**：anthropic 形态全链路（probe/service/injector/前端）逐字不变（NFR-02，单测锁死）；本变更不触碰其它 change 的代码（ppm/change/dispatch/mcp_gateway/auth 等 diff 文件已剔除）。

## 未匹配文件

| 文件 | 原因 |
|------|------|
| 无 | 本 change 所有文件均匹配到 backend/frontend/sillyhub-daemon/deploy/sillyspec 模块 |

> 说明：git diff b3168060..HEAD 中含大量**其它 change** 的文件（change-center-on-demand 归档、security-backend-guardrails incident/ssrf、security-ppm-ownership ppm ownership、dispatch-worker、changes-ts-apitypes-migrate 等），均不属于本变更，已在分析中剔除，不计入影响矩阵。
