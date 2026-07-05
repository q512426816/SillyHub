---
author: qinyi
created_at: 2026-07-02 10:46:07
change: 2026-07-02-change-detail-file-tree-editor
---

# Tasks

> 只列任务名 / 文件 / 覆盖 FR·D。细节（Wave 分组、依赖、步骤）在 plan 阶段展开。

## 后端

- **task-01** `_resolve_change_dir` spec_root 解析 helper — `backend/app/modules/change/service.py` — FR-03 / D-006@v1
- **task-02** `list_files` 遍历变更目录全部文件 — `backend/app/modules/change/service.py` — FR-03
- **task-03** `read_file` 按 path 读单文件 + 路径守卫 + 1MB 截断 — `backend/app/modules/change/service.py` — FR-04 / D-004@v1
- **task-04** `write_file` path_source 分流写回（server-local 直写 / daemon-client 镜像直写+入 outbox 队列）+ 同文件 pending 合并 — `backend/app/modules/change/service.py` — FR-05, FR-06 / D-001@v1, D-002@v1, D-006@v1
- **task-05** `_resync_change_docs` per-change 文档刷新 — `backend/app/modules/change/service.py` — FR-07 / D-005@v1
- **task-06** `list_pending_files` 查询 pending/claimed edit 行 — `backend/app/modules/change/service.py` — FR-08
- **task-07** 4 新 router 端点 + schema（ChangeFileList/Content/WriteRequest/WriteResponse/PendingFileList）— `backend/app/modules/change/router.py`, `backend/app/modules/change/schema.py` — FR-03~FR-08
- **task-08** 删除 `get_document_content` + `GET /documents/{doc_type}` 死代码 — `backend/app/modules/change/service.py`, `router.py` — FR-02 / D-008@v1
- **task-09** `DaemonChangeWrite` 加 `kind` 列 + migration（down→202607011300）+ schema 透传 — `backend/app/modules/daemon/model.py`, `schema.py`, `migrations/versions/` — FR-05, FR-08

## 前端

- **task-10** `lib/change-files.ts` API 封装 + `buildChangeFileTree` — `frontend/src/lib/change-files.ts` — FR-03~FR-09
- **task-11** `change-file-tree.tsx` 文件树 + 编辑器 + 保存状态机 + 排队徽标 + last_synced_at — `frontend/src/components/change-file-tree.tsx` — FR-09 / D-003@v1
- **task-12** `[cid]/page.tsx` 删文档完整性 panel + DOC_TABS 查看器 + 死代码，接入 `<ChangeFileTree>` — `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` — FR-02 / D-008@v1
- **task-13** `changes/page.tsx` 删生命周期 SectionCard — `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx` — FR-01
- **task-14** `lib/changes.ts` 删 `getChangeDocumentContent`（+ 视情况 `getChangeDocuments`）死 wrapper — `frontend/src/lib/changes.ts` — FR-02 / D-008@v1

## 测试

- **task-15** 后端 list/read/write/pending + 路径穿越 + 两分支单测 — `backend/app/modules/change/tests/test_files_router.py` — FR-03~FR-06 / D-004@v1
- **task-16** edit-kind outbox 入队 + pending 合并 + 离线续传单测 — `backend/app/modules/change/tests/test_files_router.py` — FR-06 / D-001@v1, D-002@v1
- **task-17** 前端 change-file-tree 渲染 + 状态机 + 排队徽标 + jsdom vi.mock — `frontend/src/components/__tests__/change-file-tree.test.tsx` — FR-09
