---
id: task-05
title: ppm-item-side-session-entry-and-card
title_zh: '前端任务/问题侧入口与卡片——pendingPpmItem 挂起位通道 + 发起会话入口 + ppm-item-sessions-card（W4, depends_on: task-03, task-04）'
author: 'qinyi'
created_at: 2026-08-28 03:19:00
priority: P0
depends_on: [task-03, task-04]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1, D-004@v2]
expects_from:
  task-04:
    - contract: createSession ppm 参数
      needs: [ppm_item_kind, ppm_item_id]
    - contract: listItemSessions
      needs: [kind, itemId]
  task-03:
    - contract: ppm_context_injection
      needs: [ppm_item_context_preamble, materialized_session_attachments, degraded_attachment_lines]
allowed_paths:
  - frontend/src/components/ppm/ppm-item-sessions-card.tsx
  - frontend/src/stores/floating-session.ts
  - frontend/src/components/floating/floating-session-host.tsx
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/app/(dashboard)/ppm/task-plans/page.tsx
  - frontend/src/app/(dashboard)/ppm/workbench/_components/workbench-task-table.tsx
  - frontend/src/app/(dashboard)/ppm/problem-list/_problem-drawer.tsx
  - frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
  - frontend/src/components/floating/floating-session-host.test.tsx
  - frontend/src/stores/floating-session.test.ts
related_tests:
  - frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
  - frontend/src/components/floating/floating-session-host.test.tsx
  - frontend/src/stores/floating-session.test.ts
goal: >
  实现 FR-04 任务/问题侧双向入口（D-001@v1）：task-plans 个人视图、workbench 我的任务表、
  problem-list 详情抽屉三处「发起会话」经 store pendingPpmItem 挂起位（requestNewSession
  会清空 preContext，不能走 preContext 直传）构造 preContext.ppmItem，并按 D-004@v2
  workspace_id 升序解析项目第一个关联工作区预填；新增 ppm-item-sessions-card（kind+itemId
  泛化）承载本人前 3 条会话预览与 ?session= 深链。
implementation:
  - floating-session.ts 新增 pendingPpmItem 挂起位（kind 取 plan_task/problem，携带 id 与
    projectId——projectId 供宿主解析工作区，入口行内已有零额外请求）及写入/清除 action；
    仅新增 ppm 字段，不碰 task-07 已落地的 autoTeamIntent/autoNewPending（共存不冲突）
  - floating-session-host.tsx 打开预会话构造 preContext 时读取挂起位：构造
    preContext.ppmItem（kind+id），并调 listProjectWorkspaces(projectId)
    （lib/workspace.ts:125，WorkspaceBrief.workspace_id）按 workspace_id 升序取第一个填
    preContext.workspaceId（与后端 link.workspace_id 同键 D-004@v2），解析不到/请求失败
    不带 workspaceId 不阻塞；消费后清挂起位
  - session-panel.tsx 最小接线：SessionPreContext 扩展 ppmItem 字段（kind 与 id，kind 取值
    plan_task/problem），handlePreSessionSend 组装 ppm_item_kind/ppm_item_id（与
    change_id/quicklog_id 并列，有值才带，缺省不进请求体零回归）；预会话上下文条按
    changeId/quickId 先例展示 PPM 条目标识
  - 三处入口加「发起会话」按钮：task-plans/page.tsx 个人任务视图行操作、
    workbench-task-table.tsx 我的任务行操作、_problem-drawer.tsx 详情底部——点击写入
    pendingPpmItem 并 requestNewSession（页面上下文沿既有 pageContext 通道）
  - 新增 components/ppm/ppm-item-sessions-card.tsx（kind+itemId 泛化，复用
    change-sessions-card.tsx 结构）：useQuery 调 listItemSessions(kind, itemId)（task-04
    提供）→ author 本人过滤（author 缺失视为本人保留，同 change-sessions-card 口径）→
    last_active_at 倒序取前 3 条，渲染 id 短码/状态中文/相对时间（复用
    session-list-panel 导出的 formatRelativeTime）；条目点击深链 ?session= 打开会话面板；
    卡尾「+ 新会话」按钮走同入口触发通道；卡片挂载于三处入口旁
  - 测试适配（GAP-1）：session-panel-pre-session.test.tsx 补 ppmItem 随首句 createSession
    上送断言（直击 handlePreSessionSend）；floating-session-host.test.tsx 补挂起位 →
    preContext.ppmItem 与 workspace_id 升序取首解析；floating-session.test.ts 补
    pendingPpmItem 状态流转（写入/消费清除/requestNewSession 不误清挂起位）
acceptance:
  - FR-04 GWT-1：task-plans 个人视图 / workbench 我的任务表 / problem-list 详情抽屉点击
    「发起会话」→ store 写入 pendingPpmItem 并 requestNewSession，宿主构造
    preContext.ppmItem，前端 listProjectWorkspaces(item.project_id) 结果按 workspace_id
    升序取第一个填 workspaceId（D-004@v2 与后端同键，可断言排序），解析不到不带；
    首句 createSession 请求体含 ppm_item_kind/ppm_item_id
  - FR-04 GWT-2：任务/问题详情渲染且存在关联会话时，ppm-item-sessions-card 展示本人前
    3 条预览（进行中/已结束状态、标题/短码、相对时间），点击深链 ?session= 打开会话面板
    查看完整会话，「+ 新会话」可再次发起；卡片对 plan_task/problem 两 kind 均成立
  - 端到端冒烟（依赖 task-03/task-04 就绪）：从任务入口发起会话发首句后，link 落库且
    会话 workspace 为项目第一个关联工作区，首条 user 消息含【PPM 任务上下文】前导
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-panel-pre-session.test.tsx src/components/floating/floating-session-host.test.tsx src/stores/floating-session.test.ts
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - session-panel.tsx 只加 SessionPreContext.ppmItem + handlePreSessionSend 上送 + 上下文条
    展示的最小接线，不迁移/重排既有逻辑（R-06）
  - 不碰 mention 相关代码（pendingMentions/@ 联想归 task-06；plan Wave 4 task-05→task-06
    串行即因共改 session-panel.tsx，本卡守住边界避免重叠）
  - 与 task-07 在 floating-session.ts / floating-session-host.tsx 的 autoTeamIntent/
    autoNewPending 改动共存：只新增 ppm 挂起位字段与 action，不改对方语义
  - 不改后端与 lib/daemon.ts（createSession ppm 参数 / listItemSessions 来自 task-04，
    见 expects_from；task-04 由另一 batch 生成，按契约对齐）
  - 不做移动端（app/m/）入口适配（design §3 非目标）
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
