---
id: task-06
title: build_claim_payload 注入 provider_config + lease/execution DTO 加字段
title_zh: lease 下发 provider_config + DTO 扩字段
author: qinyi
created_at: 2026-07-25 17:06:11
priority: P0
depends_on: [task-03]
blocks: [task-07, task-08]
requirement_ids: [FR-03]
decision_ids: [D-002@v1, D-005@v1, D-010@v1]
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/agent/schema.py
provides:
  - contract: ProviderConfig
    fields: [agent_kind, base_url, api_key, auth_field, model, model_role_mappings, default_fallback_model, extra_env]
goal: >
  在 build_claim_payload（context.py:62）interactive 与 batch 两路注入 provider_config，
  按 lease 关联用户查其 is_default 且 agent_kind 对齐的默认 provider，解密 api_key 落入 payload；
  并在 ExecutionContextResponse（agent/schema.py:27）DTO 加同名字段。
implementation:
  - 解析 user_id 主路径 lease.runtime_id → DaemonRuntime.user_id（daemon/model.py:144，nullable=False 全 lease kind）
  - interactive 兜底 lease_meta.session_id → AgentSession.user_id（agent/model.py:429）
  - agent_kind 归一化复用 context.py:44 _normalize_lease_provider（claude_code→claude，X-08）
  - 查询 WHERE user_id AND agent_kind=归一化 AND is_default=True（复用 task-03 service），命中才注入
  - default_model 落点 X-10：provider.model/default_fallback_model 覆盖 payload[model]（context.py:289/303）
  - 命中后 CredentialCipher.decrypt（task-03 已封装）明文 api_key 放入 provider_config.api_key
  - DTO ExecutionContextResponse 加 provider_config: dict|None=None
  - 未配兜底（D-007）：查不到 → payload 不加 provider_config 键（absent），daemon 第0层跳过
acceptance:
  - runtime_id→user_id 主路径解析成功；runtime 缺失时 session_id→AgentSession.user_id 兜底成立
  - 用户配了默认 provider → payload.provider_config 含 provides 全字段且 api_key 是明文
  - 用户未配 → payload 不含 provider_config 键（absent），payload[model] 维持原来源
  - claude_code 经归一化能查到 agent_kind=claude 的 provider
  - ExecutionContextResponse 新字段默认 None，旧响应序列化不变
verify:
  - cd backend && uv run pytest tests/modules/daemon/lease/ -q --no-cov && uv run mypy app
constraints:
  - 主路径 lease.runtime_id→DaemonRuntime.user_id（daemon/model.py:144）；不可误用 AgentRun.created_by（R-01 已删该误引）
  - agent_kind 归一化复用 _normalize_lease_provider（X-08），不另写映射
  - 查询条件 is_default=True AND agent_kind=归一化值 AND user_id=解析值 三者对齐
  - 用户未配则 provider_config 字段 absent（None），不下发空 dict（D-007 零回归）
  - default_model 落点 X-10：provider.model/default_fallback_model 覆盖 payload[model]（context.py:289/303）
  - 解密 api_key 明文放入 provider_config（daemon 注入 env 必需，claim/create 阶段下发）
  - provider_config 严禁落 submitMessages/complete_lease/AuditLog/日志（R-02）；audit_hooks 只读 ORM 列，明文不入 ORM 故捕获不到（R-04 已关闭）
  - DTO 类名是 ExecutionContextResponse（agent/schema.py:27），非泛称 lease DTO
  - mypy 必须通过（忽略注释只留 code 不留中文）
---
