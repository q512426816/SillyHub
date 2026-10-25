---
id: task-05
title: '文件 diff 弹窗——file-tree.tsx 导出 buildFileTree/diff 渲染件 + worktree-diff-modal.tsx（组件内取数+错误分型降级；回归既有 file-tree.test.tsx）+ 弹窗测试'
title_zh: '文件 diff 弹窗——file-tree.tsx 导出 buildFileTree/diff 渲染件 + worktree-diff-modal.tsx（组件内取数+错误分型降级；回归既有 file-tree.test.tsx）+ 弹窗测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-25 20:18:25
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-004@v1, D-010@v1]
allowed_paths:
  - frontend/src/components/git-log/file-tree.tsx
  - frontend/src/components/git-log/__tests__/file-tree.test.tsx
  - NEW:frontend/src/components/git-log/worktree-diff-modal.tsx
  - NEW:frontend/src/components/git-log/__tests__/worktree-diff-modal.test.tsx
target_files:
  - frontend/src/components/git-log/file-tree.tsx
  - NEW:frontend/src/components/git-log/worktree-diff-modal.tsx
  - NEW:frontend/src/components/git-log/__tests__/worktree-diff-modal.test.tsx
expects_from:
  - task-04: useGitLogWorktreeDiff hook 与 buildFileTree 导出
related_tests:
  - frontend/src/components/git-log/__tests__/file-tree.test.tsx（buildFileTree/DiffBody 导出后行为回归）
goal: >
  文件级「工作区 vs 最近一次提交」diff 弹窗（FR-03）：点击更改卡文件行后打开，
  三态渲染（modified 红绿对比 / untracked 全绿 / deleted 全红）+ 错误分型降级。
implementation:
  - frontend/src/components/git-log/file-tree.tsx 将私有 DiffBody(:187) 加 export（diff 行红绿渲染件，git-log 内既有语义 bg-success/10 text-success、bg-error/10 text-error、@@头 muted），不改行为
  - NEW:frontend/src/components/git-log/worktree-diff-modal.tsx：props={workspaceId, path, status, open, onClose}；组件内 useGitLogWorktreeDiff 取数（queryKey 按 path，enabled=open && path!=null）；头部状态徽标+文件路径+基线说明（最近一次提交 <head_short>）；正文 parseUnifiedDiff(file-tree.tsx:147 已导出) 解析 + DiffBody 渲染；untracked 全 + 行（daemon no-index 形态）/deleted 全 − 行；truncated=true 显示截断提示条、binary=true 显示二进制提示不渲染 diff；加载骨架与错误分型降级对齐 frontend/src/components/changes/scope-file-diff-modal.tsx 先例（422 引导升级 daemon / 404 / 502 / 504 各文案）
  - NEW:frontend/src/components/git-log/__tests__/worktree-diff-modal.test.tsx：三态渲染（modified 红绿行、untracked 全绿、deleted 全红）、truncated/binary 提示、422/404/502/504 降级文案、open=false 不取数（enabled 门）
  - 回归 frontend/src/components/git-log/__tests__/file-tree.test.tsx（导出后既有断言不破）
acceptance:
  - 弹窗测试与 file-tree 回归全绿；tsc 无新错误
  - 弹窗为受控组件（open/path props），挂载接线留给 task-06
verify:
  - cd frontend && pnpm exec vitest run src/components/git-log/__tests__/worktree-diff-modal.test.tsx src/components/git-log/__tests__/file-tree.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 复用 parseUnifiedDiff/DiffBody，不引入第三方 diff 库（与 conflict-compare-modal「不引入 diff 库」先例一致）
  - 弹窗壳用 antd Modal（ConfigProvider 主题化）或项目 Dialog 先例，文案中文
  - 不改动 file-tree.tsx 既有渲染行为（仅 export 扩展）
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
