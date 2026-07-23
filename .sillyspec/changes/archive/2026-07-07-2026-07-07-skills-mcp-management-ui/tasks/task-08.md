---
author: qinyi
created_at: 2026-07-07 23:23:00
goal: frontend /settings/skills 管理页
implementation: 新建 frontend/src/app/(dashboard)/settings/skills/page.tsx；上区平台 sillyspec skills 只读列表（调 GET /api/daemon/skills/latest/manifest 读 version+files）+ 同步版本；下区自定义 skills 表格 CRUD（调 /api/custom-skills）；编辑弹窗 name+description+markdown 编辑器带预览（复用现有 markdown 组件）；admin 权限 gating（非 admin 只读）
acceptance: 平台 skills 列表展示；自定义 skills CRUD 可用（admin）；编辑弹窗 markdown 预览；非 admin 只读；样式对齐 settings/api-keys
verify: cd frontend && pnpm test src/app/\(dashboard\)/settings/skills + pnpm typecheck
constraints: 中文文案（CLAUDE.md）；样式参考 frontend-style-system + settings/api-keys；复用 React Query hooks；markdown 编辑器复用现有（D-007）
depends_on: [task-02, task-03]
covers: [FR-09, D-007]
---

# task-08: frontend /settings/skills 页

## 验收标准
A. `/settings/skills` 页：平台 sillyspec skills 只读列表（version + files 数 + 同步状态）。
B. 自定义 skills 表格 CRUD（admin 可新增/编辑/删除，调 task-02 端点）。
C. 编辑弹窗含 markdown 编辑器 + 预览（复用现有组件）。
D. 非 admin 只读（CRUD 按钮隐藏/禁用）。
E. 样式对齐 settings/api-keys 子页；pnpm test + typecheck 全绿。
