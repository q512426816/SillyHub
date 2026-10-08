---
id: task-01
title: 'Create CardMarkdown shell component with unit tests'
title_zh: '新建 CardMarkdown 薄壳组件（渲染 + 表格滚动 + 字号对齐 + 表头品牌色）与单测'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-08 10:24:03
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/knowledge/card-markdown.tsx
  - frontend/src/components/knowledge/__tests__/card-markdown.test.tsx
target_files:
  - NEW:frontend/src/components/knowledge/card-markdown.tsx
  - NEW:frontend/src/components/knowledge/__tests__/card-markdown.test.tsx
provides:
  - contract: CardMarkdownProps
    fields: [content, className]
goal: >
  新建卡片场景的 markdown 渲染薄壳组件 CardMarkdown（包装既有 MarkdownText compact 档），
  集中表格横向滚动、字号对齐、表头品牌色三类卡片适配，供 task-02 的 4 处正文统一接入。
implementation:
  - 新建 frontend/src/components/knowledge/card-markdown.tsx——导出 CardMarkdownProps（content 与 className）与 CardMarkdown 组件，内部委托 frontend/src/components/ui/markdown-text.tsx 的 MarkdownText（size 为 compact），空 content 返回 null
  - 外层容器类做三类适配——overflow-x-auto（宽表格横向滚动不撑破卡片）、表格字号对齐 11.5px（任意值选择器对齐 markdown-text.tsx COMPACT_CLASS 写法）、表头 brand-50 底与 brand-700 字（brand 语义阶，禁硬编码 hex）
  - 新建 __tests__/card-markdown.test.tsx——覆盖 md 元素渲染（表格、列表、加粗、行内 code）、空内容返回 null、className 透传合并；jsdom 下 next dynamic 的渲染问题沿用 frontend/src/components/daemon/__tests__/team-task-block.test.tsx:42-50 的 vi mock 先例
acceptance:
  - card-markdown.tsx 导出 CardMarkdown 与 CardMarkdownProps，内部复用 MarkdownText 且不透传 rehypePlugins（继承统一 sanitize，见 frontend/src/components/ui/markdown-text.tsx:90-92）
  - 表格在窄容器内横向滚动（容器 overflow-x-auto），表头 brand-50 底 brand-700 字
  - 空 content 渲染为 null；className 经 cn 合并透传
  - card-markdown.test.tsx 用例全绿（含 dynamic mock）
verify:
  - cd frontend && pnpm exec vitest run src/components/knowledge/__tests__/card-markdown.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 禁止新增 npm 依赖（uiw react-markdown-preview 与 rehype-sanitize 均已在 package.json）
  - 禁止在本组件新开渲染路径或绕过 MARKDOWN_SANITIZE_SCHEMA（安全红线）
  - 色值只用 brand 语义阶类名，禁止硬编码 hex（FRONTEND_PAGE_STYLE 0.5 节）
  - 不改动 markdown-text.tsx 本体（本 task 只做包装）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->