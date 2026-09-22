## FR-credential-injector-001 用户 CRUD 自己的 LLM 供应商
变更：2026-07-26-2026-07-25-llm-provider-management
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-008@v1、D-009@v1、D-010@v1
场景正文：
- 场景：默认场景 — Given 用户已登录 用户创建供应商时填了 api_key 用户填了 cc-switch 核心字段（notes/website_url/auth_field/model_；When 调用 `/api/llm-providers` 增删改查 `service.create` create/update；Then 仅返回 `user_id = current_user.id` 的记录；api_key 加密入库，响应仅 masked；越权返回 403 / 404。 api_
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-llm-provider-management/requirements.md#FR-01
最近确认：b89ac6ed9

## FR-credential-injector-002 设默认供应商（互斥）
变更：2026-07-26-2026-07-25-llm-provider-management
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 用户已有同 agent_kind 的默认供应商 A；When 设 B 为默认；Then A.is_default → false、B.is_default → true（事务内，每 `(user_id, agent_kind)` 至多 1 个默认，
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-llm-provider-management/requirements.md#FR-02
最近确认：b89ac6ed9

## FR-credential-injector-003 lease 下发默认供应商配置
变更：2026-07-26-2026-07-25-llm-provider-management
状态：active
摘要：默认场景
依据决策：D-001@v1、D-005@v1、D-006@v1
场景正文：
- 场景：默认场景 — When backend 构造 `build_claim_payload` `build_claim_payload`
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-llm-provider-management/requirements.md#FR-03
最近确认：b89ac6ed9

## FR-credential-injector-004 daemon 注入器把 provider_config 转 env
变更：2026-07-26-2026-07-25-llm-provider-management
状态：active
摘要：默认场景
依据决策：D-004@v1、D-006@v1、D-007@v1、D-010@v1、D-011@v1
场景正文：
- 场景：默认场景 — Given lease 含 provider_config 且 agent_kind=claude provider_config 含 model_role_mapping；When daemon `spawn-env buildSpawnEnv` ClaudeInjector.toEnv `buildSpawnEnv`；Then 注入 `ANTHROPIC_BASE_URL` / 认证 env(auth_field 决定 AUTH_TOKEN 或 API_KEY) / `ANTHROPI
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-llm-provider-management/requirements.md#FR-04
最近确认：b89ac6ed9

## FR-credential-injector-005 抽象解耦（加新 agent）
变更：2026-07-26-2026-07-25-llm-provider-management
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 要接入 codex；When 后端 agent_kind 加 `codex` 值 + daemon 加 `CodexCredentialInjector`；Then 后端表结构 / lease 协议不变；codex provider 可 CRUD 并下发；daemon 注入 `OPENAI_*` env。
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-llm-provider-management/requirements.md#FR-05
最近确认：b89ac6ed9

## FR-credential-injector-006 前端供应商管理页
变更：2026-07-26-2026-07-25-llm-provider-management
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-010@v1
场景正文：
- 场景：默认场景 — Given 用户进入设置页「我的供应商」；When 操作（列表 / 新建 / 编辑 / 删除 / 设默认）；Then UI 正确反映状态；表单含 名称 / agent 种类(claude，下拉预留) / base_url / api_key 密码框 / model；按前端设计系
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-llm-provider-management/requirements.md#FR-06
最近确认：b89ac6ed9

## FR-credential-injector-007 安全脱敏
变更：2026-07-26-2026-07-25-llm-provider-management
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given provider_config 含明文 api_key 流经 daemon；When 写日志 / submitMessages / complete_lease / AuditLog；Then api_key 被 `redactEnv` 脱敏（`***REDACTED***`），严禁明文落盘 / 落日志 / 回传。
全文：.sillyspec/changes/archive/2026-07-26-2026-07-25-llm-provider-management/requirements.md#FR-07
最近确认：b89ac6ed9

## FR-credential-injector-008 聚合契约 + 编译期强制
变更：2026-09-11-provider-adapter-registry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given INTERACTIVE_PROVIDERS 聚合表（ProviderAdapter = 现五要素 + envInjector 懒工厂【实例或显式 none+理由；Then `satisfies Record<InteractiveProvider, ProviderAdapter>` 编译期强制全引擎覆盖——新引擎加入联合类型后未
全文：.sillyspec/changes/archive/2026-09-11-provider-adapter-registry/requirements.md#FR-01
最近确认：f0211bbcf

## FR-credential-injector-009 派生改造零漂移
变更：2026-09-11-provider-adapter-registry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given credential-injector REGISTRY（惰性 memoized 派生）与 provider-file-settings 分派（按 adapte；Then 模块导出面与调用点零改动；全部既有测试（daemon 162 修改相关 + frontend 55，含 ForReload 21 矩阵/dispatch 17/
全文：.sillyspec/changes/archive/2026-09-11-provider-adapter-registry/requirements.md#FR-02
最近确认：f0211bbcf

## FR-credential-injector-010 硬编码收口（六处）
变更：2026-09-11-provider-adapter-registry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon.ts 热切换判断（:7815）、_cleanupProviderFileDirs、_sweepOrphanProviderFileDirs（:47；When 改为读聚合表元数据（fileSettings 是否 writer / perSessionDir）；Then 六处行为与原字面量判断逐类等价（claude/cursor/未知零动作，codex/pi 原逻辑不变），既有测试锁定
全文：.sillyspec/changes/archive/2026-09-11-provider-adapter-registry/requirements.md#FR-03
最近确认：f0211bbcf

## FR-credential-injector-011 caps 生成 + 白名单派生
变更：2026-09-11-provider-adapter-registry
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given providers.ts PROVIDER_CAPS 单源（新增第 10 键 provider_switch：claude/codex/pi=true，curs；When 跑生成脚本（frontend gen:types 链尾自动 / 手动）；Then 产出 frontend/src/lib/provider-caps.ts 与 backend/app/modules/agent/provider_caps.p
全文：.sillyspec/changes/archive/2026-09-11-provider-adapter-registry/requirements.md#FR-04
最近确认：f0211bbcf

## FR-credential-injector-012 冒烟制度化
变更：2026-09-11-provider-adapter-registry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 每个文件层写盘器声明 smokeSuite（测试文件名）；Then 守护测试校验：smokeSuite 文件真实存在 + 文件内容含 api_format 词表全量字面量（表驱动映射覆盖）；pi-settings/codex-s
全文：.sillyspec/changes/archive/2026-09-11-provider-adapter-registry/requirements.md#FR-05
最近确认：f0211bbcf
