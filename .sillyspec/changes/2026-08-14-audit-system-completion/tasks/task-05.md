---
author: qinyi
created_at: 2026-08-14 14:40:00
title: audit_hooks 生效用例 + 全量回归
priority: P0
wave: 3
depends_on: [task-02, task-03, task-04]
allowed_paths:
  - backend/tests/
---

# task-05: audit_hooks 生效用例 + 全量回归

## 目标

验证挂载后的 hooks 行为符合 design §4.5/FR-06，并确认全局生效不破现存测试（FR-07/R-01）。

## 实现要点

1. **新增 hooks 生效用例**（建议 `backend/tests/core/test_audit_hooks_effective.py` 或就近现有 core 测试文件）：
   - 有 audit_context 的 insert → 1 条 AuditLog（action=`<resource>.insert`，actor/resource 正确）
   - 有 audit_context 的 update（真实改字段）→ 1 条（details 含 changed_fields/from/to）
   - **无** audit_context 的写 → **不产生**审计行（核心断言：daemon/后台写豁免，D-01 依据）
   - audit_logs 自身写入不递归（计数不增长）
   - 复合主键表（如 role_permissions）写入不产生审计（`_get_resource_id` None 跳过）
2. **全量回归**：`cd backend && uv run pytest -q --no-cov`（backend 目录）。挂 hooks 全局生效，可能出现现存测试断言受新增审计行影响（典型：断言 audit_logs 行数、或断言某表 select 计数被审计行干扰——审计写的是 audit_logs 表，一般只影响直接查 audit_logs 的断言）。
3. **修断言纪律**：受影响断言一律加 `action`/`resource_type` 过滤收窄查询，**禁止删除断言或弱化测试**（CLAUDE.md 规则 11）。

## 验收标准

| AC | 检查方式 | 通过条件 |
|---|---|---|
| AC-01~05 | 新增用例 | 全过（五场景覆盖） |
| AC-06 | 全量 backend pytest | 通过；若有修断言，逐一列出（文件+改法） |
| AC-07 | ruff + mypy（backend） | 全过 |
