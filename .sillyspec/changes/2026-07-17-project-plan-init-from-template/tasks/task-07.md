---
id: task-07
title: milestone-details 模块层条件 — overall_stage → has_module
phase: W2
author: WhaleFall
created_at: 2026-07-17 11:02:17
priority: P1
status: draft
requirement_ids:
  - FR-006
decision_ids:
  - D-006@v1
depends_on:
  - task-06
blocks:
  - task-08
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
---

## 1. 目标

milestone-details 展开行渲染的「模块层 / 明细层」判断条件，由 `overall_stage === IMPLEMENT_STAGE`（`"实施阶段"`）改为 `PsPlanNode.has_module === true`，使模块层三级展开与「该里程碑是否承载模块子表」对齐，而非与阶段名硬绑定。

## 2. 依据

- design.md §5.3：模块层展示条件 `overall_stage==="实施阶段"` → `PsPlanNode.has_module===true`。
- design.md §11 D-006@v1：模块层条件改 has_module（替代 overall_stage）。
- plan.md task-07 / Wave 2 依赖链：task-06（types 加 has_module）→ task-07（page）→ task-08（测试+部署）。
- 现状（`page.tsx`）：`IMPLEMENT_STAGE="实施阶段"`（:111）；`expandRender`（:504-557）内 `if (node.overall_stage === IMPLEMENT_STAGE)` 走 `ModuleLevelTable`（三级），否则走 `DetailLevelTable`（二级）。
- task-06 已在 `PsPlanNode` 加 `has_module: boolean`，本任务可直接 `node.has_module`。

## 3. 实现

修改 `frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx` 的 `expandRender`（:504）：

- 将 `if (node.overall_stage === IMPLEMENT_STAGE)` 改为 `if (node.has_module)`（即 `node.has_module === true`，字段为 boolean 直接真值判断）。
- `ModuleLevelTable` 分支（has_module=true）→ 三级模块层；`DetailLevelTable` 分支（has_module=false）→ 二级明细层，两分支其余 props 不动。
- `IMPLEMENT_STAGE` 常量（:111）若改为无引用：保留（其他逻辑如 `openDetail`/drawer `overallStage` 仍可能用阶段串），仅移除 expandRender 内的判定用途；若确认全文件无其它引用再一并删除常量（保守起见保留）。

## 4. 验收

| # | 标准 |
|---|---|
| AC-01 | `has_module===true` 里程碑 → 三级 `ModuleLevelTable`（模块层）。 |
| AC-02 | `has_module===false` 里程碑 → 二级 `DetailLevelTable`（明细层）。 |
| AC-03 | `cd frontend && pnpm exec tsc --noEmit` 无错误。 |
| AC-04 | `cd frontend && pnpm lint` 无新增 error。 |

## 5. 约束

- 只改 expandRender 内模块层判断条件（`overall_stage === IMPLEMENT_STAGE` → `has_module`），不动 props、不动 drawer/openDetail 逻辑。
- R-02 定案（plan.md）：现有 `overall_stage="实施阶段"` 但 `has_module=false`（手动建）的里程碑 → 回落到二级展示，接受（项目未上线可重置，migration 不回填）。
- `IMPLEMENT_STAGE` 常量保留，不扩散删除（避免触碰其它阶段判定）。

## 6. 验证命令

```bash
cd frontend && pnpm exec tsc --noEmit
cd frontend && pnpm lint
```

## 7. 完成定义

- [ ] expandRender 模块层判断改为 `node.has_module`。
- [ ] tsc --noEmit 过。
- [ ] pnpm lint 无新增 error。
