---
plan_level: full
author: qinyi
created_at: 2026-08-09 01:30:00
---

# 实现计划（Plan）— 供应商管理支持完整 URL + OpenAI API 格式（经 LiteLLM 网关）

## Spike 前置验证

| Spike | 验证内容 | 通过标准 | 不通过后果 |
|---|---|---|---|
| spike-litellm-routing | 本地起 LiteLLM，验证：① admin API 注册/注销 model 幂等（`POST /model/new` + 删除）② Anthropic `/v1/messages`→OpenAI 上游流式 ③ 工具调用 tool_use↔function 转换 ④ Claude Code 后台发的角色模型名请求经 LiteLLM 路由（openai 单模型不设角色 env）是否命中或需 mapping | 4 项用例全部跑通，确定路由机制（admin API 动态注册 vs config 重载 vs virtual key） | Wave2 实现推迟；回退备选（virtual key / config.yaml+/reload）；若全不可控则降级为方案 A（Wave2 转独立 change） |

> spike-litellm-routing 是 Wave2 的 P0 前置门（R-01）。Wave2 所有任务在 spike 通过后定稿路由机制。

## Wave 1（供应商管理，可独立验收，任务间无强依赖可并行）

- [x] task-01: 后端数据模型 + 迁移——`llm_provider/model.py` 加 `api_format` 列（String(32) NOT NULL default anthropic）+ Alembic 迁移（老行回填 anthropic）（覆盖：FR-01, D-001@v1, NFR-02）✅ 2026-08-09 已完成验证：alembic head=202608091100，迁移正反可跑，llm_provider 161 passed 零回归
- [x] task-02: 后端 schema + service/probe 按 format——Create/Update/Read/FetchModelsRequest 加 `api_format`；`_build_auth_headers(api_key,auth_field,api_format)`、`_candidate_urls(base_url,api_format)`、`_strip_openai_suffix` helper；fetch_models + probe_provider 透传 format（覆盖：FR-02, FR-03, FR-04, D-002@v1）✅ 2026-08-09 已完成验证：双格式 helper + 全链路透传，既有 139 测零回归（api_format 默认 anthropic）
- [x] task-03: 后端单测——双格式鉴权头 + 完整 URL 剥路径 + openai/anthropic 候选 URL + 探测归一 + set_default 透传 format（mock httpx，不真实联网）（覆盖：FR-01~04, NFR-02）✅ 2026-08-09 已完成验证：test_api_format.py 22 passed（helper 双格式/strip/候选/fetch_models inline openai/probe openai/create-update-read 透传）
- [x] task-04: OpenAPI 生成 + 前端 api-types——backend 跑 openapi 生成提交 openapi.json；前端 `pnpm gen:types`（先确认 node_modules 健康）；lib/api/llm-providers.ts 手写 LlmProvider* 补 api_format（债显式登记）（覆盖：FR-10）✅ 2026-08-09 已完成：gen:types 重生成 openapi.json+api-types.ts 含 api_format（LlmProvider Create/Update/Read/Fetch 5 处 schema）；llm-providers.ts 手写补 api_format+formToCreate/Update 透传+文件头债登记；顺带同步 dispatch_worker caller-worktree(worktree_path/branch/worker_prompt)+mission external(orchestration_mode) 类型债（规则20，后端 a1bea56a 提交时未跑 gen:types）。
- [x] task-05: 前端表单——API 格式下拉（Anthropic/OpenAI Chat）+ openai 时隐藏认证字段/角色映射 + URL 框完整 URL 提示（覆盖：FR-09）✅ 2026-08-09 已完成：apiFormat state + API 格式下拉 + openai 条件隐藏认证字段/角色映射/默认兜底（Fragment 包裹，env 保留）+ handleSubmit/handleFetch/applyPreset/resetToCustom 透传 + base_url 完整URL提示。typecheck 绿 + 65 测试零回归。
- [x] task-06: 前端预设 + 列表 + 过渡守护——新增 OpenCode Zen OpenAI 预设（openai_chat）+ 现有预设补 api_format:"anthropic" + 列表 openai 徽标 + openai set-default 过渡提示（覆盖：FR-10, FR-11, D-007@v1）✅ 2026-08-09 已完成：接口+11预设补 anthropic + opencode_zen_openai 预设 + list openai 徽标 + handleSetDefault 守护（Wave1 过渡，Wave2 task-12 移除）。typecheck 绿 + 65 测试零回归。
- [ ] task-07: 前端单测 + Wave1 真实验收——表单 api_format 切换字段显隐 + 预设补字段 + 列表徽标单测；对 opencode.ai 真实「获取模型列表」成功（测试 token 仅本次用不入库）；anthropic 供应商零回归（覆盖：FR-01~04/09~11, NFR-02）⏳ 2026-08-09 单测部分完成（commit 4fb9a2d1，review.json cannot_verify）：form-apiformat(6)+presets(6)+list徽标守护(2) 共 14 用例，llm-providers 目录 60 测试全绿 + typecheck 绿（task-05/06 零回归）；⚠️ Wave1 真实验收（opencode.ai 拉模型）cannot_verify 待 opencode.ai 测试 token（review.json requiredEvidence），Wave2 待真实环境（Docker LiteLLM + Claude Code）

## Wave 2（LiteLLM 集成，依赖 Wave1 + spike-litellm-routing）

- [x] task-08: LiteLLM 部署——docker-compose 加 litellm 服务（与 backend 同网络，master key env，healthcheck + restart=always）（覆盖：FR-05, NFR-03, R-08）✅ 2026-08-09 代码完成（commit f8a2d6c3，review.json cannot_verify）：litellm+litellm-db 服务（独立 postgres 避 alembic_version 冲突）+ master key ${LITELLM_MASTER_KEY:?must set} + STORE_MODEL_IN_DB=True + DATABASE_URL→litellm-db + healthcheck /health/liveness + restart always + prod 无端口/dev 127.0.0.1 + backend 不 depends_on + .env.example 占位 + litellm-config.yaml（admin API model_list:[]）。yaml 结构+安全验证全过；⚠️ docker compose config + 容器 healthcheck + backend curl litellm 真实验证 cannot_verify 待 spike-litellm-routing + 联调环境
- [x] task-09: 后端 litellm_client + 联动——`litellm_client.py` 封装 admin API register/unregister（幂等 best-effort）；set_default/unset_default/delete openai 格式联动；set_default 返回 `litellm_registered` 标志（扩 SetDefaultResult）；**写 litellm_client mock 单测**（覆盖：FR-06, R-09, D-003@v1）✅ 2026-08-09 代码+mock 单测完成（commit 00995d55，review.json cannot_verify）：config LITELLM_BASE_URL/MASTER_KEY settings + litellm_client(register/unregister/litellm_model_name R-03，明文 key 仅请求体) + service DefaultSwitchResult.litellm_registered + set/unset/delete openai 联动 + schema/router 透传 + test_litellm_client(13)+test_llm_provider 联动(5)。llm_provider 179 passed 零回归 + ruff 绿；⚠️ admin API 路由为 design 假设，真实 LiteLLM 联动待 spike + task-12
- [x] task-10: 后端 provider_config openai 形态——`resolve_default_provider_config` / `_inject_provider_config`（context.py）openai 分支构造 6 字段 config（不含上游 key）；**写 provider_config openai 形态单测**（覆盖：FR-07, D-003@v1）✅ 2026-08-09 代码+单测完成（commit e5deb556，review.json cannot_verify）：context.py openai 早返回 6 字段（agent_kind/api_format/litellm_base_url/litellm_model_name 复用 task-09 helper/litellm_auth_token/model，D-003 不含上游 key）+ _inject override_model .get() 兼容 openai + test_resolve_default_provider_config openai 4 用例 + test_provider_config_payload openai 注入 2 用例（interactive+batch）。30 passed 零回归 + ruff 绿；⚠️ 真实 LiteLLM claim 路由命中待 spike + task-12
- [x] task-11: daemon 类型 + injector openai 分支——ProviderConfig 加 api_format + litellm_base_url/model_name/auth_token；credential-injector openai 分支（ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL 指向 LiteLLM，不注入上游 key）+ 单测（覆盖：FR-08, NFR-01）✅ 2026-08-09 代码+单测完成（commit f2b13d5d，review.json cannot_verify）：types.ts ProviderConfig +4 optional 字段（api_format/litellm_base_url/model_name/auth_token，与 task-10 逐字对齐）+ injector toEnv openai 早返回 3 字段指向 LiteLLM（D-003 不注上游 key/不走角色映射，D-006 不新增 injector 类）+ anthropic 6 条规则逐字不变 + test openai 5 用例。vitest 42 passed（5 新+37 零回归）+ tsc 绿；⚠️ 真实 LiteLLM 端到端经 injector 路由待 spike + task-12
- [ ] task-12: Wave2 端到端验收 + 收尾——openai 供应商 set-default → Claude Code 会话经 LiteLLM 正常对话（工具调用 + 流式）；移除 FR-11 过渡守护；llm_provider.md 模块文档 + deploy 文档同步（覆盖：FR-05~08, NFR-01/03, C-01, R-07）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端数据模型+迁移 | W1 | P0 | — | FR-01, D-001@v1 | api_format 列 + Alembic 回填 |
| task-02 | 后端 schema+service/probe 按 format | W1 | P0 | task-01 | FR-02/03/04, D-002@v1 | 鉴权头/候选URL/完整URL归一 |
| task-03 | 后端单测 | W1 | P0 | task-02 | FR-01~04, NFR-02 | mock httpx 双格式 |
| task-04 | OpenAPI + 前端 api-types | W1 | P0 | task-02 | FR-10 | gen:types + 手写补字段 |
| task-05 | 前端表单 | W1 | P0 | task-04 | FR-09 | API 格式下拉+条件字段 |
| task-06 | 前端预设+列表+过渡守护 | W1 | P1 | task-04 | FR-10/11, D-007@v1 | OpenCode Zen OpenAI 预设 |
| task-07 | 前端单测 + Wave1 真实验收 | W1 | P0 | task-05/06 | FR-01~04/09~11, NFR-02 | opencode.ai 拉模型 |
| task-08 | LiteLLM 部署 | W2 | P0 | spike, task-01 | FR-05, NFR-03, R-08 | docker-compose 服务 |
| task-09 | 后端 litellm_client + 联动 | W2 | P0 | task-08, task-02 | FR-06, R-09, D-003@v1 | register/unregister + 标志 |
| task-10 | 后端 provider_config openai 形态 | W2 | P0 | task-09 | FR-07, D-003@v1 | context.py openai 分支 |
| task-11 | daemon 类型 + injector openai | W2 | P0 | task-10 | FR-08, NFR-01 | credential-injector 分支 |
| task-12 | Wave2 端到端验收 + 收尾 | W2 | P0 | task-11 | FR-05~08, NFR-01/03, C-01, R-07 | Claude Code 经 LiteLLM 对话 + 文档 |

## 关键路径

task-01 → task-02 → task-03（后端可独立绿）‖ task-02 → task-04 → task-05/06 → task-07（Wave1 验收门）→ **spike-litellm-routing** → task-08 → task-09 → task-10 → task-11 → task-12（Wave2 端到端）

Wave1 关键路径：task-01 → task-02 → task-04 → task-05 → task-07。
Wave2 关键路径：spike → task-08 → task-09 → task-10 → task-11 → task-12（串行，LiteLLM 部署→注册→config→injector→联调）。

## 全局验收标准

- [ ] backend：`cd backend && uv run pytest app/modules/llm_provider -q --no-cov` 全绿（local.yaml llm_provider 模块命令）；task-10 改 `daemon/lease/context.py` 连带跑 `cd backend && uv run pytest app/modules/daemon -q --no-cov`；迁移可正向+反向跑通。
- [ ] frontend：`cd frontend && pnpm test`（llm-provider 相关）全绿；`pnpm gen:types` 产出含 api_format；node_modules 健康（`pnpm exec tsc --version` 可跑）。
- [ ] daemon：`cd sillyhub-daemon && pnpm test`（credential-injector）全绿。
- [ ] Wave1 真实验收：对 opencode.ai `https://opencode.ai/zen/v1/models` + Bearer 拉模型成功（测试 token 仅本次用，不入库不入日志）。
- [ ] brownfield 零回归：anthropic 供应商 fetch-models/probe/set-default/injector 行为逐字不变（老行 api_format=anthropic）。
- [ ] Wave2 端到端：openai 供应商 set-default → Claude Code 会话经 LiteLLM 能正常对话（含一次工具调用 + 流式输出）。
- [ ] 安全：OpenAI 上游 api_key 不出现在 provider_config / daemon env / 日志（只在 LiteLLM 注册）。
- [ ] 集成冒烟：Wave2 task-12 必须真实起 Claude Code 会话联调（组件单测全绿 ≠ LiteLLM 转换正确）。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（api_format 列，不加 is_full_url） | task-01 | AC: 迁移 + model.py 列 + 老行 anthropic |
| D-002@v1（openai 恒 Bearer，auth_field 不变） | task-02 | AC: _build_auth_headers 双格式单测 |
| D-003@v1（openai key 不下发 daemon，注册 LiteLLM） | task-09, task-10, task-11 | AC: provider_config openai 形态无 key + injector 不注入上游 key |
| D-004@v1（转换乘 LiteLLM 服务器网关） | task-08, task-12 | AC: docker-compose LiteLLM + 端到端对话 |
| D-005@v1（双 Wave 单 change，spike 前置） | 全 plan | AC: Wave1 独立验收 + spike 门控 Wave2 |
| D-006@v1（openai 不做角色映射，agent_kind 不放开） | task-05, task-06 | AC: 表单 openai 隐藏角色映射 + agent_kind 仍固定 |
| D-007@v1（Wave1 openai set-default 守护提示） | task-06, task-12 | AC: Wave1 提示在 + Wave2 task-12 移除 |
| D-012（API 格式转换非目标，外包 LiteLLM 绕过） | task-08, task-12, 文档 | AC: 平台代码无转换逻辑 + llm_provider.md 注释 |
| FR-01~FR-04 | task-01~task-03, task-07 | AC: 双格式单测 + opencode.ai 拉模型 |
| FR-05~FR-08 | task-08~task-12 | AC: LiteLLM 部署 + 联动 + 端到端 |
| FR-09~FR-11 | task-04~task-07 | AC: 表单/预设/类型/守护 |
| NFR-01（key 不下发） | task-10, task-11 | AC: provider_config/env 无上游 key |
| NFR-02（零回归） | task-03, task-07 | AC: anthropic 行为不变 |
| NFR-03（LiteLLM SPOF） | task-08 | AC: healthcheck + restart=always |
