---
id: task-07
title: 'markdown 渲染器（复用 MarkdownText，禁裸用 @uiw，D-006）+ 测试'
title_zh: 'markdown 渲染器（复用 MarkdownText，禁裸用 @uiw，D-006）+ 测试'
author: 'WhaleFall'
created_at: 2026-08-25 01:29:35
priority: P0
depends_on: [task-03]
blocks: [task-08]
requirement_ids: [FR-02]
decision_ids: [D-006@v1]
provides:
  - contract: PreviewerProps
    fields: [blob, url, meta]
expects_from:
  task-03:
    - contract: matchRenderer
      needs: [RendererKey]
allowed_paths:
  - frontend/src/components/files/previewers/markdown-previewer.tsx
  - frontend/src/components/files/__tests__/markdown-previewer.test.tsx
goal: >
  实现 markdown 渲染器：读取 md 文件源码后必须经 ui/markdown-text.tsx（自带
  rehype-sanitize 防线）渲染，禁止裸用 @uiw 组件直出不可信内容（D-006@v1、R-08 必修）。
implementation:
  - markdown-previewer 从 blob 取 text 源码（useEffect 加 cancelled 防护），渲染时复用 ui/markdown-text.tsx 的 MarkdownText 组件传入源码
  - 读取失败置错误态加下载引导
  - 新建 __tests__/markdown-previewer.test.tsx，断言渲染走了 MarkdownText（mock MarkdownText 或断言其渲染标记），并验证未直接 import @uiw/react-markdown-preview
acceptance:
  - md 源码经 MarkdownText 渲染（rehype-sanitize 防线生效）
  - 本卡文件未直接 import @uiw/react-markdown-preview（静态检查可验，D-006 验收项）
  - 读取失败路径有错误态与下载引导
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- markdown-previewer
  - grep -n "react-markdown-preview" frontend/src/components/files/previewers/markdown-previewer.tsx 应无匹配
constraints:
  - 禁止裸用 @uiw/react-markdown-preview 渲染用户上传内容（XSS 防线，R-08）
  - 只新增渲染器与测试两个文件，不改 ui/markdown-text.tsx
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
