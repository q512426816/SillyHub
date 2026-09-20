---
author: qinyi
created_at: 2026-09-20T17:58:00+08:00
---

# 决策台账 — 2026-09-20-workspace-member-visibility

本变更的需求澄清/方案讨论中产生的、有实现或验收影响的决策。长期术语在 archive/scan 时再提升到 glossary.md。

## D-001@v1: 平台级「工作区读」收紧为纯功能入口

- type: requirement
- status: accepted
- source: user（需求澄清轮①，AskUserQuestion 拍板）
- question: 收紧后，平台级角色携带的 workspace:read（如 developer 系统角色）应变成什么语义？候选：纯功能入口 vs 维持现状只摘数据。
- answer: 纯功能入口。持有平台级 workspace:read 的用户能看见「工作区」菜单、能打开列表页（无成员身份时为空列表），但看不到任何工作区内容；工作区内容可见性回归成员制；平台管理员（is_platform_admin 标志 / platform:admin 权限）保持全量。否决「维持现状只摘数据」：治标不治本，管理员手工再授该权限即重开全量暗道。
- normalized_requirement: 平台级 workspace:read 不得授予任何具体工作区的内容访问；非成员持该权限时列表为空、直连工作区 URL 403；is_platform_admin 与 platform:admin 的全量可见不受影响。
- impacts: [design 总体方案、行为对照表、FR-01/FR-02]
- evidence: `backend/app/modules/auth/rbac.py:107-132`（has_permission 三段解析，平台段在 :124-126）；`backend/app/modules/workspace/router.py:351-362`（ql-20260917-007 平台分支）；实查 DB：180490 持 developer 角色平台级 workspace:read → 全量可见 5 个非成员工作区
- 模块域: auth, workspace
- priority: P0

## D-002@v1: 所有权限在工作区内的效力一并统一按成员算

- type: requirement
- status: accepted
- source: user（需求澄清轮②，AskUserQuestion 拍板）
- question: 其它权限（developer 角色还带 mcp:read、skill:read、agent_session:read、agent_profile:read）目前也是「平台级持有 = 在所有工作区内生效」。要一并统一吗？
- answer: 一并统一。所有权限在「某个工作区内部」的效力一律按成员算，平台级角色只管平台级功能（菜单入口、个人资产、平台管理）。彻底消除「开了菜单顺带拿到全部工作区内容」的暗道。否决「只收 workspace:read」：留下其它权限口径不一的割裂，同型问题会复发。
- normalized_requirement: 带工作区上下文的权限判定中，平台级授权段仅 platform:admin 放行（is_platform_admin 短路保留），对全部 Permission 枚举生效，不按权限白名单区分。
- impacts: [design 接口定义 has_permission 段、风险登记 R-02/R-03]
- evidence: `backend/app/modules/auth/rbac.py:124-126`（平台段无权限白名单，任何平台级权限均穿透）；developer 角色权限清单（实查 DB role_permissions：mcp:read/skill:read/agent_session:read/agent_profile:read 等 10 项）
- 模块域: auth
- priority: P0

## D-003@v1: 技术方案 A——判定链单点收紧 + 三触点对齐

- type: architecture
- status: accepted
- source: user（方案选择轮，AskUserQuestion 拍板）
- question: 怎么落地 D-001/D-002 的语义？候选：A 判定链单点收紧；B 角色数据治理（平台级角色禁止携带工作区效力权限）；C 权限模型拆分（入口权限/内容权限双枚举）。
- answer: 选方案 A。改 rbac.has_permission 单点（workspace_id≠None 时平台段仅 platform:admin 放行）+ 列表端点平台分支收窄 + 通知收件人段 2 收窄，三处口径联动。否决 B：mcp:read 等双用途权限（既开菜单又开工作区内容）无法从平台角色剥离，否则菜单消失，且手授即可重开暗道；否决 C：权限数量/种子/前端矩阵/存量数据全要动，过度设计。
- normalized_requirement: 语义变更落点限定三处——`rbac.has_permission` 平台段、`workspace/router.py` 列表平台分支、`rbac.list_user_ids_with_permission` 段 2；require_permission_any / auth/me 权限聚合 / 菜单门控不动。
- impacts: [design 总体方案 Phase 划分、文件变更清单、FR-03/FR-04/FR-05]
- evidence: `backend/app/modules/auth/rbac.py:107-132`（判定链）；`backend/app/modules/workspace/router.py:336-374`（列表端点）；`backend/app/modules/auth/rbac.py:179-194`（通知收件人段 2）；`backend/app/modules/notification/service.py:128`（消费方）
- 模块域: auth, workspace, NEW:notification
- 故障面: 三处若不同步会出现口径割裂（列表看得见进不去 / 收到通知看不了内容）——ql-20260917-007 的反向教训，验收用三口径一致性测试兜底
- 退役判据: 若未来引入「平台级巡视员」类需跨工作区只读的角色需求，重新评估平台级白名单机制（届时走新决策版本）
- priority: P0

## D-004@v1: 列表卡片「客户端路径」显示问题另开 quick，不纳入本变更

- type: scope
- status: accepted
- source: user（需求澄清轮③，AskUserQuestion 拍板）
- question: 列表卡片「客户端路径」显示创建者全局路径（workspaces.root_path）的问题怎么安排？
- answer: 另开 quick 单独修。本次变更聚焦权限语义；路径显示是纯前端展示口径问题（改为本人 binding 的 root_path / 未绑定显示空或引导），互不拖延。
- normalized_requirement: 本变更不改动 workspace-path-fields.tsx 与 workspaces.root_path 字段语义；路径显示修复走独立 quick 变更。
- impacts: [design 非目标]
- evidence: `frontend/src/components/workspace-path-fields.tsx:105`（客户端路径 = workspace.root_path 全局列）；实查 DB：workspaces.root_path 均为创建者 admin2 本机路径
- 模块域: frontend_components
- priority: P2
