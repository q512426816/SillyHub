---
author: qinyi
created_at: 2026-08-15T10:05:00+08:00
change: 2026-08-15-error-message-l10n
project: backend
status: draft
---

# Proposal — 后端面向用户报错文案中文化

> author: qinyi
> created_at: 2026-08-15T10:05:00+08:00

## 问题

前端错误展示契约（2026-06-25-frontend-error-handling）假定「后端 AppError.message
已是中文」并直接透传给用户，但后端 462 处 raise message 中仅 61 处中文。用户在
admin 管理、workspace 成员、change 推进、ppm、release 等页面操作失败时看到
`User not found`、`daemon runtime '3f87ad1d-…' is offline` 这类英文技术串。

## 方案

范围 A（用户确认）：只改前端可达链路（router + service 用户动作链路）约
251 处 / 41 文件，原位改写为中文短语+行动指引；UUID/路径/上游错误串移
details；code/http_status/API 契约零变更，前端零改动。机器对机器接口
（daemon 内部 RPC、MCP 工具、platform_sync CLI、core 启动校验）保持英文。

## 收益

- 用户看到的所有报错都是可理解的中文 + 明确的下一步动作；
- 排查信息不丢（details 保留技术 ID）；
- 守护测试防止英文文案再混入用户链路。

## 不在范围内（Non-Goals）

- daemon 内部 RPC / MCP 工具与 SSE（tools.py/server.py/sse.py）/ platform_sync
  CLI 接口 / core 启动期校验：机器对机器接口，英文语义更准。
- 前端任何文件（契约零变更，errMessage 透传链路不动）。
- code / http_status / openapi.json / api-types.ts：零变更。
- 不做 code→文案映射表、不引入 i18n 框架。
