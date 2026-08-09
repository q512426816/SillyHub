---
author: qinyi
created_at: 2026-08-09 01:05:00
scale: large
tier: independent
stage_review: required
---

# 设计文档（Design）— 供应商管理支持完整 URL + OpenAI API 格式（经 LiteLLM 网关）

## 1. 背景

当前 `llm_provider`（供应商管理）模块只支持 Anthropic 格式：

- `agent_kind: Literal["claude"]`、`auth_field: Literal["ANTHROPIC_AUTH_TOKEN","ANTHROPIC_API_KEY"]`；
- `base_url` 只接受 base，`fetch_models` / `probe` 固定 `GET <base>/v1/models`，鉴权头按 Anthropic；
- daemon `ClaudeCredentialInjector` 把 `base_url → ANTHROPIC_BASE_URL`、`api_key → ANTHROPIC_AUTH_TOKEN`，喂给 Claude Code。

用户需要（参考 cc-switch）：

1. 支持**完整 URL**：可直接粘贴 `https://opencode.ai/zen/v1/chat/completions` 这类完整端点 URL（而非只能填 base）；
2. 支持 **OpenAI API 格式**：`Authorization: Bearer sk-***` + `/v1/chat/completions` + `/v1/models`；
3. OpenAI 格式供应商要让 **Claude Code 真正可用**——本质需要 Anthropic Messages ↔ OpenAI Chat Completions 格式转换。

cc-switch 的做法是**自带本地代理**（Rust，监听 `127.0.0.1:15721`，`forwarder.rs` 按 `apiFormat` 转换）。本平台不自带代理（模块文档 D-012「API 格式转换非目标」），改为**复用开源代理 LiteLLM**（服务器侧统一网关）做转换，平台不自研转换逻辑——实质绕过 D-012（转换交给外部服务，非平台代码内实现）。

已实测（用户提供的测试 token，仅本次测试用，不入库）：`https://opencode.ai/zen/v1/models` + `Authorization: Bearer sk-***` 返回标准 OpenAI `{data:[{id,owned_by}]}` 模型列表；`/v1/chat/completions` 返回 `CreditsError/401`（token 有效但余额不足，非鉴权失败）。从完整 URL `.../v1/chat/completions` 剥 `/chat/completions` 即得 OpenAI base，拼 `/models` 拉模型、作 LiteLLM `api_base`。

## 2. 设计目标

- **G1**：供应商管理新增 `api_format`（`anthropic` / `openai_chat`），支持保存 OpenAI 格式供应商。
- **G2**：`base_url` 接受完整端点 URL（如 `.../v1/chat/completions`）或 base，后端按 `api_format` 算法归一（剥尾部路径）。
- **G3**：`fetch_models` / `probe` 按 `api_format` 产鉴权头（OpenAI=纯 Bearer）+ 候选 URL；可对 opencode.ai 真实验证。
- **G4**：OpenAI 格式供应商 set-default 为 Claude 默认后，经服务器侧 LiteLLM 网关让 Claude Code 端到端可用（Anthropic 请求 → LiteLLM 转 OpenAI → 上游）。
- **G5**：OpenAI 上游 `api_key` **不下发 daemon**，只注册在服务器 LiteLLM；daemon 只拿 LiteLLM 地址+令牌+模型名（比今天 Anthropic「key 下发 daemon」更安全）。
- **G6**：brownfield 零回归——未配 OpenAI 格式时全链路行为不变。

## 3. 非目标

- **N1**：不自研 Anthropic↔OpenAI 格式转换逻辑（交 LiteLLM；D-012 维持，仅绕过）。
- **N2**：本期不放开 `agent_kind` 下拉（codex/gemini/pi 仍 disabled 占位）；OpenAI 格式仍挂在 `agent_kind=claude` 下，经 LiteLLM 让 Claude Code 消费。
- **N3**：OpenAI 格式不做**模型角色映射**（sonnet/opus/fable/haiku）——单模型即可；角色映射留后续。
- **N4**：不引入 `openai_responses` / `gemini_native` 等其它格式（cc-switch 有，本期只要 `openai_chat`）。
- **N5**：不做 LiteLLM 的用量统计/成本追踪/failover 等高级特性（仅用其转换+路由）。
- **N6**：daemon 不起本地代理子进程、不管代理生命周期（代理是服务器常驻服务）。

## 4. 拆分判断

- **不走批量模式**：非「模板×数据」重复任务，是有限文件的功能扩展。
- **单 change 双 Wave**（不拆两个 change）：Wave1（供应商管理数据模型+拉模型+前端）与 Wave2（LiteLLM 集成+daemon）紧耦合——Wave2 的 provider_config/前端字段依赖 Wave1 的 `api_format` 列；但**交付可分阶段**：Wave1 独立可验收（对 opencode.ai 拉模型成功），Wave2 前置一个 LiteLLM 路由机制 spike。
- **Wave2 spike 前置**：LiteLLM 动态注册/hot-reload 能力未确认前，Wave2 实现细节（admin API vs virtual key）不定稿；spike 失败则回退备选（virtual key 或动态 config 重载）。

## 5. 总体方案

### 5.1 数据流（OpenAI 格式供应商 → Claude Code 可用）

```
新增/编辑供应商 (api_format=openai_chat, base_url=.../v1/chat/completions, key=sk-***)
  │ 加密存后端 llm_providers 表（api_key 同今天 CredentialCipher 加密）
  ▼
拉模型/探测：后端按 openai 格式 → Bearer 头 + 剥 /chat/completions 拼 /models → 打上游
  │
  ▼  set-default
后端：探测上游 key 有效 → 注册 LiteLLM（model_name=usr-<uid>-<pid>, api_base=<剥后base>, api_key=<解密>, model=<provider.model>）
  │                       → 事务内置 is_default → 推 PROVIDER_CONFIG_CHANGED
  ▼
provider_config（openai 形态）下发 daemon：{agent_kind, api_format, litellm_base_url, litellm_model_name, litellm_auth_token, model}  ← 不含上游 key（与 §7.3 逐字一致，6 字段）
  ▼
daemon ClaudeCredentialInjector（openai 分支）：
  ANTHROPIC_BASE_URL = litellm_base_url
  ANTHROPIC_AUTH_TOKEN = litellm_auth_token
  ANTHROPIC_MODEL = litellm_model_name
  ▼
Claude Code 发 Anthropic /v1/messages → LiteLLM（按 model_name 路由）→ 转 OpenAI Chat → 上游 opencode.ai
```

### 5.2 Wave 1 — 供应商管理（可独立验收）

**后端**：`llm_providers` 加 `api_format` 列；schema/service/probe/router 透传 `api_format`，按格式产鉴权头+候选 URL；完整 URL 算法归一。OpenAPI 重生成。单测覆盖 anthropic/openai 双格式 + 完整 URL 剥路径。

**前端**：api-types 重生成；表单加「API 格式」下拉（Anthropic/OpenAI Chat），openai 时隐藏认证字段+角色映射；预设加 OpenAI 格式条目（OpenCode Zen OpenAI）+ 现有预设补 `api_format:"anthropic"`；列表加格式徽标。

**验收**：能存 openai 供应商；对 opencode.ai 真实拉模型返回模型列表；anthropic 供应商行为零回归。

### 5.3 Wave 2 — LiteLLM 集成（端到端 Claude Code 可用）

**前置 spike（spike-litellm-routing）**：起一个本地 LiteLLM，验证动态注册 model 条目（admin API `POST /model/new` 或 config.yaml + `/reload`）+ Anthropic `/v1/messages` → OpenAI 上游转换 + 流式/工具调用。确认后定路由机制。

**部署**：docker-compose 加 `litellm` 服务（与 backend 同网络），master key 走 `.env`。

**后端**：
- 新增 `app/modules/llm_provider/litellm_client.py`：封装 LiteLLM admin API（register/unregister model）。
- `set_default`（openai 格式）：探测成功后 `litellm_client.register(provider)`；`unset_default`/`delete`：`unregister`。best-effort（注册失败不阻塞 is_default，降级为"已置默认但代理未就绪"，daemon 拿到 config 仍尝试连，失败时 Claude Code 报错可见）。
- `resolve_default_provider_config` / `_inject_provider_config`（context.py）：openai 格式时构造 openai 形态 config（含 litellm_base_url/model_name/auth_token，不含上游 key）。

**daemon**：`ProviderConfig` 类型加 `api_format` + openai 专属字段；`ClaudeCredentialInjector`/`credential-injector.ts` 加 openai 分支（见 §7）。

**验收**：openai 供应商设默认 → 起 Claude Code 会话 → 能正常对话（经 LiteLLM 转发 opencode.ai）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/llm_provider/model.py | 加 `api_format` 列（String(32), NOT NULL, default "anthropic"） |
| 新增 | backend/migrations/versions/2026xxxx_add_api_format.py | Alembic 加列 + 老行回填 "anthropic" |
| 修改 | backend/app/modules/llm_provider/schema.py | Create/Update/Read/FetchModelsRequest 加 `api_format`；openai 鉴权头逻辑 |
| 修改 | backend/app/modules/llm_provider/service.py | `_build_auth_headers`/`_candidate_urls`/`fetch_models`/`_resolve_fetch_credentials`/`_detect` 透传 format；完整 URL 归一 helper |
| 修改 | backend/app/modules/llm_provider/probe.py | `probe_provider` 加 `api_format`，按格式产头+候选 |
| 修改 | backend/app/modules/llm_provider/router.py | 无新端点（透传 schema 字段） |
| 修改 | backend/openapi.json + 前端 api-types.ts | `pnpm gen:types` 重生成。注：`frontend/src/lib/api/llm-providers.ts` 的 `LlmProvider*` 类型现为**手写**（文件头自述，规则 20 坑：本模块尚未迁到 `components[schemas]` 生成类型，仅 `SetDefaultResult` 已迁）；本期 `api_format` 仍走手写路径补字段，不顺带整体迁移（独立 frontend-type-migration 坑），仅在注释标注 |
| 新增（Wave2） | backend/app/modules/llm_provider/litellm_client.py | LiteLLM admin API register/unregister |
| 修改（Wave2） | backend/app/modules/llm_provider/service.py | set/unset_default/delete 调 litellm_client |
| 修改（Wave2） | backend/app/modules/daemon/lease/context.py | provider_config openai 形态构造 |
| 修改（Wave2） | deploy/docker-compose*.yml | 加 litellm 服务 |
| 修改（Wave2） | sillyhub-daemon/src/types.ts | ProviderConfig 加 api_format + openai 字段 |
| 修改（Wave2） | sillyhub-daemon/src/credential-injector.ts | openai 分支 injector |
| 修改 | frontend/src/components/llm-providers/llm-provider-form.tsx | API 格式下拉 + 条件隐藏字段 |
| 修改 | frontend/src/config/llmProviderPresets.ts | OpenAI 预设 + 现有补 api_format |
| 修改 | frontend/src/lib/api/llm-providers.ts | 类型加 api_format |
| 修改 | frontend/src/components/llm-providers/llm-provider-list.tsx | 格式徽标 |
| 新增 | backend/app/modules/llm_provider/tests/test_* | 双格式 + 完整 URL 单测 |
| 新增（Wave2） | backend/app/modules/llm_provider/tests/test_litellm*.py | LiteLLM 注册/注销 mock 测 |
| 新增（Wave2） | sillyhub-daemon/tests/credential-injector.test.ts | openai 分支单测 |

## 7. 接口定义

### 7.1 schema（Wave1）

```python
class LlmProviderCreate(BaseModel):
    name: str
    agent_kind: Literal["claude"] = "claude"
    api_format: Literal["anthropic", "openai_chat"] = "anthropic"   # 新增
    base_url: str | None = None   # 接受完整端点 URL 或 base
    api_key: str | None = None
    auth_field: Literal["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] = "ANTHROPIC_AUTH_TOKEN"
    # ... 其余不变（model_role_mappings 仅 anthropic 用；openai 前端隐藏，后端忽略）
```

`FetchModelsRequest` 内联形态加 `api_format: Literal["anthropic","openai_chat"] | None`（编辑态从行读，缺省 anthropic）。

### 7.2 鉴权头 + 候选 URL（Wave1）

```python
@classmethod
def _build_auth_headers(cls, api_key, auth_field, api_format) -> dict:
    if api_format == "openai_chat":
        return {"Authorization": f"Bearer {api_key}"}
    # anthropic：现有逻辑（API_KEY→x-api-key+anthropic-version；AUTH_TOKEN→Bearer）
    ...

@classmethod
def _candidate_urls(cls, base_url, api_format) -> list[str]:
    if api_format == "openai_chat":
        base = cls._strip_openai_suffix(base_url)   # 剥尾部 /chat/completions
        return [f"{base}/models", f"{base}/v1/models"]  # 兼容 base 是否含 /v1
    # anthropic：现有 _candidate_urls 逻辑
    ...
```

### 7.3 provider_config（Wave2，下发 daemon）

```python
# anthropic 形态（9 核心字段 + api_format 透传，共 10）
{agent_kind, base_url, api_key, auth_field, model, model_role_mappings,
 default_fallback_model, extra_env, settings_config, api_format:"anthropic"}

# openai 形态（新）—— 不含上游 api_key
{agent_kind:"claude", api_format:"openai_chat",
 litellm_base_url: "<平台 LiteLLM url>",
 litellm_model_name: "usr-<uid>-<pid>",
 litellm_auth_token: "<LiteLLM 接受的令牌>",
 model: "<provider.model>"}
```

### 7.4 daemon injector（Wave2）

```typescript
// credential-injector.ts 新增 openai 分支
if (c.api_format === 'openai_chat') {
  if (c.litellm_base_url) env.ANTHROPIC_BASE_URL = c.litellm_base_url;
  if (c.litellm_auth_token) env.ANTHROPIC_AUTH_TOKEN = c.litellm_auth_token;
  if (c.litellm_model_name) env.ANTHROPIC_MODEL = c.litellm_model_name;
  return env;   // 不注入上游 key
}
// anthropic：现有 ClaudeCredentialInjector.toEnv 逻辑
```

## 7.5 生命周期契约表

本变更涉及 daemon / lease / session / provider_config 关键词（provider_config 经 lease claim 下发、经 set-default WS 推送），列出 provider_config 的生命周期契约：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| claim lease（注入 provider_config） | daemon | backend | lease_id, runtime_id, agent_kind | lease claimed；payload 带 provider_config（anthropic 或 openai 形态） |
| set-default（openai） | 用户(前端) | backend | provider_id, user_id | is_default=True **+ 注册 LiteLLM**；provider_config=openai 形态 |
| PROVIDER_CONFIG_CHANGED（openai） | backend | daemon(WS) | session_id, provider_config(openai 形态) | daemon 标 pendingSwitch；turn 边界 reload |
| unset-default（openai） | 用户(前端) | backend | provider_id | is_default=False **+ 注销 LiteLLM**；推 provider_config=null |
| delete provider（openai） | 用户(前端) | backend | provider_id | 行删除 **+ 注销 LiteLLM**（若是默认） |
| session 端到端（openai） | Claude Code | LiteLLM → 上游 | ANTHROPIC_MODEL=litellm_model_name, token | Anthropic /v1/messages → 转 OpenAI → 上游 |

> 注：anthropic 形态的 claim/set-default/unset 路径字段与今天完全一致（仅多一个 `api_format:"anthropic"` 字段透传，daemon 老逻辑忽略未知字段，零回归）。

## 8. 数据模型

`llm_providers` 加 1 列：

```python
api_format: str = Field(
    default="anthropic",
    max_length=32,
    sa_column=Column(String(32), nullable=False, server_default="anthropic"),
)
```

- 迁移：`ADD COLUMN api_format VARCHAR(32) NOT NULL DEFAULT 'anthropic'`；老行自动回填 anthropic。
- 索引不变（`ix_llm_providers_user_agent_default` 仍 (user_id, agent_kind, is_default)）。
- **不新增 `is_full_url` 列**：完整 URL 由后端按 `api_format` 算法归一（§7.2 `_strip_openai_suffix`），偏离 cc-switch 的 flag 做法——理由：标准 OpenAI 兼容端点 URL 形态固定（`/v1/chat/completions`），算法剥路径足够，少一列更简单；非常规 URL 未来再加 flag。

## 9. 兼容策略（brownfield）

- **未配 OpenAI 格式**：老行 `api_format='anthropic'`（迁移回填），全链路（fetch_models/probe/set_default/provider_config/injector）走原 anthropic 分支，行为逐字不变。
- **daemon 老版本**：provider_config 多带的 `api_format` 字段，老 daemon `execPayload` 归一化忽略未知字段（既有行为），不破坏。
- **前端老缓存**：api-types 重生成后字段可选（default anthropic），老前端不传 → 后端默认 anthropic。
- **OpenAI 格式但 Wave2 未上线**：Wave1 交付后用户能存 openai 供应商、拉模型；此时 set-default 会经 anthropic 注入器（`api_format` 被 Wave2 前的 injector 忽略）→ Claude Code 会拿到上游 OpenAI URL 当 Anthropic base → 连不上报错。**故 Wave1 期间前端对 openai 供应商的 set-default 加守护提示「OpenAI 格式 Claude Code 支持即将上线」**，Wave2 合入后移除。这条守护是 Wave1→Wave2 过渡期的已知降级，记 R-04。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | LiteLLM 动态注册/hot-reload 机制不确定（admin API vs virtual key） | P0 | Wave2 前置 spike-litellm-routing；失败回退 virtual key 或 config 重载。**spike 必含用例**：① admin API 注册/注销幂等 ② Anthropic /v1/messages→OpenAI 流式 ③ 工具调用 tool_use↔function 转换 ④ Claude Code 后台发的**角色模型名**（如 claude-3-5-haiku）请求经 LiteLLM 路由（openai 单模型不设角色 env，N3）是否命中或需 mapping |
| R-02 | Anthropic↔OpenAI 工具调用/流式/图片内容转换边界（依赖 LiteLLM 成熟度） | P1 | spike 实测 Claude Code 典型工具调用场景；转换 bug 上游 LiteLLM issue，非本平台修 |
| R-03 | 多用户上游路由：LiteLLM 单实例按 model_name 路由，model_name 命名冲突/注销竞态 | P1 | model_name=`usr-<uid>-<pid>` 全局唯一；register/unregister 幂等 + best-effort |
| R-04 | Wave1→Wave2 过渡期：openai 供应商 set-default 会注入错误 base（Claude Code 连不上） | P1 | Wave1 前端 set-default 守护提示；Wave2 合入移除 |
| R-05 | openai 上游 key 注册到 LiteLLM 后，LiteLLM 成为新信任边界（key 明文存 LiteLLM config/DB） | P1 | LiteLLM master key + 网络隔离（仅 backend 可达）；key 注销随 unset/delete |
| R-06 | 完整 URL 算法归一对非标准端点（如自定义路径）剥错 | P2 | 候选 URL 兜底（试 base/models 与 base/v1/models）；剥失败原样尝试 |
| R-07 | D-012「API 格式转换非目标」被实质绕过（转换交 LiteLLM） | P2 | design 明示：转换不在平台代码内，D-012 维持；模块文档 llm_provider.md 同步注释 |
| R-08 | LiteLLM 单实例 SPOF：LiteLLM 宕→所有 openai 格式供应商 Claude Code 全不可用（新可用性依赖） | P1 | LiteLLM 容器 healthcheck + docker restart=always；监控告警；anthropic 供应商不受影响（独立链路） |
| R-09 | best-effort 注册失败但 is_default=True 的降级态：用户看到"已启动"但 LiteLLM 路由缺失 → Claude Code 连代理报错 | P1 | set_default 返回结构化 `litellm_registered` 标志（扩 SetDefaultResult），失败时前端 toast 明示"网关注册失败，Claude Code 暂不可用，请重试或联系管理员"；unset/delete 兜底重试注销 |

## 11. 决策追踪

| 决策 ID | 内容 | 覆盖 |
|---|---|---|
| D-001@v1 | 新增 `api_format` 列（anthropic/openai_chat），不加 is_full_url（算法归一） | §7.1 §8 |
| D-002@v1 | OpenAI 格式鉴权恒 Bearer；auth_field 列不变（openai 忽略） | §7.2 |
| D-003@v1 | OpenAI 上游 key 不下发 daemon，注册服务器 LiteLLM；provider_config openai 形态不含 key | §5.1 §7.3 G5 |
| D-004@v1 | 转换乘 LiteLLM 服务器网关（非 daemon 本地、非自研），daemon 仅改 injector | §5.3 N1 N6 |
| D-005@v1 | 双 Wave 单 change；Wave2 前置 spike-litellm-routing | §4 §5 |
| D-006@v1 | openai 本期不做角色映射（单模型）；agent_kind 不放开 | N2 N3 |
| D-007@v1 | Wave1 期间 openai set-default 前端守护提示（过渡降级） | §9 R-04 |
| D-012（既有） | 「API 格式转换」非目标——维持，本变更转换交外部 LiteLLM 绕过 | §1 §10 R-07 |

## 12. 自审（Self-Review）

逐条对照 brainstorm 完成契约与本模块文档：

- **必填章节齐全**：背景/目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪 全部命中。
- **生命周期契约表**：design 含 daemon/lease/session/provider_config 关键词 → §7.5 已给「事件×发起方×接收方×必需字段×状态变化」矩阵，6 个事件齐（claim/set-default/WS推送/unset/delete/end2end），每个事件有对应 Wave2 任务覆盖。
- **brownfield 零回归**：§9 三条回退路径（老行 anthropic 回填 / daemon 忽略未知字段 / 前端字段可选 default）+ R-04 过渡期守护。
- **D-012 一致性**：转换交外部 LiteLLM 不在平台代码内，D-012 维持；§1/§10/R-07 显式说明，无自相矛盾。
- **api_format 数据模型最小**：只加 1 列，不加 is_full_url（算法归一，§8 给理由），避免 schema 膨胀。
- **OpenAI key 安全**：D-003/G5 不下发 daemon，比今天更安全；R-05 记 LiteLLM 新信任边界 + 应对。
- **未决项诚实标注**：R-01 LiteLLM 路由机制 P0 风险 + Wave2 前置 spike；R-02 转换边界依赖 LiteLLM 成熟度。
- **规模评估**：scale=large（跨 backend/frontend/daemon/部署 4 端 + 双 Wave + DB 迁移 + spike）→ tier=independent，需 Stage Review Gate 独立审查（step 7）。
