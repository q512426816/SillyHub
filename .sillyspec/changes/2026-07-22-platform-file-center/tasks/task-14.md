---
id: task-14
title: 看板附件接入
title_zh: PPM 看板附件接入（create/edit dialog + task-detail drawer 三处）
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P0
depends_on: [task-08, task-09]
blocks: [task-15]
requirement_ids: [FR-9]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-create-task-dialog.tsx
  - frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-edit-task-dialog.tsx
  - frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-task-detail-drawer.tsx
goal: >
  看板子域接入：创建/编辑任务弹窗用 FileUpload（编辑弹窗暴露 file_urls），任务详情抽屉把只读 PpmFileUrls 换为 FileViewer。
expects_from:
  task-08:
    - contract: FileUpload
      needs: [value, onChange]
  task-09:
    - contract: FileViewer
      needs: [fileIds]
implementation:
  - kanban-create-task-dialog.tsx：新建表单接 FileUpload（owner_type=ppm_kanban_task）
  - kanban-edit-task-dialog.tsx：编辑表单暴露 file_urls 并接 FileUpload（传 owner_id）
  - kanban-task-detail-drawer.tsx：已有只读 PpmFileUrls 替换为 FileViewer
acceptance:
  - 看板任务创建/编辑可上传附件，编辑回显已存附件
  - 任务详情抽屉只读预览图片/文件
verify:
  - cd frontend && pnpm typecheck
constraints:
  - 编辑弹窗表单需暴露 file_urls 字段（当前可能未暴露，按需补）
  - 不改后端 kanban schema/service（file_urls 透传不变）
  - file_urls 类型不变，值语义为文件 id
---
