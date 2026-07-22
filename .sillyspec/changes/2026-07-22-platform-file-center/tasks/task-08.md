---
id: task-08
title: FileUpload 组件
title_zh: 通用文件上传组件（antd Upload.customRequest + 进度 + 回显 + 删除）
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P0
depends_on: [task-07]
blocks: [task-10, task-11, task-12, task-13, task-14]
requirement_ids: [FR-6, FR-8]
decision_ids: []
allowed_paths:
  - frontend/src/components/file-upload.tsx
goal: >
  实现受控 FileUpload 组件（value=fileIds[]/onChange），antd Upload.customRequest 调 uploadFile，支持 accept、进度、batch-meta 回显、单项删除。
expects_from:
  task-07:
    - contract: FileFrontendApi
      needs: [uploadFile, fetchFileMetaBatch]
provides:
  - contract: FileUpload
    fields: [value, onChange, accept, owner_type, owner_id, disabled]
implementation:
  - 受控 props：value(string[])、onChange(ids)、accept('image'|'file'|'all')、owner_type?、owner_id?、disabled?
  - antd Upload + customRequest 调 uploadFile（透传 onProgress），成功 onChange 追加 file id
  - 已上传列表用 fetchFileMetaBatch 回显文件名/类型/大小
  - 图片项显示缩略图、文件项显示类型图标；每项可删除（onChange 过滤）
  - 编辑场景传 owner_type+owner_id，新建场景仅传 owner_type（owner_id 按 D-008 暂空）
acceptance:
  - 受控 value/onChange 工作，上传成功追加 id、删除过滤 id
  - 上传进度可见，401 自动重试不丢
  - accept=image 时仅接图片，已上传项正确回显
verify:
  - cd frontend && pnpm typecheck
constraints:
  - 样式参考前端设计系统总纲（prototype-frontend-style-system.html）
  - 不改 file_urls 字段类型（string[] 不变，值语义为文件 id）
  - 组件测试在 task-10
---
