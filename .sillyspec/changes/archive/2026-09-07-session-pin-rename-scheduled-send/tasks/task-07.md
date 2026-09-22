---
id: task-07
title: 'sessions-tree-pin-rename-ui'
title_zh: '会话树置顶/重命名 UI（hover 按钮+行内编辑+置顶徽标）+ sessions-portal 接线'
author: 'qinyi'
created_at: 2026-09-07 23:32:39
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-06]
decision_ids: [D-002@v1]
expects_from:
  task-05:
    - pinAgentSession
    - unpinAgentSession
    - renameAgentSession
allowed_paths:
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/sessions/sessions-portal.tsx
target_files:
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/sessions/sessions-portal.tsx
goal: >
  会话树 SessionRow 加置顶/重命名 hover 操作、置顶徽标与行内重命名编辑态，
  sessions-portal 接线三回调（调 API → invalidate → toast），让高频会话可
  置顶（分组内最前，D-002）、派生标题可修正，多端经 SSE 秒级同步。
implementation:
  - session-list-panel.tsx——SessionRowProps 加可选 onPin/onUnpin/onRename（照 onArchive 可选模式）；hover 按钮区归档按钮左侧按 session.pinned_at 二选一渲染置顶（Pin）/取消置顶（PinOff）+ 重命名（Pencil）按钮，均 stopPropagation；置顶行标题前 Pin 小徽标（brand 阶，照 tool_report 徽标形态）
  - 重命名行内编辑态——标题位换 input 预填当前标题，Enter/blur 提交、Esc 取消，strip 非空且 ≤255 才回调（空值静默退出编辑不弹错）
  - SessionListPanel——renaming 状态防重入（照 archiving 模式）+ 三处理函数（useNotify toast 成功/部分失败，照 notifyArchiveResult 口径）+ onPinSessions/onUnpinSessions/onRenameSession props 透传 WorkspaceTreeList 到 SessionRow
  - sessions-portal.tsx 接线——三回调照 onArchiveSessions 模式（dynamic import @/lib/daemon → Promise.allSettled → invalidate agentSessions 前缀 → 返回失败个数供面板 toast）；重命名不动 ?session= 参数与选中态
acceptance:
  - pnpm exec tsc --noEmit 零错误，既有 session-list-panel 测试零回归
  - 置顶/取消置顶/重命名三操作经 invalidate 即时收敛，失败有 toast 反馈
  - 未传新 props 的既有消费点（悬浮助手 runtime 抽屉等）零渲染变化（可选 props 兼容）
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改后端与 lib/daemon.ts（API 函数由 task-05 提供）；不改既有测试文件（新用例归 task-09）
  - 置顶分组内最前语义靠服务端排序（pinned_at IS NULL 前置键），前端 byWs 桶保序插入不做本地重排
  - 样式全走 brand-*/muted/destructive 语义阶（双主题铁律，CLAUDE.md 规则 20）
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
