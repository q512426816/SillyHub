---
schema_version: 1
doc_type: module-card
module_id: lib-tool-gateway
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-tool-gateway

## 定位
Tool Gateway API 客户端。封装外部工具调用的代理网关。

## 契约摘要
- `executeTool(data)` — 执行工具调用（通过后端网关代理）

## 关键逻辑
- 调用 `/api/tool-gateway` 端点
- 后端负责实际工具执行，前端仅发起请求

## 注意事项
- 极简模块，仅一个函数

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
