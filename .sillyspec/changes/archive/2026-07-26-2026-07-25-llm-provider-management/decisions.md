---
author: qinyi
created_at: 2026-07-25 16:08:29
---

# 决策记录 — LLM 供应商管理

本次变更的决策台账（非长期术语表）。每条含稳定版本 ID `D-xxx@vN`。

---

## D-001@v1 凭证平台 SSOT（集中存 + 下发）

- **type**: architecture
- **status**: decided
- **source**: 用户澄清（step3）
- **question**: API 密钥这类敏感凭证主要存哪里、谁来当唯一来源？当前 daemon 设计是「密钥不离开本机」，要平台管就得打破这个边界。
- **answer**: 平台集中存 —— 后端用 `core/crypto.py`（CredentialCipher）加密落盘当唯一真相源，经 lease 下发给各 daemon。
- **normalized_requirement**: LLM 凭证（api_key）必须在后端加密存储（LargeBinary + key_id），经现有 lease 链路下发 daemon；打破 daemon 现有「密钥不离开本机」边界。
- **impacts**: 数据模型（encrypted_api_key 字段）、lease 下发（provider_config 含明文 api_key）、安全（R-02 传输/日志脱敏）、复用 crypto+git_identity（D-009）。
- **evidence**: 调研报告1（core/crypto.py + git_identity 加密 CRUD 范式可复用）、调研报告2（daemon spawn-env 三层合并 + tool_config.env 下发通道）。
- **priority**: P0

---

## D-002@v1 作用域：用户级

- **type**: product
- **status**: decided
- **source**: 用户澄清（step3，用户选「用户级」而非推荐的「工作空间级」）
- **question**: 供应商配置按什么范围隔离（谁能看到 / 用哪套）？
- **answer**: 用户级 —— provider 归属 user，跨工作空间跟随用户，用户 CRUD 自己的。
- **normalized_requirement**: `llm_providers.user_id` 为 owner；用户只能 CRUD `WHERE user_id = current_user.id` 的记录；配置跟随账号对所有工作空间生效。
- **impacts**: 数据模型（user_id owner + 索引）、权限（D-008）、lease 下发按 agent_run/session.user_id 解析。
- **evidence**: 用户明确选择（step3 AskUserQuestion 答案）。
- **priority**: P0

---

## D-003@v1 第一版纯自定义（无预设库）

- **type**: scope
- **status**: decided
- **source**: 用户澄清（step3）
- **question**: 要不要内置常见供应商预设（官方 / Kimi / 中转），让用户一键选？
- **answer**: 先纯自定义（手填 base_url / key / model），预设库后续迭代。
- **normalized_requirement**: 第一版只支持手动填写供应商配置；不做内置预设模板；预留后续预设扩展（不阻塞当前架构）。
- **impacts**: 非目标（§3）、前端表单（无预设选择器，纯表单）。
- **evidence**: 用户选择（step3）。
- **priority**: P1

---

## D-004@v1 生效方式：env 注入

- **type**: architecture
- **status**: decided
- **source**: 技术调研结论（step3，三份报告共识）
- **question**: 平台下发的供应商配置在 daemon 侧如何生效给 agent？
- **answer**: daemon spawn 时注入为环境变量（claude → ANTHROPIC_BASE_URL / AUTH_TOKEN / MODEL），不写 `~/.claude/settings.json`。
- **normalized_requirement**: daemon 在 spawn agent 子进程前，把 provider_config 转 env 注入；claude code 原生支持 env 优先级；贴合现有 spawn-env 三层合并机制。
- **impacts**: daemon CredentialInjector.toEnv（D-006）、spawn-env 第 0 层最高优先级。
- **evidence**: 调研报告2（spawn-env.ts 三层合并 + claude SDK/CLI 读 env）、报告3（cc-switch 改 home 文件的方式不适用于容器内 daemon）。
- **priority**: P0

---

## D-005@v1 lease 扩展下发 provider_config

- **type**: architecture
- **status**: decided
- **source**: 方案 A（step4，用户选定）
- **question**: 平台供应商配置走什么通道下发给 daemon？
- **answer**: lease 的 `build_claim_payload` 新增独立 `provider_config` 字段（agent 中性：{agent_kind, base_url, api_key, model}），不复用 tool_config.env。
- **normalized_requirement**: lease payload 新增 `provider_config`（中性结构）；由 `build_claim_payload` 按 lease→user 解析默认 provider 注入；用户未配则字段 absent；不与 tool_config 混淆。
- **impacts**: backend lease/context.py 改造、ExecutionContextPayload/lease DTO 加字段、daemon types.ts 加字段、生命周期契约表（§7.5）。
- **evidence**: 调研报告1（build_claim_payload @ context.py:62 是唯一注入点）、报告2（现有 lease 无 api_key/base_url 字段）。
- **priority**: P0

---

## D-006@v1 agent_kind + per-agent injector 抽象

- **type**: architecture
- **status**: decided
- **source**: 用户需求（抽象解耦预留其他 agent）+ 方案 A（step4）
- **question**: 如何为 codex / gemini / pi 等其他 agent 预留接入扩展开关？
- **answer**: `agent_kind` 枚举（第一版 claude，预留 codex/gemini/pi）+ daemon 侧 `CredentialInjector` 接口（每 agent 一个实现，把中性 config 转 env）；加新 agent 时后端表/lease 协议不变，只动 daemon 注入器。
- **normalized_requirement**: 后端 `llm_providers.agent_kind` 字段（枚举值）；daemon `CredentialInjector` 接口 + 注册表；provider_config 是 agent 中性结构；加 codex = 后端 agent_kind 加值 + daemon 加 CodexCredentialInjector。
- **impacts**: 数据模型（agent_kind）、daemon credential-injector.ts、前端表单 agent 种类下拉。
- **evidence**: 调研报告2（daemon 已有 12-provider 成熟抽象 + 6 协议 adapter，agent 专业知识天然在 daemon 侧）、报告3（cc-switch AppType 枚举 + per-app 配置 schema 借鉴）。
- **priority**: P0

---

## D-007@v1 未配则本机 env 兜底（零回归）

- **type**: compatibility
- **status**: decided
- **source**: 技术决策（step3）
- **question**: 用户没配供应商时 daemon 怎么办？
- **answer**: lease 不带 provider_config → daemon spawn-env 第 0 层跳过 → 走现有三层（process.env / credentials.json / tool_config.env），行为完全不变。
- **normalized_requirement**: provider_config 为可选；absent 时 daemon 行为与当前完全一致；不破坏现有 daemon 本机 credentials.json 机制。
- **impacts**: 兼容策略（§9）、spawn-env 第 0 层条件注入。
- **evidence**: 调研报告2（spawn-env 三层合并现有行为）。
- **priority**: P0

---

## D-008@v1 权限：owner = user

- **type**: security
- **status**: decided
- **source**: D-002 用户级作用域派生
- **question**: 谁能管理（CRUD）供应商配置？
- **answer**: 用户只能 CRUD 自己的（owner_id = user_id），所有端点按 current_user.id 过滤。
- **normalized_requirement**: 所有 `/api/llm-providers` 端点 `WHERE user_id = current_user.id`；列表/详情/编辑/删除均加 owner 校验；越权访问 403/404。
- **impacts**: router/service 所有方法、单测（权限隔离用例）。
- **evidence**: 项目既有模式（git_identity 同样 user 级隔离）、调研报告1。
- **priority**: P0

---

## D-009@v1 复用 core/crypto.py + git_identity 范式

- **type**: implementation
- **status**: decided
- **source**: 技术调研（step3）
- **question**: 加密存储和 CRUD 套件要不要新建？
- **answer**: 复用 `core/crypto.py`（CredentialCipher，xchacha20-poly1305 + key_id 轮换）+ `git_identity` 模块整套加密 CRUD 范式（model/service/router/schema/test）。
- **normalized_requirement**: api_key 经 CredentialCipher.encrypt 加密入库（encrypted_api_key + key_id）；使用时 decrypt；llm_provider 模块结构对齐 git_identity；主键 SILLYSPEC_MASTER_KEY（部署已硬强制）。
- **impacts**: 模块结构、加密调用、.env.example 补 SILLYSPEC_MASTER_KEY 文档债（R-03）。
- **evidence**: 调研报告1（core/crypto.py + git_identity 完整范式 + SILLYSPEC_MASTER_KEY 部署状态）。
- **priority**: P0

---

## D-010@v1 cc-switch 核心字段集

- **type**: architecture
- **status**: decided
- **source**: 用户反馈（原型缺字段，参考 cc-switch）+ step3澄清
- **question**: 供应商配置包含哪些字段？
- **answer**: 采纳 cc-switch 的 env 可实现核心字段集：名称/备注/官网 + API Key + 请求地址(base_url) + 认证字段(ANTHROPIC_AUTH_TOKEN/API_KEY 二选一) + 模型角色映射(Sonnet/Opus/Fable/Haiku→实际模型) + 默认兜底模型 + 自定义环境变量(extra_env)。排除反代相关（见 D-012）。
- **normalized_requirement**: `llm_providers` 表含 notes/website_url/auth_field/model_role_mappings(JSON)/default_fallback_model/extra_env(JSON)；provider_config 下发同结构；injector 全字段翻译成 env。
- **impacts**: 数据模型、schema、injector、前端表单（角色映射表格 + env 键值编辑器）。
- **evidence**: 用户贴 cc-switch 字段截图；deploy/.env.example 实证 ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL 在用；用户选「核心可用字段」。
- **priority**: P0

---

## D-011@v1 模型角色映射经 ANTHROPIC_DEFAULT_{ROLE}_MODEL env 实现

- **type**: architecture
- **status**: decided
- **source**: 技术验证（claude-api skill + deploy/.env.example）
- **question**: 模型角色映射（Sonnet/Opus/Fable/Haiku→实际模型）如何在 env 注入下生效？
- **answer**: ClaudeInjector 把 model_role_mappings 翻译成 `ANTHROPIC_DEFAULT_SONNET_MODEL` / `OPUS_MODEL` / `FABLE_MODEL` / `HAIKU_MODEL`；默认兜底走 `ANTHROPIC_MODEL`；1M 通过模型名后缀 `[1m]` 声明（X-12 plan 实测确认）。
- **normalized_requirement**: ROLE_ENV 映射表 {sonnet,opus,fable,haiku}→对应 env；每个角色 model 非空才注入；one_m=true 时模型名追加 [1m]。
- **impacts**: ClaudeCredentialInjector.toEnv、daemon 单测（角色映射→env）。
- **evidence**: deploy/.env.example:ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.2 等已实证；claude-api skill 确认 env 优先级机制。
- **priority**: P0

---

## D-012@v1 反代相关字段明确不做

- **type**: boundary
- **status**: decided
- **source**: 架构差异分析（用户反馈后）
- **question**: cc-switch 的 User-Agent/Header/Body 覆盖、API 格式转换、本地代理做不做？
- **answer**: 不做。这些是 cc-switch 桌面端本地反代拦截改写 HTTP 实现；本平台 daemon 是直接 spawn claude 设环境变量、不走反代，架构上做不到，第一版也不引入反代层。
- **normalized_requirement**: 供应商配置明确不含 user_agent/header_overrides/body_overrides/api_format/proxy 字段；非目标声明；UI 不暴露这些。
- **impacts**: 非目标（design §3）、前端表单（无反代相关项）、scope 边界。
- **evidence**: 调研报告3（cc-switch proxy/ 280KB 反代层是桌面特有）；用户选「核心可用字段」排除「核心+反代」。
- **priority**: P1
