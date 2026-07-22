---
id: task-10
title: 前端组件测试
title_zh: 前端组件测试（FileUpload / FileViewer / api mock）
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P1
depends_on: [task-08, task-09]
blocks: []
requirement_ids: [NFR-4]
decision_ids: []
allowed_paths:
  - frontend/src/components/file-upload.test.tsx
  - frontend/src/components/file-viewer.test.tsx
  - frontend/src/lib/file/api.test.ts
goal: >
  为 FileUpload / FileViewer / lib/file/api 补组件测试，mock 文件 API，处理 antd 动态组件 jsdom 问题。
implementation:
  - file-upload.test.tsx：mock uploadFile/fetchFileMetaBatch，验证受控 value/onChange、上传成功追加 id、删除过滤
  - file-viewer.test.tsx：mock fetchFileMetaBatch/getFileDownloadUrl，验证图片缩略图与非图片下载链接渲染
  - api.test.ts：mock XHR/fetch，验证 uploadFile 进度与 401 refresh 重试
  - antd 动态组件 jsdom 处理（参考 frontend-markdown-text-jsdom-null 经验，按需 vi.mock 纯渲染）
acceptance:
  - 三个测试文件全绿
  - 受控交互、进度、401 重试、图片/文件渲染均有断言
verify:
  - cd frontend && pnpm test src/components/file-upload.test.tsx
  - cd frontend && pnpm test src/components/file-viewer.test.tsx
  - cd frontend && pnpm test src/lib/file/api.test.ts
constraints:
  - 测试逻辑本身有误才改测试
  - mock api，不发真实网络请求
  - antd 动态组件在 jsdom 下可能 null，用 vi.mock 纯渲染
---
