---
id: task-06
title: 'add-frontend-merge-dialog-and-reject-flow'
title_zh: '前端 merge-dialog 合并预览/确认 + 拒绝流'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-17 10:44:49
priority: P0
depends_on: ['task-05']
blocks: ['task-09']
requirement_ids: [FR-05]
decision_ids: [D-007@v1]
expects_from:
  - contract: KnowledgeMergeIn
    needs: [target_file, section_title, keywords]
  - contract: MergePreviewOut
    needs: [section_text, index_line]
related_tests:
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
allowed_paths:
  - NEW:frontend/src/components/knowledge/merge-dialog.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
  - frontend/src/lib/knowledge.ts
  - NEW:frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
target_files:
  - NEW:frontend/src/components/knowledge/merge-dialog.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
  - frontend/src/lib/knowledge.ts
  - NEW:frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx
goal: >
  在知识库页待审核区实现合并弹层（三类目标文件白名单 + 后端 dry-run 预览 + 确认合并）与拒绝二次确认流，兑现 FR-05 审核闭环的前端侧并落实 D-007 合并语义（目标白名单、关键词人工输入、409 冲突提示）。
implementation:
  - lib/knowledge.ts 增 previewMerge/mergeEntry/rejectEntry 三封装（preview-merge、merge、reject 端点，proposed 路径段按 / 分段 encodeURIComponent 拼接不整串编码），类型取自 api-types 再生成果禁止手写
  - 新建 components/knowledge/merge-dialog.tsx 对照原型 mergeModal 三段布局——表单区、追加段落预览、INDEX 行预览
  - 表单三字段为目标文件下拉（白名单 known-issues.md/patterns.md/conventions.md 三选一，D-007）、小节标题、路由关键词人工输入（逗号或回车分隔多值，不做自动派生）
  - 表单变化即调 preview-merge，预览区等宽字体渲染后端返回的 section_text（追加 ## 小节）与 index_line（INDEX 路由行，diff 高亮追加行），前端不拼接预览文本防与 dry-run 漂移
  - 确认合并调 merge；成功 toast 后关弹层并刷新列表；409 冲突 toast 文案「文件在别处被修改，请刷新后重试」且弹层保留已填表单可重试
  - 拒绝走 antd Popconfirm 二次确认后调 reject 并刷新列表；page.tsx 待审核条目操作区挂「合并/拒绝」按钮，复用 task-05 的 KNOWLEDGE_WRITE 权限渲染口径
  - 新增 merge-dialog.test.tsx 覆盖预览渲染、合并成功与 409 分支、拒绝确认流；knowledge-page.test.tsx 补操作区断言
acceptance:
  - 待审核条目可打开合并弹层，目标文件仅三类可选且无新建文件入口，必填项未填齐时确认按钮禁用
  - 预览区内容与后端 preview 返回一致（## 小节文本 + INDEX 路由行），非前端拼接
  - 合并成功后列表刷新且候选从待审核区消失；409 时出现指定文案 toast 且表单不丢
  - 拒绝需二次确认，确认后候选从列表消失；合并/拒绝按钮仅对 KNOWLEDGE_WRITE 用户可见
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/knowledge/__tests__/merge-dialog.test.tsx
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx"
constraints:
  - 仅消费 task-04 已交付端点不改后端；两段式时序由后端保证前端单次调 merge 不拆调用
  - 样式走 AI-Native 双主题（brand-* 语义阶 + 主题 token），文案中文
  - 不做新建目标文件选项与关键词自动派生（D-007 边界）
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
