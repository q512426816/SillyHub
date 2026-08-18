---
id: task-07
title: file-preview-dispatch
title_zh: 文件预览组件——代码高亮 / Markdown / 图片 / 二进制元信息卡 + 下载
author: qinyi
created_at: 2026-08-18 12:39:45
priority: P0
depends_on: [task-05]
blocks: [task-08]
requirement_ids: [FR-02, FR-03]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/components/explorer/file-preview.tsx
  - frontend/src/components/explorer/__tests__/file-preview.test.tsx
provides:
  - contract: FilePreview
    fields: [workspaceId, filePath]
expects_from:
  task-05:
    - contract: explorer-lib
      needs: [fetchFile, fetchDownload]
goal: >
  右侧预览组件（FR-02/FR-03，D-004@v1）——按文件类型分发渲染：代码高亮、Markdown 复用 MarkdownText、图片经鉴权 Blob 内联、二进制与截断走元信息卡，任意文件可下载。
implementation:
  - props 为 workspaceId 与 filePath（供 task-08 页面装配消费）；filePath 变化重新拉 useExplorerFile，加载中 Spin、失败中文红条透传 ApiError message、空路径占位提示
  - 代码类扩展名映射 Prism 语言用 react-syntax-highlighter 渲染（dynamic import 加 ssr:false 防打包膨胀，未识别扩展名按纯文本）；md/markdown 复用 MarkdownText（size 用 reading，不复制其实现）
  - 图片扩展名（png/jpg/jpeg/gif/webp/svg/bmp/ico）——fetchDownload 取 Blob 转 objectURL 渲染 img（照 file-image.tsx 先例），卸载或换文件时 revokeObjectURL 防泄漏
  - binary 为 true 或二进制类扩展名——元信息卡展示名称/大小/mtime 与二进制提示；truncated 为 true（超 10MB 截断，D-004）时预览区顶部警示条说明已截断并引导下载看全量
  - 下载按钮全类型可用——fetchDownload 取 Blob 转 objectURL 触发 a download 点击后 revoke（照 lib/file/api.ts 的 downloadFile 先例），文件名取路径 basename，按钮 loading 态防重复点击
acceptance:
  - 代码/Markdown/图片/二进制四类分发、truncated 警示、下载按钮行为均有测试用例
  - 图片与下载全走 fetch 带 Bearer 取 Blob 转 objectURL，组件内无裸 URL 引用（design R-06）
  - 切换 filePath 与卸载时 objectURL 均 revoke，无泄漏路径
verify: cd frontend 后 pnpm vitest run explorer，再 pnpm exec tsc --noEmit
constraints:
  - react-syntax-highlighter 必须 dynamic import 加 ssr:false；语言映射按扩展名收敛到 Prism 支持列表，未识别按纯文本渲染不报错
  - MarkdownText 直接复用（sanitize 已内建）不得另起渲染管线；下载与图片禁裸 URL（design R-06）
  - 组件测试落 explorer/__tests__/ 目录惯例，vi.mock 掉 lib/explorer 与 react-syntax-highlighter（jsdom 不做真实高亮，断言分发分支）；遵循设计系统（antd 6、中文文案）
related_tests: file-preview.test.tsx——分发矩阵/truncated 警示/下载触发/objectURL revoke，全 mock explorer-lib
---
