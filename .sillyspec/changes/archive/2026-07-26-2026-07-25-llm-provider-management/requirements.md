---
author: qinyi
created_at: 2026-07-25 16:30:03
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 用户（开发者） | 在网页管理自己的 LLM 供应商配置（CRUD + 设默认） |
| 平台后端 | 加密存储凭证，经 lease 下发用户默认供应商配置 |
| daemon | 接收 provider_config，注入为 agent 环境变量 |
| claude code | 第一版唯一接入的 agent；读 ANTHROPIC_* env 跑 |

## 功能需求

### FR-01: 用户 CRUD 自己的 LLM 供应商

覆盖决策：D-001@v1, D-002@v1, D-008@v1, D-009@v1, D-010@v1

Given 用户已登录
When 调用 `/api/llm-providers` 增删改查
Then 仅返回 `user_id = current_user.id` 的记录；api_key 加密入库，响应仅 masked；越权返回 403 / 404。

Given 用户创建供应商时填了 api_key
When `service.create`
Then api_key 经 `CredentialCipher.encrypt` 加密，存 `encrypted_api_key` + `key_id`，明文不入 ORM（对照 git_identity/service.py:81-93）。

Given 用户填了 cc-switch 核心字段（notes/website_url/auth_field/model_role_mappings/default_fallback_model/extra_env）
When create/update
Then 各字段按 schema 持久化（model_role_mappings/extra_env 存 JSON；auth_field 校验为 ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY），Read 返回原值（api_key 仍仅 masked）。

### FR-02: 设默认供应商（互斥）

覆盖决策：D-002@v1

Given 用户已有同 agent_kind 的默认供应商 A
When 设 B 为默认
Then A.is_default → false、B.is_default → true（事务内，每 `(user_id, agent_kind)` 至多 1 个默认，R-05）。

### FR-03: lease 下发默认供应商配置

覆盖决策：D-001@v1, D-005@v1, D-006@v1

Given 用户有默认供应商（agent_kind 对齐 lease 的 agent 类型，经 `_normalize_lease_provider` 归一化，X-08）
When backend 构造 `build_claim_payload`
Then payload 含 `provider_config = { agent_kind, base_url, api_key(明文已解密), model }`，按 `lease.runtime_id → DaemonRuntime.user_id`（主）解析。

Given 用户未配默认供应商
When `build_claim_payload`
Then payload 不含 provider_config 字段（absent，daemon 走本机兜底）。

### FR-04: daemon 注入器把 provider_config 转 env

覆盖决策：D-004@v1, D-006@v1, D-007@v1, D-010@v1, D-011@v1

Given lease 含 provider_config 且 agent_kind=claude
When daemon `spawn-env buildSpawnEnv`
Then 注入 `ANTHROPIC_BASE_URL` / 认证 env(auth_field 决定 AUTH_TOKEN 或 API_KEY) / `ANTHROPIC_MODEL`(兜底)，优先级最高（第 0 层，盖过 tool_config.env / credentials.json / process.env）。

Given provider_config 含 model_role_mappings（如 sonnet→kimi-k2）
When ClaudeInjector.toEnv
Then 注入 `ANTHROPIC_DEFAULT_SONNET_MODEL=kimi-k2`（opus/fable/haiku 同理）；one_m=true 时模型名追加 `[1m]`；extra_env 全部注入。

Given lease 不含 provider_config
When `buildSpawnEnv`
Then 行为与现状一致（三层合并不变，零回归）。

### FR-05: 抽象解耦（加新 agent）

覆盖决策：D-006@v1

Given 要接入 codex
When 后端 agent_kind 加 `codex` 值 + daemon 加 `CodexCredentialInjector`
Then 后端表结构 / lease 协议不变；codex provider 可 CRUD 并下发；daemon 注入 `OPENAI_*` env。

### FR-06: 前端供应商管理页

覆盖决策：D-002@v1, D-003@v1

Given 用户进入设置页「我的供应商」
When 操作（列表 / 新建 / 编辑 / 删除 / 设默认）
Then UI 正确反映状态；表单含 名称 / agent 种类(claude，下拉预留) / base_url / api_key 密码框 / model；按前端设计系统实现（CLAUDE.md 规则19）。

### FR-07: 安全脱敏

覆盖决策：D-001@v1（派生）

Given provider_config 含明文 api_key 流经 daemon
When 写日志 / submitMessages / complete_lease / AuditLog
Then api_key 被 `redactEnv` 脱敏（`***REDACTED***`），严禁明文落盘 / 落日志 / 回传。

## 非功能需求

- **兼容性**：用户未配时 daemon 行为不变（零回归）；旧 daemon 忽略 provider_config 可选字段不破坏（D-007）；
- **可回退**：provider_config absent 即回退本机 env；删除供应商等同未配；
- **可测试**：每条 FR 有对应单测；env 注入用注入器单测验证（不依赖真实 claude）；
- **安全**：api_key 加密落盘 + masked 返回 + 全链路脱敏（R-02）；
- **跨平台**：Windows / Linux / macOS 兼容（env 注入无平台依赖）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-03, FR-07 | 凭证平台 SSOT 加密存 + 下发 |
| D-002@v1 | FR-01, FR-02, FR-06 | 用户级作用域 |
| D-003@v1 | FR-06 | 第一版纯自定义无预设 |
| D-004@v1 | FR-04 | env 注入生效 |
| D-005@v1 | FR-03 | lease 扩展下发 |
| D-006@v1 | FR-03, FR-04, FR-05 | agent_kind + injector 抽象 |
| D-007@v1 | FR-04 | 未配本机兜底 |
| D-008@v1 | FR-01 | 权限 owner = user |
| D-009@v1 | FR-01 | 复用 crypto + git_identity |
| D-010@v1 | FR-01, FR-04, FR-06 | cc-switch 核心字段集 |
| D-011@v1 | FR-04 | 角色映射 → ANTHROPIC_DEFAULT_*_MODEL |
| D-012@v1 | （边界，非目标） | 反代相关字段不做 |

> 全部 D-001~012 均已被 FR 覆盖（D-012 为边界声明），无剩余未覆盖决策。
