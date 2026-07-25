---
author: qinyi
created_at: 2026-07-25 16:08:29
scale: large
---

# 设计文档（Design）— LLM 供应商管理

## 1. 背景

当前 daemon 直接调用 claude code 等 agent，LLM 凭证（API key + base_url + model）**100% 靠 daemon 本机环境变量 / `~/.sillyhub/daemon/credentials.json`**，平台零管控（调研确认：后端无 provider/credential 表，lease payload 仅含 provider/model 路由字符串，无 api_key/base_url）。用户要换供应商（官方↔中转↔自建网关）、换模型、轮换密钥，必须登录每台跑 daemon 的机器改配置。痛点：

- 多机器 / 多用户场景配置割裂，无法集中管控；
- 无法在网页直接切换供应商 / 模型；
- 计费 / 账号无法按用户隔离。

参考 cc-switch（单机桌面供应商切换工具）的数据模型与抽象边界，但在 Web 多租户平台上重新落地：后端集中加密存凭证 → 经 lease 下发 → daemon spawn 时注入 env。cc-switch 的实现细节（SQLite 明文、改 home 目录文件、本地反代、桌面 OAuth）全部不搬。

## 2. 设计目标

- 用户在网页 CRUD 自己的 LLM 供应商（名称 / agent 种类 / 接口地址 / API 密钥 / 模型）；
- 配置**跟随用户账号**，跨工作空间通用（用户级作用域）；
- 平台经现有 lease 链路把用户默认供应商下发给 daemon；
- daemon 启动 agent 时把供应商配置注入为环境变量（claude 先行）；
- **抽象解耦**：加新 agent（codex / gemini / pi）时后端表 / lease 协议不变，只动 daemon 注入器；
- **零回归**：用户未配供应商时 daemon 行为完全不变。

## 3. 非目标

- 不做供应商预设库（官方 / Kimi / 中转等内置模板）—— 第一版纯自定义，预设后续迭代（D-003）；
- 不做工作空间级 / 全局级配置覆盖 —— 第一版纯用户级（D-002）；
- 不做 OAuth provider（Copilot / Codex OAuth / xAI OAuth）—— 只走 API key 直连；
- 不做本地反代 / failover（cc-switch 的 proxy 层不搬）；
- 不改 daemon 本机 credentials.json 机制（保留作兜底，D-007）；
- 不做 provider 连通性测试端点（可选，后续）；
- 不实现 codex / gemini / pi 的实际注入器（第一版只做 claude 注入器，但抽象接口预留）；
- **不做 cc-switch 的反代相关字段**（自定义 User-Agent、Header 覆盖、Body 覆盖、API 格式转换 anthropic↔openai、本地代理 / failover）—— 这些需 daemon 本地反代拦截改写 HTTP，与「直接 spawn 设环境变量」架构冲突，明确不做（D-012）。

## 4. 拆分判断

单一大功能（供应商管理），**不拆 MASTER**。理由：

- 三端（后端 / daemon / 前端）耦合于同一 lease 协议变更（provider_config 字段），需协同交付；
- 非批量模式（不是「模板 × 数据」）；
- 按 Wave 分阶段实现，Wave 间通过 lease `provider_config` 字段解耦（后端先产出字段 → daemon 消费 → 前端使用）。

## 5. 总体方案

### 架构

```
用户(网页) ──CRUD──▶ 后端 llm_providers 表(加密 api_key)
                          │
跑 Agent 时 ──▶ backend build_claim_payload
                          │ 按 lease→user_id 查默认 provider
                          │ 解密 api_key
                          ▼
              lease.provider_config { agent_kind, base_url, api_key, model } | None
                          │
                          ▼
                     daemon claim_lease
                          │
                          ▼
              CredentialInjector.toEnv(provider_config)
                          │ claude → ANTHROPIC_BASE_URL / AUTH_TOKEN / MODEL
                          ▼
              spawn-env 第0层注入(最高优先级)
                          │
                          ▼
                   claude code 进程
```

### Wave 划分

- **Wave 1（后端基础）**：`llm_providers` 表 + migration + model + 加密 CRUD service + schema + router（`/api/llm-providers`）+ main.py 挂载 + 单测。复用 `core/crypto.py` + git_identity 范式。
- **Wave 2（lease 下发）**：`build_claim_payload` 加 `provider_config` 字段，按 lease 关联 user 解析默认 provider；扩展 ExecutionContextPayload / lease DTO；单测覆盖「有 provider / 无 provider」两路。
- **Wave 3（daemon 注入器）**：新建 `credential-injector.ts`（CredentialInjector 接口 + ClaudeInjector + 注册表）；`types.ts` LeaseCtx 加 provider_config；`spawn-env.ts buildSpawnEnv` 加第 0 层（provider_config → injector.toEnv → 最高优先级）；扩展 `redactEnv` 覆盖 provider_config；单测。
- **Wave 4（前端）**：设置页「我的供应商」区块（列表 + 新建 / 编辑表单 + 设默认 + 删除）；api 封装 + types；按设计系统实现；单测。
- **Wave 5（集成 + 文档）**：端到端（配 provider → 跑 agent → 验证 env 注入）；更新模块文档；local.yaml 补 `llm_provider` 子模块（verify 粒度）；补 `.env.example` 的 `SILLYSPEC_MASTER_KEY` 文档债。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/llm_provider/__init__.py | 模块包 |
| 新增 | backend/app/modules/llm_provider/model.py | `LlmProvider` 表模型 |
| 新增 | backend/app/modules/llm_provider/schema.py | Pydantic 请求 / 响应（api_key 仅 masked） |
| 新增 | backend/app/modules/llm_provider/service.py | `LlmProviderService`（list/get/create/update/delete/set_default + 加解密 + is_default 互斥） |
| 新增 | backend/app/modules/llm_provider/router.py | `/api/llm-providers` CRUD 端点 |
| 新增 | backend/app/modules/llm_provider/tests/test_llm_provider.py | 单测（CRUD + 加密 + 权限隔离 + 设默认互斥） |
| 新增 | backend/migrations/versions/20260725xxxx_create_llm_providers.py | 建表 migration（唯一 revision + down 接真实 head，防多 head） |
| 修改 | backend/app/main.py | `include_router(llm_provider_router, prefix="/api")` |
| 修改 | backend/app/modules/daemon/lease/context.py | `build_claim_payload` 注入 `provider_config`（按 lease→user 解析默认 provider） |
| 修改 | backend/app/modules/agent/schema.py（或 lease 相关 DTO） | ExecutionContextPayload / lease payload 加 `provider_config` 字段 |
| 新增 | sillyhub-daemon/src/credential-injector.ts | `CredentialInjector` 接口 + `ClaudeCredentialInjector` + 注册表 |
| 修改 | sillyhub-daemon/src/types.ts | LeaseCtx / ExecutionContextPayload 加 `provider_config?: ProviderConfig` |
| 修改 | sillyhub-daemon/src/spawn-env.ts | `buildSpawnEnv` 加第 0 层（provider_config → injector → env，最高优先级）；`redactEnv` 扩展覆盖 provider_config |
| 修改 | sillyhub-daemon/src/daemon.ts | `_startInteractiveSession`：provider_config 注入须独立于 `if (this._credentialManager)` 门控（daemon.ts:2816），覆盖 interactive 主聊天/扫描路径（X-02） |
| 新增 | sillyhub-daemon/tests/credential-injector.test.ts | 注入器单测 |
| 修改 | sillyhub-daemon/tests/spawn-env.test.ts | 第 0 层注入 + 脱敏单测 |
| 新增 | frontend/src/app/(dashboard)/settings/llm-providers/* （或 settings/page.tsx 区块） | 「我的供应商」列表 + 表单 |
| 新增 | frontend/src/lib/api/llm-providers.ts | API 封装 |
| 修改 | frontend/src/lib/api-types.ts | `LlmProvider` 类型（或 OpenAPI 生成后对齐） |
| 修改 | .sillyspec/local.yaml | modules 块加 `llm_provider` 子模块（path + test，verify 粒度） |
| 修改 | deploy/.env.example | 补 `SILLYSPEC_MASTER_KEY` 文档（已硬强制但漏写） |
| 修改 | .sillyspec/docs/backend/modules/llm_provider.md | 新模块文档（execute 后 / scan） |

## 7. 接口定义

### 后端 REST

```
GET    /api/llm-providers                   → LlmProviderList   # 当前 user 的供应商，api_key masked
POST   /api/llm-providers                   → LlmProviderRead   # 新建（api_key 加密入库）
GET    /api/llm-providers/{id}              → LlmProviderRead   # 详情（masked）
PATCH  /api/llm-providers/{id}              → LlmProviderRead   # 编辑（api_key 可选，不传则不动）
DELETE /api/llm-providers/{id}              → 204               # 删
POST   /api/llm-providers/{id}/set-default  → LlmProviderRead   # 设默认（同 user×agent_kind 互斥）
```

权限：所有端点 `WHERE user_id = current_user.id` 过滤，用户只能 CRUD 自己的（D-008）。

### 数据结构

```python
# model.py
class LlmProvider(BaseModel, table=True):
    __tablename__ = "llm_providers"
    id: uuid.UUID (PK, default uuid4)
    user_id: uuid.UUID (FK users.id, ondelete CASCADE, indexed)   # 归属用户（D-002 用户级）
    name: str (max 128)                                            # 用户起名
    agent_kind: str (max 32, 第一版="claude")                       # 预留 codex/gemini/pi（D-006）
    base_url: str | None (max 512)                                 # API 接口地址
    encrypted_api_key: bytes (LargeBinary)                         # 加密后（core/crypto.py）
    key_id: str (max 64)                                           # 加密密钥版本（支持轮换）
    model: str | None (max 128)                                    # 默认模型（= default_fallback_model 简写，兼容）
    # —— cc-switch 核心字段扩充（D-010）——
    notes: str | None (max 512)                                    # 备注
    website_url: str | None (max 512)                              # 官网链接（可选）
    auth_field: str (max 64, default "ANTHROPIC_AUTH_TOKEN")       # 认证 env 名：ANTHROPIC_AUTH_TOKEN | ANTHROPIC_API_KEY
    model_role_mappings: dict | None (JSON)                        # {sonnet:{display,model,one_m}, opus, fable, haiku}
    default_fallback_model: str | None (max 128)                   # 默认兜底模型 → ANTHROPIC_MODEL
    extra_env: dict | None (JSON)                                  # 自定义环境变量 {KEY:VALUE}
    is_default: bool (default False)                               # 每 (user_id, agent_kind) 至多 1 个
    created_at: datetime (Field default_factory=utcnow)            # 显式定义（BaseModel 是空类，见 §8）
    updated_at: datetime (Field default_factory=utcnow, onupdate=utcnow)

# schema.py
class LlmProviderCreate(BaseModel):
    name: str
    agent_kind: Literal["claude"] = "claude"
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    notes: str | None = None
    website_url: str | None = None
    auth_field: Literal["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] = "ANTHROPIC_AUTH_TOKEN"
    model_role_mappings: dict | None = None      # {sonnet:{display,model,one_m}, opus, fable, haiku}
    default_fallback_model: str | None = None
    extra_env: dict | None = None                # {KEY:VALUE}
    is_default: bool = False

class LlmProviderUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None        # None = 不动原密钥
    model: str | None = None
    notes: str | None = None
    website_url: str | None = None
    auth_field: Literal["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] | None = None
    model_role_mappings: dict | None = None
    default_fallback_model: str | None = None
    extra_env: dict | None = None
    is_default: bool | None = None

class LlmProviderRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    agent_kind: str
    base_url: str | None
    model: str | None
    notes: str | None
    website_url: str | None
    auth_field: str
    model_role_mappings: dict | None
    default_fallback_model: str | None
    extra_env: dict | None
    is_default: bool
    api_key_masked: str | None        # 如 "sk-***...***"，绝不返回明文（规则见 plan 细化 X-09）
    created_at: datetime
    updated_at: datetime
```

### lease 下发字段（后端 → daemon）

```python
# build_claim_payload 新增（interactive + batch 分支）
provider_config: {
    "agent_kind": "claude",
    "base_url": "https://...",
    "api_key": "<明文，已解密>",                # daemon 必须用
    "auth_field": "ANTHROPIC_AUTH_TOKEN",       # 认证 env 名（D-010）
    "model_role_mappings": { "sonnet": {"model":"kimi-k2","one_m":false}, "opus": {...}, "fable": {...}, "haiku": {...} },
    "default_fallback_model": "kimi-k2",
    "extra_env": { "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1" }
} | None   # 用户未配默认 provider → 整个字段 None/absent
```

### daemon 注入器接口（TypeScript）

```typescript
// types.ts
interface ProviderConfig {
  agent_kind: string
  base_url?: string
  api_key?: string
  auth_field?: string                      // 'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_API_KEY'
  model?: string
  model_role_mappings?: Record<string, { display?: string; model?: string; one_m?: boolean }>
  default_fallback_model?: string
  extra_env?: Record<string, string>
}
// LeaseCtx / ExecutionContextPayload 新增: provider_config?: ProviderConfig

// credential-injector.ts
interface CredentialInjector {
  readonly agentKind: string
  toEnv(config: ProviderConfig): Record<string, string>   // 中性 config → 该 agent 的 env
}

class ClaudeCredentialInjector implements CredentialInjector {
  readonly agentKind = 'claude'
  // 角色 → claude code 的默认模型 env（deploy/.env.example 已实证 HAIKU/SONNET/OPUS；FABLE 按命名规律，plan 实测确认 X-11）
  private static readonly ROLE_ENV: Record<string, string> = {
    sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    fable: 'ANTHROPIC_DEFAULT_FABLE_MODEL',
    haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  }
  toEnv(c: ProviderConfig) {
    const env: Record<string, string> = {}
    if (c.base_url) env.ANTHROPIC_BASE_URL = c.base_url
    if (c.api_key) env[c.auth_field ?? 'ANTHROPIC_AUTH_TOKEN'] = c.api_key   // 认证字段可选（D-010）
    const fallback = c.default_fallback_model ?? c.model
    if (fallback) env.ANTHROPIC_MODEL = fallback
    // 角色映射 → ANTHROPIC_DEFAULT_{ROLE}_MODEL（D-011）；1M 通过模型名后缀 [1m] 声明（X-12 plan 确认）
    for (const [role, m] of Object.entries(c.model_role_mappings ?? {})) {
      const envName = ClaudeCredentialInjector.ROLE_ENV[role]
      if (envName && m?.model) env[envName] = m.one_m ? `${m.model}[1m]` : m.model
    }
    Object.assign(env, c.extra_env ?? {})                                    // 自定义 env
    return env
  }
}
// 注册表 getInjector(agentKind)：第一版只返回 ClaudeCredentialInjector
// 加 codex 时：新增 CodexCredentialInjector(toEnv → OPENAI_API_KEY 等) + 注册，后端/协议不变
```

## 7.5 生命周期契约表

涉及 lease / daemon / agent_run / session / state transition，必填：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| claim lease（含 provider_config） | daemon | backend | leaseId, claimToken, agentRunId, **provider_config?** | pending → running |
| create session | backend → daemon | daemon spawn claude | sessionId, leaseId, **provider_config?** | session active |
| spawn claude（注入 ANTHROPIC_* env） | daemon | claude 进程 | ANTHROPIC_BASE_URL / AUTH_TOKEN / MODEL（来自 provider_config） | claude 启动 |
| submit message | daemon | backend | leaseId, claimToken, agentRunId | append messages（**严禁含 api_key**） |
| turn result | daemon | backend | runId, status, output | running → completed/failed |
| session end | daemon | backend | sessionId, reason | active → ended |

> `provider_config` 仅在 claim / create 阶段下发；submit / complete / end 链路禁止回传 api_key（延续 `spawn-env.ts:16` 铁律，`redactEnv` 扩展覆盖 provider_config）。

## 8. 数据模型

见 §7 `model.py`。要点：

- `llm_providers` 表，owner = `user_id`（用户级作用域，D-002）；
- `encrypted_api_key`（LargeBinary）+ `key_id`，复用 `core/crypto.py` 的 `CredentialCipher`（xchacha20-poly1305，同 git_identity，D-009）；
- `is_default` 互斥：每 `(user_id, agent_kind)` 至多 1 条 `is_default=true`（service 层 `set_default` 事务内先清同组再置，R-05）；
- 索引：`(user_id)`、`(user_id, agent_kind, is_default)`；
- 审计字段：`created_at` / `updated_at` **显式定义**（`backend/app/models/base.py` 的 `BaseModel` 是空类 `class BaseModel(SQLModel): pass`，不自动提供；照 daemon/model.py:366-381 范式）；
- AuditLog 钩子（audit_hooks.py:95-121,160-224）只读 ORM 列值；明文 api_key 仅在 Pydantic 请求 schema 不入 ORM（service 先 `cipher.encrypt` 再赋 `encrypted_api_key`，对照 git_identity/service.py:81-93），故钩子捕获不到明文（**R-04 已验证关闭，无需 exclude**）；
- 附带 P2：钩子仅在 service 注入 `audit_context` 时触发，git_identity 未注入故不落 AuditLog；llm_provider 若需审计须 service 显式注入 audit_context（可观测性，plan 决定）。

## 9. 兼容策略（brownfield）

- **未配置供应商**：`build_claim_payload` 不注入 `provider_config`（字段 absent）→ daemon spawn-env 第 0 层跳过 → 走现有三层（process.env / credentials.json / tool_config.env）→ 行为完全不变（D-007 兜底，零回归）；
- **daemon 旧版本**：lease 新增 `provider_config` 是可选字段，旧 daemon 不识别则忽略（不破坏）；
- **不改变的表 / API**：`workspace.default_agent` / `default_model` 保留（路由用）；daemon credentials.json 机制保留（兜底）；
- **default_model 优先级**：`provider_config.model`（若下发）优先于 `workspace.default_model`；lease 构造时合并（provider.model 覆盖 workspace.default_model）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | lease → user 关联路径 | ✅已解决（Design Grill 验证） | 主路径：`lease.runtime_id → DaemonRuntime.user_id`（daemon/model.py:144，nullable=False 已索引，全 lease kind 适用）；interactive 兜底：`lease_meta.session_id → AgentSession.user_id`（agent/model.py:429）。原稿误引 AgentRun.created_by（实属 AgentMission@model.py:581），已删除 |
| R-02 | api_key 明文经 lease 下发，传输 / 日志泄漏 | P0 | 走现有 daemon↔backend 鉴权通道（claim_token）；redactEnv 扩展覆盖 provider_config；严禁落 submitMessages / complete_lease / AuditLog / daemon 日志 |
| R-03 | SILLYSPEC_MASTER_KEY 丢失致历史 provider 不可解 | P1 | 同 git_identity 既有约束；`crypto.py:37-44` 是 use-time lazy 503（非 boot 校验，未配则首次 crypto 操作才失败）；`.env.example` 漏写（Wave5 补） |
| R-04 | AuditLog 是否记录明文 api_key | ✅已解决-不成立（Design Grill 验证） | audit_hooks 只读 ORM 列值（audit_hooks.py:95-224）；明文 api_key 仅在 Pydantic schema 不入 ORM（service 先 encrypt 再赋 encrypted_api_key）；钩子捕获不到明文，无需 exclude |
| R-05 | is_default 互斥并发竞态 | P2 | service 层事务内先 UPDATE 清同组再 SET |
| R-06 | local.yaml modules 块无 backend 整体条目，verify 实测 llm_provider 命中时无 test 命令 | P2 | Wave5 在 local.yaml 加 `llm_provider` 子模块条目 |
| R-07 | daemon 注入器抽象设计不当致加 codex 时返工 | P1 | CredentialInjector 接口最小化（只 toEnv），claude 先验证；plan 阶段评审 |

### plan 细化项（Design Grill 提出，P2，plan 阶段明确）

- **X-08 agent_kind 归一化**：`llm_providers.agent_kind="claude"` 与 lease adapter id `"claude_code"`（AgentRun.agent_type）查询时要归一化，复用 `context.py:57` 的 `_normalize_lease_provider` 逻辑；
- **X-09 masked 格式**：`api_key_masked` 精确规则（如首 4 + 尾 4，短 key 全掩）；git_identity 是直接 OMIT 无先例，本变更自定义；
- **X-10 default_model 落点**：`provider.model` 覆盖 `workspace.default_model` 的具体位置在 `build_claim_payload` 内（现 context.py:289,303 `payload[model]` 从 agent_run.model 取）；
- **X-02 interactive 门控**：`daemon.ts:2816` 的 `buildSpawnEnv` 受 `if (this._credentialManager)` 门控，provider_config 注入须独立于此门控（或确认生产 daemon 必注入 credentialManager 并注释锁死）。
- **X-11 Fable/subagent env 名**：`ANTHROPIC_DEFAULT_FABLE_MODEL` 按命名规律推断（HAIKU/SONNET/OPUS 已在 deploy/.env.example 实证），plan/execute 阶段实测 claude code 是否识别；subagent 角色的 env 待确认（可能无独立 env，走 default_fallback）。
- **X-12 1M 上下文声明**：通过模型名后缀 `[1m]`（如 `opus[1m]` / `claude-opus-4-8[1m]`），非独立 env；injector 在角色映射 model 后追加，plan 实测确认 claude code 解析规则。
- **X-13 auth_field 校验**：后端 Literal 限定 `ANTHROPIC_AUTH_TOKEN` | `ANTHROPIC_API_KEY`；injector 按此值写 env（不再两个都写）。

## 11. 决策追踪

见 `decisions.md`。当前版本决策 → 覆盖章节：

- D-001@v1 凭证平台 SSOT → §5 / §7 / §8（后端加密存 + lease 下发）
- D-002@v1 作用域用户级 → §8（user_id owner）
- D-003@v1 第一版纯自定义无预设 → §3 非目标
- D-004@v1 生效 env 注入 → §5 / §7（injector.toEnv）
- D-005@v1 lease 扩展下发 → §5 / §7.5（provider_config）
- D-006@v1 agent_kind + per-agent injector 抽象 → §5 / §7（CredentialInjector）
- D-007@v1 未配则本机 env 兜底 → §9 兼容策略
- D-008@v1 权限 owner = user → §7（WHERE user_id = current_user）
- D-009@v1 复用 crypto + git_identity → §5 / §8
- D-010@v1 cc-switch 核心字段集（auth_field / model_role_mappings / default_fallback_model / extra_env / notes / website_url）→ §7
- D-011@v1 模型角色映射经 `ANTHROPIC_DEFAULT_{ROLE}_MODEL` env 实现（sonnet/opus/fable/haiku）→ §7 ClaudeInjector
- D-012@v1 反代相关字段（User-Agent / Header / Body 覆盖、API 格式转换、本地代理）明确不做 → §3 非目标

未解决 / 剩余风险：R-01 / R-04 已关闭（见 §10）；P2 待 plan 细化（X-08 归一化 / X-09 masked / X-10 default_model 落点 / X-11 Fable env 实测 / X-12 1M 声明）。

## 12. 自审

- [x] 必填章节齐全（背景 / 目标 / 非目标 / 拆分 / 总体方案 / 文件清单 / 接口 / 生命周期契约表 / 数据模型 / 兼容 / 风险 / 决策追踪 / 自审）；
- [x] 涉及 lease / daemon / agent_run / session → 含「生命周期契约表」✓；
- [x] brownfield → 含兼容策略（未配兜底 + 旧 daemon 兼容 + default_model 优先级）✓；
- [x] decisions.md 当前版本 D-001~D-009 全部在 design 引用 ✓；
- [x] 文件清单覆盖三端 + migration + local.yaml + 文档债 ✓。

### Design Grill 复审结果（step7 独立审查子代理，review.json 已归档）

status: **passed** — 3 个 P1 事实性错误已修正，无 P0，核链路源码验证成立（review.json: specVerdict=cannot_verify→修正后 pass，qualityVerdict 同）。

- ✅ R-01 已解决：lease→user 路径 = `runtime_id → DaemonRuntime.user_id`（主，daemon/model.py:144）+ `session_id → AgentSession.user_id`（interactive 兜底，agent/model.py:429）；删除误引的 AgentRun.created_by。
- ✅ R-04 已关闭：audit_hooks 只读 ORM 列，明文 api_key 不入 ORM，钩子捕获不到，无需 exclude。
- ✅ X-03 已修：BaseModel 是空类（base.py:13-16），created_at/updated_at 显式定义（§7/§8）。
- ✅ X-02 已修：§6 补 daemon.ts；interactive 注入门控独立化（plan 细化 X-02）。
- P2 plan 细化项：X-08 归一化 / X-09 masked / X-10 default_model 落点（见上节）。
- 核链路源码验证：`crypto.encrypt→LargeBinary`（crypto.py:67-70，照 git_identity/model.py:55-57）、buildSpawnEnv 第 0 层共享点（task-runner.ts:549 batch + daemon.ts:2817 interactive）、SILLYSPEC_MASTER_KEY use-time 503（crypto.py:37-44）。

结论：章节齐全，**无 P0/P1 unresolved blocker**，核心链路（CRUD → 加密 → lease 下发 → daemon 注入 → claude env）成立，进入 step8 生成规范文件。
