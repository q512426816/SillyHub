---
schema_version: 1
doc_type: module-card
module_id: lib-git-gateway
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-git-gateway

## 定位
Git Gateway API 客户端。封装 Git 操作的代理网关调用。

## 契约摘要
- `executeGitOperation(data)` — 执行 Git 操作（通过后端网关代理）

## 关键逻辑
- 调用 `/api/git-gateway` 端点
- 后端负责实际执行 Git 命令，前端不直接操作 Git

## 注意事项
- 极简模块，仅一个函数

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
