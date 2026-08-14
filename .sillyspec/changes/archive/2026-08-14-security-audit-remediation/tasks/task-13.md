---
id: task-13
title: "markdown sanitize"
title_zh: "markdown 渲染管线加 rehype-sanitize 防 XSS"
author: qinyi
created_at: 2026-08-15 01:12:00
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-13]
decision_ids: [D-006@v1]
allowed_paths:
  - frontend/src/components/ui/markdown-text.tsx
  - frontend/src/components/ui/markdown-text.test.tsx
  - frontend/src/components/change-file-tree.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx
  - frontend/package.json
  - frontend/pnpm-lock.yaml
provides: {}
expects_from: {}
goal: >
  markdown 渲染管线统一加 rehype-sanitize（默认 schema 基础放开平台 markdown 所需标签），闭合 agent 输出注入 script/img onerror 等的存储型 XSS。
implementation:
  - frontend 安装 rehype-sanitize（pnpm add rehype-sanitize，进 package.json + pnpm-lock.yaml）；核实与 @uiw/react-markdown-preview 5.x 的 rehype 插件透传方式——MarkdownPreview 支持 rehypePlugins prop，sanitize 插件置于插件数组末位（所有转换后再过滤）
  - markdown-text.tsx MarkdownPreview（:20/:97）加 rehypePlugins=[rehypeSanitize(schema)]——schema 用 defaultSchema 基础上放开平台 markdown 语法实际产出的标签（code/span/table/thead/tbody/tr/th/td/input checkbox 等，以 defaultSchema 缺哪些实测补哪些，不预放开 script/iframe/style/on* 属性）
  - 新建 markdown-text.test.tsx（组件同级，非 __tests__ 目录亦可按项目惯例）——注入用例含 script 标签、img onerror 内联事件、javascript: 链接，断言渲染输出不含这些危险节点/属性（对 dynamic ssr:false 组件用 vi.mock @uiw/react-markdown-preview 捕获 rehypePlugins 传参，或直接单测 sanitize schema 配置纯函数）
  - 排查三处 @uiw 引用——change-file-tree.tsx:21 直接 dynamic import MarkdownPreview 渲染文件预览，同样加 rehypePlugins；scan-docs 页面 page.tsx:13 同理（若该页仅渲染平台自身生成的 scan 文档、内容源可信度仍取决于 daemon 上报，按统一 sanitize 处理）；markdown.css 导入两处不受影响
  - sanitize schema 抽成可导出常量（markdown-text.tsx 内 export），三处引用点共用一份，避免漂移
  - 若 change-file-tree 既有测试 mock 了 MarkdownPreview（__tests__/change-file-tree.test.tsx:14），补 rehypePlugins 存在性断言
acceptance:
  - 含 <script>alert(1)</script> 的 markdown 渲染输出无 script 节点
  - 含 img onerror=... 与 a href=javascript:... 的输入，onerror 属性与 javascript: 协议被剥离
  - 平台正常 markdown 文档（标题/表格/代码块/任务列表/引用）渲染不受影响（快照或关键节点断言）
  - 三处 @uiw 引用点全部经 sanitize 管线，无遗漏直渲染
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - D-006@v1 范围只含 rehype-sanitize；Next.js / passlib 依赖升级独立 change 不在本卡
  - sanitize schema 只按实测需要放开标签，禁止一次性放开 defaultSchema 全部 + 全属性；input 仅 type=checkbox（GFM 任务列表）
  - 不改 COMPACT_CLASS / READING_CLASS 样式体系与 dynamic ssr:false 结构
  - R-07 风险应对——若 sanitize 后某页面文档渲染缺元素，先补 schema 白名单而非移除 sanitize；发现绕过 sanitize 的白名单页面（原型 HTML 预览类）逐一报备确认再放行
related_tests:
  - path: frontend/src/components/__tests__/change-file-tree.test.tsx
    reason: 已 mock @uiw/react-markdown-preview（:14），加 rehypePlugins 后补插件传参断言即可，mock 结构不用推翻
  - path: frontend/src/components/__tests__/agent-log-viewer.test.tsx
    reason: 注释声明不测 markdown 渲染本身（:21），经 MarkdownText 间接覆盖——sanitize 落在 MarkdownText 内则该文件无需动，执行时核实无直渲染路径
---
