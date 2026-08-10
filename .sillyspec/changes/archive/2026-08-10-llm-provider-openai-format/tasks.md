---
author: qinyi
created_at: 2026-08-09 01:22:00
---

# 任务（Tasks）— 供应商管理支持完整 URL + OpenAI API 格式

> 高层任务清单（plan 阶段拆 Wave + 细化步骤）。FR/NFR/C 映射见 requirements.md，文件清单见 design.md §6。

## Wave 1 — 供应商管理（可独立验收）

- [ ] T1.1 后端数据模型：`llm_provider/model.py` 加 `api_format` 列；新增 Alembic 迁移（加列 + 老行回填 anthropic）。【FR-01】
- [ ] T1.2 后端 schema：Create/Update/Read/FetchModelsRequest 加 `api_format` 字段（Literal anthropic/openai_chat，default anthropic）。【FR-01/FR-04】
- [ ] T1.3 后端 service 鉴权+URL：`_build_auth_headers(api_key, auth_field, api_format)`、`_candidate_urls(base_url, api_format)`、`_strip_openai_suffix` helper；fetch_models 透传 format。【FR-02/FR-03/FR-04】
- [ ] T1.4 后端 probe：`probe_provider` 加 `api_format` 参数，按格式产头+候选。【FR-03/FR-04】
- [ ] T1.5 后端 set_default：透传 api_format 给 probe（openai 也探测上游 key 有效）；Wave1 不接 LiteLLM（FR-06 留 Wave2）。【FR-03】
- [ ] T1.6 后端单测：双格式鉴权头 + 完整 URL 剥路径 + openai/anthropic 候选 URL + 探测归一（不真实联网，mock httpx）。【FR-01~FR-04】
- [ ] T1.7 OpenAPI：backend schema 改动后跑生成，提交 openapi.json。
- [ ] T1.8 前端 api-types：`pnpm gen:types`（先确认 node_modules 健康）；lib/api/llm-providers.ts 手写 LlmProvider* 补 api_format。【FR-10】
- [ ] T1.9 前端表单：API 格式下拉 + openai 时隐藏认证字段/角色映射 + URL 框完整 URL 提示。【FR-09】
- [ ] T1.10 前端预设：新增 OpenCode Zen OpenAI 预设（openai_chat）；现有预设补 api_format:"anthropic"。【FR-10】
- [ ] T1.11 前端列表：openai 格式行加格式徽标。【FR-10】
- [ ] T1.12 前端过渡守护：openai 供应商 set-default 提示（FR-11，Wave2 移除）。
- [ ] T1.13 前端单测：表单 api_format 切换字段显隐 + 预设补字段 + 列表徽标。
- [ ] T1.14 Wave1 验收：对 opencode.ai 真实拉模型成功（测试 token 仅本次用不入库）；anthropic 供应商零回归。

## Wave 2 — LiteLLM 集成（前置 spike，端到端 Claude Code 可用）

- [ ] T2.0 spike-litellm-routing（P0 前置）：本地起 LiteLLM，验证 ① admin API 注册/注销幂等 ② Anthropic /v1/messages→OpenAI 流式 ③ 工具调用 tool_use↔function 转换 ④ Claude Code 角色模型名请求路由。失败回退 virtual key / config 重载。【R-01/C-02】
- [ ] T2.1 部署：docker-compose 加 litellm 服务（healthcheck + restart=always + master key env）。【FR-05/NFR-03】
- [ ] T2.2 后端 litellm_client：封装 LiteLLM admin API register/unregister（幂等 + best-effort）。【FR-06】
- [ ] T2.3 后端 set/unset_default/delete：openai 格式联动 litellm_client register/unregister；set_default 返回 litellm_registered 标志（扩 SetDefaultResult）。【FR-06/R-09】
- [ ] T2.4 后端 provider_config openai 形态：resolve_default_provider_config / _inject_provider_config（context.py）openai 分支构造 6 字段 config（不含上游 key）。【FR-07】
- [ ] T2.5 daemon 类型：ProviderConfig 加 api_format + litellm_base_url/model_name/auth_token。【FR-08】
- [ ] T2.6 daemon injector：credential-injector openai 分支（ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL 指向 LiteLLM，不注入上游 key）。【FR-08】
- [ ] T2.7 后端/daemon 单测：litellm_client mock + provider_config openai 形态 + injector openai 分支。
- [ ] T2.8 Wave2 端到端验收：openai 供应商 set-default → Claude Code 会话经 LiteLLM 正常对话（工具调用 + 流式）；移除 FR-11 过渡守护。
- [ ] T2.9 文档同步：llm_provider.md 模块文档补 api_format/D-012 绕过注释 + LiteLLM 网关说明；deploy 文档补 LiteLLM 服务。

## 验收门

- Wave1 done：FR-01~FR-04/FR-09~FR-11 + NFR-02 通过；opencode.ai 拉模型真实成功。
- Wave2 done：FR-05~FR-08 + NFR-01/03 + C-01~C-03 通过；端到端 Claude Code 经 LiteLLM 可用。
