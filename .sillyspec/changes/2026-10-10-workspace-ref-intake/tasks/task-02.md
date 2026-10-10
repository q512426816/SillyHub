---
id: task-02
title: 'add-file-preview-line-numbers-selection-menu'
title_zh: 'FilePreview 行号与选区右键入口'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 13:48:40
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04, FR-05]
decision_ids: [D-002, D-006, D-007]
allowed_paths:
  - frontend/src/components/explorer/file-preview.tsx
  - frontend/src/components/explorer/__tests__/file-preview.test.tsx
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
provides:
  - contract: FilePreviewOnAddSelectionRef
    fields: [desc]
expects_from:
  task-01:
    - contract: WsRefDesc
      needs: [kind, workspaceId, path, name, lines]
related_tests:
  - frontend/src/components/explorer/__tests__/file-preview.test.tsx（既有 pre 结构断言因纯文本分支行结构重构失效需同步，计划审查 P2 建议落卡）
goal: FilePreview 代码与纯文本分支加行号与选中行右键入口，把选区行范围组装为代码块引用描述符回调上层，是选区引用功能的前置交互面。
implementation:
  - 代码分支（frontend/src/components/explorer/file-preview.tsx:436-445）SyntaxHighlighter 开 showLineNumbers，lineNumberStyle 对齐 oneDark 与 fontSize 12 观感（R-03）
  - 纯文本分支（frontend/src/components/explorer/file-preview.tsx:446-453）由裸 pre 重构为行号槽加内容行结构——行号列不可选中，内容行挂 data-line，保留 whitespace-pre 与横向滚动语义
  - 新增 selectionLineRange——按选区起止行元素 data-line 取 min-max（反向选区免疫、不做文本匹配，R-04）；contextmenu 仅代码/纯文本分支且选区非空才拦截（D-006）
  - 新增可选 prop onAddSelectionRef——菜单单项「添加选中内容到会话输入框（名称:起始行-结束行）」点击组装 kind=code 的 WsRefDesc 回调；菜单为本文件内联实现（fixed 定位加 document 级关闭加视口 clamp，看板 kanban-task-context-menu.tsx:29-47 同模式，不依赖 task-03 并行新建的组件）
  - 扩展测试——行号渲染、选中行右键回调 desc 行号正确、反向与跨行选区、无选区不拦截、未传回调零行为差异、.md 图片 PDF 二进制分支零改动；同步修复既有 pre 结构断言
acceptance:
  - 代码与纯文本分支渲染行号且行号列不可选中；.md/图片/PDF/二进制分支渲染与现状逐字一致（D-002）
  - 选中行右键回调 desc 的 lines 为起止行元素实际文档位置（反选取 min-max）；无选区或未传 onAddSelectionRef 时右键为浏览器默认菜单
verify:
  - cd frontend && pnpm exec vitest run src/components/explorer/__tests__/file-preview.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 选区功能仅覆盖代码/纯文本分支——.md 富文本/图片/PDF/二进制与原生预览态零改动（D-002 显式接受边界）
  - 行号换算按行元素实际文档位置（data-line）不做文本匹配；选区锚点只落内容区
  - 未传 onAddSelectionRef 的消费方（explorer 页）行为与现状一致；品牌色 brand-* 语义阶，文案中文
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
