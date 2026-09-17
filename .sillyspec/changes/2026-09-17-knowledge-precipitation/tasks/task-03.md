---
id: task-03
title: 'group-knowledge-tree-by-zone'
title_zh: '前端知识库页 zone 分组树 + 待审核徽标 + 既有 knowledge-page.test.tsx 适配'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-17 10:44:49
priority: P0
depends_on: ['task-01']
blocks: ['task-05']
requirement_ids: [FR-06]
decision_ids: [D-004@v1]
expects_from:
  - contract: KnowledgeEntryRead
    needs: [zone, filename, path, title, last_modified_at]
related_tests:
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
target_files:
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
goal: >
  知识库页左树由扁平路径分组改为按 zone 分组（待审核置顶加计数徽标、手册、决策库、自动生成），对齐 sillyspec CLI zone 口径修复展示范围缺陷；本 task 只适配读侧展示与既有测试，不含任何写操作。
implementation:
  - 树数据源改为按 entry.zone 分组且顺序固定（proposed 待审核置顶、其后 top 手册、decisions 决策库、generated 自动生成），缺 zone 的条目兜底归 top 组
  - 待审核组标题展示中文计数徽标、空组不显示徽标；zone 分组标签全中文，保持目录初始全展开与点击收起交互
  - 保持现有 antd Tree + TreeBox + PanelResizer + MarkdownText 骨架不变，文件行仍是文件名加灰色日期，点文件仍按 filename 调 getKnowledge 拉详情
  - knowledge-page.test.tsx mock 条目补 zone 字段并改为真实 knowledge 目录样例（含 decisions/generated/proposed 子目录），树断言由扁平目录结构改为 zone 分组断言（待审核置顶加徽标计数加各组标签），并覆盖空待审核不显徽标的负例
acceptance:
  - mock 数据含四种 zone 条目时树按固定 zone 顺序分组且待审核置顶、徽标计数正确；空待审核无徽标
  - 既有展开收起、点文件拉详情与 Markdown 渲染、拖拽调宽与 localStorage 记忆用例在适配后全部通过
verify:
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx"
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不做任何写操作与写按钮入口（沉淀弹层与编辑态属 task-05）
  - 不改后端；前端类型只消费 task-01 再生成的 api-types.ts，禁止手写补 zone 类型
  - 不破坏 TreeBox 与 PanelResizer 共享组件接口
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
