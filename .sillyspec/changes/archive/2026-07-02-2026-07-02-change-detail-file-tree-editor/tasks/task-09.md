---
author: qinyi
created_at: 2026-07-02 11:01:00
change: 2026-07-02-change-detail-file-tree-editor
task_id: task-09
title: lib/change-files.ts API 封装 + buildChangeFileTree
priority: P0
depends_on: [task-08]
requirement_ids: [FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09]
decision_ids: []
allowed_paths:
  - frontend/src/lib/change-files.ts
  - frontend/src/lib/scan-docs-tree.ts
---

# task-09 — lib/change-files.ts API 封装 + buildChangeFileTree

## goal
新建 `frontend/src/lib/change-files.ts`：封装变更目录文件读写 4 端点（task-08 契约，design §7）+ 适配 `scan-docs-tree.ts` buildTree 范式产出 `buildChangeFileTree`。供 task-10 组件消费。

## implementation
1. **类型**（对齐后端 schema，design §7）：
   - `ChangeFileEntry{path,name,size,last_modified_at,is_text}`、`ChangeFileList{change_id,items}`
   - `ChangeFileContent{path,content,exists}`
   - `ChangeFileWriteRequest{path,content}`、`ChangeFileWriteResponse{status:'done'|'pending',task_id?:string|null}`
   - `PendingFileEntry{path,status:'pending'|'claimed',created_at}`、`PendingFileList{items}`
2. **API 函数**（均经 `apiFetch` from `./api`，路径 `/api/workspaces/${wid}/changes/${cid}/files...`，范式照搬 `scan-docs.ts` listScanDocs/getScanDoc）：
   - `listChangeFiles(wid,cid)` → GET `/files`
   - `getChangeFileContent(wid,cid,path)` → GET `/files/content?path=${encodeURIComponent(path)}`
   - `saveChangeFileContent(wid,cid,path,content)` → POST `/files/content` body `{path,content}`，返 `ChangeFileWriteResponse`
   - `listPendingChangeFiles(wid,cid)` → GET `/files/pending`
3. **`buildChangeFileTree(items: ChangeFileEntry[])`**：复用 `scan-docs-tree.ts` buildTree 算法（root 节点 + split('/') 逐段建树 + 目录优先排序），输入是扁平相对 path 清单（如 `tasks/task-01.md`，**无前导包裹段**，直接 split）。导出 `ChangeFileTreeNode{name,path,entry?:ChangeFileEntry,children:ChangeFileTreeNode[]}`。排序：children 先目录后文件（`entry===undefined` 优先），同类 `name.localeCompare`。

## 验收标准
- 类型与后端 §7 schema 字段名/可空性逐一对齐。
- 4 函数全部走 `apiFetch`（不裸 fetch），错误以 `ApiError` 抛出。
- `buildChangeFileTree` 纯函数：空数组→`[]`；嵌套 path 正确建树；目录排在文件前。

## verify
- `cd frontend && pnpm exec tsc --noEmit`（类型零错）。
- vitest 单测 `buildChangeFileTree`：扁平清单（含 `tasks/task-01.md`、`design.md`、`references/x.md`）→ 树结构断言（层级 + 排序 + entry 挂叶节点）。

## constraints
- 不裸 fetch（统一 `apiFetch`）；不引入新依赖。
- `buildChangeFileTree` 抽纯函数（无 IO），便于单测；不直接复用 `TreeNode`（语义不同，独立 `ChangeFileTreeNode`）。
- 日期/uuid 字段用 `string`（前端惯例，对齐 `changes.ts`），不引 Date/uuid 类型。
