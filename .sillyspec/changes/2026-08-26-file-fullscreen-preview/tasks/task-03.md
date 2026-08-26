---
id: task-03
title: 'Add renderer fill mode and html previewer'
title_zh: '渲染器层 fill 适配 + HtmlPreviewer + registry html/svg/bmp/ico（含测试）'
author: 'qinyi'
created_at: 2026-08-26 20:13:49
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-06]
decision_ids: [D-005@v1]
provides:
  - contract: PreviewerProps
    fields: [fill]
  - contract: RendererKey
    fields: [html]
allowed_paths:
  - frontend/src/components/files/preview-registry.ts
  - frontend/src/components/files/previewers/index.ts
  - frontend/src/components/files/previewers/html-previewer.tsx
  - frontend/src/components/files/previewers/image-previewer.tsx
  - frontend/src/components/files/previewers/pdf-previewer.tsx
  - frontend/src/components/files/previewers/onlyoffice-previewer.tsx
  - frontend/src/components/files/previewers/docx-previewer.tsx
  - frontend/src/components/files/previewers/xlsx-previewer.tsx
  - frontend/src/components/files/previewers/markdown-previewer.tsx
  - frontend/src/components/files/__tests__/preview-registry.test.ts
  - frontend/src/components/files/__tests__/previewers-basic.test.tsx
goal: >
  为 task-04 全屏弹窗铺渲染层能力——PreviewerProps 增可选 fill（撑满容器高度）、
  六渲染器 fill 态高度适配、新增 HtmlPreviewer（iframe sandbox 渲染 HTML 原型）、
  registry 增 html/svg/bmp/ico 分发。
implementation:
  - previewers/index.ts 的 PreviewerProps 增可选 fill 字段（boolean，缺省 false）并导出 HtmlPreviewer
  - 六渲染器 fill 态高度适配——image 的 max-h-[560px] 换 max-h-full、pdf 的 h-[70vh] 换 h-full、onlyoffice 的 h-[74vh] 换 h-full、docx/xlsx/markdown 滚动容器 min-h-[420px] 在 fill 态换 h-full；非 fill 态类名保持原样
  - 新增 previewers/html-previewer.tsx——blob.text() 异步读出后经 iframe srcDoc 渲染，sandbox 取 allow-scripts allow-popups 且不设 allow-same-origin（与 change-file-tree 内联 HTML 预览同款安全策略），含 loading 态
  - preview-registry.ts 的 MIME_MAP 增 text/html 映射 html、EXT_MAP 增 html/htm 映射 html 与 svg/bmp/ico 映射 image、IMAGE_MIMES 增 image/svg+xml 与 image/bmp 与 image/x-icon，RendererKey 类型增 html
  - preview-registry.test.ts 补 html mime/ext 与 svg/bmp/ico 分发用例；previewers-basic.test.tsx 补 HtmlPreviewer sandbox/srcDoc 与 fill 类名用例
acceptance:
  - matchRenderer 对 text/html 与 .html/.htm 文件名均返回 html
  - svg/bmp/ico 经 mime 或扩展名均命中 image 渲染器
  - fill 为 true 时六渲染器根容器用 h-full 系高度类；fill 缺省或 false 时输出类名与现状逐字一致（零回归）
  - HtmlPreviewer 渲染的 iframe sandbox 属性为 allow-scripts allow-popups 且不含 allow-same-origin
verify:
  - cd frontend && pnpm test -- --run src/components/files/__tests__/preview-registry.test.ts src/components/files/__tests__/previewers-basic.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - fill 缺省 false，非 fill 态渲染输出与现状完全一致（既有弹窗入口零回归）
  - fallback-previewer 不做 fill 适配（design §5 Phase 2 取舍，不列入 allowed_paths）
  - 不改 file-preview-modal.tsx 与既有弹窗入口（fill 消费方属 task-04）
  - HtmlPreviewer 不设 allow-same-origin、零新增 npm 依赖
  - registry 既有 mime/ext 映射零改动，仅新增条目
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
