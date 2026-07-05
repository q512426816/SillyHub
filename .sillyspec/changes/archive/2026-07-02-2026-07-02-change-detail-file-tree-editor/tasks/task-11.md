---
author: qinyi
created_at: 2026-07-02 11:01:00
change: 2026-07-02-change-detail-file-tree-editor
task_id: task-11
title: [cid]/page.tsx 删文档完整性 panel + DOC_TABS 查看器 + 死代码、接入 ChangeFileTree；changes/page.tsx 删生命周期 SectionCard
priority: P0
depends_on: [task-10]
wave: W5
requirement_ids: [FR-01, FR-02]
decision_ids: [D-008@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
---

# task-11 — 详情页删 A+B + 死代码接入文件树，列表页删生命周期图

## 目标
D-008@v1：详情页删「文档完整性」panel（A）+ DOC_TABS 只读查看器（B），原位接 `<ChangeFileTree>`；清理所有关联死代码；列表页删「变更生命周期」SectionCard。

## 依据
- design.md §5 Phase4（line 80-92 删除清单 D-008）、§6 影响表（line 110-111）、line 14/21-22（A+B 越权/失效根因）。
- plan.md line 44/67 task-11、覆盖矩阵 line 102 D-008@v1→task-08/11/12。
- 现状核实：[cid]/page.tsx 文档完整性 section 828-914、DOC_TABS 查看器 916-993、常量 123-179、state matrix/activeDoc/docContent/loadingDoc 185-188、handleDocSelect 256-272、docExistsMap 337、matrix 自动刷新 effect 485-502、import 20-21；changes/page.tsx 生命周期 SectionCard 341-361。
- task-10 契约：`<ChangeFileTree workspaceId changeId lastSyncedAt? daemonOnline />`（lastSyncedAt 可 undefined）。

## 实现要点
- [cid]/page.tsx 删：文档完整性 section（828-914）、DOC_TABS 查看器（916-993），原位替换为 `<ChangeFileTree workspaceId={workspaceId} changeId={changeId} lastSyncedAt={undefined} daemonOnline={??} />`。
- daemonOnline 来源：从已加载 runtime（`listDaemonRuntimes` 或 bound runtime status）推导；若 [cid] 页未持有 runtime 信息，可暂取 `!!runtime?.online` 或 task-10 兜底（lastSyncedAt undefined 不硬阻）。
- 死代码清理：`DOC_TABS`/`DOC_LABELS`/`REQUIRED_DOCS`/`OPTIONAL_DOCS` 常量；state `matrix`/`activeDoc`/`docContent`/`loadingDoc`；`handleDocSelect`；`docExistsMap`；matrix 自动刷新 effect（485-502）；`getChangeDocuments`/`getChangeDocumentContent` import 与所有调用点（effect 237/476/579 fetch、handleDocSelect、auto-refresh effect）。
- 保留 `COMPONENT_EMOJI`/`getComponentEmoji`（line 1102 agent panel 仍用，**勿删**）。
- changes/page.tsx 删 SectionCard「变更生命周期」（341-361）。

## 验收标准
- `cd frontend && pnpm exec tsc --noEmit`（删 import/常量后无悬空引用）。
- `cd frontend && pnpm exec vitest run`（现有测试不回归）。
- 手测：详情页文件树渲染、列表页生命周期图消失、其它 section（gate/agent/approval/审查记录/任务进度）完好。

## 约束
- D-008@v1：删 A+B + 全部死代码，task-12 兜底删 lib wrapper（本任务确认无前端引用即可）。
- 保留 `change` 对象（文件树需 change.change_key / changeId）；不破坏其它 section。
- lastSyncedAt 可暂传 undefined，task-10 已兜底。
- 不动 backend、不动 lib/change-files.ts（task-09/10 产物）。
