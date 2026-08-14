---
author: qinyi
created_at: 2026-08-14 14:40:00
title: workflow/model.py 定义 5 个审计 action 常量 + AUDIT_PLACEHOLDER_ID
priority: P0
wave: 1
depends_on: []
allowed_paths:
  - backend/app/modules/workflow/model.py
---

# task-01: workflow/model.py 定义 5 个审计 action 常量 + AUDIT_PLACEHOLDER_ID

## 目标

在 `backend/app/modules/workflow/model.py` 的 `AuditLog` 类定义旁新增模块级常量（方案 B 常量集中，D-005），供 task-03/task-04 引用，service 代码禁止内联 action 字面量。

## 实现要点

1. 五个 action 常量（**不含 `PLATFORM_SETTING_DELETE`**——Grill C-6：settings 全仓无 delete 端点，requirements FR-02 为权威；design §5 写 6 个是已知偏差不回改）：
   - `AUTH_LOGIN_SUCCESS = "auth.login.success"`
   - `AUTH_LOGIN_FAILED = "auth.login.failed"`
   - `PLATFORM_SETTING_CREATE = "platform_setting.create"`
   - `PLATFORM_SETTING_UPDATE = "platform_setting.update"`
2. `AUDIT_PLACEHOLDER_ID = uuid.UUID(int=0)`（全零占位，D-002/D-004 共用单一定义；AuditLog.resource_id 非空但无 FK 约束，占位不违约——Grill C-5 已核）。
3. 加简短注释说明用途与出处（ql/change 引用：2026-08-14-audit-system-completion / D-005）。

## 验收标准

| AC | 检查方式 | 通过条件 |
|---|---|---|
| AC-01 | `from app.modules.workflow.model import AUTH_LOGIN_SUCCESS, AUTH_LOGIN_FAILED, PLATFORM_SETTING_CREATE, PLATFORM_SETTING_UPDATE, AUDIT_PLACEHOLDER_ID` | import 成功 |
| AC-02 | grep 全仓 `PLATFORM_SETTING_DELETE` | 零命中 |
| AC-03 | `uv run ruff check` + `uv run mypy app/modules/workflow/model.py`（backend 目录） | 全过 |
