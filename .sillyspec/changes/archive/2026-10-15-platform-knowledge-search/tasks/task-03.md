---
id: task-03
title: 'Knowledge page search UI'
title_zh: '前端知识库页搜索（搜索框/结果列表/跳转/降级提示）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 16:26:20
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-02, FR-03, FR-05]
decision_ids: [D-006@v1]
allowed_paths:
  - frontend/src/lib/knowledge.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
target_files:
  - frontend/src/lib/knowledge.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
expects_from:
  task-02:
    - contract: KnowledgeSearchOut
      needs: [ok, results, model_ready, reason]
    - contract: KnowledgeSearchResultItem
      needs: [spec_path, kind, title, anchor, snippet, score]
goal: >
  知识库页左栏新增搜索框与结果面板：输入（debounce 300ms）触发后端搜索，结果列表替换文件树，
  条目含来源徽章/标题/路径/片段高亮/匹配度；点击 knowledge 类结果经 URL 深链就地定位、
  docs 类结果跳模块文档页；语义模型降级时显示提示条。含「同 key 重选边界」对策。
implementation:
  - frontend/src/lib/knowledge.ts：新增 searchKnowledge(workspaceId, {query, limit}) → apiFetch POST `/api/workspaces/${workspaceId}/knowledge/search`（{method:"POST", json:input, timeoutMs: 120_000}，首查含索引构建；注释放明理由）；导出类型别名 KnowledgeSearchOut/KnowledgeSearchResultItem（从 api-types.ts 生成物 components["schemas"] 取）
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx：左栏 pane-title 下新增搜索框（antd Input 前缀放大镜 + 清除按钮，placeholder「搜索知识、需求、决策、模块文档…」）；debounce 300ms（对齐 scan-docs/page.tsx:297-305 形态）；状态 searchQuery/debouncedQuery/results/searching/modelReady/degradedReason
  - 结果列表：debouncedQuery 非空时替换文件树（同一列表位两种视图，空查询回树）；条目 = kind 徽章（kind→中文映射：decision=决策/fr=需求/proposed=待审核/generated=自动生成/knowledge=知识/module=模块文档/scan=扫描/flow=流程/glossary=术语）+ 标题 + spec_path + 片段（query 词面子串 `<mark>` 高亮，brand 阶）+ 匹配度小数（toFixed(2)）；空结果空态提示；请求失败错误态 + 重试
  - 点击跳转（URL 深链驱动，design.md Phase 3 / D-006@v1）：knowledge 前缀 → relative = spec_path.slice("knowledge/".length)，router.push(`/workspaces/${workspaceId}/knowledge?file=${encodeURIComponent(relative)}&anchor=${encodeURIComponent(anchor ?? "")}`)；**同 key 重选边界**：push 前比对当前 searchParams 的 file/anchor 与目标值，全等时直调 selectEntry(relative, anchor)（防 URL 未变→deepLink effect 不触发）；docs 前缀 → router.push(`/workspaces/${workspaceId}/scan-docs?path=${encodeURIComponent(spec_path)}`)
  - 降级提示条：model_ready === false 时搜索框下方黄色提示条「语义模型暂不可用，当前为关键词匹配结果」（对齐 themes token 的 warning 语义色）
  - 配测试 frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx（扩展）：输入→结果列表替换树→清除还原；点击 knowledge 结果触发 router.push 深链 URL；同 key 重选场景（URL 已等值时直调 selectEntry——mock useSearchParams 返回同值）；docs 结果 router.push scan-docs?path=；降级提示条渲染；搜索请求失败错误态
acceptance:
  - 输入「会话状态点」类 query → 结果列表渲染（替换树），条目字段与契约一致
  - 点击 knowledge 类结果 → URL 变 ?file=&anchor=（旧 push 通路）且右栏加载；URL 已等值时仍能重选（同 key 边界）
  - 点击 docs 类结果 → 路由到 scan-docs 带 ?path= 参数
  - model_ready=false → 提示条可见；空查询 → 回到文件树视图
  - 清除按钮 → 恢复文件树且清空结果态
verify:
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx"
  - cd frontend && pnpm exec tsc --noEmit && pnpm lint
constraints:
  - MUST NOT 新增 npm 依赖（antd Input 既有；高亮用后端返回片段 + 前端子串包裹，不引 markdown 高亮库）
  - 检索结果渲染 MUST NOT 用 dangerouslySetInnerHTML 直插（片段经 React 文本节点拼接）
  - 既有文件树/深链/编辑/审核交互 MUST NOT 被削弱（扩展测试即可，既有用例不改断言）
  - 搜索请求 MUST 走 lib/knowledge.ts 封装（MUST NOT 组件内裸 fetch）
  - MUST 兼容三平台（无平台特定 API）
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
