---
id: task-06
title: protocol.ts 新增 PROVIDER_CONFIG_CHANGED 类型 + daemon.ts WS 分发 case
title_zh: daemon 新增 PROVIDER_CONFIG_CHANGED 类型加 WS 分发 case
author: WhaleFall
created_at: "2026-08-06 16:40:41"
priority: P0
depends_on: [task-02]
blocks: [task-07]
requirement_ids: [FR-04]
decision_ids: [D-001, D-002]
allowed_paths:
  - sillyhub-daemon/src/protocol.ts
  - sillyhub-daemon/src/daemon.ts
expects_from:
  task-02:
    - contract: MSG.PROVIDER_CONFIG_CHANGED
      needs: [payload 结构]
goal: >
  daemon 端新增 PROVIDER_CONFIG_CHANGED 消息类型常量与 payload 类型，daemon.ts WS 分发新增 case 路由到 sessionManager.markPendingSwitch（design §5 Wave2 / FR-04）。
implementation:
  - protocol.ts MSG 对象新增 PROVIDER_CONFIG_CHANGED 常量值 'daemon:provider_config_changed' 与 backend protocol.py 逐字对齐
  - protocol.ts 新增 ProviderConfigChangedPayload 接口含 session_id 与 provider_config 可空（null 表回退本机）
  - daemon.ts _handleWsMessage switch 与 SESSION_INJECT 同位置新增 case MSG.PROVIDER_CONFIG_CHANGED 非阻塞分发（约第 2534 行）
  - 分发调 sessionManager.markPendingSwitch(sessionId, providerConfig | null) 透传 null 不拦截
  - payload 字段按 SESSION_INJECT 风格做 snake/camel 双写归一化读取 session_id 与 provider_config
acceptance:
  - daemon 收到 PROVIDER_CONFIG_CHANGED 消息时调 sessionManager.markPendingSwitch
  - payload 类型与后端 task-02 定义逐字对齐（session_id + provider_config 可空）
  - provider_config 为 null 时透传给 markPendingSwitch（停止场景回退本机）
  - 未知消息类型仍走 default warn 忽略保持向前兼容
verify:
  - cd sillyhub-daemon && pnpm test
constraints:
  - 未知消息类型忽略保持向前兼容（旧 daemon 升级路径 design §9）
  - provider_config 为 null 时透传给 markPendingSwitch 不拦截
  - ESM import 带 .js 后缀（CONVENTIONS 规则 5）
  - 消息常量字符串与 backend protocol.py 逐字对齐任一字符漂移即契约单测失败
---
