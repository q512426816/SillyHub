---
author: qinyi
created_at: 2026-07-31 11:45:37
---

## 任务

- [ ] task-01: 后端拼装 SKILL.md frontmatter
- [ ] task-02: 前端编辑弹窗 frontmatter 适配与校验
- [ ] task-03: skills 页生效提示加新手引导加白话化加只读 banner
- [ ] task-04: 前端单测编辑弹窗 frontmatter 适配加 skills 页 placeholder 断言更新

# skills-settings-p0-fixup 实现计划

## 规模分类

plan_level: light — 改动 7 个文件、跨后端打包层+前端两处+测试、无 schema/状态机/权限变更、主 agent 顺序实现（不开并发子代理）。
estimated_files: 7
cross_module: true
has_schema_change: false
has_state_machine_change: false
needs_parallel_execution: false
needs_human_review: false

## 执行顺序（Wave）

- Wave 1（顺序）：task-01 后端、task-02 弹窗、task-03 页面（文件不重叠、无数据契约，可独立实现）。
- Wave 2：task-04 前端测试（依赖 task-02/03 实现完成）。

## 文件覆盖对账（design 文件清单 → task allowed_paths）

- backend/app/modules/agent/skills_bundle_service.py → task-01
- backend/app/modules/skills/model.py → task-01
- backend/app/modules/skills/schema.py → task-01
- backend/app/modules/daemon/tests/test_skills_bundle.py → task-01
- frontend/src/components/custom-skill-edit-dialog.tsx → task-02
- frontend/src/app/(dashboard)/settings/skills/page.tsx → task-03
- frontend/src/app/(dashboard)/settings/skills/__tests__/edit-dialog.test.tsx（新增）→ task-04
- frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx（断言更新）→ task-04

## 验证策略

- 后端：pytest test_skills_bundle.py + test_router.py（断言更新为 frontmatter+body）
- 前端：vitest edit-dialog + page 测试 + tsc --noEmit typecheck
- 不改 schema → 不需 gen:types
