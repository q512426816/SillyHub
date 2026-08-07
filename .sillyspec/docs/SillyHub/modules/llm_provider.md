---
schema_version: 1
doc_type: module-card
module_id: llm_provider
---

# llm_provider

## 定位

用户级 LLM 供应商凭证管理模块。负责单个用户保存自己常用的 LLM 提供商（Claude 为主，codex/gemini/pi 字段已预留），并以「cc-switch 式启停」决定哪一条凭证在 daemon 派发任务时被注入子进程环境。本模块只管凭证数据本身（增删改查 + 加密 + 默认互斥），不负责调用 LLM、不负责派发；真正的「按默认凭证下发到 daemon」发生在 `daemon/lease/context.py` 的 lease 装配阶段。

作用域是 **owner 级（user_id）**：每个用户独立维护自己的凭证集，跨用户既不可见也不可猜（D-008）。`(user_id, agent_kind)` 二元组内同一时刻只能有一条 `is_default=True`（R-05 互斥），由 service 层在事务内先清兄弟行再置本行保证。

## 契约摘要

对外 HTTP 前缀 `/llm-providers`，7 个端点，全部经 `get_current_user` 鉴权并按 `current_user.id` 过滤（**不走** `require_permission_any`）：

- `GET /llm-providers` — 列表（按创建时间倒序）
- `POST /llm-providers` — 新建（201）
- `GET /llm-providers/{id}` — 详情
- `PATCH /llm-providers/{id}` — 更新（`api_key=None` 表示不动原密钥）
- `DELETE /llm-providers/{id}` — 删除（204）
- `POST /llm-providers/{id}/set-default` — 「启动」：先凭证探测（probe.py `probe_provider`），通过则置本行默认+清同组兄弟+触发 `notify_provider_switch` 热切换；失败回滚不改默认。返回 `SetDefaultResult{switched,affected_sessions,error}`（2026-08-06-provider-switch-live-session）
- `POST /llm-providers/{id}/unset-default` — 「停止」：置本行 `is_default=False`+触发 notify 推 `provider_config=null`（回退本机凭证）。返回 `SetDefaultResult`（幂等，**不清兄弟**）

数据契约（`schema.py`）：

- `LlmProviderCreate` / `LlmProviderUpdate` / `LlmProviderRead` / `LlmProviderList`
- `agent_kind` 当前 Literal 仅 `claude`；`auth_field` 仅 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`
- 出参 **永不返回明文或密文**，只有 `api_key_masked`（service `_to_read` 后注入；空→None、<8 位→`****`、≥8 位→首4…尾4，规则 X-09）
- `encrypted_api_key` / `key_id` 列存在 ORM 但不在任何 Read DTO 上暴露

## 关键逻辑

**加密（明文永不入 ORM，R-04）**：照 `git_identity/service.py` 范式，`__init__(session, *, cipher=None)` + lazy `get_cipher()`；`create/update` 先 `cipher.encrypt(api_key)` 拿 `(密文, key_id)` 再落库。`update` 对 `api_key` 单独处理——请求体里给 `None` 就保留旧密钥，给非 `None` 才重新加密覆盖。

**默认互斥（R-05）**：`set_default` 与 `create/update` 中置 `is_default=True` 都走 `_clear_sibling_defaults(user_id, agent_kind, except_id=...)`——单事务内 `UPDATE ... SET is_default=False WHERE user_id=? AND agent_kind=? AND is_default=True`。`unset_default` 是对称的「停止」操作，只清本行不清兄弟（取消默认不应波及其它行），且对本就 `False` 的行是 no-op。

**owner 过滤 + 不泄漏存在性**：`get(provider_id, user_id)` 先按 id 查，查不到 → `HTTP_404_LLM_PROVIDER_NOT_FOUND`；查到但 `user_id` 不匹配 → `PermissionDenied`（403）。注意这是「先查再判归属」的两段式，错误码区分是为了不向越权者确认 id 是否存在。

**与 cc-switch / lease 的关系（D-005@v1 / D-007）**：本模块只产数据，真正消费方是 `daemon/lease/context.py::_inject_provider_config`：

- 派发 lease 时按 `lease.runtime_id → DaemonRuntime.user_id`（防御性 fallback 走 `AgentSession.user_id`）解析用户
- `agent_kind` 经 `_normalize_lease_provider` 归一化（`claude_code → claude`，X-08）
- 三条件对齐查询：`user_id AND agent_kind=归一化值 AND is_default=True`，命中才注入 `provider_config`（含 `CredentialCipher.decrypt` 出的明文 `api_key`、`base_url`、`auth_field`、`model`/`default_fallback_model` 等 8 字段）
- `model` 落点（X-10）：`provider.model` 优先，否则 `default_fallback_model`，覆盖原 lease_meta/agent_run 来源
- **未配默认（D-007 零回归）**：payload 不加 `provider_config` 键（absent），daemon 第 0 层跳过、回归本机凭证管理（读宿主机 `~/.claude/settings.json` 等）。这正是 `unset_default` 存在的意义——用户「停止」后该 agent_kind 无默认，daemon 立即回退到本机凭证，无需删除整条记录。

interactive 与 batch 两条 lease 装配路径都在尾部统一调用 `_inject_provider_config`，`agent_kind_raw` 分别取自 `lease_meta.provider` 和 `agent_run.agent_type`。

## 注意事项

- **agent_kind 当前只支持 `claude`**：schema Literal 写死，model 注释里 codex/gemini/pi 是「reserved」，扩第 9 工具（PI / earendil-works）等需要先放开 Literal 并核对 lease 归一化映射。
- **列定义须与 migration `20260725_create_llm_providers.py` 一一对应**（model.py docstring 明确要求防漂移）；改字段要同步改 migration。
- **明文 api_key 只允许出现在两个位置**：`service.create/update` 写入前的 `encrypt()` 入参，和 `daemon/lease/context.py` 注入 `provider_config` 时的 `decrypt()` 出参。R-02 明确：不入 ORM、不入审计、不入日志。`_to_read` 出的是 masked。
- **不要在 Read DTO 加 `encrypted_api_key` / 明文 `api_key` 字段**，会直接破坏 R-02/R-04 安全契约；`api_key_masked` 是唯一对外口径。
- **`update` 是 `exclude_unset=True` 语义**：未传的字段不动；`api_key=None`（显式传 null）也按「不动」处理——前端「清空密钥」不能用 null，需要单独设计（当前无此入口）。
- **测试环境**：`LlmProviderService` 构造支持注入 `cipher`，测试可传 in-memory cipher 避免依赖 KMS；service 内 `get_cipher()` 是 lazy import，避免启动期循环依赖。
- **与 `git_identity` 模块同构**：加密、owner 过滤、service 范式直接照搬，改本模块时优先参考 `git_identity/service.py` 保持一致。
