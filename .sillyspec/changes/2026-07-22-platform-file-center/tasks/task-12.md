---
id: task-12
title: 任务附件接入
title_zh: PPM 任务计划附件接入（task-plans 创建/编辑 FileUpload + task-detail FileViewer + 跨天填报）
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P0
depends_on: [task-08, task-09]
blocks: [task-15]
requirement_ids: [FR-9]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/task-plans/page.tsx
  - frontend/src/app/(dashboard)/ppm/_components/task-detail-modal.tsx
goal: >
  任务计划子域接入：创建/编辑弹窗用 FileUpload，任务详情用 FileViewer，跨天填报支持挂附件。
expects_from:
  task-08:
    - contract: FileUpload
      needs: [value, onChange]
  task-09:
    - contract: FileViewer
      needs: [fileIds]
implementation:
  - task-plans/page.tsx：创建/编辑表单接入 FileUpload（value=file_urls/onChange，owner_type=ppm_task，编辑传 owner_id）
  - task-detail-modal.tsx：详情用 FileViewer 只读预览 file_urls
  - 跨天填报区域可挂附件（FileUpload）
acceptance:
  - 任务创建/编辑可上传附件，保存后 file_urls 存文件 id
  - 任务详情与跨天填报附件正确回显
verify:
  - cd frontend && pnpm typecheck
constraints:
  - 不改后端 plan_task schema/service（file_urls 透传不变）
  - file_urls 类型不变，值语义为文件 id
  - 跨天填报附件归属 owner_type 按实际填报对象填
---
