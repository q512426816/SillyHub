---
author: qinyi
created_at: 2026-07-27 09:08:07
scale: large
revision: 2 (Design Grill B1-B5 修订)
---

# 设计文档 — LLM 供应商：获取模型列表 + 一键设置 + 配置 JSON 编辑器

## 1. 背景与目标

LLM 供应商编辑页（`frontend/src/components/llm-providers/llm-provider-form.tsx`）当前模型角色映射是**纯手填文本框**，配置高级项能力弱。参考 cc-switch（`C:\Users\qinyi\IdeaProjects\cc-switch`），新增两类能力：

1. **获取模型列表 + 一键设置**：从供应商上游拉取可用模型（`/v1/models`），下拉选填角色映射；一键把某模型应用到全部 4 角色。
2. **配置 JSON 编辑器**：直接编辑下发 daemon 的完整 Claude Code settings 片段（5 个快捷开关 + JSON 编辑器 + 应用通用配置预设），**编辑后真正下发生效**。

参考组件：cc-switch `ModelInputWithFetch.tsx` / `useModelState.ts` / `lib/api/model-fetch.ts` / `CommonConfigEditor.tsx` / `JsonEditor.tsx`。

## 2. 现状（已核实）

- 后端 `backend/app/modules/llm_provider/`：model.py 已有 `model_role_mappings`(JSON) + `default_fallback_model` + `extra_env`(JSON) 字段；schema Create/Update/Read 含这些；router 只有 CRUD + set/unset-default，**无 fetch-models 端点**；service 用 `core/crypto.py` `CredentialCipher` 加密 api_key（`decrypt(encrypted_api_key, key_id)` 得明文）。
- **下发链路（关键，两段）**：
  - **backend** `daemon/lease/context.py:139-148`：查默认 provider → 产 `provider_config` dict（8 字段：`agent_kind/base_url/api_key/auth_field/model/model_role_mappings/default_fallback_model/extra_env`），注入 lease payload。**backend 不产任何 `ANTHROPIC_*` env 变量名**。
  - **daemon** `sillyhub-daemon/src/credential-injector.ts:71 toEnv(config)`：把 provider_config 转 `Record<string,string>` env——`base_url→ANTHROPIC_BASE_URL`、`model_role_mappings→ANTHROPIC_DEFAULT_{ROLE}_MODEL`、`extra_env→Object.assign`（最后覆盖）。env 合成在 daemon，不在 backend。
- 前端 form：已有 4 角色映射表格（ROLE_ROWS sonnet/opus/fable/haiku × display/model/one_m），model 是纯手填 input。
- migration head：`202607251600`（`alembic heads` 实测）。
- SSRF 范式：`backend/app/modules/tool_gateway/tool_policy.py:163-295` `_check_not_private_ip`（IPv4Network 成员判定 + `is_reserved`，含 `0.0.0.0/8` 等），可复用；`tool_gateway/service.py:152` 示范 `socket.getaddrinfo` 须 `asyncio.to_thread` 包裹（code-quality-hardening C1）。

## 3. 决策记录

| ID | 决策 | 依据 |
|---|---|---|
| D-001 | fetch-models 端点**统一双形态** `POST /api/llm-providers/fetch-models`：`{provider_id}`（后端解密 key）或 `{base_url, api_key}`（新建未存，用完即弃） | api_key 加密存后端，前端不接触明文；用户确认 |
| D-002 | 一键设置 = 把当前任一非空模型**应用到全部 4 角色** | cc-switch `ClaudeFormFields.tsx:902-949`；用户确认 |
| D-003 | 获取按钮 = **全局一个**（角色映射区顶部，4 角色共用同一 provider 拉一次） | 4 角色共用 base_url+key，避免重复请求；用户确认 |
| D-004 | **新增 `settings_config` JSON 字段**存"高级配置片段"；结构化字段全部保留 | 不破坏现有；用户确认 |
| D-005 | 配置 JSON 面板**全套对齐 cc-switch**：5 开关 + JsonEditor + 应用通用配置预设 | 用户确认 |
| D-006 | fetch-models = 方案A：httpx 异步 + 严格 SSRF（复用 tool_policy 范式）+ 候选 URL 兜底 + 错误分类 + `getaddrinfo` 包 `asyncio.to_thread` | UX/安全/健壮；用户确认；Grill B3 |
| D-007 | 下发优先级：`settings_config.env` 在 daemon toEnv 中**最后**合并（覆盖 extra_env 之后）；api_key 永不进 settings_config 明文 | settings_config 是"高级显式写"；安全 |
| D-008 | 5 开关映射：隐藏署名=`attribution:{commit:"",pr:""}`（settings.json 顶层）/ Teammates=`env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS="1"` / Tool Search=`env.ENABLE_TOOL_SEARCH="true"` / 最大强度思考=`env.CLAUDE_CODE_EFFORT_LEVEL="max"` / 禁用自动升级=`env.DISABLE_AUTOUPDATER="1"` | cc-switch `CommonConfigEditor.tsx:72-157` |
| D-009 | **本期改 daemon 完整闭环**（用户选 X）：backend context.py 把 `settings_config` 透传进 `provider_config`；daemon `credential-injector.toEnv` 合并 `settings_config.env`（覆盖 extra_env）；daemon 生成 Claude settings.json 处（`CLAUDE_CONFIG_DIR` 隔离目录）合并 `settings_config` 顶层（attribution/enabledPlugins/skipDangerousModePermissionPrompt/model）。配置 JSON 编辑后真正下发生效 | Grill B1/B4：不碰 daemon 则 settings_config 永不生效；用户选 X |

## 4. 数据模型变更

`backend/app/modules/llm_provider/model.py` 新增列：
```python
settings_config: dict[str, Any] | None = Field(
    default=None,
    sa_column=Column(JSON, nullable=True),
)
```
新 migration `202607270900`（接 head `202607251600`，`alembic heads` 实测单头）：`ALTER TABLE llm_providers ADD COLUMN settings_config JSON NULL`（SQLite/PG 方言分支，照既有 migration 范式；down 接真实 head）。

`schema.py`：`LlmProviderCreate` / `LlmProviderUpdate` / `LlmProviderRead` 加 `settings_config: dict[str, Any] | None`。

## 5. 后端设计

### 5.1 fetch-models 端点（D-001/D-006）

`router.py` 新增 `POST /api/llm-providers/fetch-models`（owner 级，`get_current_user`）：
- 请求 body（二选一）：`{provider_id: uuid}` 或 `{base_url: str, api_key: str, auth_field?: str}`。
- 响应：`{models: [{id: str, owned_by: str | null}]}`。
- service 新增 `fetch_models(...)`：
  - 解析凭证：provider_id → 取行 + `get_cipher().decrypt(encrypted_api_key, key_id)` 得明文 key + auth_field + base_url；base_url+api_key → 直接用（不落库）。
  - `httpx.AsyncClient(timeout=10)`，鉴权头：`ANTHROPIC_AUTH_TOKEN`→`Authorization: Bearer <key>`；`ANTHROPIC_API_KEY`→`x-api-key: <key>` + `anthropic-version: 2023-06-01`。
  - **候选 URL**：`base_url.rstrip('/') + '/v1/models'`；若 404/405，剥离尾部 `/anthropic`、`/compatibility`、`/api` 子路径再试（cc-switch 范式）。
  - **SSRF 防护**（D-006/Grill B3）：**复用 `tool_policy._check_not_private_ip`**（IPv4Network 成员判定 + `is_reserved`，已含 `0.0.0.0/8` 等，勿另写字符串前缀）；补 IPv6（`::1`/`fc00::/7`/`fe80::/10`，既有 `_check_not_private_ip` 仅 AF_INET）；DNS 解析 `socket.getaddrinfo` **必须 `await asyncio.to_thread(...)`** 包裹防阻塞事件循环（对齐 `tool_gateway/service.py:152`）。
  - 错误分类：401/403→`LLM_PROVIDER_AUTH_FAILED`；404/405→`LLM_PROVIDER_MODELS_UNSUPPORTED`；全部候选失败→`LLM_PROVIDER_MODELS_ALL_FAILED`；超时→`LLM_PROVIDER_MODELS_TIMEOUT`。

### 5.2 下发链路（D-007/D-009，Grill B1 修订）

**两段改动**（不能只在 backend 改，env 合成在 daemon）：

1. **backend** `daemon/lease/context.py:139-148`：`provider_config` dict 增加 `"settings_config": provider.settings_config`（透传，不解密不加工）。
2. **daemon** `sillyhub-daemon/src/credential-injector.ts`：
   - `ProviderConfig` 类型加 `settings_config?: { env?: Record<string,string>; attribution?: ...; enabledPlugins?: ...; model?: string; skipDangerousModePermissionPrompt?: boolean }`。
   - `toEnv(c)`：在现有 `Object.assign(env, c.extra_env)` **之后**追加 `Object.assign(env, c.settings_config?.env ?? {})`（settings_config.env 覆盖优先级最高，D-007）。
   - **顶层合并**：daemon 生成 Claude settings.json 处（`CLAUDE_CONFIG_DIR` 隔离目录，见 memory `claude-code-config-dir-isolation-under-daemon`）把 `settings_config` 的 `attribution`/`enabledPlugins`/`skipDangerousModePermissionPrompt`/`model` 顶层键合并进生成的 settings.json。**plan 阶段定位 daemon 具体生成 settings.json 的函数**（design 标方向，daemon 模块文档 + grep `CLAUDE_CONFIG_DIR`/`settings.json` 定位）。
   - **api_key 永不从 settings_config 取**（只走 provider_config.api_key 加密字段 + auth_field）。

## 6. 前端设计

### 6.1 获取模型 + 一键设置（D-002/D-003/D-006）

- 新建 `frontend/src/components/llm-providers/model-input-with-fetch.tsx`（shadcn）：props `{value, onChange, fetchedModels, isLoading, onFetch?}`。有列表→Input + DropdownMenu（按 owned_by 分组选）；loading→spinner；有 onFetch→Input + 获取按钮（移植 cc-switch `ModelInputWithFetch.tsx`，shadcn + 中文）。
- `llm-provider-form.tsx` 角色映射区改造：表格上方加全局「获取模型列表」+「一键设置」按钮（D-003）；4 角色 model 单元格改用 `ModelInputWithFetch`，共享 `fetchedModels` 状态；一键设置取 `sonnet||opus||fable||haiku` 第一个非空填全部（D-002）。
- `lib/api/llm-providers.ts` 加 `fetchProviderModels({provider_id?} | {base_url, api_key, auth_field?})` → `POST /api/llm-providers/fetch-models`。
- **form values 加 `settings_config`**（Grill B5：非"不变"）：`LlmProviderFormValues` 类型 + 提交 payload 加 `settings_config: Record<string,any>|null`（配置 JSON 面板产出）。

### 6.2 配置 JSON 面板（D-005/D-008）

`llm-provider-form.tsx` 加「配置 JSON」折叠区（`<details>`，对齐既有"高级选项"折叠风格）：
- 5 开关 checkbox（D-008），toggle 时 parse settings_config JSON → 增删对应键 → stringify（照 cc-switch `CommonConfigEditor:100-157`）。
- JsonEditor：行号 + 折叠 + 格式化。倾向**轻量自研**（textarea+行号+折叠，避免 monaco 重依赖）；若 cc-switch `JsonEditor.tsx` 易移植则移植（plan 阶段定）。
- 「应用通用配置」：合并预设片段（`{env:{API_TIMEOUT_MS,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,ENABLE_TOOL_SEARCH}, enabledPlugins:{frontend-design,playwright}}`）到 settings_config（浅合并 env/enabledPlugins）。
- `lib/api/llm-providers.ts` 类型 + form values 加 `settings_config`，提交时整体存后端 JSON 列。

## 7. 测试策略

- **后端**：fetch-models（mock httpx：正常/401/404→候选兜底/全失败/超时/SSRF 拒私网+IPv6/双形态）；migration `alembic upgrade head` 单头 `202607270900`；context.py 透传 settings_config。
- **daemon**：`credential-injector` toEnv 合并 settings_config.env（覆盖 extra_env）；settings.json 生成合并顶层（attribution/enabledPlugins）。
- **前端**：ModelInputWithFetch（拉取中/下拉选/无 onFetch）；配置 JSON 面板（5 开关 toggle 改 JSON / 格式化 / 应用预设 / JSON 非法不崩）；一键设置。

## 8. 风险与边界

- **SSRF**（D-006）：复用 `tool_policy._check_not_private_ip` + 补 IPv6；`getaddrinfo` 包 `asyncio.to_thread`。
- **api_key 暴露**：fetch-models 新建态前端临时传 base_url+api_key 经 HTTPS 到后端用完即弃；编辑态 provider_id 后端解密；前端永不收明文。
- **中转站 /v1/models 不支持**：候选 URL 兜底 + 错误分类（404/405→提示未开放）。
- **settings_config 与结构化字段冲突**：D-007 明确 settings_config.env 在 toEnv 最后覆盖；UI 配置 JSON 面板提示"高级 env 覆盖上方结构化字段"。
- **daemon 改动范围**（D-009）：`credential-injector.toEnv`（env 合并）+ settings.json 生成处（顶层合并）。plan 阶段定位具体生成 settings.json 的 daemon 函数。daemon bundle 改了需 `pnpm bundle` + backend 镜像 rebuild。
- **JsonEditor 依赖**：倾向轻量自研，plan 阶段定。

## 9. 生命周期契约（豁免声明）

本变更**不涉及生命周期状态机**，无需生命周期契约表（事件×状态转换矩阵）。理由：

- 不改 `DaemonTaskLease` / `AgentRun` / `AgentSession` 的状态字段、状态流转或事件转换（pending/running/completed/failed/killed/cancelled 等状态机完全不变）。
- `fetch-models` 是无状态查询端点（GET 语义，POST 仅因双形态 body；不创建/转移任何实体状态，无副作用）。
- `settings_config` 是 `LlmProvider` 的配置字段（CRUD 扩展）；下发链路（backend context.py 透传 + daemon `toEnv`/settings.json 合并）在现有 lease 流转中携带配置，不改变 lease 生命周期或触发新事件。
- daemon 改动（`credential-injector.toEnv` env 合并 + settings.json 生成顶层合并）是配置合并逻辑，不碰 daemon 三循环（HTTP 轮询/WS 心跳/lease 执行）或 session 生命周期。

故豁免生命周期契约表要求。

## 10. 文件变更清单

详见 tasks.md Wave 分组（task-01~14）。核心文件：
- **backend**：`app/modules/llm_provider/{model,schema,router,service}.py` + `app/modules/daemon/lease/context.py` + `migrations/versions/202607270900_*.py` + `app/modules/llm_provider/tests/`
- **daemon**：`src/credential-injector.ts`（toEnv 合并 env）+ settings.json 生成处（task-06 spike 定位，grep `CLAUDE_CONFIG_DIR`/`settings.json`）
- **frontend**：`components/llm-providers/{llm-provider-form,model-input-with-fetch}.tsx` + 可能新建 `components/ui/json-editor.tsx` + `lib/api/llm-providers.ts` + `__tests__/`

## 11. 自审

Design Grill（独立子代理审查）发现 5 blocker，revision 2 全部修订：
- B1（settings_config 下发链路断裂）→ D-009 改 daemon 完整闭环（用户确认 X）+ §5.2 两段改动。
- B2（现状把 provider_config 字段与 env 变量名混淆）→ §2 澄清 backend 产 8 字段 / daemon toEnv 产 ANTHROPIC_* env。
- B3（SSRF 字符串前缀漏 0.0.0.0/8 + 无 IPv6 + getaddrinfo 阻塞）→ §5.1 复用 tool_policy._check_not_private_ip + 补 IPv6 + to_thread。
- B4（attribution daemon 不消费）→ 随 D-009 daemon settings.json 生成合并顶层解决。
- B5（form values "不变" vs "加 settings_config" 冲突）→ §6.1 明确加 settings_config。

已核实为真的断言：model.py 字段 / `CredentialCipher.decrypt(encrypted_api_key, key_id)` 签名（crypto.py:72）/ router 现状 / 前端 4 角色表格 model 手填 / migration head `202607251600`（alembic heads 实测）/ tool_gateway SSRF 范式（tool_policy.py:163-295）。
