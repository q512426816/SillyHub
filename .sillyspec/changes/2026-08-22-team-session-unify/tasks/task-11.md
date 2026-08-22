---
id: task-11
title: 'frontend-team-trigger-entry-dispatch-button-popover-chip-team-command-codex-gating-analyze-remap-block-mount'
title_zh: '前端触发入口——派团队按钮+配置弹层+状态 chip + /team 指令 + Codex 置灰 + 「用团队分析」两处改造 + TeamTaskBlock 挂载'
author: 'qinyi'
created_at: 2026-08-22 03:35:53
priority: P0
depends_on: [task-03, task-12]
blocks: [task-13]
requirement_ids: [FR-03, FR-07]
decision_ids: [D-003@v1, D-004@v1]
expects_from:
  task-12:
    - contract: TEAM_UI_COMPONENTS
      needs: [TeamTaskBlock 组件, triggerSessionTeamMission client]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/interactive-session-panel.tsx
  - frontend/src/components/daemon/team-trigger-popover.tsx
  - frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx
  - frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-team.test.tsx
goal: >
  会话输入区提供团队触发四路入口——派团队按钮+配置弹层+状态 chip+/team
  指令，Codex 置灰，两处「用团队分析」改为打开触发弹层，消息流挂载
  TeamTaskBlock（design §5 Phase 3、FR-03/FR-07、D-003/D-004）。
implementation:
  - 新建 team-trigger-popover.tsx——输入框上方弹层（同 SessionConfigBar 浮层风格），含范围（当前工作区/项目+scope 多选+anchor，仅项目经理可选项目）、预算上限（留空不限）、分身预设折叠；确认调 triggerSessionTeamMission 预建，409 活跃冲突提示
  - session-panel.tsx 输入区新增「派团队」按钮——provider 为 claude 可用，codex 等置灰并 tooltip「团队需要 Claude 引擎」；触发后显示就绪/进行中状态 chip（可关闭收回）
  - /team 指令拦截——检测前缀不直接发送，弹层确认后目标文本随下条消息发出（D-004 四路等价）
  - 「用团队分析」两处改造——session-panel.tsx header 按钮与 interactive-session-panel.tsx 透传层不再调 createMission，改为打开触发弹层（page/dialog 两模式覆盖）
  - 消息流挂载 TeamTaskBlock（task-12 组件）——按 listSessionTeamMissions 数据在对话视图渲染团队任务块
  - 适配 interactive-session-panel.test.tsx 既有「用团队分析」断言为弹层新行为；新增 team-trigger-popover 测试
acceptance:
  - Claude 会话显示派团队按钮；Codex 会话按钮置灰且 tooltip 提示团队需要 Claude 引擎
  - 弹层含范围（当前工作区/项目+scope+anchor）、预算、分身预设，确认走 triggerSessionTeamMission 预建
  - /team 前缀输入被拦截并走弹层确认路径，与按钮路径等价
  - 状态 chip 显示团队就绪/进行中并可关闭收回
  - session-panel 与 interactive-session-panel 两处「用团队分析」均改为打开触发弹层，不再调用 createMission
  - TeamTaskBlock 挂载在会话消息流中渲染团队任务
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm typecheck
constraints:
  - 样式遵循双主题铁律——brand-* 语义阶随 data-theme 换肤，violet 系与弹层浮层风格对齐原型 prototype-team-session-unify.html，参考 .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md
  - 不动 lib/agent.ts（createMission 删除归 task-13）；只消费 task-12 提供的 TeamTaskBlock 与 triggerSessionTeamMission
  - 不做 Codex 引擎 MCP 工具注入（D-003 非目标，另立后续变更）
  - 追问排队复用 useMessageQueue 零改动（投递目标即主控会话）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
