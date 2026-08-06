---
id: task-02
title: extract resolve_default_provider_config helper + protocol MSG.PROVIDER_CONFIG_CHANGED
title_zh: 抽取 resolve_default_provider_config helper + protocol.py 新增 PROVIDER_CONFIG_CHANGED 消息常量
author: WhaleFall
created_at: "2026-08-06 16:40:41"
priority: P0
depends_on: []
blocks: [task-03, task-04, task-06]
requirement_ids: [FR-06]
decision_ids: [D-005@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/protocol.py
provides:
  - contract: resolve_default_provider_config
    fields: [helper 函数]
  - contract: MSG.PROVIDER_CONFIG_CHANGED
    fields: [消息常量]
goal: >
  从 _inject_provider_config 抽取可复用 provider_config 构造 helper 作为 D-006 单一真相源,
  并在 protocol.py 新增 PROVIDER_CONFIG_CHANGED 常量与 payload 结构,供 task-03/04/06 复用。
implementation:
  - context.py 新增 resolve_default_provider_config(session, user_id, agent_kind) 异步函数,返回 ProviderConfig dict 或 None
  - helper 内查 LlmProvider 中 is_default 为 True 且 user_id/agent_kind 对齐行,经 get_cipher 解密 api_key,构造 8 字段中性结构(含 settings_config 原样透传)
  - _inject_provider_config 改为调 helper,命中时覆盖 payload.model、未配 absent,对外行为零回归
  - protocol.py 新增 DAEMON_MSG_PROVIDER_CONFIG_CHANGED 字符串常量(值对齐现有 daemon:xxx 命名约定),风格同 DAEMON_MSG_SESSION_INJECT
  - protocol.py 新增 ProviderConfigChangedPayload Pydantic 模型,字段 session_id 与 provider_config(可空 dict),对齐 design §7 WS payload
acceptance:
  - _inject_provider_config 对外行为零回归(现有 interactive 与 batch claim 路径不变)
  - helper 在无默认供应商或 user_id/agent_kind 缺失时返回 None
  - DAEMON_MSG_PROVIDER_CONFIG_CHANGED 常量与 ProviderConfigChangedPayload 已定义,可在 ws_hub.send_session_control 引用
verify:
  - cd backend && pytest app/modules/daemon/lease/tests/
constraints:
  - helper 为 claim 与 set_default 单一真相源,禁止两处各写一份构造逻辑
  - api_key 明文仅在 helper 内部短暂存在,不外泄到日志/ORM/审计
  - 不改 _inject_provider_config 对外签名
  - ProviderConfig 8 字段及 settings_config 透传口径与现有 claim payload 完全一致
---
