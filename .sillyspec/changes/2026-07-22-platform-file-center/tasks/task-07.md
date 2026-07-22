---
id: task-07
title: lib/file/api
title_zh: 前端文件 API 封装（uploadFile XHR + 401 refresh / fetchFileMetaBatch / getFileDownloadUrl）
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P0
depends_on: [task-05]
blocks: [task-08, task-09]
requirement_ids: [FR-1, FR-3]
decision_ids: []
allowed_paths:
  - frontend/src/lib/file/api.ts
goal: >
  封装前端文件 API：uploadFile 走 XHR（支持上传进度 + 401 refresh 重试）、fetchFileMetaBatch、getFileDownloadUrl。
expects_from:
  task-05:
    - contract: FileUploadResp
      needs: [id, original_name, mime_type, size]
provides:
  - contract: FileFrontendApi
    fields: [uploadFile, fetchFileMetaBatch, getFileDownloadUrl]
implementation:
  - uploadFile(file, {owner_type, owner_id, onProgress})：XHR POST /api/file/upload（multipart），onProgress 回调进度
  - uploadFile 内 401 拦截 → refresh token → 重试一次（不走 apiFetch，因 fetch 无原生上传进度）
  - fetchFileMetaBatch(ids)：POST /api/file/batch-meta，返回 FileMetaResp[]（走带 401 refresh 的 apiFetch）
  - getFileDownloadUrl(id)：返回 /api/file/{id} 直链（供 FileViewer 下载/预览）
acceptance:
  - uploadFile 返回 {id, original_name, mime_type, size} 并支持 onProgress 进度回调
  - 401 时自动 refresh 并重试，不静默失败
  - 三个函数齐全且类型化
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm exec tsc --noEmit src/lib/file/api.ts
constraints:
  - 401 处理在 uploadFile 内单独实现（XHR），不复用 apiFetch（fetch 无进度）
  - 跨平台：URL 拼接不依赖浏览器特有 API
  - 不在本任务写组件（组件在 task-08/09）
---
