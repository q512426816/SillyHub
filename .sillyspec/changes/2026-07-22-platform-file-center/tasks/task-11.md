---
id: task-11
title: 问题附件接入
title_zh: PPM 问题附件接入（problem-list 表单 FileUpload + problem-detail FileViewer）
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P0
depends_on: [task-08, task-09]
blocks: [task-15]
requirement_ids: [FR-9]
decision_ids: [D-006]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/problem-list/_forms.tsx
  - frontend/src/app/(dashboard)/ppm/_components/problem-detail-modal.tsx
goal: >
  问题子域接入文件中心：新建/编辑表单用 FileUpload（file_urls 存文件 id），详情弹窗用 FileViewer 只读预览。
expects_from:
  task-08:
    - contract: FileUpload
      needs: [value, onChange]
  task-09:
    - contract: FileViewer
      needs: [fileIds]
implementation:
  - problem-list/_forms.tsx：把已有 PpmFileUrls 替换为 FileUpload（value=file_urls/onChange，编辑传 owner_type=ppm_problem+owner_id，新建仅 owner_type）
  - problem-detail-modal.tsx：详情用 FileViewer（fileIds=file_urls）只读预览
  - file_urls 存值从 URL 改为文件 id（string[] 类型不变）
acceptance:
  - 问题新建/编辑可上传/删除附件，保存后 file_urls 存文件 id
  - 问题详情正确回显图片缩略图/文件下载
verify:
  - cd frontend && pnpm typecheck
constraints:
  - 不改后端 problem schema/service（file_urls 透传不变，D-006）
  - file_urls 字段类型 string[] 不变，仅存值语义变更
  - 编辑场景传 owner_id，新建仅 owner_type（D-008）
---
