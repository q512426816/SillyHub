---
author: qinyi
created_at: 2026-08-28 03:33:20
---

# 符号影响分析（Symbol Impact）— 会话关联 PPM 任务/问题 + 发起团队预选修复

> 基线：main@HEAD（规范文件提交后）。搜索工具 grep -rn，主仓库根目录执行（worktree 同基线）。

## 逐 task 结论

- task-01: 纯新增（PpmItemSessionLink 表 / bind_session_to_ppm_item / resolve_item_workspace_id / load_ppm_item / load_item_files / GET /api/ppm/item-sessions / main.py 挂载）——无既有签名变更，无调用点破坏；新端点消费方（前端 listItemSessions）归 task-04。
- task-02: DTO 与函数签名变更——SessionCreateRequest/SessionInjectRequest 加 Optional 字段（调用点 backend/app/modules/daemon/router.py:2271/2288（create_session）、:2326/2336（inject_session）、:2077（list_agent_sessions）均在 task-02 allowed_paths）；svc.create_session/inject_session/list_agent_sessions 形参新增（router.py 三处调用同文件适配 ✓）。超范围使用点：tests/test_session_create_attachments.py、test_team_mission_create_block.py 构造 SessionCreateRequest——新字段 Optional 缺省，既有构造零破坏，无需改动。
- task-03: 纯新增函数（context.py build_ppm_item_context_preamble、service.py _materialize_ppm_attachments）+ create_session 内接线——无对外签名变更；消费点均在自身 allowed_paths。
- task-04: 前端 API client 签名变更（createSession/injectSession/listAgentSessions 加可选参数、新增 listItemSessions）——调用点 frontend/src/components/daemon/session-panel.tsx（task-05/06/07 allowed_paths 逐步接线）；超范围调用点 runtime-session-helpers.tsx、agent-run-panel.tsx、mobile/mobile-session-list.tsx 及大量 __tests__ mock——可选参数缺省零回归，无需改动（mock 补齐按 task-04 惯例顺手处理 gen:types 暴露项）。
- task-05: 内部类型扩展（SessionPreContext.ppmItem、store pendingPpmItem）+ 新组件 ppm-item-sessions-card——消费点 session-panel.tsx/floating-session-host.tsx/stores/floating-session.ts 均在 allowed_paths ✓。
- task-06: 内部类型扩展（mention 条目类型）+ SessionInputBar mentions 透传——调用点 session-mention-popover.tsx、session-input-bar.tsx、session-list-panel.tsx、session-panel.tsx 均在 allowed_paths ✓。
- task-07: TeamTriggerPopover props 加 defaultProjectId（可选）——使用点 session-panel.tsx（task-07 allowed ✓）、session-input-bar.tsx / session-mention-popover.tsx（透传链，props 可选不破坏；若需传参归 task-07 内接线）。

## 汇总

签名级变更全部为「加 Optional 字段/可选参数」向后兼容形态；超范围调用点（后端 2 个测试文件、前端 runtime-session-helpers/agent-run-panel/mobile 组件）经核对均不需改动（缺省零回归），无阻断项。DTO/类型定义变更（SessionCreateRequest/SessionInjectRequest/api-types）已由 task-04 gen:types 覆盖前端类型同步。
