---
id: task-06
title: 'route-wsref-insert-slot-through-sessions-portal'
title_zh: 'portal 槽位接线——两壳透传回调+四分支下发+空门户 toast'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 13:48:40
priority: P0
depends_on: [task-02, task-03]
blocks: [task-08]
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - frontend/src/components/sessions/portal-file-panels.tsx
  - frontend/src/components/sessions/sessions-portal.tsx
  - frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx
  - frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
target_files:
  - frontend/src/components/sessions/portal-file-panels.tsx
  - frontend/src/components/sessions/sessions-portal.tsx
  - frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx
  - frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
provides:
  - contract: PendingWsRefInsertSlot
    fields: [desc, nonce]
expects_from:
  task-01:
    - contract: WsRefDesc
      needs: [kind, workspaceId, path, name, lines]
  task-02:
    - contract: FilePreviewOnAddSelectionRef
      needs: [desc]
  task-03:
    - contract: FileExplorerOnAddNodeRef
      needs: [desc]
goal: >
  打通 FR-01 通道——文件树/预览区两右键入口回调经 portal-file-panels 两壳透传到
  sessions-portal，组装 WsRefDesc 落 pendingWsRefInsert 槽位（nonce 自增保证可
  重复触发）下发中栏四分支，空门户态无输入区时 toast 兜底提示。
implementation:
  - frontend/src/components/sessions/portal-file-panels.tsx:30-46 两壳 props 增 onAddNodeRef/onAddSelectionRef，在 FileExplorer（portal-file-panels.tsx:95）与 FilePreview（portal-file-panels.tsx:127）消费点位直通（保持纯组合薄壳零业务逻辑的既有约定）
  - frontend/src/components/sessions/sessions-portal.tsx 新增 pendingWsRefInsert 槽位 state 与 nonce 自增 ref——树入口（sessions-portal.tsx:688-706）挂 onAddNodeRef，workspaceId 用 filesModeWorkspaceId 树快照（sessions-portal.tsx:200）；预览入口（sessions-portal.tsx:1048-1052）挂 onAddSelectionRef，workspaceId 用 filePreview 自身值（sessions-portal.tsx:205），防跨工作区串档
  - 槽位下发中栏四分支（sessions-portal.tsx:917-1024）——GroupChatPanel（sessions-portal.tsx:922-928）与真会话/预会话两 SessionPanel 挂载（sessions-portal.tsx:929-954）均透传 pendingWsRefInsert；面板内部接线分别归 task-07（session-panel）/task-08（群聊），契约以 design 接口定义为准先行
  - 空门户态（sessions-portal.tsx:955-1024，无输入区消费者）右键插入时 notify.warning 中文 toast 兜底，不落槽位
  - 用例——portal-file-panels.test.tsx 验两壳 props 直通；sessions-portal.test.tsx 验槽位下发（真会话/预会话/群聊三分支）、nonce 自增同引用可重复触发、空门户 toast（计划审查 P2 建议落卡）
acceptance:
  - 树右键与预览选区右键回调经两壳透传到 portal，组装的 WsRefDesc 含正确 workspaceId（树快照/预览列自身）与相对工作区根 POSIX 路径
  - pendingWsRefInsert 槽位（nonce 自增）下发群聊/真会话/预会话三分支；同一引用连续添加可重复触发
  - 空门户态右键插入 toast 提示且不崩溃；未接回调的既有渲染路径行为与现状一致
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions/__tests__/portal-file-panels.test.tsx src/components/sessions/__tests__/sessions-portal.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 两壳保持纯组合薄壳（portal-file-panels.tsx 顶部约定），只加 props 直通不加业务逻辑；不改 FileExplorer/FilePreview 本体（task-02/task-03 范围）
  - daemon/session-panel 与 group-chat 目录不碰——面板接槽位归 task-07、群聊消费归 task-08
  - 文案中文；未插入引用零行为差异；后端 0 端点；品牌色 brand-* 语义阶
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
