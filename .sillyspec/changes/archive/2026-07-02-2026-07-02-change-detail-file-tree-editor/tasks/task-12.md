---
author: qinyi
created_at: 2026-07-02 11:01:00
change: 2026-07-02-change-detail-file-tree-editor
task: task-12
priority: P2
depends_on: [task-11]
requirement_ids: [FR-02]
decision_ids: [D-008@v1]
allowed_paths:
  - frontend/src/lib/changes.ts
---

# task-12 — 删 `lib/changes.ts` 死 wrapper

## 目标
D-008@v1 死代码清理收尾：task-11 把 `[cid]/page.tsx` 改用 `<ChangeFileTree>` 后，前端对 `getChangeDocumentContent` / `getChangeDocuments` 的引用应已清零。本 task 在 task-11 完成的基础上，删 `frontend/src/lib/changes.ts` 中已无调用方的 wrapper 与仅服务它们的类型。

## 当前引用盘点（task-11 执行前实测）
- `getChangeDocumentContent`：唯一调用方 `[cid]/page.tsx:20,264,496`（DOC_TABS 查看器 + `handleDocSelect`），均属 task-11 删除范围。
- `getChangeDocuments`：唯一调用方 `[cid]/page.tsx:21,237,476,579`（matrix 自动刷新 effect + 文档完整性面板），均属 task-11 删除范围。
- 关联类型 `ChangeDocContent`（仅 `getChangeDocumentContent` 返回值用）/ `ChangeDocMatrix` / `ChangeDocMatrixEntry`（仅 `getChangeDocuments` 返回值用）：除 `[cid]/page.tsx:30,31,185,187` 外无其它消费方。

## 执行步骤
1. **前置断言（依赖 task-11）**：全前端 `grep getChangeDocumentContent` 与 `grep getChangeDocuments` 命中应只剩 `lib/changes.ts` 定义本身（`[cid]/page.tsx` 已清）。若仍有其它调用方 → **保守保留**对应 wrapper + 类型，记录到 decisions，本 task 不强删。
2. 删 `lib/changes.ts:179-189` 的 `getChangeDocumentContent` 函数 + `51-56` 的 `ChangeDocContent` 类型。
3. 删 `lib/changes.ts:173-177` 的 `getChangeDocuments` 函数 + `36-49` 的 `ChangeDocMatrix` / `ChangeDocMatrixEntry` 类型（前提：步骤 1 确认无前端调用方）。
4. 确认文件顶部 `apiFetch` import 仍被其它导出函数使用（必然保留），无未使用 import 残留。

## 约束 / 边界
- **不删后端 endpoint**：`GET /changes/{cid}/documents` 与 `GET /changes/{cid}/documents/{doc_type}` 的删除归属 task-08（其中 `{doc_type}` 死端点）与后端决策（§9 仅删 `documents/{doc_type}`）。本 task 只动前端 wrapper，避免越界。
- D-008@v1：保守死 wrapper 清理——**有任何调用方即保留对应 wrapper**，不强行删。
- 类型删除前提：该类型仅被本次删除的 wrapper 用。若发现其它文件 import 了 `ChangeDocMatrix`/`ChangeDocContent`（如未来 hook），改为保留类型只删 wrapper。

## 验收标准
- `cd frontend && pnpm exec tsc --noEmit`：零未使用 import / 未定义引用报错。
- `grep -rn "getChangeDocumentContent\|getChangeDocuments\|ChangeDocContent\|ChangeDocMatrix" frontend/src`：除 task-08 后端无关外，前端无孤儿引用（`lib/changes.ts` 定义已删，`[cid]/page.tsx` 已在 task-11 删）。
- 回归：`cd frontend && pnpm test`（无新失败）。
