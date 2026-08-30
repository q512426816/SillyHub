---
id: task-07
title: 'Fix "Launch Team" preselection: autoTeamIntent/autoTeamOpen channel + defaultProjectId preselect + objective prefill (W1)'
title_zh: '「发起团队」预选修复——autoTeamIntent/autoTeamOpen 通道 + defaultProjectId 预选 + objective 预填（W1）'
author: 'qinyi'
created_at: 2026-08-28 03:19:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-004@v2]
allowed_paths:
  - frontend/src/stores/floating-session.ts
  - frontend/src/stores/floating-session.test.ts
  - frontend/src/components/floating/floating-session-host.tsx
  - frontend/src/components/floating/floating-session-host.test.tsx
  - frontend/src/components/daemon/team-trigger-popover.tsx
  - frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/__tests__/session-panel-team.test.tsx
related_tests:
  - frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-team.test.tsx
  - frontend/src/stores/floating-session.test.ts
  - frontend/src/components/floating/floating-session-host.test.tsx
goal: >
  Fix the standalone W1 bug: clicking "发起团队" on a PPM project page only injects
  page context (projects/page.tsx:174-179) and the team trigger popover never
  opens with nothing preselected (floating-session.ts:160-168 clears preContext,
  floating-session-host.tsx:196-202 workspaceId always null, team-trigger-popover.tsx
  has no defaultProjectId and projectId starts ""). Build the autoTeamIntent →
  autoTeamOpen channel and defaultProjectId preselection so the pre-session
  auto-opens the popover with project + first linked workspace (workspace_id
  ascending, D-004@v2) + prefilled editable objective.
implementation:
  - "floating-session.ts: add `autoTeamIntent` state + clear action; `requestNewSession` sets it true when pageContext.page_key === 'ppm_project' (project_id carried in pageContext); non-ppm_project entry leaves it false"
  - "floating-session-host.tsx: when autoNewPending opens the pre-session (196-202), read autoTeamIntent from the store and pass it to SessionPanel as new prop `autoTeamOpen` (do not touch handleNewSession's workspaceId=null behavior); clear the store intent after handoff"
  - "session-panel.tsx (minimal wiring only): on pre-session mount, if autoTeamOpen → call openTeamPopover('分析项目 <项目名> 当前迭代风险并给出建议' style objective, user-editable); derive defaultProjectId from the ppm_project pageContext and forward to TeamTriggerPopover"
  - "team-trigger-popover.tsx: new optional prop `defaultProjectId` → projectId state initialized to it (:229), scopeMode initialized 'project' (:222-224 branch), effect auto-calls listProjectWorkspaces (:279-286) and preselects the first workspace sorted by workspace_id ascending (same sort key as D-004@v2); prop absent → current behavior unchanged"
  - "Guard: empty workspace list in project scope must not error — confirm remains available with no workspace selected"
acceptance:
  - "PPM 项目页点击「发起团队」→ 预会话打开后派团队弹层自动打开（无需用户手动点击，openTeamPopover 仅用户动作触发的现状 :1772-1775 被自动通道补充）"
  - "弹层内项目已按 defaultProjectId 自动选中且 scopeMode=按项目"
  - "项目关联工作区自动拉取并按 workspace_id 升序预选第一个（多工作区时断言排序键与 D-004@v2 同键）"
  - "objective 预填「分析项目 X 当前迭代风险并给出建议」句式且可修改后提交"
  - "非 ppm_project 入口（其它页面 requestNewSession）的预会话不自动打开弹层，行为与现状零回归"
  - "项目无关联工作区时弹层不报错，项目模式仍可确认派团队"
verify:
  - "cd frontend && pnpm exec vitest run src/components/daemon/__tests__/team-trigger-popover.test.tsx"
  - "cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-panel-team.test.tsx src/stores/floating-session.test.ts src/components/floating/floating-session-host.test.tsx"
  - "cd frontend && pnpm exec tsc --noEmit"
constraints:
  - "不动后端；不碰 ppm_item_session_links 绑定链路（task-01/02 范围），本 task 为独立 bug 修复"
  - "不破坏现有真会话「用团队分析」按钮：workspaceId 条件渲染（session-panel.tsx :4327-4332）由既有测试锁定，行为不变"
  - "session-panel.tsx 仅做 autoTeamOpen/defaultProjectId 最小接线（R-06 防膨胀），新逻辑尽量落在 team-trigger-popover"
  - "多工作区为空时弹层不报错（项目模式无工作区也可确认）"
  - "不跑全量测试，仅跑上述相关单文件 + tsc（CLAUDE.md 规则 0）"
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
