---
author: qinyi
created_at: 2026-08-23 03:58:12
scale: large
tier: independent
---

# 设计文档（Design）— 会话门户工作区中心化与预会话态

## 1. 背景

会话门户（SessionsPortal，2026-08-22-workspace-sessions-portal 刚统一三入口）当前的新建体验仍带"配置表单"心智：右侧渲染 NewSessionForm（ql-20260822-010 已改聊天优先，但仍是表单页），用户感知上"新建"与"聊天"是两个页面。用户期望：**点新建直接进入与正常聊天完全一致的会话界面，配置上下文自动解析，第一句话发送的那一刻才真正创建会话**；左侧列表从平铺时间序改为按工作区组织（参考 ZCode 客户端"工作区和任务"页形态），让"在哪个工作区/机器上聊过什么"一目了然。

既有资产：D-005 默认机器三级回退、D-004@v2 机器/智能体建后不可换、workspace 绑定机器链路（fetchMyBindings→daemon_id 在线校验）、dialog 模式"输入→createSession→SSE 接管"完整链路（session-panel dialog idle 态先例）、三入口 scope 判别联合（D-001@v1）。

## 2. 设计目标

- FR-01 左侧改为工作区树：按 workspace_id 分组手风琴（组头=名称+会话数+「＋」新建+展开箭头），组内按机器分小节（小节标题=机器名+在线点）；「非工作区」固定末尾分组（组头同样有「＋」）。
- FR-02 顶部两层筛选 tab：第一层机器（含「全部」），选中机器后出现第二层智能体（引擎）；筛选态下树内条目过滤、机器小节标题隐藏（已隐含）；「全部」清空筛选。
- FR-03 预会话态：点组头「＋」→ 右侧渲染与正常会话**完全同构**的 SessionPanel 空态（同面板头/时间线/输入区），顶部一行锁定上下文（📂工作区·🖥机器·⚡智能体，创建后不可换标识）；第一句话发送时才调 createSession，成功后同一界面原地开聊（SSE 接管）；不发言离开不残留空会话。
- FR-04 新建上下文解析：筛选态（机器+智能体 tab 已选）点「＋」直接带 tab 上下文进预会话；全部态点「＋」先弹两步轻量选择浮层（①在线机器 ②智能体），选完直接进预会话——浮层是选择器不是配置表单，两步即达。工作区维度上下文恒为组所在工作区；机器优先取工作区绑定在线机器，非工作区/无绑定走 D-005 三级回退。
- FR-05 会话条目增强：chips 附加创建人（owner_name）。**Grill X-09 修正**：现状列表 SQL 强制按创建人隔离（session/service.py:2453 `user_id == user_id`），本人视图下 owner_name 恒为本人——chip 作为信息完备项保留（显"我"），为未来会话共享场景预留字段与渲染，不宣称当前有区分度。条目其余信息（状态点/标题/相对时间/引擎/档案/供应商）沿用现状。
- FR-06 入口收敛：全局 /sessions = 完整工作区树；/workspaces/[id]/sessions = 深链预展开+滚动到该工作区分组；变更入口 /workspaces/[id]/changes/[cid]/sessions 保持独立页面（预会话上下文行加显变更名，不并入全局树）。NewSessionForm 三入口统一退役。

## 3. 非目标（Non-Goals）

- 不改任何 session/turn 生命周期与 daemon 协议（createSession 请求体语义不变，只是调用时机变为预会话首句发送）。
- 不做会话内切换机器/智能体（D-004@v2 维持，跨机器仍标"二期"）。
- 不做按工作区的服务端聚合端点（客户端分组够用，见 D-103）。
- 不做全局虚拟滚动保留（分组结构下改组内限高滚动，数据量评估见 R-04）。
- 不改 change 入口独立页形态、不做变更会话并入全局树（D-106）。
- 左侧现状能力边界（Grill X-11 固化）：**状态筛选下拉保留**（组内过滤）；**批量删除保留**（组头尾随多选态入口）；引擎胶囊 tab 由两层筛选 tab 的智能体层取代；change 独立页左侧维持现状 scope 列表不改树。

## 4. 拆分判断

单一页面族 IA 重构（左侧树+右侧预会话+入口收敛三块紧耦合在同一门户组件族），不拆分、不走批量（无模板×N 重复模式）。

## 5. 总体方案（Wave）

- **Wave 1 后端小改 + 类型**：列表端点补 owner_name（SQL join users）；`pnpm gen:types` 同步。
- **Wave 2 SessionPanel 预会话态**：sessionId=null 渲染同构空态；SSE/队列/轮询/team-missions/深链 effect 加 null 守卫（守卫清单化）；首句发送走 createSession→session_id 就位→状态机自然接管（复用 dialog idle 链路）；创建失败输入保留可重试。
- **Wave 3 左侧工作区树**：SessionListPanel 重构为两层筛选 tab + 工作区分组手风琴 + 机器小节 + 创建人 chip；数据一次拉取（limit 500）客户端分组（D-103）；组头「＋」交互（筛选态直带上下文 / 全部态弹两步浮层）。
- **Wave 4 门户接线与入口收敛**：SessionsPortal 双态（选中会话=SessionPanel 真会话 / 预会话=SessionPanel 空态）替换 NewSessionForm；?session= 深链保留；workspace 入口深链预展开；NewSessionForm + 其锁定表单测试退役；change 入口接预会话（bind 语义转 preContext）。
- **Wave 5 回归与实证**：全量 vitest/tsc/lint + 部署 + 浏览器实证（原型对照）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/router.py | ①limit 上限放宽 le=100→500（router.py:1817，D-103 一次拉取前提，否则 Wave3 直接 422——Grill X-07） |
| 修改 | backend/app/modules/daemon/session/service.py | ②列表端点补 owner_name：producer=列表 SQL（:2408-2497，runtime JOIN users 先例 schema.py:255/296）join users.username（owner 缺失 NULL 兜底）→ consumer 见下一行 |
| 修改 | backend/app/modules/daemon/schema.py | SessionRead DTO `owner_name: str \| null`（AgentSessionRead）→ frontend pnpm gen:types（api-types.ts）→ consumer=SessionListPanel 创建人 chip（null 显"—"） |
| 修改 | frontend/src/lib/daemon.ts | AgentSessionRead 类型随 gen:types 更新（禁手写）；列表调用参数如需 limit 调整在此收口 |
| 修改 | frontend/src/components/daemon/session-panel.tsx | 预会话态：page 分支 null 行为改造（现 :203 sessionId null 防御性 return null → 渲染同构空态；SessionPanelPage :224 sessionId 窄化放宽）；null 守卫清单（Grill X-04 补全）：SSE effect / useMessageQueue 激活 / **page 模式 detailQuery+refetchInterval 轮询（:428-436，null 不得发 getAgentSession(null)）** / **page 模式 fetchPendingDialogs+fetchSessionDialogHistory 恢复 effect（:708-736，dialog 版已有守卫、page 版现无）** / team missions（已有守卫 :302-315 保持）；首句 createSession 链路（复用 dialog idle 先例 :2359-2421，但失败语义改造：dialog 现状先清输入再建、失败输入已丢——预会话须失败保留输入可重试 + 传 runtime_id 而非 provider） |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | 重构为两层筛选 tab（机器>智能体+全部）+ 工作区分组手风琴 + 机器小节 + owner chip；客户端分组（D-103）；组头＋回调 onNewInGroup(workspaceId, filterCtx) |
| 新增 | frontend/src/components/sessions/pre-session-picker.tsx | 全部态新建的两步轻选择浮层（①在线机器 ②智能体），两步即达非配置表单 |
| 修改 | frontend/src/components/sessions/sessions-portal.tsx | 双态接线（预会话 preContext 状态机替换 NewSessionForm 渲染分支）；?session= 深链保留；workspace 入口深链预展开分组 |
| 删除 | frontend/src/components/sessions/new-session-form.tsx（+ 其测试） | D-109 三入口统一退役，被预会话态替代；bindWorkspaceId/bindChangeId 语义由 preContext 继承 |
| 删除 | frontend/src/components/sessions/workspace-session-picker.tsx（+ 其测试） | 随 NewSessionForm 退役（真实消费仅表单；绑定映射语义由门户 preContext 解析继承） |
| 修改 | frontend/src/app/(dashboard)/sessions/page.tsx | 薄壳随门户 props 微调 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/sessions/page.tsx | 薄壳随门户 props 微调（workspace 入口预展开由门户内部处理） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/sessions/page.tsx | change 入口传 preContext（含 changeId，显式双传 X-13） |
| 测试 | 对应 __tests__（session-list-panel/session-panel/sessions-portal/pre-session-picker + backend daemon 列表 + app/(dashboard)/sessions 页面测试迁移） | 新行为用例 + NewSessionForm 用例迁移/退役（R-06 清单） |

## 7. 接口定义

```ts
/** 预会话上下文（组头「＋」解析产物，SessionPanel 空态渲染与首句创建共用）。 */
export interface SessionPreContext {
  workspaceId: string | null; // null = 非工作区分组
  changeId?: string | null;   // 变更入口独立页传入（change 级隐含 workspace）
  runtimeId: string;          // 机器+引擎已定（绑定优先/D-005 回退/筛选 tab/浮层选择）
}
// SessionPanel props：sessionId: string | null（null 且无 preContext = 空门户态）
// 首句发送 = createSession({ runtime_id, prompt, manual_approval: true, ask_user_only: true,
//   ...(workspace_id), ...(change_id) })——请求体契约与现行完全一致。
// Grill X-13 固化：change 入口调用方必须显式双传 preContext.workspaceId + changeId
//（先例 new-session-form.tsx bindChangeId 契约"调用方须同时给 bindWorkspaceId"）。
```

后端：`AgentSessionRead.owner_name: string | null`（列表 join users；旧数据/无主 NULL）。

## 7.5 生命周期契约表

本变更**不新增、不修改**任何生命周期事件——预会话首句发送是既有 `create session` 事件的新调用时机（此前由 NewSessionForm 触发），事件契约原样引用：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| create session | 前端（预会话首句，原表单提交） | backend /api/daemon/sessions → daemon | runtime_id, prompt, workspace_id?, change_id?, agent_profile_id?, llm_provider_id?, manual_approval, ask_user_only | 会话建立，daemon spawn 进程，session active |
| turn result | daemon | backend（SSE envelope） | run_id, status, input/output_tokens | running → completed/failed/killed |
| session end | daemon | backend | session_id, reason | active → ended |

## 8. 数据模型

无表结构变更。仅列表查询层 join users 补 owner_name 只读字段。

## 9. 兼容策略（brownfield）

- 后端列表 owner_name 为可空新字段：旧会话 owner 缺失返回 null，前端 chip 兜底"—"；未上线模块无历史兼容负担（CLAUDE.md 规则 11）。
- `?session=` 深链行为不变（选中会话直达）；深链无效仍落空态（现为新建表单态 → 改为空门户态）。
- change 入口路由与锁定语义不变，仅渲染载体从表单换预会话态。
- daemon 协议、createSession 请求体零变化——旧客户端（若有）行为不受影响。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | SessionPanel null 守卫遗漏（SSE/消息队列/attach 轮询/team missions/深链验证在无会话态误激活） | P0 | 守卫清单化逐项过（Grill X-04 补全：page detailQuery 轮询、page pending-dialogs/dialog-history 恢复 effect、SSE effect、队列激活；team/attach 已有守卫保持）；预会话态专项测试（各 effect 断言零调用） |
| R-02 | 首句创建失败体验（网络/422） | P1 | 失败保留输入+内联错误+重试；不切真会话态 |
| R-03 | 全量拉取数据量（limit 500）超限 | P2 | 组内条目截断显示（最近 50+「显示全部」）；个人使用评估 <200 条 |
| R-04 | 分组结构替代全局虚拟滚动的长列表性能 | P2 | 组内限高滚动+分组折叠天然限载；回归验证 |
| R-05 | 筛选 tab 与工作区树正交组合的状态爆炸（机器 tab × 分组 × 展开态） | P1 | 筛选为纯视图过滤（不进数据层）；筛选切换重置展开态除当前组 |
| R-06 | NewSessionForm 退役夹带（门户/列表/表单三方测试耦合） | P1 | Wave 4 单独退役+测试迁移清单（每条旧断言落新家或注明有意删除） |
| R-07 | 三入口行为回归（D-001 契约） | P1 | 三入口各一条端到端实证（列表源/标题/深链/预会话上下文） |

## 11. 决策追踪

- D-101@v1 预会话渲染载体=SessionPanel sessionId=null 同构空态（用户硬约束"不要独立页面"）→ FR-03/§5 Wave2
- D-102@v1 首句创建时机=发送动作触发 createSession（后端 prompt 首句约束由发送满足，零协议改动）→ FR-03/§7.5
- D-103@v1 左侧数据=一次拉取 limit 500 客户端分组 → FR-01/§5 Wave3
- D-104@v1 预会话上下文行完全锁定不可改（用户决策）→ FR-03
- D-105@v1 非工作区分组保留新建（机器走 D-005 回退）→ FR-01/FR-04
- D-106@v1 变更入口独立不并入全局树 → FR-06
- D-107@v1 两层筛选 tab+全部按钮；筛选态＋直带上下文、全部态＋两步浮层 → FR-02/FR-04
- D-108@v1 创建人 chip（后端补 owner_name join）→ FR-05/§6
- D-109@v1 NewSessionForm 三入口退役 → FR-06
- 沿用既有：D-005（机器三级回退）、D-004@v2（建后不可换）、D-001@v1（三入口统一）、D-003@v2（scope 端点过滤参）——本变更不推翻任何一条。

## 12. 自审

- 生命周期关键词命中（session）→ §7.5 已含契约表且注明零变更。✅
- 文件清单含对外新字段 owner_name → §6 已标 producer→consumer 数据流（SQL join → DTO → gen:types → chip）。✅
- 用户四条修改意见（创建人/主题色/同构/两层 tab）逐条对应 FR-05/§9 原型/D-101/D-107。✅
- 体验硬约束"新建=正常会话界面"由 D-101 同构渲染+D-102 原地接管满足，无独立页面。✅
- 残留：R-03/R-04 数据量与滚动性能需 Wave 5 实证；筛选态下组头「＋」上下文优先级（tab 筛选 > 工作区绑定 > D-005 回退）在 plan 的接口细节里固化。
- **Design Grill 修正记录**（独立审查 pass/pass，3 P1 gap 已修）：X-07 limit 上限 le=100→500 补入 §6 后端清单；X-04 R-01/§6 守卫清单补全（page detailQuery 轮询+dialog 恢复 effect，纠正"attach 轮询"措辞）+ 复用链路失败语义/参数改造点明示（X-02/X-03）；X-09 D-108 动机修正（FR-05/D-108@v2）；X-11 左侧能力边界固化（§3）；X-13 change 双传固化（§7）。
