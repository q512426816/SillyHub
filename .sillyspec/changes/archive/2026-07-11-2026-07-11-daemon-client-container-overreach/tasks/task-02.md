---
id: task-02
title: 删除前端 archive 死代码（lib/archive.ts + 页面 handleArchive/archiving 残留）
title_zh: 删除前端 archive 死代码
author: qinyi
created_at: 2026-07-12 00:43:24
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-1.2]
decision_ids: [D-004@v2]
allowed_paths:
  - frontend/src/lib/archive.ts
  - "frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx"
---

# TaskCard — task-02 删除前端 archive 死代码

## 目标
删除前端 archive 模块死代码：整块 `frontend/src/lib/archive.ts`（`archiveChange`/`distillChange`/`ArchivedChange`，server-local 时代遗留，调用已删的 backend `/archive` `/distill` 端点）+ change 详情页里残留的 `handleArchive` 函数与 `archiving` state。归档完全归属 sillyspec stage dispatch（`/archive-confirm` + `handleTransition("archived")` 已在用，本任务不动）。

## 实现要点
真实 grep 结果（已核实，零调用者）：
- `frontend/src/lib/archive.ts` 全文 43 行，`archiveChange`/`distillChange`/`ArchivedChange` 仅在文件内部自引用，全 frontend 无 `import ... from "@/lib/archive"`，无外部调用。
- `changes/[cid]/page.tsx`：
  - `:162` `const [archiving, setArchiving] = useState(false);` —— `archiving` 仅在 `handleArchive` 内被 set，JSX 从未读取（无按钮 disabled 绑定）。
  - `:395-408` `const handleArchive = async () => { ... await handleTransition("archived"); ... setArchiving(true/false); ... }` —— 定义后**全文件无调用点**（不是 onClick/onAction 绑定），是死残留。

步骤：
1. 删除整个文件 `frontend/src/lib/archive.ts`。
2. 在 `changes/[cid]/page.tsx` 删除 `:162` 的 `[archiving, setArchiving]` state 与 `:395-408` 的 `handleArchive` 函数块（两者互为残留，一并删）。

## 验收标准
- `frontend/src/lib/archive.ts` 文件不存在。
- change 详情页 `grep -n "handleArchive\|archiving" page.tsx` 零命中（`archive` 字符串仍存在于 WORKFLOW_STAGES/STATUS_BADGE/GATE_PANELS，属正常存活语义，**不删**）。
- `cd frontend && pnpm build` 通过（TypeScript 零未使用变量 / 零悬空引用报错）。

## verify
- `cd frontend && pnpm test`（全量绿，确认无组件依赖被删符号）
- `cd frontend && pnpm build`（类型检查 + 构建通过）
- `cd frontend && grep -rn "archiveChange\|distillChange\|@/lib/archive\|ArchivedChange" src` → 零输出

## 约束
- **不动其他 lib**（仅删 `lib/archive.ts`，不碰 `lib/changes.ts` 的 `archiveConfirm`/`transitionChange`/`listArchived` —— 这些是活路径）。
- **不改后端**（backend archive 模块删归 task-01）。
- **不删 archive 存活语义**：保留 `WORKFLOW_STAGES` 里的 `"archive"`、`STATUS_BADGE.archived`、`GATE_PANELS.archive_confirm`、`archiveConfirm(...)` 调用（`:498`）、archive stage 的 `useEffect` 自动加载 archive gate（`:437-443`）—— 这些走 stage dispatch，非死代码。
- **不删 `[id]/page.tsx` 的 `archivedChanges`**（`:49/:109`）：那是 workspace 详情页统计已归档变更数，调的是 `listArchived`（活 API），与本任务无关。
- 无依赖任务（Wave 1 可独立并行）。
