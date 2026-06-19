---
author: qinyi
created_at: 2026-06-19 13:25:00
source_commit: 0303536
updated_at: 2026-06-19T05:25:00Z
generator: sillyspec-quick
schema_version: 1
doc_type: module-card
module_id: interactive
---

# interactive

> 由 ql-20260619-002-703a 增量补充（interactive-session 变更落地后补入索引）。依赖链 `depends_on`/`used_by` 待全量 scan 核对。

## 定位
交互式（多轮）会话管控模块，基于 **Claude Agent SDK driver 层**实现。负责会话生命周期、用户输入注入、工具权限裁决与会话持久化。前身是 task-runner 的一次性执行模型；本模块把它升级为有状态、可中断、可恢复的交互式会话。

不负责：与 backend 的传输层（归 `ws-client`/`client`）、凭据管理（归 `credential`）、一次性任务执行（归 `task-runner`）。

## 契约摘要
（具体导出符号以 `_module-map.yaml` 的 entrypoints/main_symbols 为准）
- **SessionManager** — 会话生命周期：创建/恢复/注入用户消息/取消；持有 `SessionState`。
- **ClaudeSdkDriver** — Claude Agent SDK 驱动：`query({prompt, options})` 流式消费、`interrupt`、`canUseTool` 权限回调、`resume`；无状态，由 SessionManager 编排。
- **InputQueue** — `AsyncIterable<SDKUserMessage>` 用户输入队列，支持多轮注入。
- **PermissionResolver** — 工具调用权限裁决（注册/解析/超时回退 `PERMISSION_FALLBACK_TIMEOUT_MS`）。
- **JsonSessionPersistence** — 会话状态 JSON 持久化（`DEFAULT_SESSION_FILE`，`SESSION_FILE_VERSION`）。

## 关键逻辑
```
SessionManager.create(CreateSessionInput) → SessionState(active)
  → ClaudeSdkDriver.consume(ConsumeCallbacks) 驱动 SDK query
  → InputQueue 注入用户消息(SDKUserMessage) → SDK 流式产出
  → 工具调用经 PermissionResolver.canUseTool 裁决 → 允许/拒绝/待确认
  → 状态经 JsonSessionPersistence 落盘 → 可 resume 恢复
```

## 注意事项
- 来自 `2026-06-18-daemon-interactive-session` 变更（SDK driver 层方案 v3）。
- 权限链路与 backend WS（`PermissionWsSender`）耦合，修改时同步检查 `ws-client` 与 backend daemon 模块。
- 会话持久化格式受 `SESSION_FILE_VERSION` 控制，升级需迁移。
- 本卡片为增量补充，模块边界与依赖链建议在下一次全量 scan 复核。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
