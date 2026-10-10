---
schema_version: 1
doc_type: module-card
module_id: llm_provider
author: qinyi
created_at: 2026-08-18 01:45:00
---

# LLM 供应商凭证管理（llm_provider）

## 定位
后端「用户级 LLM 供应商凭证管理」：cc-switch 式启停模型——每用户维护自己的供应商记录（base_url + 加密 api_key + api_format + 模型角色映射），`(user_id, 引擎)` 维度单条 `is_default` 互斥；2026-10-06-provider-multi-agent-kind 起一行供应商持有 `agent_kinds` 引擎集合（至少一个），多引擎行对集合内**每个**引擎各占一个默认位（同一 key 一条行服务多引擎，免重复建卡）。本模块只管数据与生命周期（CRUD + 加密 + 逐引擎互斥 + 凭证探测 + 模型列表/用量/配额代查 + LiteLLM 网关注册），不下发凭证——真正注入 daemon 子进程在 `daemon/lease/context.py::_inject_provider_config`。openai_chat 格式经服务器 LiteLLM 网关转 Anthropic↔OpenAI（平台不自己实现协议转换）。

## 契约摘要
- 端点（prefix=/llm-providers，全部 `get_current_user` + 按 `current_user.id` 过滤，**不走** require_permission_any——owner 级，跨用户 404/403 不泄漏存在性）：
  - `GET ""` — 列表（创建时间倒序）
  - `POST ""` — 新建（201）
  - `GET /{id}` — 详情
  - `PATCH /{id}` — 更新（exclude_unset 语义；api_key=None 表示不动旧密钥）
  - `DELETE /{id}` — 删除（204）
  - `POST /fetch-models` — 拉上游模型列表（表单填写辅助，请求体可传 provider_id 或裸凭证）
  - `POST /{id}/usage` — 余额/套餐用量代查
  - `GET /{id}/quota` — 配额查询（智谱 query_zhipu_quota）
  - `POST /{id}/set-default` — 「启动」；`POST /{id}/unset-default` — 「停止」；均返回 `SetDefaultResult{switched, affected_sessions, error, litellm_registered?}`（router 包装 service 的 DefaultSwitchResult）
- `LlmProvider` 列：
  - agent_kinds（JSON 数组，D-004 单值改集合）/ base_url / auth_field / api_format
  - encrypted_api_key(bytes) + key_id（CredentialCipher，xchacha20-poly1305，照 git_identity）
  - model / default_fallback_model（X-10：provider.model 优先，否则 fallback，覆盖 lease_meta 来源）
  - model_role_mappings（dict，角色→映射：display 仅展示 / model 实际模型名留空=该角色不注入走兜底 / one_m 在模型名后追加 [1m] 标记）
  - is_default；原复合索引 (user_id, agent_kind, is_default) 随 agent_kind 列删除退役，现为 `ix_llm_providers_user(user_id)`
  - 列定义须与 migration `20260725_create_llm_providers` + `20261006120000_provider_agent_kinds`（单值→JSON 数组双方言回填 + 索引 drop/rebuild + 对称 downgrade）一一对应（防漂移）
- schema：agent_kinds 为 `list[Literal["claude","pi","codex"]]`（min_length=1，保序去重 validator；该字段声明形态被 daemon 源读取对账正则共享）；**组合禁配**——agent_kinds 含 `pi` 且 api_format=`openai_chat` 直接 422（create 级 model_validator，update 级 service 取行合并后同判）；auth_field 仅 `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`；api_format 仅 `anthropic`/`openai_chat`；Read DTO 无单值 agent_kind 字段（无过渡期，前后端同批切换）。
- 出参只含 `api_key_masked`（空→None、<8→`****`、≥8→首4…尾4）；`encrypted_api_key`/明文 key 不出现在任何 Read DTO。
- 错误类（fetch-models 四分类 + SSRF + usage 两态）：
  - `LlmProviderAuthFailed`(401) — 上游 401/403 凭证被拒
  - `LlmProviderModelsUnsupported`(404) — 候选 URL 全部 404/405（中转站常见）
  - `LlmProviderModelsAllFailed`(502) — 候选全失败（5xx/网络/解析错）
  - `LlmProviderModelsTimeout`(504) — 上游请求超时（10s）
  - `LlmProviderSsrfBlocked`(400) — base_url 解析私网/保留 IP 或 DNS 失败
  - `LlmProviderUsageTransient`(502) — 用量查询瞬时失败（前端保上次成功值 10min）

## 关键逻辑
```
set_default（启动）:
  解密 → 缺 base_url/key 拒绝（switched=False + error）
  → probe_provider（GET /v1/models，按 api_format 走候选 URL + 鉴权头
    ——复用 service._build_auth_headers/_candidate_urls 单一来源；
    SSRF assert_public_hostname；失败→不改默认不推送，返结构化 error）
  → _clear_sibling_defaults（按 user_id+is_default 过滤后行级集合交集清：set_default 逐引擎清、
    update 扩张 agent_kinds 时对新增引擎清兄弟——扩张语义 D-006）+ 置本行 True（事务内互斥）
  → openai_chat: litellm_client.register（POST /model/new，
    model_name=usr-<uid>-<pid>，model 带 openai/ 前缀，
    model_info.mode=chat 强制 Chat Completions；best-effort）
  → notify_provider_switch 按会话引擎分组扇出热切换（best-effort，
    失败仅告警不阻塞，新会话仍走 claim 注入）
unset_default（停止）: 不探测，置本行 False 不清兄弟（幂等）；
  openai_chat 联动 litellm unregister；notify provider_config=null 对全部活跃会话广播
  （多引擎行亦无差别广播 None 回退本机——收缩引擎默认空缺的会话跳过热切换仅告警）
fetch_models: 候选 URL 逐个试 → 四类错误分类 + SSRF 拒绝
query_usage: _detect_usage_provider(base_url) 路由（不加 DB 字段）
  → 6 家 handler（deepseek/kimi/minimax/openrouter/siliconflow/zhipu）
  → 两态：瞬时（网络/5xx/429/超时）raise 502（前端保上次成功值 10min）；
    确定性（401/403→data[{is_valid:False}] 翻红；404/未知供应商/
    解析失败/业务错→success:False 灰提示）
```

## 注意事项
- **明文 api_key 只允许两处出现**：service 写入前 `encrypt()` 入参与 lease 注入时 `decrypt()` 出参；永不入 ORM/日志/审计/响应（R-02/R-04）。
- LiteLLM 联动全部 best-effort（R-09）：register/unregister 失败不阻塞启停，只反映在 `litellm_registered`（前端 toast 提示优于静默成功）；`litellm_model_name` 命名约定 `usr-<uid>-<pid>` 与 daemon lease 侧逐字一致，改一处必改另一处（否则按 model_name 路由不命中，Claude Code 直接报错）。
- litellm 1.95.0 实测坑：openai 上游默认走 Responses API，必须显式 `model_info.mode=chat`；delete 按 model_id 非 model_name，且 unregister 要先 GET /model/info 找出重复注册产生的多 deployment 逐个删；重复注册返 200 非 409（多 deployment 轮询无害）。
- 未配默认（或 unset 后）lease payload 不加 `provider_config` 键（absent 语义）→ daemon 第 0 层跳过、回归宿主机本机凭证（读 ~/.claude/settings.json 等），这是 D-007 兼容策略不是 bug。
- 上游外呼（fetch-models / usage / probe）统一过 `ToolPolicyService.assert_public_hostname`（IPv4+IPv6+getaddrinfo 包 asyncio.to_thread 防阻塞）——复用 tool_gateway 的 SSRF 防护，勿各自另写；这是本模块 depends_on tool_gateway 的原因。
- usage_handlers 只做「请求+解析」：base_url 只取 scheme://host 拼各家固定用量端点（兼容 .cn/.com 与子路径变体）；balance 三家回绝对额、token_plan 四家回百分比（total=100），负数/超 100 不裁剪（裁剪归前端）；上游 body 不回传前端（防回显泄漏，只进 debug 日志）。
- 探测形态当前是 GET /v1/models（spike-01 结论，留 TODO：若 GLM/kimi 兼容端点不通需改极简 completion）。
- `PATCH` 显式传 api_key=null 按「不动」处理——前端「清空密钥」当前无入口，需要时单独设计。
- `settings_config` env 空串占位三层防线（ql-20260823-007，历史预设预填 `ANTHROPIC_AUTH_TOKEN: ""` 曾在 daemon 注入链盖掉真实 key 致会话 "Not logged in"）：预设不再预填认证键（前端守护测试锁定）→ 提交经 `cleanSettingsConfig` 剔 env 空串 → daemon 注入器合并 settings_config.env 时空串按「未配置」跳过（治愈存量行）。表单侧 base_url/兜底模型/角色模型/认证字段与配置 JSON 联动（改字段自动同步 env 同名键）。
- 测试：service 构造可注入 cipher（in-memory 免 KMS）；probe mock `probe.httpx.AsyncClient`；涉 LLM 配置测试防本机环境变量泄漏打真实网关（GLMConfig.from_env 须 monkeypatch）。
- 与 git_identity 同构（加密/owner 过滤/service 范式照搬），改其一审视另一。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
- 2026-08-20-session-multimodal-attachments：会话附件（图片多模态/文件落盘/multimodal 三态门控）涉及本模块（详见 changes 归档）
- 2026-10-06-provider-multi-agent-kind：agent_kind 单值 → agent_kinds 集合全链路化（迁移/互斥逐引擎/组合禁配/前端多选），本卡定位/契约/关键逻辑已同步（详见 changes 归档）
