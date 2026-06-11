---
schema_version: 1
doc_type: module-card
module_id: test-utils
author: qinyi
created_at: 2026-06-10T16:55:00
---

# test-utils

## 定位
测试基础设施。包含 Vitest 配置和测试 setup 文件。

## 契约摘要
- `vitest.config.ts` — Vitest 测试配置：jsdom 环境、全局 API、setup 文件路径、`@/` 路径别名
- `src/test/setup.ts` — 测试 setup 文件（如果存在）
- `src/lib/__tests__/` — 单元测试目录（api.test.ts、agent.test.ts、spec-workspaces.test.ts）

## 关键逻辑
- Vitest 使用 @vitejs/plugin-react 支持 TSX 测试
- css: false 避免测试中处理 CSS 文件

## 注意事项
- 当前测试覆盖率较低，仅有 3 个测试文件
- 新增测试遵循 `__tests__` 目录约定

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
