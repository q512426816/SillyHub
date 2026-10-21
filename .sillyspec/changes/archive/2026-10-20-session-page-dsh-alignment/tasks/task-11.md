---
id: task-11
title: 'Frontend 1b: snapshot mapping, session summary, degraded card, per-turn mount'
title_zh: '前端 1b：映射纯函数 + 会话级汇总 + 卡片降级 + 轮级挂载'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P0
depends_on: [task-08, task-09]
blocks: []
requirement_ids: [FR-14, FR-16]
decision_ids: [D-012@v1, D-023@v1]
allowed_paths:
  - frontend/src/components/daemon/file-changes/
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
target_files:
  - NEW:frontend/src/components/daemon/file-changes/turn-file-changes.ts
  - NEW:frontend/src/components/daemon/file-changes/file-changes-summary.tsx
  - frontend/src/components/daemon/file-changes/file-changes-card.tsx
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - NEW:frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts
  - NEW:frontend/src/components/daemon/file-changes/__tests__/file-changes-summary.test.tsx
expects_from:
  task-08:
    - contract: turn-snapshot-read-model
      needs: [fileChanges, fileChangesCapability]
goal: >
  把读模型里的 `fileChanges` + `capability` 变成页面上的卡：轮级卡片列出逐文件 +/− 与归因，会话级汇总去重后给
  总数与 Σ+/−，老 daemon（`capability="tool_only"`）降级为「仅工具编辑」并显式提示。禁止把「没有快照」显示成
  「本轮无改动」——这是 E6/E8 的硬约束。
implementation:
  - 'NEW:frontend/src/components/daemon/file-changes/turn-file-changes.ts（纯函数、零 DOM）：`toFileChangesCardProps(snapshot, capability)` → `FileChangesCardProps | null`。映射：`attribution="edit_patch"` → `source="tool"`（`editToolNames` 保留用于行内提示）、`"command"` → `source="shell"`；`status="partial"` → `truncated=true` 且行级 +/− 显示破折号；`binary=true` → 数字破折号；`status="failed"|"unavailable"` 或 `capability="tool_only"` 或 `snapshot=null` → 降级态（不出空卡，不出「无改动」）；`sharedWorkspace=snapshot.concurrentSessionsHint`'
  - 'NEW:frontend/src/components/daemon/file-changes/file-changes-summary.tsx：会话级汇总——按 path 去重（同文件多轮取并集、+/− 各自求和）、给文件总数与 Σadded/Σdeleted、`status` 取最差值（unavailable > failed > partial > ok）、恒标「可能含并行会话改动」横幅；props only，零 fetch'
  - 'frontend/src/components/daemon/file-changes/file-changes-card.tsx：补 `capability?: "full" | "tool_only"` 与降级形态（折叠头显示「仅工具编辑」+ 一行说明「daemon 未上报工作区快照，本卡只含 Edit/Write 工具编辑」），保持既有 28px 折叠行 / 24px 文件行 / 240px 限高'
  - '接线（`frontend/src/components/daemon/session-panel/session-panel-page.tsx`：`runsMeta` :1697 / :1721 已持有 run DTO）→ 把 `fileChanges` / `fileChangesCapability` 透传到 `SessionTurnView`（`turn-timeline.tsx` 的 turn 视图类型），**只加 props 透传，不改取数 / 分页 / SSE 编排**（FR-22）'
  - '挂载（`frontend/src/components/daemon/turn-timeline.tsx`）：TurnRow 内在轮尾状态行之后渲染轮级卡，`toFileChangesCardProps` 返回 null 时**不渲染任何占位**；会话级汇总卡挂在会话流顶部（受 props 开关控制，默认开）'
  - '测试：NEW:.../__tests__/turn-file-changes.test.ts（归因映射 / partial → truncated + 破折号 / binary 破折号 / tool_only 降级 / null 不出卡 / sharedWorkspace 横幅）；NEW:.../__tests__/file-changes-summary.test.tsx（多轮去重 / Σ+/− / 最差 status / 横幅在场 / 无 worktree 调用）；并扩展 file-changes-card.test.tsx 覆盖降级形态（不得破坏既有 8 例）'
acceptance:
  - '新增两套用例全绿，且既有 file-changes-card.test.tsx 8 例不回归'
  - '`capability="tool_only"` 与 `snapshot=null` 两态：卡片文案含「仅工具编辑」，全树不出现「本轮无改动」（断言 `queryByText(/无改动/)` 为 null）'
  - '`status="partial"`：卡片照出 + 行级 +/− 显示破折号 + 标注来源（超时/截断）'
  - '会话级汇总：同一 path 出现在 3 轮 → 汇总计 1 个文件、+/− 为三轮之和；横幅「可能含并行会话改动」在场'
  - '`session-panel-page.tsx` 只增 props 透传：`git diff` 中该文件不出现取数/分页/SSE 相关改动'
verify:
  - cd frontend && node node_modules/vitest/vitest.mjs run src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts src/components/daemon/file-changes/__tests__/file-changes-summary.test.tsx src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx
  - cd frontend && node node_modules/typescript/bin/tsc --noEmit
constraints:
  - 卡片零 fetch / 零 store / 零 context（数据由 props 注入）
  - 不引入新依赖、不引入虚拟化库；列表限高内滚沿用现实现
  - 只看 `capability`，禁止用「字段是否存在」判断降级（E6/E8）
  - 不改 session-panel 的取数 / 分页 / SSE（FR-22）；不引 worktree
  - 文案中文；降级/截断必须显式提示，禁静默
related_tests:
  - path: frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx
    reason: 同一组件新增 capability 降级形态，既有 8 例的折叠/展开/断言行必须保持绿
  - path: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
    reason: turn-timeline 挂载面变化可能影响该文件对「轮内卡片/折叠头」的断言
---
