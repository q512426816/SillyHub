---
id: task-11
title: 'build-mobile-session-list-component'
title_zh: 'MobileSessionList 组件（listAgentSessions+workspace_id 同 key query、机器分组、状态 Tab、卡片菜单 删除/归档/取消归档）（FR-06；Grill C-08）'
author: 'qinyi'
created_at: 2026-08-27 01:45:00
priority: P0
depends_on: ['task-01']
blocks: ['task-12']
requirement_ids: [FR-06]
decision_ids: [D-001@V1, D-003@V1]
allowed_paths:
  - frontend/src/components/mobile/mobile-session-list.tsx
  - frontend/src/components/mobile/mobile-session-list.test.tsx
provides:
  - contract: MobileSessionList
    fields: ['workspaceId', 'onSelect', 'onNew', '同 key query 数据 + 机器分组 + 状态Tab + 菜单操作']
goal: >
  新建移动会话分组卡片列表组件，数据用 listAgentSessions+workspace_id 与桌面门户
  同 key query 共享缓存（C-08），提供机器分组/状态 Tab/卡片菜单操作（FR-06）。
implementation:
  - '新建 frontend/src/components/mobile/mobile-session-list.tsx，props 按 design §7：workspaceId、onSelect(sessionId)、onNew'
  - '数据 useQuery 逐字对齐 session-list-panel.tsx:584：key ["agentSessions","sessionsPortal",scope,{limit: AGENT_SESSIONS_TREE_FETCH_LIMIT, archived: isArchivedView, assoc: null}]，scope = WorkspaceScope {kind:"workspace", workspaceId}（session-list-panel.tsx:110）；queryFn 用 listAgentSessions({limit: AGENT_SESSIONS_TREE_FETCH_LIMIT, ...(isArchivedView ? { archived: true } : {}), workspace_id})（daemon.ts:1760；C-08 修订：不是 listWorkspaceAgentSessions——后者无 limit/archived 参数、返回类型不同）；limit 从 daemon.ts:1719 导入禁止写死'
  - '状态 Tab（全部/进行中/已归档）：已归档切换 isArchivedView（key 变化自动重拉）；全部/进行中客户端按 status 过滤 items'
  - '机器分组：useDaemonMachines（@/lib/use-daemon-machines，与门户同源 key）取在线态，在线组在前/离线组在后，组头机器名+在线点；会话卡：会话名（title/config_snapshot.agent_name）/引擎/状态/最后活动相对时间'
  - '卡片 ⋯ 菜单用 MobileActionMenu（props open/actions/onClose，MobileAction key/label/danger/onPress）承载 删除（danger+确认）/归档/取消归档：mutation 调 deleteAgentSession/archiveAgentSession/unarchiveAgentSession（daemon.ts:1856/:1865/:1873，均 sessionId 单参），成功后 invalidate ["agentSessions"] 前缀（与门户同前缀全覆盖）'
  - '点击卡片 onSelect(sessionId)（宿主跳 /m/workspaces/[id]/sessions/[sid]）'
  - '新增 colocate 测试 mobile-session-list.test.tsx：query key 形态逐字断言（X-04 锁 key：scope 槽位+参数对象 limit:500/archived）、listAgentSessions 入参含 workspace_id 且未调 listWorkspaceAgentSessions、在线分组序、三 Tab 过滤、菜单三操作调对 API+invalidate、onSelect/onNew 回调'
acceptance:
  - query key 与 session-list-panel.tsx:584 同构（["agentSessions","sessionsPortal",scope,{limit:500,archived,…}]），数据函数为 listAgentSessions+workspace_id（C-08），测试锁 key 形态（X-04）
  - 机器分组按在线态（在线组在前、组头机器名+在线点）；状态 Tab 全部/进行中/已归档过滤正确
  - 卡片菜单经 MobileActionMenu 执行 删除/归档/取消归档（真实调对应 API）并 invalidate ["agentSessions"] 刷新列表
  - 点击卡片触发 onSelect（路由跳转由宿主 task-12 接线）
verify:
  - cd frontend && pnpm test -- src/components/mobile/mobile-session-list.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 禁止用 listWorkspaceAgentSessions（无 limit/archived 参数、返回类型不同、缓存语义对不齐——C-08）
  - query key 逐字对齐桌面（scope 槽位 + limit/archived 参数对象），禁止自造独立 key；limit 必须 import AGENT_SESSIONS_TREE_FETCH_LIMIT
  - 预会话新建流程不在本卡（onNew 由宿主 task-12 接 PreSessionPicker bottomSheet）；不改 session-list-panel.tsx 与 lib/daemon.ts
  - 危险操作（删除）走 MobileActionMenu danger+确认，触摸热区 ≥44px、语义 token（R-04）
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
