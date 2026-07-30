---
author: qinyi
created_at: 2026-07-30 08:35:17
change: 2026-07-29-sidebar-menu-restructure
---

# 决策台账 — SillyHub 侧边栏菜单信息架构重组

## D-001@v1: 菜单按功能域重组为 5 组 + ppm 隔离

- type: architecture
- status: accepted
- source: user
- priority: P0
- question: 侧边栏菜单如何重新分组，解决"分组杂、同类功能分散"的问题？
- answer: 按功能域重组为 5 个语义分组——工作区 / 智能体 / 配置中心 / 协作治理 / 系统管理；ppm 组保持隔离不变。用户在方案 preview 中确认。
- normalized_requirement: `MenuSection` 联合类型改为 `workspace/agent/config/governance/system/ppm`；菜单项按 §5.1 表格归属各组；ppm 隔离逻辑不变。
- impacts: [FR-01, design §5.1]
- evidence: 用户在 AskUserQuestion 选择"按功能域重组(推荐)"preview；`menu-permissions.ts`

## D-002@v1: 「我的供应商」提为独立菜单 + 独立路由，可见性用可分配权限

- type: boundary
- status: accepted
- source: user + code
- priority: P0
- question: 「我的供应商」如何成为可直达的独立菜单？可见性给谁、怎么控制？
- answer: 新建独立路由 `/settings/providers` 复用 `LlmProviderSection`，菜单直达。可见性用新增权限 `llm_provider:read` 控制：platform admin 短路可见，普通成员由管理员在角色管理分配（用户答"分配"）。后端 `llm_provider` 本为 per-user（router 所有端点按 `current_user.id` 过滤、`get_current_user`），本次不改其后端鉴权。
- normalized_requirement: 菜单项 `llm-providers` href=`/settings/providers`、permissions=`llm_provider:read`；后端 `permissions.py` 新增 `LLM_PROVIDER_READ`；不做 migration 默认全员赋权。
- impacts: [FR-02, FR-05, design §5.2/§5.3]
- evidence: 用户答"分配"；`llm_provider/router.py:1-6`（per-user owner 级注释）；`rbac.py`

## D-003@v1: 技能/MCP 提为独立菜单，指向平台级

- type: boundary
- status: accepted
- source: user
- priority: P1
- question: 「技能管理」「MCP 管理」有平台级（`/settings/skills`、`/settings/mcp`）与工作区级（`/workspaces/[id]/skills`、`/workspaces/[id]/mcp`）两套，侧边栏菜单指向哪套？
- answer: 指向平台级那套（对应设置页现有卡片入口），复用 `settings:admin` 权限；工作区级仍在工作区内部访问，不在侧边栏单列。
- normalized_requirement: 菜单项 `skills`/`mcp` href 分别为 `/settings/skills`、`/settings/mcp`、permissions=`settings:admin`、归入智能体分组。
- impacts: [FR-03, design §5.1]
- evidence: 用户选择"平台级那套(推荐)"；`settings/page.tsx:445-470` EntryCard

## D-004@v1: 设置页瘦身，仅留平台级配置

- type: boundary
- status: accepted
- source: user
- priority: P1
- question: 供应商/技能/MCP 提为独立菜单后，原「设置」页如何处理？
- answer: 设置页瘦身，仅保留工作区信息 / 智能体配置 / 安全策略 / 集成 4 个平台配置 Tab；移除顶部 4 个 EntryCard 卡片入口（技能/MCP/API 密钥/Git 身份）与"我的供应商" Tab，统一从侧边栏进入，消除双入口。
- normalized_requirement: `settings/page.tsx` 删除 EntryCard 区块与 providers Tab 及 `LlmProviderSection` 引用；默认 Tab 改为工作区信息。
- impacts: [FR-04, design §5.2]
- evidence: 用户选择"设置页瘦身(推荐)"；`settings/page.tsx`

## D-005@v1: 菜单视觉统一

- type: architecture
- status: accepted
- source: user
- priority: P2
- question: 是否顺带统一菜单视觉（图标/间距/高亮）？
- answer: 一并统一：侧边栏图标统一为 lucide 线条图标（消除 emoji 与线条图标混用），分组标题间距与选中高亮样式统一。
- normalized_requirement: `app-shell.tsx` 的 `MENU_ICON_MAP` 补齐新菜单图标；新增菜单项有对应 lucide 图标；分组间距/高亮样式一致。
- impacts: [FR-06, design §5.3 Phase 3]
- evidence: 用户选择"一起优化"；`app-shell.tsx` MENU_ICON_MAP

## D-006@v1: 「守护进程运行时」归入配置中心

- type: boundary
- status: accepted
- source: user
- priority: P1
- question: 「守护进程运行时」归属哪个分组？
- answer: 归入配置中心（非系统管理）。其管理的是 daemon 实例/版本等平台运行资源，与供应商/密钥/Git 身份同属"平台资源配置"。系统管理组保留用户/组织/角色/设置等平台治理项。
- normalized_requirement: 菜单项 `runtimes` section 设为 `config`。
- impacts: [FR-01, design §5.1]
- evidence: 用户反馈"守护进程运行时 应该放 配置中心 里"
