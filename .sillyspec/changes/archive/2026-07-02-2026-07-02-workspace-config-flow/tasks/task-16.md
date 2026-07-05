---
id: task-16
title: daemon 测试
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P0
depends_on: [task-07, task-11, task-12, task-13]
blocks: []
allowed_paths:
  - sillyhub-daemon/tests/
---

## 目标
daemon 侧测试全覆盖。

## 实现步骤
- init lease 处理 + platform.json 写入（task-07：6 字段）。
- 版本检查保鲜（task-11：落后 pull / 一致跳过）。
- pull 前回灌（task-12：未回灌标记 + postSpecSync 失败保护）。
- kind=spec-sync 处理（task-13：拉到 spec-sync 行 → postSpecSync）。

## 验收标准
- vitest 全绿。

## 验证方式
`cd sillyhub-daemon && pnpm exec vitest run`。

## 约束
- mock backend lease/outbox 响应，不依赖真实 backend。
