---
id: task-13
title: '前端预会话解禁+create 携带——TeamTriggerRow 门控+payload 暂存+handlePreSessionSend 携 team_mission+daemon.ts client 扩展'
title_zh: '前端预会话解禁+create 携带——TeamTriggerRow 门控+payload 暂存+handlePreSessionSend 携 team_mission+daemon.ts client 扩展'
author: 'qinyi'
created_at: 2026-08-24 19:00:25
priority: P0
depends_on: ['task-09', 'task-12']
blocks: []
requirement_ids: [FR-05, FR-06]
decision_ids: [D-009@v2, D-010@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/lib/daemon.ts
  - frontend/src/components/daemon/__tests__/
goal: >
  预会话态解禁团队触发行——门控改为 claude 引擎+所选机器在线（与真会话同构），弹层确认后 payload 暂存 state、首句 createSession 请求携带 team_mission 块（含 orchestrator_workspace_id），daemon.ts client 同步扩展（FR-05/FR-06 前端侧落地，D-009@v2/D-010@v1）。
expects_from:
  task-09:
    - contract: create_session_team_mission
      needs: [team_mission, orchestrator_workspace_id]
  task-12:
    - contract: preSession_popover
      needs: [preSession, orchestrator_workspace_id]
implementation:
  - session-panel.tsx 预会话 TeamTriggerRow（:1657-1671 硬编码 disabled+安全空 props）解禁——门控与真会话同构（:1769-1779 teamButtonDisabled/teamButtonTitle 先例）改为 preEngine==="claude" && preMachineOnline（:904/:905 既有派生，机器列表找不到不武断判离线的语义保持），tooltip 按未满足原因更新（团队需要 Claude 引擎/所选机器离线/可用时提示首句创建会话即预建团队任务）
  - 弹层开关联入真实 state（popoverOpen/onOpen/onClose 替代空回调）——preSession 实例向 task-12 弹层组件传 preSession prop 与 workspaceName/defaultObjective 等既有 props
  - 预会话弹层确认回调不走 handleTeamTrigger（:1248 无 sessionId 即 return 的 triggerSessionTeamMission 路径）——改为 payload 暂存 state（preTeamMission，含 task-12 主 agent 选择器落定的 orchestrator_workspace_id）+关弹层+objective 回填输入框，等首句随 create 上送
  - handlePreSessionSend（:1278-1309）createSession 入参追加 team_mission 暂存块（有值才带），发送成功后清空暂存 payload；失败保留输入与暂存可原地重试（R-02 语义沿用）
  - daemon.ts createSession（:668-694）body 追加 team_mission 透传；类型锚定 api-types 生成版 SessionCreateRequest（:634-642 Omit+放宽先例）——task-14 gen:types 前以局部类型扩展对齐 TeamMissionCreateBlock 字段集合，gen 后漂移由 tsc 暴露；plan 口径的 probeWorkspaces client（POST /api/workspaces/probe）若 task-12 未落则在此补齐，不与弹层侧重复实现
  - 补 vitest（__tests__/session-panel-pre-session.test.tsx 扩展或新增）——门控三态（claude+在线可点/非 claude 禁/离线禁）、确认后暂存+首句请求体携带 team_mission、既有会话路径不变
acceptance:
  - 预会话 TeamTriggerRow 解禁——claude 引擎且所选机器在线时可点开弹层，tooltip 随门控原因更新；非 claude 引擎或所选机器离线仍禁用
  - 弹层确认后 payload 暂存 state，首句 createSession 请求体携带 team_mission 块（含主 agent 选择器落定的 orchestrator_workspace_id，未选工作区=缺省走当前会话默认）
  - 既有会话路径零变化——对话/普通两模式 TeamTriggerRow 挂载点（:2008/:3254）与 handleTeamTrigger 预建行为逐字节不变
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test
constraints:
  - 仅前端接线——create 端点 team_mission 预建归 task-09、弹层 preSession 实例与主 agent 选择器归 task-12，本卡只消费契约；W5 内先于 task-14 执行（串行）
  - 预会话弹层确认绝不调 triggerSessionTeamMission（无会话 id 可挂 mission）——payload 暂存随首句 create 上送，创建失败保留输入与暂存可重试
  - api-types.ts 不手改（CLAUDE.md 规则 21）——gen:types 产物同步归 task-14，本卡局部类型扩展仅作 gen 前过渡
  - 既有会话派团队（对话/普通模式）与无 mission 普通会话行为不变（FR-07 门控与挂载点零回归）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
