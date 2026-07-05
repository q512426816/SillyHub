---
id: task-15
title: backend 集成测试（三端联调）
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P0
depends_on: [task-01, task-02, task-06, task-09, task-10, task-13]
blocks: []
allowed_paths:
  - backend/app/modules/agent/tests/
  - backend/app/modules/workspace/tests/
  - backend/app/modules/spec_workspace/tests/
  - backend/app/modules/daemon/tests/
---

## 目标
backend 三端联调集成测试，覆盖所有新增/改动端点 + 两分支。

## 实现步骤
- placement 用 member binding 路由（task-01）。
- scan owner+count 门禁（task-02：403/409/force）。
- init dispatch + lease payload（task-06/10：platform_config/latest_spec_version/root_path）。
- spec_version 递增（task-09：scan 成功后 +1）。
- spec-sync outbox kind 识别（task-13：两分支 server-local/daemon-client）。
- 旧 binding 回退读全局列兼容测。

## 验收标准
- 所有新增/改动端点有测试；server-local/daemon-client 两分支覆盖；旧数据默认值不崩。

## 验证方式
`cd backend && uv run pytest -q --cov=app --cov-fail-under=60`。

## 约束
- 测试不绑死 SQL 函数名（用行数 + 行为断言，见 known issue backend-test-sqlite-vs-pg）。
- SQLite in-memory 测 + 生产 PG 方言分支（date_trunc 等）。
