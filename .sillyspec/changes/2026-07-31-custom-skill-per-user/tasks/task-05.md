---
id: task-05
title: CustomSkillRead.created_by type narrow to uuid.UUID
title_zh: CustomSkillRead.created_by 类型收窄 uuid.UUID|None 到 uuid.UUID
author: qinyi
created_at: 2026-07-31 22:40:05
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - backend/app/modules/skills/schema.py
---

## 目标
`CustomSkillRead.created_by` 类型从 `uuid.UUID | None` 收窄为 `uuid.UUID`（per-user 强归属后必有创建者），并排查前端是否存在 `created_by: null` 默认会炸的引用（发现问题交 task-10 修，本任务只动后端 schema）。

## 实现要点
- 现状 `schema.py:50` `created_by: uuid.UUID | None = None`；改为 `created_by: uuid.UUID`（去掉 `| None` 与 `= None` 默认值）。
- `CustomSkillDetail` 继承自 `CustomSkillRead`（`:55-58`），类型随之收窄，无需单独改。
- 排查（gap#5）：grep `frontend/src/lib/custom-skills.ts` 及前端测试 mock，确认无 `created_by: null` 或 `created_by?: ...` 默认会与收窄后类型冲突的引用；发现问题记录到本任务实现要点末尾，交 task-10 在前端侧修复（task-05 只改后端 schema.py，不动前端）。
- 若后端测试 mock 里有 `created_by=None`（如 test_router/test_service 构造 CustomSkillRead 时），按规则 9 判断：测试本身 mock 与新契约不符才改测试 mock 字段值（不是改回手写）。
- 后端 OpenAPI 类型生成（CLAUDE.md 规则 20）：schema 改完后，本变更 execute 阶段同一 change 内跑 `pnpm gen:types`，让 `frontend/src/lib/api-types.ts` 的 `created_by` 同步收窄（必填，非 nullable）。

## 验收
- `schema.py` 中 `CustomSkillRead.created_by` 类型为 `uuid.UUID`（无 `| None`），`CustomSkillDetail` 继承一致。
- mypy / pydantic 校验过（构造 CustomSkillRead 不传 created_by 会报 validation error，符合 per-user 必有归属语义）。
- gap#5 排查有结论（前端无炸点 / 发现问题列出交 task-10），不能跳过排查直接交付。
- gen:types 后 `api-types.ts` 的 created_by 字段不再是 nullable。
