---
id: task-05
title: 'add-precipitate-dialog-manual-tab-and-entry-editor'
title_zh: '前端沉淀弹层手工 tab + entry-editor 编辑态 + 权限渲染 + lib/knowledge.ts 写侧 API 封装'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-17 10:44:49
priority: P0
depends_on: ['task-03', 'task-04']
blocks: ['task-06', 'task-08']
requirement_ids: [FR-02, FR-07]
decision_ids: [D-001@v1, D-006@v1]
expects_from:
  - contract: KnowledgeProposeIn
    needs: [title, category, body, tags]
  - contract: KnowledgeUpdateIn
    needs: [content]
  - contract: KnowledgeEntryRead
    needs: [zone, filename]
related_tests:
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
allowed_paths:
  - NEW:frontend/src/components/knowledge/precipitate-dialog.tsx
  - NEW:frontend/src/components/knowledge/entry-editor.tsx
  - frontend/src/lib/knowledge.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
  - NEW:frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx
  - NEW:frontend/src/components/knowledge/__tests__/entry-editor.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
target_files:
  - NEW:frontend/src/components/knowledge/precipitate-dialog.tsx
  - NEW:frontend/src/components/knowledge/entry-editor.tsx
  - frontend/src/lib/knowledge.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
  - NEW:frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx
  - NEW:frontend/src/components/knowledge/__tests__/entry-editor.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
goal: >
  在知识库页新增「沉淀知识」弹层（双 tab 骨架 + 手工录入 tab 表单调 propose）与条目编辑态
  （Markdown textarea 保存/取消），写入口仅 KNOWLEDGE_WRITE 持有者可见，lib/knowledge.ts
  同步封装写侧 API，兑现 FR-02 手工录入候选与 FR-07 全层编辑（decisions 只读由归档流程维护）的前端侧。
implementation:
  - lib/knowledge.ts 增 proposeKnowledge（POST propose，入参 KnowledgeProposeIn）与 updateKnowledge（PATCH entries 编辑，入参 KnowledgeUpdateIn，响应复用 KnowledgeEntryRead）两封装，走 apiFetch（method/json，写请求显式 timeoutMs 与 lib/daemon/sessions.ts 先例一致）；filename 含子目录段时按 / 分段 encodeURIComponent 拼接不整串编码（decisions/daemon.md 类键）
  - 新建 precipitate-dialog.tsx 对照原型 precipitateModal——antd Tabs 双 tab 骨架（从记录提炼/手工录入），本 task 只实现手工录入 tab（标题必填、分类下拉 Conventions/Patterns/Known Issues/未分类、正文必填 Markdown textarea、hint 文案照原型），「从记录提炼」tab 渲染占位说明由 task-08 补实现
  - 手工录入提交调 proposeKnowledge，成功后关弹层、toast 已存为候选知识并刷新列表使条目出现在待审核区（复用 task-03 zone 分组树的列表刷新入口）
  - 新建 entry-editor.tsx 编辑态——原文 Markdown textarea + 保存/取消；保存调 updateKnowledge 成功后回显新正文并刷新列表；编辑对象仅正文，frontmatter 不动（由后端保存时保持原样，前端不提供 frontmatter 编辑）
  - page.tsx 头部挂「沉淀知识」按钮、内容区挂「编辑」入口（原型 ✦/✎ 位）；写入口可见性用既有权限判断实名写法——useSession((s) => s.user?.permissions) 加 is_platform_admin 短路（runtime 页 93-94 行先例）判含 knowledge:write 才渲染；decisions zone 条目不渲染编辑按钮并标注「由归档流程维护 · 只读」（D-006）
  - 样式走 AI-Native 双主题（brand-* 语义阶 + 主题 token），弹层与表单文案全中文
  - 新增 __tests__/precipitate-dialog.test.tsx 与 __tests__/entry-editor.test.tsx——覆盖必填缺省禁用提交、分类默认值、保存成功/失败分支、编辑取消不落盘
  - knowledge-page.test.tsx 补权限两态断言（持有 knowledge:write 见沉淀与编辑入口、未持有全不可见）与 decisions 只读标注断言
acceptance:
  - KNOWLEDGE_WRITE 持有者可见「沉淀知识」与「编辑」入口；未持有者两入口均不渲染，页面行为与现状一致（brownfield 兼容）
  - 手工录入填齐标题与正文提交后待审核区立即出现新候选；未填齐时「存为候选知识」按钮禁用
  - top/generated/proposed 条目编辑保存后正文更新且 frontmatter 保持不动；decisions 条目无编辑按钮且有「由归档流程维护 · 只读」标注
  - propose/update 的请求与响应类型全部来自 api-types 再生成果（task-04 产物），无手写 DTO
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/knowledge/__tests__/precipitate-dialog.test.tsx src/components/knowledge/__tests__/entry-editor.test.tsx
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx"
constraints:
  - 只消费 task-04 已交付端点不改后端；「从记录提炼」tab 仅占位不实现派发（属 task-08）
  - 不做 merge/reject 弹层与拒绝流（属 task-06）；不重构 task-03 的 zone 分组树只挂载入口
  - 类型禁手写；品牌色只用 brand-* 语义阶（多主题铁律），blue-* 阶仅限真信息蓝
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
