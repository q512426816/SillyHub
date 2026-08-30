---
id: task-12
title: 'frontend-team-task-block-worker-details-cancel-progress-worker-segments-mcp-tool-cards-api-client'
title_zh: '前端 TeamTaskBlock（概要/分身明细/日志产物/取消）+ 进度视图分身段块与 MCP 工具卡 + lib/daemon.ts API client'
author: 'qinyi'
created_at: 2026-08-22 03:35:53
priority: P0
depends_on: [task-03]
blocks: [task-11]
requirement_ids: [FR-07]
decision_ids: [D-001@v1]
provides:
  - contract: TEAM_UI_COMPONENTS
    fields: [TeamTaskBlock 组件, triggerSessionTeamMission client, listSessionTeamMissions client]
expects_from:
  task-03:
    - contract: TeamMissionSummary
      needs: [mission_id, status, objective, scope_workspace_ids, budget_usd, workers]
allowed_paths:
  - frontend/src/components/daemon/team-task-block.tsx
  - frontend/src/components/daemon/turn-segment-views.tsx
  - frontend/src/lib/daemon.ts
  - frontend/src/components/daemon/__tests__/team-task-block.test.tsx
  - frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  - frontend/src/lib/__tests__/daemon-team-mission.test.ts
goal: >
  新建消息流内 TeamTaskBlock 组件与进度视图分身段块/MCP 工具卡渲染，并在
  lib/daemon.ts 增加会话团队 API client，使分身进度/日志/产物/取消全部嵌入
  当前会话（design §5 Phase 3、FR-07）。
implementation:
  - lib/daemon.ts 新增 triggerSessionTeamMission(sessionId, req) 与 listSessionTeamMissions(sessionId)，对应 POST /api/daemon/sessions/{id}/team-mission 与 GET /api/daemon/sessions/{id}/team-missions，类型对齐 task-03 的 TeamMissionSummary 契约
  - 新建 team-task-block.tsx——概要行常驻（状态徽标、N 分身成功失败计数、花费/预算），展开显示主控行+分身行（角色、目标工作区徽标、状态、耗时、目标摘要）与日志产物入口；取消按钮调保留的 cancel 端点（复用 cancelMission 语义）
  - 数据源 listSessionTeamMissions——活跃态（planning/running/awaiting_input）5s 轮询，终态停止
  - turn-segment-views.tsx——ToolRowView 泛化渲染 dispatch_worker/get_worker_result/converge_mission/list_workers/report_progress 工具卡（mcp 前缀标识+主参数摘要）；新增分身段块 violet 折叠卡（角色、目标工作区徽标、状态、耗时、日志、产物）
  - vitest 覆盖——TeamTaskBlock 渲染（概要行、展开明细、取消回调、轮询启停）与工具卡/分身段块渲染
acceptance:
  - TeamTaskBlock 概要行显示状态徽标、N 分身成功失败计数、花费/预算；展开见主控+分身明细与日志产物入口
  - 取消按钮调用保留的 cancel 端点并更新展示；活跃 mission 5s 轮询、终态停止
  - 进度视图渲染分身段块（violet 系、角色、目标工作区徽标、状态、耗时）与 dispatch_worker 等 MCP 工具卡
  - 两个 client 与 TeamMissionSummary 契约字段一一对应，新增 vitest 用例全绿
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm typecheck
constraints:
  - 样式遵循双主题铁律——brand-* 语义阶随 html data-theme 换肤，violet 系对齐现有 mission 视觉与原型 prototype-team-session-unify.html，参考 .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md
  - 不改 team-progress.tsx 与 change 详情既有用法（依赖端点保留）
  - 本卡不接线 session-panel（挂载归 task-11）；不动 lib/agent.ts（删除归 task-13）
  - 一期不做 SSE 实时推送，轮询 5s 即可（非目标）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
