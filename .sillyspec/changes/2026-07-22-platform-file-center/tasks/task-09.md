---
id: task-09
title: FileViewer 组件
title_zh: 通用文件预览组件（图片缩略图 + antd Image 放大 / 非图片图标 + 下载）
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P0
depends_on: [task-07]
blocks: [task-10, task-11, task-12, task-13, task-14]
requirement_ids: [FR-7, FR-8]
decision_ids: [D-005]
allowed_paths:
  - frontend/src/components/file-viewer.tsx
goal: >
  实现只读 FileViewer 组件（fileIds），batch-meta 取列表，图片缩略图 + antd Image 放大，非图片图标 + 下载链接，按 MIME 前端判定。
expects_from:
  task-07:
    - contract: FileFrontendApi
      needs: [fetchFileMetaBatch, getFileDownloadUrl]
provides:
  - contract: FileViewer
    fields: [fileIds]
implementation:
  - props：fileIds(string[])
  - fetchFileMetaBatch 取元数据列表，按 mime_type 前端判定图片/文件
  - 图片：缩略图网格 + antd Image.PreviewGroup 点击放大
  - 非图片：类型图标 + 文件名 + 下载链接（getFileDownloadUrl）
  - 空列表显示“暂无附件”
acceptance:
  - 图片显示缩略图且可点击放大
  - 非图片显示图标 + 下载链接
  - fileIds 为空时显示占位
verify:
  - cd frontend && pnpm typecheck
constraints:
  - 纯前端 MIME 判定，不引入服务端图像处理（D-005）
  - 样式参考前端设计系统总纲
  - 组件测试在 task-10
---
