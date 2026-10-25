---
id: task-06
title: 'Git 日志页挂载接线——git-log/page.tsx 挂 WorktreeChangesCard（GitStatusBar 之下）+ 弹窗状态接线 + no_git 空态不堆叠（回归 git-log-page/git-status-bar 测试）'
title_zh: 'Git 日志页挂载接线——git-log/page.tsx 挂 WorktreeChangesCard（GitStatusBar 之下）+ 弹窗状态接线 + no_git 空态不堆叠（回归 git-log-page/git-status-bar 测试）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-25 20:18:25
priority: P0
depends_on: ['task-04', 'task-05']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx
  - frontend/src/components/git-log/__tests__/git-log-page.test.tsx
  - frontend/src/components/git-log/__tests__/git-status-bar.test.tsx
target_files:
  - frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx
expects_from:
  - task-04: WorktreeChangesCard 组件
  - task-05: WorktreeDiffModal 组件
related_tests:
  - frontend/src/components/git-log/__tests__/git-log-page.test.tsx（page 结构变更回归）
  - frontend/src/components/git-log/__tests__/git-status-bar.test.tsx（状态条形态不受影响回归）
goal: >
  把「工作区更改」卡与 diff 弹窗接进 Git 日志页（D-001 挂载位置），
  完成 FR-02/FR-03 的端到端闭环。
implementation:
  - frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx:190 GitStatusBar 之下、工具栏之上挂 WorktreeChangesCard workspaceId={workspaceId} onOpenFile={...}；onOpenFile 置 {path,status} state 驱动 WorktreeDiffModal open/path/status/onClose
  - no_git 空态不堆叠：gitMode==="no_git" 时不渲染更改卡（与既有 no_git 空态卡二选一，卡片自身 error/加载态已在 task-04 内消化）
  - 既有 handleRefresh（invalidate ["git-log", wid] 前缀）天然覆盖新 query，无需另接刷新线
  - 回归两既有测试：git-log-page.test.tsx 补新挂载断言（卡片在场/点击文件行弹窗打开/no_git 下卡片不渲染）；git-status-bar.test.tsx 确认状态条行为不变
acceptance:
  - 页面测试与状态条回归全绿；tsc 无新错误
  - 更改卡位于状态条与提交列表工具栏之间，不挤掉提交列表首屏（卡可折叠）
verify:
  - cd frontend && pnpm exec vitest run src/components/git-log/__tests__/git-log-page.test.tsx src/components/git-log/__tests__/git-status-bar.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改页面既有取数/过滤/分页逻辑，只增挂载与弹窗 state
  - 弹窗关闭后 state 清理（path→null），不留悬挂查询
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
