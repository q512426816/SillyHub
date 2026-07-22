---
id: task-13
title: 任务执行附件接入
title_zh: PPM 任务执行附件接入（task-execute attach_group_id / check_attach_group_id）
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P0
depends_on: [task-08, task-09]
blocks: [task-15]
requirement_ids: [FR-9]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/task-execute/page.tsx
goal: >
  任务执行页接入：交付物（attach_group_id）用 FileUpload 上传，验证（check_attach_group_id）用 FileViewer 只读预览。
expects_from:
  task-08:
    - contract: FileUpload
      needs: [value, onChange]
  task-09:
    - contract: FileViewer
      needs: [fileIds]
implementation:
  - task-execute/page.tsx：attach_group_id 区域接 FileUpload（交付物上传，owner_type=ppm_task_execute）
  - check_attach_group_id 区域接 FileViewer（验证附件只读预览）
  - file_urls 存值改为文件 id（类型不变）
acceptance:
  - 执行页交付物可上传/删除附件
  - 验证区附件只读回显正确
verify:
  - cd frontend && pnpm typecheck
constraints:
  - 不改后端 task_execute schema/service（file_urls 透传不变）
  - file_urls 类型不变，值语义为文件 id
  - 交付物上传传 owner_type，已有记录时传 owner_id
---
