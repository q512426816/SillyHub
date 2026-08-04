---
author: qinyi
created_at: 2026-08-04 16:48:00
---

# 需求规格（Requirements）

> 变更 `2026-08-04-agent-profile-ui-redesign`。FR 覆盖全部当前版本决策 D-001~D-007(见末尾矩阵)。

## 角色

| 角色 | 说明 |
|---|---|
| 普通用户(actor) | 创建/管理自己的 private 档案、使用所属工作区的 workspace 级档案、查看 platform 级档案 |
| 工作区成员 | 在所属工作区内创建/编辑 workspace 级档案 |
| 平台管理员(admin) | 创建/管理 platform 级档案、跨工作区移动档案 |

## 功能需求

### FR-01: 侧边栏一级菜单入口
覆盖决策:D-001@v1, D-007@v1

**Given** 任意已登录用户
**When** 打开侧边栏「智能体」分组
**Then** 看到「智能体档案」菜单项;点击跳转 `/agent-profiles`

**Given** 菜单数据源 `lib/menu-permissions.ts`
**When** agent section 含 `agent-profiles` 条目(permissions:[])
**Then** 经 `permission.ts:41`(空 perms=登录可见)对所有登录用户可见,无需新增后端权限

### FR-02: 全局聚合视图
覆盖决策:D-001@v1, D-004@v1

**Given** 用户在 `/agent-profiles` 全局页
**When** 页面加载
**Then** 调用 `GET /api/agent-profiles?scope=mine`,展示该用户可见的全部档案(个人 private 全集 + 所在各工作区 workspace 级 + 全部 platform 级 + 系统预置),每条带 workspace 归属名

**Given** 用户不属于工作区 X
**When** 查看全局聚合结果
**Then** 看不到工作区 X 的 workspace 级档案(越权防护,见 FR-03)

### FR-03: 聚合端点可见性越权防护
覆盖决策:D-004@v1

**Given** actor A 与 actor B 是不同用户,A 不在 B 的任何工作区
**When** A 调用 `GET /api/agent-profiles?scope=mine`
**Then** 返回结果不含 B 的 private 档案,不含 A 非成员工作区的 workspace 级档案

**Given** 后端 `service.list_visible_all(actor)`
**When** 构建可见集
**Then** 逐档用 `_can_read_async(profile, actor)` 判定(非拼 ws clause),platform/系统预置按 id 去重

### FR-04: 卡片墙列表
覆盖决策:D-002@v1

**Given** 档案列表数据已加载
**When** 渲染列表
**Then** 以卡片网格展示(非表格);每张卡含:头像、名称、可见范围 tag、供应商/模型、人设摘要(2 行截断)、能力标签、版本、操作

**Given** 某档案为系统预置(is_system_default)
**When** 渲染其卡片
**Then** 显示「系统预置」+「只读」,不显示编辑/复制/删除按钮

### FR-05: 搜索与筛选
覆盖决策:D-001@v1(全局视图)

**Given** 全局页顶部搜索框
**When** 输入关键词(回车触发)
**Then** 按档案名或系统提示词匹配过滤

**Given** 三个筛选下拉(工作区/可见范围/供应商)
**When** 选择某筛选值(onChange 即时触发)
**Then** 列表按该维度过滤

### FR-06: 带实时预览的重做表单
覆盖决策:D-003@v1, D-006@v1

**Given** 用户点「新建档案」或「编辑」
**When** 打开表单
**Then** 宽弹窗(~900px)双栏:左填字段、右实时预览角色卡(随左边输入即时更新);字段分 身份/大脑/能力 三组,保留原 8 字段(name/visibility/provider/model/system_prompt/tool_policy_id/mcp_refs/skill_refs)

**Given** 全局页(`/agent-profiles`)新建
**When** 表单加载
**Then** 首字段「工作区上下文」必选(数据源 `listWorkspaces()` @/lib/workspaces);选定后 ③能力(mcp/policy)按该 ws sourcing

**Given** visibility=workspace 且选定工作区上下文
**When** 保存
**Then** workspace_id=所选工作区(归属)

**Given** visibility=private/platform
**When** 保存
**Then** workspace_id=null(工作区上下文仅作 sourcing,不改归属)

### FR-07: 人设预览
覆盖决策:(用户需求,无新决策)

**Given** 用户点击某档案卡片
**When** 弹出人设预览
**Then** 展示 system_prompt 原文 + 模拟「prepend 到 CLAUDE.md 顶部」的片段(纯前端只读,不真注入)

### FR-08: 系统预置档案只读(保留前置变更行为)
覆盖决策:(前置变更保留)

**Given** 档案 is_system_default=true
**When** 用户尝试编辑/删除
**Then** 前端不显示操作按钮;后端拒改拒删(前置变更已实现)

### FR-09: 选档下拉视觉对齐
覆盖决策:D-005@v1

**Given** 任务详情页的「智能体档案」选档下拉(`agent-profile-select.tsx`)
**When** 渲染
**Then** 使用 antd Select(showSearch + optionFilterProp);保持现有逻辑(数据合并/兜底项/失效标记/onChange null 语义)不变

### FR-10: 工作区内页复用卡片墙
覆盖决策:D-001@v1(保留入口)

**Given** 用户从工作区详情页快捷入口进入 `/workspaces/[id]/agent-profiles`
**When** 页面加载
**Then** 复用卡片墙组件 + workspace 预筛(仅该工作区范围);新建表单 workspaceId=路由工作区(无「工作区上下文」选择器)

## 非功能需求

- **兼容性**:原 `GET /api/workspaces/{wid}/agent-profiles` 不动;`GET /api/agent-profiles`(无 scope)行为冻结(platform 级,AgentProfileSelect 依赖);`AgentProfileRead` 类型不动,新增 `AgentProfileAggregatedItem` 扩展;profile=None 兜底链不变。
- **可回退**:新端点为加法,移除后系统回退到原按工作区访问;全局页移除后工作区内页仍可用。
- **可测试**:FR-03 越权有 service 单测 + 集成测;FR-04/06/10 有组件测试;`tsc --noEmit` + `eslint` 0 error。
- **平台兼容**:前端 next.js + antd + tailwind,Windows/Linux/macOS 构建一致。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02, FR-05, FR-10 | 独立菜单 + 全局聚合视图 |
| D-002@v1 | FR-04 | 列表卡片墙(突破表格基准) |
| D-003@v1 | FR-06 | 表单带预览双栏(突破单列 Modal 基准) |
| D-004@v1 | FR-02, FR-03 | 后端只读聚合端点 + 越权防护 |
| D-005@v1 | FR-09 | 选档下拉仅视觉对齐 |
| D-006@v1 | FR-06, FR-07(工作区上下文 sourcing) | 全局页新建工作区上下文 |
| D-007@v1 | FR-01 | 菜单经 menu-permissions.ts 数据源 |

全部 D-001~D-007 被 FR 覆盖,无剩余未覆盖决策。剩余风险(非阻断,P2):R-02 突破基准回写 FRONTEND_PAGE_STYLE(plan 落实)、R-07 owner-left-ws 边界单测(plan 补)。
