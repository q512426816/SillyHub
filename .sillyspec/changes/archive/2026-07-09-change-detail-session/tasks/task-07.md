---
id: task-07
title: build_change_context_preamble（标题/阶段/文档路径/已变更文件清单）
title_zh: 构建变更上下文前导字符串
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P0
depends_on: [task-01]
blocks: [task-08]
requirement_ids: [FR-03]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/session/context.py
provides:
  - contract: build_change_context_preamble
    fields: [returns_str]
goal: >
  新建 build_change_context_preamble(db, change_id) -> str，拉 Change（标题/当前阶段）+ ChangeDocument（design/plan/tasks 路径）+ list_change_files（已变更文件，X-01），拼【变更上下文】前导。
implementation:
  - 新建 backend/app/modules/daemon/session/context.py
  - 查 Change（title, current_stage）；查 ChangeDocument 取文档相对路径（design/plan/tasks）
  - 复用既有 list_change_files service 取该变更文件路径列表（X-01）
  - 拼成多行文本前导：【变更上下文】标题/阶段/工作目录提示/文档路径/已变更文件清单
  - change_id 为 None 或查无变更时返回 None
acceptance:
  - 前导含标题、当前阶段、文档路径、已变更文件清单四类信息
  - 无变更数据时优雅降级（返回 None 或精简前导）
verify:
  - cd backend && uv run mypy app/modules/daemon/session/context.py
  - cd backend && uv run ruff check app/modules/daemon/session/context.py
constraints:
  - 复用 list_change_files，不重复实现文件枚举
  - 前导为纯文本，不含敏感脱敏问题（路径来自已存数据）
---

## 验收标准
- 前导含标题、当前阶段、文档路径、已变更文件清单四类信息
- 无变更数据时优雅降级（返回 None 或精简前导）
- 复用 list_change_files 取文件清单

## 验证步骤
- cd backend && uv run mypy app/modules/daemon/session/context.py
- cd backend && uv run ruff check app/modules/daemon/session/context.py
