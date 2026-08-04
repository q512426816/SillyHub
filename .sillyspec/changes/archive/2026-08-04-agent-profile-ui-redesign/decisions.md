---
author: qinyi
created_at: 2026-08-04 16:12:00
---

# 决策台账(Decisions)— 智能体档案前端重设计

> 变更 `2026-08-04-agent-profile-ui-redesign`。本文件是本次变更的决策台账,仅记录有实现/验收影响的决策。长期术语在 archive/scan 时提升到 `docs/multi-agent-platform/glossary.md`。

## D-001@v1: 独立一级菜单 + 全局聚合视图
- type: architecture
- status: accepted
- source: user
- question: 智能体档案入口藏在工作区详情页快捷入口里,层级深;用户要独立成菜单。档案按工作区存放,独立后进去看哪个范围?
- answer: 提升为侧边栏一级菜单(`/agent-profiles`);进去是全局聚合视图——actor 可见的全部档案(个人私有全集 + 所在各工作区 workspace 级 + 全部 platform 级 + 系统预置),可按工作区/可见范围/供应商筛选。工作区详情页旧入口保留(不破坏习惯)。
- normalized_requirement: 侧边栏有「智能体档案」一级菜单;全局页默认显示聚合视图,支持三维度筛选;工作区详情页快捷入口仍可达。
- impacts: [FR-1, FR-2, P5, app-shell.tsx, agent-profiles/page.tsx]
- evidence: 用户 AskUserQuestion 回答"全局聚合看" + 草图确认"可以继续";现网入口 `workspaces/[id]/page.tsx:361`
- priority: P0

## D-002@v1: 列表用卡片墙,突破 FRONTEND_PAGE_STYLE 表格基准
- type: boundary
- status: accepted
- source: user
- question: 档案列表用表格还是卡片?FRONTEND_PAGE_STYLE.md §4 基准是 DataTable 表格。
- answer: 用卡片墙(角色卡)。声明 agent-profile 列表为表格基准的**显式特例**,仅限本页,不外溢到其它列表页。
- normalized_requirement: agent-profile 列表渲染为卡片网格;卡片封装在 `agent-profile/` 目录组件内;其它列表页仍走 DataTable 基准。
- impacts: [P3, R-02, agent-profile-card-grid.tsx]
- evidence: 用户 AskUserQuestion 回答"卡片墙(推荐)";FRONTEND_PAGE_STYLE.md §4
- priority: P1

## D-003@v1: 表单带实时预览双栏,突破单列 Modal 基准
- type: boundary
- status: accepted
- source: user
- question: 8 字段平铺 Modal 填着不顺,表单形态怎么改?FRONTEND_PAGE_STYLE.md §6 基准是 520 Modal + 不用 Drawer。
- answer: 宽弹窗(~900px)双栏:左填字段、右实时预览角色卡。仍用 Modal(不违反 §6「不用 Drawer」),仅突破「单列宽度」。字段保留原 8 个,分 身份/大脑/能力 三组,每组带说明。
- normalized_requirement: 表单为双栏 Modal;左栏表单右栏实时预览;字段集与原一致(含 visibility=workspace 时归属工作区选择器);不用 Drawer。
- impacts: [P4, R-02, agent-profile-form.tsx]
- evidence: 用户 AskUserQuestion 回答"带预览的单页(推荐)"+ 方案 A preview 确认;FRONTEND_PAGE_STYLE.md §6
- priority: P1

## D-004@v1: 后端新增只读聚合端点支撑全局聚合
- type: boundary
- status: accepted
- source: code + user
- question: 全局聚合需要跨工作区查 actor 全部可见档案,但现有 API 只有按单工作区查(`/workspaces/{wid}/agent-profiles`)和 platform 级查(`/agent-profiles`)。纯前端并发拉 N 个工作区再聚合是反模式(R-性能/维护)。要不要动后端?
- answer: 新增只读聚合端点 `GET /api/agent-profiles?scope=mine`,后端一次返回 actor 可见档案并集(带 workspace_id+name)。纯加法,不动现有 CRUD 契约。可见性复用既有 `_can_read` 逻辑。
- normalized_requirement: 新增只读端点;返回带 workspace 归属;严守可见性(不泄露非成员 ws / 他人 private 档);现有端点零改动。
- impacts: [P1, R-01, router.py, service.py, schema.py, gen:types]
- evidence: `lib/agent-profiles.ts` 现有端点清单;service.py `_can_read`/`_is_workspace_member`;用户确认方案 A(含后端只读接口)
- priority: P0

## D-005@v1: 任务页选档下拉本次仅视觉对齐,不重做逻辑
- type: premise
- status: accepted
- source: architect
- question: `AgentProfileSelect`(任务详情页 `tasks/[tid]/page.tsx:472` 挂载)是否一并重做?
- answer: 不重做逻辑,仅做视觉对齐(与新卡片墙风格统一)。理由(YAGNI + 避免范围蔓延):选档下拉是另一交互场景(嵌入式选择器),本次核心诉求是档案管理页(列表+表单+入口),选档下拉顺带对齐样式即可。
- normalized_requirement: `agent-profile-select.tsx` 视觉对齐新 token;选项逻辑/兜底项/失效标记行为不变。
- impacts: [P6, agent-profile-select.tsx]
- evidence: `agent-profile-select.tsx` 现状(原生 select,select:99-117 偏离 antd §0);用户未单独提选档下拉诉求
- priority: P2

## D-006@v1: 全局页新建表单「工作区上下文」sourcing 策略(Grill B-3)
- type: boundary
- status: accepted
- source: design-grill
- question: 现 form 的 tool_policy_id/mcp_refs 下拉是 ws-scoped hook(`useWorkspaceToolPolicies`/`useWorkspaceMcpConfig`,form:159-160);全局页新建若无 ws 上下文,③能力 区会空数据。全局页新建 private/platform 档案(无 workspace_id)时这些引用从哪来?
- answer: 全局页新建表单首字段加「工作区上下文」必选选择器,数据源 `listWorkspaces()`(`@/lib/workspaces`,已存在)。visibility=workspace 时该字段=归属工作区(workspace_id=它);visibility=private/platform 时该字段仅 sourcing(workspace_id 落 null)。编辑态 private/platform 档案用「参考工作区」(默认 actor 首个可见 ws)。工作区内页路由自带 ws,无该选择器。
- normalized_requirement: 全局页新建表单有「工作区上下文」选择器(listWorkspaces 数据源);选定后 mcp/policy 联动有数据;workspace_id 按 visibility 决定(workspace 级=所选,private/platform=null)。
- impacts: [P4, R-03, agent-profile-form.tsx, 全局 page.tsx]
- evidence: `agent-profile-form.tsx:159-160` ws-scoped hooks;`@/lib/workspaces` listWorkspaces(workspace-switcher.tsx:58/123 在用)
- priority: P1

## D-007@v1: 侧边栏菜单经 menu-permissions.ts 数据源(Grill B-1)
- type: boundary
- status: accepted
- source: design-grill
- question: design v1 §6 写「改 app-shell.tsx 加菜单」,但侧边栏菜单条目数据源在 `lib/menu-permissions.ts` 的 `MENU_PERMISSION_GROUPS`,app-shell 只管图标映射 + 路径拼接。只改 app-shell 菜单不出现。
- answer: 在 `menu-permissions.ts` 的 agent section 加「智能体档案」条目(menuKey=agent-profiles, href=/agent-profiles, absolute:true, matchPattern:/agent-profiles, permissions:[]);permissions:[] 经 `permission.ts:41`(空=登录可见,D-003 同款)对所有登录用户可见;app-shell 的 MENU_ICON_MAP 加 /agent-profiles lucide 图标。
- normalized_requirement: menu-permissions.ts 新增 agent-profiles 条目(permissions:[]);app-shell MENU_ICON_MAP 加图标;菜单对所有登录用户可见,无需新增后端权限。
- impacts: [P5, menu-permissions.ts, app-shell.tsx]
- evidence: `menu-permissions.ts` MENU_PERMISSION_GROUPS 结构(agent section 已有 4 条);`permission.ts:41` `if (perms.length === 0) return true`(已核实,menu-permissions.ts:211-217 旧警告注释过时)
- priority: P1
