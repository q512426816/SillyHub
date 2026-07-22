---
id: task-15
title: 里程碑+废弃+文档
title_zh: 里程碑/项目计划附件接入 + 废弃 ppm-file-urls + 同步 scan 文档
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P1
depends_on: [task-11, task-12, task-13, task-14]
blocks: []
requirement_ids: [FR-9, NFR-6]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
  - frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
  - frontend/src/components/ppm-file-urls.tsx
  - .sillyspec/docs/backend/modules/ppm.md
  - .sillyspec/docs/backend/modules/file.md
goal: >
  里程碑明细/项目计划明细接入 FileUpload/FileViewer，废弃 ppm-file-urls.tsx，同步 scan 文档（ppm.md + 新增 file 模块卡）。
expects_from:
  task-08:
    - contract: FileUpload
      needs: [value, onChange]
  task-09:
    - contract: FileViewer
      needs: [fileIds]
implementation:
  - milestone-details/page.tsx：PsPlanNodeDetail 附件接 FileUpload/FileViewer
  - project-plans/page.tsx：明细附件按需接入
  - ppm-file-urls.tsx 标记废弃（确认无引用后删除或保留过渡）
  - 同步 .sillyspec/docs/backend/modules/ppm.md（file_urls 语义变更说明）
  - 新增 .sillyspec/docs/backend/modules/file.md 模块卡
acceptance:
  - 里程碑/项目计划明细可上传/预览附件
  - ppm-file-urls 无残留引用（或已删）
  - scan 文档同步 file 模块卡与 ppm file_urls 语义
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm build
constraints:
  - file_urls 字段类型不变，仅存值语义为文件 id（D-006）
  - 文档同步遵循 SillySpec 文档驱动（模块卡记录 file 表/API/抽象层）
  - 跨平台命令链（Win/Linux/macOS）
---
