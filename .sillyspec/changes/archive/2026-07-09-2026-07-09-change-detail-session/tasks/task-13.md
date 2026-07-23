---
id: task-13
title: 新建 change-session-section.tsx（左历史列表+新建+右复用 Panel+切换恢复）
title_zh: 变更会话区块组件
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P0
depends_on: [task-11, task-12]
blocks: [task-14, task-15]
requirement_ids: [FR-05]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/components/changes/change-session-section.tsx
expects_from:
  task-11:
    - contract: listChangeSessions(workspaceId, changeId)
      needs: [returns_AgentSessionListItem_array]
  task-12:
    - contract: InteractiveSessionPanel
      needs: [changeId, workspaceId, attachSessionId, onSessionCreated]
goal: >
  新建 ChangeSessionSection：左侧该变更会话历史列表（listChangeSessions，跨成员显作者 D-005）+ 新建按钮，右侧复用 InteractiveSessionPanel（传 changeId/workspaceId），点击历史项切换并恢复轮次。
implementation:
  - props: workspaceId, changeId
  - 左侧：useQuery(listChangeSessions) 渲染历史项（作者/状态/时间/标题），「新建会话」清空当前并新建
  - 右侧：InteractiveSessionPanel changeId={changeId} workspaceId={workspaceId}；选中历史项时用 attachSessionId/initialTurns 走既有恢复路径
  - 沿用平台前端样式（slate/blue 体系，参考 archive frontend-style-system）
acceptance:
  - 列表只显示该变更会话；新建会话 createSession 带 change_id
  - 切换历史项能加载该会话轮次
  - 样式与变更详情页一致
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test -- src/components/changes/change-session-section
constraints:
  - 复用 InteractiveSessionPanel 既有恢复/attach 逻辑，不重造
  - 无在线 daemon 时沿用既有 NoSession 提示，不新增错误态
---

## 验收标准
- 列表只显示该变更会话；新建会话 createSession 带 change_id
- 切换历史项能加载该会话轮次
- 样式与变更详情页一致（slate/blue 体系）

## 验证步骤
- cd frontend && pnpm typecheck
- cd frontend && pnpm test -- src/components/changes/change-session-section
