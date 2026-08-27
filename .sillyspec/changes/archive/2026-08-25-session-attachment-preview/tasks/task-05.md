---
id: task-05
title: image-pdf-fallback-previewers
title_zh: 'image/pdf/fallback 三渲染器 + 冒烟测试'
author: 'WhaleFall'
created_at: 2026-08-25 01:29:35
priority: P0
depends_on: [task-03]
blocks: [task-08]
requirement_ids: [FR-02]
decision_ids: [D-003@v1]
provides:
  - contract: PreviewerProps
    fields: [blob, url, meta]
expects_from:
  task-03:
    - contract: matchRenderer
      needs: [RendererKey]
allowed_paths:
  - frontend/src/components/files/previewers/image-previewer.tsx
  - frontend/src/components/files/previewers/pdf-previewer.tsx
  - frontend/src/components/files/previewers/fallback-previewer.tsx
  - frontend/src/components/files/__tests__/previewers-basic.test.tsx
goal: >
  实现 image、pdf、fallback 三个渲染器组件：image 用 antd Image 居中展示可放大，
  pdf 用 iframe 内嵌 objectURL 走浏览器原生视图器（D-003@v1 零新依赖），
  fallback 对不支持格式给出说明与下载引导，三者统一消费 PreviewerProps。
implementation:
  - 约定渲染器统一 props PreviewerProps（blob、url、meta 含 name/mime/size），image-previewer 用 antd Image 渲染 url，限高居中可点击放大
  - pdf-previewer 用 iframe src 等于 url 撑满内容区，加载失败引导下载
  - fallback-previewer 渲染 FileTypeIcon、暂不支持在线预览说明、下载按钮（优先 target.download 回调，否则用 url 构造 a 标签下载 meta.name）
  - 新建 __tests__/previewers-basic.test.tsx 冒烟覆盖三渲染器渲染与 fallback 下载引导存在（jsdom 无 createObjectURL 时按 explorer 测试先例 mock）
acceptance:
  - 三个渲染器各自按 PreviewerProps 消费渲染，不互相依赖
  - pdf 走 iframe 内嵌且未引入任何 pdf 相关 npm 依赖
  - fallback 含明确说明文案与可点击下载入口，冒烟测试全绿
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- previewers-basic
constraints:
  - 只新增渲染器与测试四个文件，不改 Modal 与入口组件（后续 Wave）
  - 色值走 brand-* 与主题 token，不硬编码 hex（FRONTEND_PAGE_STYLE 0.5 铁律）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
