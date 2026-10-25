---
id: task-04
title: '前端取数层与工作区更改卡——lib/git-log.ts 一次性扩展（fetchDirtyFiles + fetchWorktreeDiff + 两 hook + queryKeys）+ worktree-changes-card.tsx（三分组树+四色+计数+刷新）+ 卡片测试'
title_zh: '前端取数层与工作区更改卡——lib/git-log.ts 一次性扩展（fetchDirtyFiles + fetchWorktreeDiff + 两 hook + queryKeys）+ worktree-changes-card.tsx（三分组树+四色+计数+刷新）+ 卡片测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-25 20:18:25
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1, D-002@v1, D-007@v1]
allowed_paths:
  - frontend/src/lib/git-log.ts
  - frontend/src/components/git-log/file-tree.tsx
  - NEW:frontend/src/components/git-log/worktree-changes-card.tsx
  - NEW:frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx
target_files:
  - frontend/src/lib/git-log.ts
  - frontend/src/components/git-log/file-tree.tsx
  - NEW:frontend/src/components/git-log/worktree-changes-card.tsx
  - NEW:frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx
expects_from:
  - task-03: api-types 的 GitDirtyFilesResponse / GitWorktreeDiffResponse 类型
provides:
  - frontend/src/lib/git-log.ts: fetchDirtyFiles / fetchWorktreeDiff / gitLogQueryKeys.dirtyFiles / .worktreeDiff / useGitLogDirtyFiles / useGitLogWorktreeDiff（task-05/06/07 消费）
  - file-tree.tsx 导出 buildFileTree（task-05 消费）
goal: >
  前端取数层一次性扩展（两 fetch + 两 hook + queryKeys）+ Git 日志页「工作区更改」卡
  （IDEA 三分组树、四色、计数、刷新——FR-02 主形态）。
implementation:
  - frontend/src/lib/git-log.ts 对齐既有 fetch/queryKey 模式扩展：fetchDirtyFiles(workspaceId)、fetchWorktreeDiff(workspaceId, path)、gitLogQueryKeys.dirtyFiles(wid)=["git-log",wid,"dirty-files"]、.worktreeDiff(wid,path)、useGitLogDirtyFiles / useGitLogWorktreeDiff 两 hook（类型来自 api-types，禁手写）
  - frontend/src/components/git-log/file-tree.tsx:82 将私有 buildFileTree 加 export（不改行为，纯导出）
  - NEW:frontend/src/components/git-log/worktree-changes-card.tsx 按 prototype-explorer-git-status.html ① 形态：卡头（标题+修改/删除/新文件/忽略计数徽标+快照时间+刷新按钮 invalidate ["git-log",wid] 前缀+折叠）；三分组树——「更改」（status=added/modified/deleted，含 HEAD 基线说明）、「未纳入版本管理」（untracked）、「已忽略」（顶层聚合行）；文件行四色（added/untracked=text-success、modified=text-primary、deleted=text-error line-through、ignored=text-muted-foreground）+ +N/−N 行数（null 不显示）+ 状态徽标；目录聚合用 buildFileTree；文件行 onOpenFile(path,status) 回调（props 传入，本卡不开弹窗）
  - NEW:frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx：三分组渲染归属断言、四色类名断言、untracked 无行数仅徽标、卡头计数、刷新回调 invalidate 调用、空清单/加载/错误态（错误态对齐既有降级形态）——props 桩数据驱动
acceptance:
  - 卡片测试全绿；tsc 无新错误
  - 颜色语义为 IDEA 口径（D-002），不触碰 frontend/src/components/daemon/file-changes/file-changes-card.tsx
  - 卡片为 props 驱动（workspaceId+onOpenFile），挂载留给 task-06
verify:
  - cd frontend && pnpm exec vitest run src/components/git-log/__tests__/worktree-changes-card.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 颜色一律 tailwind 语义 token（text-success/text-primary/text-error/text-muted-foreground），禁硬编码色
  - 刷新为手动（invalidate），不轮询不自动刷新（D-007/D-009）
  - 组件中文文案；antd 组件经 ConfigProvider 主题化
  - 本卡不动 lib/git-log.ts 之外的既有取数函数签名
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
