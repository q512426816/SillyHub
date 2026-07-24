---
id: task-09
title: Wire import button into problem-list page.tsx
title_zh: problem-list/page.tsx 接入「导入」按钮
author: qinyi
created_at: 2026-07-24 09:53:30
priority: P0
depends_on: [task-08]
blocks: []
requirement_ids: [FR-01, FR-12]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/problem-list/page.tsx
provides: []
expects_from:
  task-08:
    - contract: ImportProblemModal
      needs: []
goal: >
  在问题清单页顶部「导出」旁加「导入」按钮，打开 ImportProblemModal，
  成功后刷新列表。
implementation:
  - page.tsx 顶部按钮行「导出」按钮旁加「导入」Button
  - 加 importOpen state，点击设 true
  - 渲染 <ImportProblemModal open={importOpen} onClose={...} onSuccess={() => { setImportOpen(false); void load(); }} />
  - import ImportProblemModal from "@/components/ppm/problem/import-problem-modal"
acceptance:
  - 顶部出现「导入」按钮
  - 点击打开弹窗，关闭后不影响页面
  - 导入成功后列表刷新
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改现有导出/新建/搜索/表格逻辑
---

# TaskCard — 接入「导入」按钮

## 目标
问题清单页顶部按钮行（page.tsx 485-507 行，D-006 数据组）「导出」按钮旁加「导入」按钮，点击打开 task-08 的 `ImportProblemModal`，成功后复用页面 `load()`（121-164 行）刷新列表。依据：design.md §5 Wave2 step4、§9（仅顶部多一按钮，零回归）；plan.md task-09 覆盖 FR-01/FR-12。

## task-08 契约
`ImportProblemModal`（路径 `@/components/ppm/problem/import-problem-modal`）props：`open` / `onClose` / `onSuccess?`。模板下载、上传预览、提交、错误展示全在弹窗内自闭环，本任务只管开关 + 刷新。

## 实现步骤
1. import 区（与 `ProblemDrawer` 同区，~52-56 行）加 `import { ImportProblemModal } from "@/components/ppm/problem/import-problem-modal";`。
2. `exporting` state 旁（~111 行）加 `const [importOpen, setImportOpen] = useState(false);`。
3. 顶部按钮行「导出」按钮（486-491）之后、「+新建问题」（492-494）之前插 `<Button onClick={() => setImportOpen(true)}>导入</Button>`。
4. `ProblemDetailModal` 之后（~656 行）渲染 `<ImportProblemModal open={importOpen} onClose={() => setImportOpen(false)} onSuccess={() => { setImportOpen(false); void load(); }} />`。

## 验收
- 顶部依次：导出 / 导入 / +新建问题 | 搜索 / 重置 / 展开。
- 点击「导入」开弹窗；关闭后页面无残留、列表不跳空。
- 导入成功 → 弹窗关闭 + `load()` 刷新，新数据可见。
- `cd frontend && pnpm exec tsc --noEmit` 通过。

## 约束
- 不动导出/新建/搜索/重置/展开/查询条件/表格/分页任何现有逻辑；上传预览提交全委托给弹窗，不在本页实现。
