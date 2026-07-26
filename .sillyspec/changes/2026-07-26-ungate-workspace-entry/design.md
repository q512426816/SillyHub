---
author: qinyi
created_at: 2026-07-26 14:05:00
scale: large
---

# 设计文档（Design）— 工作区入口门禁后移（daemon 要求下沉到操作点）

## 1. 背景

当前"绑定 daemon"是工作区**进门闸**：

- 列表页 `workspaces/page.tsx` `handleActivate`、顶栏 `workspace-switcher.tsx` `handleClickEntry`、移动端 `m/workspaces/page.tsx` `handleActivate`：未绑定（`daemon_id=null`）→ 弹 `WorkspaceBindingDialog`（"配置此工作空间的守护进程 / 绑定你的守护进程和本地路径后才能进入工作区"），不导航。
- 详情 `WorkspaceBindingGuard`（`workspaces/[id]/layout.tsx`）：未绑定 → 渲染 `WorkspaceAccessGuide` 绑定表单（替换主区）。

`2026-07-25-daemon-borrow-for-business` 已让 `business_member`（`canBorrowSharedDaemon`）绕过进门闸（commit `9164746b`，ql-20260726-004），但**纯查看成员、临时协作者、未配 daemon 的开发人员**仍被拦死——进不去、看不了服务器端文档。

查证结论（commit 基线 main @ `9164746b`，本地 Docker 全栈在线）：

- **文档/数据类页面 daemon 无关**：文件中心（MinIO `file` 表）、变更中心（DB spec）、成员管理、知识库、审计、审批、发布、事故——数据都在服务器，读取不经 daemon。
- **daemon 依赖点有限**：agent 触发（own ∨ borrow ∨ 报错，task-13 已处理）、运行时页（daemon 实体信息）、扫描文档/读源码（host_fs delegate）、组件拓扑（读源码）。
- **binding 概念仍需要**：`workspace_member_runtimes`（`daemon_id` + `root_path` + `shared`）是开发人员"把自己的 daemon 接入工作区"的载体——跑自有 agent、标 `shared` 借出、host_fs `root_path` 解析都依赖它。**问题不是 binding 本身，是把它做成了进门闸**。
- 后端工作区访问鉴权已基于 membership（`user_workspace_roles`）+ platform_admin，与 daemon 无关——进门自由化是**纯前端改造**，无后端/无 schema 变更。

## 2. 设计目标

- **工作区 = 类 git 仓库容器**：成员（+平台管理员）随时可进，进门不要求 daemon。
- **daemon 要求下沉到操作点**：只在跑 agent / 读源码 / 看运行时等真正需要 daemon 的功能点要求；成员无自有 daemon 时，这些点显示**内联空态引导**（非阻断），可配/可借。
- **文档类完全 daemon 无关**：文件中心、变更中心、成员、知识库等随时可看。
- **binding 降级为可选配置**：开发人员在设置页配自己 daemon（跑自有 agent + 标 shared 借出），进门不再依赖。
- 零回归：已绑定用户的现有行为（编辑接入配置、跑自有 agent、借出共享）完全不变。

## 3. 非目标

- **不动 binding 数据模型**：`workspace_member_runtimes` 表/schema 不变；`shared` 列（daemon-borrow）不动。
- **不动后端**：无 API/schema/鉴权变更（membership 进门权后端已强制）。
- **不动 agent 页**：task-13 的 `canBorrow` 门禁已正确，不改。
- **不动 daemon-borrow 借用链路**：borrow 解析/沙箱/落 file/审计均不动。
- **不做 binding 配置的引导强化**（首次进入弹窗等）：binding 纯可选，概览页 soft nudge 即可，不再做强引导。
- **不重构工作区 tabs 结构**：tabs 不变，只改各页面对"无 daemon"的兜底。

## 4. 拆分判断

- **单变更**，前端为主，多 Phase。目标单一（门禁后移），不拆子变更。
- **不走批量模式**：非 N 个相似页面（各 daemon 依赖页接入逻辑相似但上下文不同，统一组件复用即可）。
- 纯前端，跨多个工作区页面，UX 模型变化 → `scale=large`，走 plan→execute。

## 5. 总体方案（方案 A：门禁完全后移 + 统一空态）

核心数据流/交互：

```
成员点工作区（任意绑定状态）
  → 列表/switcher/移动端 直接导航（不弹绑定框）
  → 进 workspaces/[id]/overview
     ├─ 有 binding：原行为（编辑接入配置入口、跑 agent、读源码 …）
     └─ 无 binding：
        · 概览页：soft nudge 卡（"想跑 agent/读源码?配 daemon 或借"）— 非阻断
        · 文档类页（files/changes/members/...）：正常浏览（daemon 无关）
        · daemon 依赖页（runtime/scan-docs/components 源码/agent 触发）：
          内联 DaemonRequiredNotice（"⚠ 此功能需守护进程" + [配置]/[借用]）— 非阻断
        · 设置页：「我的接入配置」卡片（开发人员配 daemon + 标 shared）— 可选
```

### Phase 1 — 进门自由化（4 入口点）

移除"未绑定→拦"分支，点工作区一律导航/切换：

- `workspaces/page.tsx` `handleActivate`：删 `setBindingTarget` 分支，always `router.push`；删 `bindingTarget` state + 列表页对 `WorkspaceBindingDialog` 的进门用法（组件保留供设置页）。
- `workspace-switcher.tsx` `handleClickEntry`：删 `setBindingTargetId` 分支，always `switchWorkspace`；删顶栏对 `WorkspaceBindingDialog` 的进门用法。
- `m/workspaces/page.tsx` `handleActivate`：删 `setBindingTarget` 分支，always `message.info("请在电脑端打开")`（移动端不导航，原行为）。
- 零回归：已绑定用户原就是导航，行为不变；`canBorrowSharedDaemon` 判定（ql-004）随进门闸移除而不再需要于入口点（agent 触发点仍用）。

### Phase 2 — Guard 降级（从进门闸 → 可选编辑入口）

`workspace-binding-guard.tsx`：

- `state=unbound`：**不再渲染** `WorkspaceAccessGuide` 绑定表单。return `null`（概览页 soft nudge 接管引导）。
- `state=bound`：保留"编辑我的接入配置"按钮（已绑定用户编辑入口，零回归）。
- guard 从 layout 内的"阻断性表单"降级为"已绑定用户的编辑按钮"。

### Phase 3 — 概览 binding 配置卡（复用既有 WorkspaceConfigCard，不新建）

查证：`workspaces/[id]/page.tsx`（概览）**已渲染** `<WorkspaceConfigCard>`（page.tsx:8 import），且已 `fetchMyBinding`（page.tsx:52/100）、用 `myBinding.daemon_id`（page.tsx:132）。该卡片内部含 `WorkspaceAccessGuide`（绑定/编辑表单）+ scan/init/sync 逻辑，是 `SectionCard`（非阻断卡片，非进门闸）。

故 **Phase 3 + Phase 6 合并**：guard 降级（Phase 2）后，概览页这张既有的 `WorkspaceConfigCard` 自然成为"可选接入配置"入口——

- 有 binding：原行为（显示已绑 daemon 信息 + 编辑/同步/scan）。
- 无 binding：卡片渲染 `WorkspaceAccessGuide` 首次绑定引导（已是卡片内、非阻断、与文档/变更统计共存）。
- **不另建 soft nudge / 不另建设置页新卡片**——避免与既有 `WorkspaceConfigCard` 重复（R-05 消解）。
- 唯一可能微调：若 `WorkspaceConfigCard` unbound 态渲染过重（占满主区），plan 阶段核实并按需收敛为轻量引导（保留 [配置] 入口）。

### Phase 4 — 统一空态组件 `DaemonRequiredNotice`（新）

新组件 `frontend/src/components/daemon-required-notice.tsx`：

```ts
interface Props {
  feature: string;            // "运行时" / "扫描文档" / "源码浏览"
  workspaceId: string;
  canBorrow: boolean;         // canBorrowSharedDaemon 结果
  onConfigured?: () => void;  // 配置成功回调（刷新 binding）
}
```

渲染："⚠ {feature} 需要守护进程" + 简短说明 + 按钮组：
- 始终：[配置我的 daemon]（展开 `WorkspaceAccessGuide` 首次模式）。
- `canBorrow=true` 时：[借用共享 daemon] 提示（"你已有借用能力，去 agent 页触发即可"——因借用发生在 agent 派发，非读源码页；此处仅说明引导）。

内联、非阻断——仅替换"该功能依赖 daemon 的主区"，页面其余部分正常。

### Phase 5 — daemon 依赖页接入空态

逐一接入 `DaemonRequiredNotice`（成员无自有 daemon 时主区渲染空态）：

- `workspaces/[id]/runtime/page.tsx`：运行时信息来自 daemon，无 binding 时空态。
- `workspaces/[id]/scan-docs/page.tsx`：读源码经 host_fs，无 binding 时空态。
- `workspaces/[id]/components/page.tsx`（组件拓扑读源码）：同。
- `agent` 页：**不改**（task-13 已 `canBorrow` 处理）。
- 接入判定：各页主数据 fetch 依赖 daemon（host_fs / daemon 实体）→ 无 binding 渲染空态；fetch 不依赖 daemon 的页不接入。

### Phase 6 — 设置页 binding 卡片（已存在，复用 WorkspaceConfigCard）

查证：binding 配置卡片**已存在**——`frontend/src/components/workspace-config-card.tsx`（用 `WorkspaceAccessGuide` + `fetchMyBinding`，挂在概览页 `workspaces/[id]/page.tsx:8`）。开发人员在此配自己 daemon（首次绑定）+ 编辑（回填 daemon_id/root_path）+ scan/init/sync。

故 **Phase 6 无新建**：

- 复用既有 `WorkspaceConfigCard`（已是 `SectionCard`，非阻断）。
- daemon-borrow 的 `shared` 标记由 `shared-daemon-toggle`/`shared-daemon-manager`（daemon-borrow 已建）在成员/设置区承接，本变更不动。
- guard 降级（Phase 2）后，`WorkspaceConfigCard` 即 binding 的唯一配置入口（概览页），进门不再依赖它。
- `WorkspaceBindingDialog` 组件保留（其"进门闸"用法在 Phase 1 移除），供其它需要弹窗的入口复用。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/app/(dashboard)/workspaces/page.tsx` | `handleActivate` 移除绑定拦截分支，always 导航；删 `bindingTarget`+列表页 Dialog 进门用法 |
| 修改 | `frontend/src/components/workspace-switcher.tsx` | `handleClickEntry` 移除绑定拦截分支，always 切换；删顶栏 Dialog 进门用法（ql-004 的 `canBorrow` 判定随之移除） |
| 修改 | `frontend/src/app/m/workspaces/page.tsx` | `handleActivate` 移除绑定拦截分支，always 提示电脑端 |
| 修改 | `frontend/src/components/workspace-binding-guard.tsx` | `unbound` 不再渲染绑定表单（return null），降级为已绑定编辑入口 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | 概览页无 binding 时渲染 soft nudge 卡 |
| 新增 | `frontend/src/components/daemon-required-notice.tsx` | 统一空态组件（feature/workspaceId/canBorrow） |
| 新增 | `frontend/src/components/daemon-required-notice.test.tsx` | 组件测试 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.tsx` | 无 binding 主区渲染 DaemonRequiredNotice |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx` | 同 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx` | 同（组件拓扑读源码） |
| 不改（复用） | `frontend/src/components/workspace-config-card.tsx` | 已是 binding 配置卡片，挂在概览页；guard 降级后自然成可选配置入口（Phase 3+6 合并，无新建） |
| 不改（复用） | `frontend/src/components/workspace-access-guide.tsx` | 首次/编辑表单，config-card 复用 |
| 修改 | 各对应 `__tests__/page.test.tsx` + `workspace-binding-guard.test` 等 | 进门自由化 + guard 降级 + 空态断言 |
| 不改 | `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` | task-13 canBorrow 已处理 |
| 不改 | files/changes/members/knowledge/audit/approvals/releases/incidents 页 | daemon 无关 |
| 不改 | 后端 / migrations / daemon | 纯前端改造 |

## 7. 接口定义（前端组件契约）

```ts
// daemon-required-notice.tsx
export function DaemonRequiredNotice(props: {
  feature: string;             // "运行时" | "扫描文档" | "源码浏览" | ...
  workspaceId: string;
  canBorrow: boolean;
  onConfigured?: () => void;
}): JSX.Element;
```

复用既有：
- `canBorrowSharedDaemon(permissions, is_platform_admin)`（`lib/workspace-binding.ts`，task-13 已建）。
- `fetchMyBinding(workspaceId)` / `upsertMyBinding`（已有）。
- `WorkspaceAccessGuide`（首次/编辑模式，已有）。

## 8. 数据模型

**无变更**。`workspace_member_runtimes`（含 daemon-borrow 的 `shared` 列）schema 不动。后端无 schema/API/鉴权变更（membership 进门权已强制）。

## 7.5 生命周期契约表

**本变更不涉及生命周期契约，申请豁免。**

理由（硬门控要求声明）：本变更是**纯前端工作区进门门禁 UX 改造**——只移除/放宽前端入口点（列表页/switcher/移动端/guard）对 `myBinding.daemon_id` 的判定分支，新建一个前端空态展示组件（`DaemonRequiredNotice`）。**不涉及任何 session / lease / agent_run / daemon 协议、状态机、或后端回调**：

- 不改 daemon ↔ backend 的 lease/session/claim/submit/complete 协议（daemon-borrow 已定的协议不动）。
- 不改 agent_run 状态机（pending/running/completed/failed 不动）。
- 不改 daemon 实体/心跳/在线状态流转。
- daemon/agent_run/lease/session 等**关键词在本文档出现仅因描述"不改动"的既有链路**（§1 背景、§3 非目标、§9 兼容策略提及 daemon-borrow 既不冲突），非本变更引入的生命周期契约。

故无事件×状态转换矩阵可列——没有新增/变更的生命周期事件。后端 lifecycle 行为完全不变，零回归。

## 9. 兼容策略（零回归）

- **已绑定用户**：进门原就是导航（行为不变）；guard 已绑定编辑入口保留；agent/runtime/scan 原行为不变。
- **`canBorrowSharedDaemon` 判定**：ql-004 在 4 入口点加的判定随进门闸移除而移除（入口点不再判定），但 agent 触发点保留（task-13）——纯删除入口点的冗余判定。
- **`WorkspaceBindingDialog`/`WorkspaceAccessGuide` 组件**：保留，仅移除"进门闸"用法；设置页/概览 nudge 复用。
- daemon 依赖页接入空态是**纯增量**（无 binding 分支新增），有 binding 路径完全不变。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | daemon 依赖页漏接入空态 → 无 binding 时白屏/报错 | P0 | plan 阶段逐一核实各页 daemon 耦合；execute 每页加无 binding 分支测试；verify 跑 180072（无 binding）真实点开每页 |
| R-02 | 进门闸移除后，binding 配置入口曝光度下降，开发人员不知道去哪配 | P1 | 概览 soft nudge + 设置页卡片双引导；agent 触发点的报错也带配置入口 |
| R-03 | ql-004 的入口点 canBorrow 判定移除后，business_member 进门仍正常（靠新门禁） | P1 | 进门自由化对所有成员生效（含 business_member），不回归；verify 单测覆盖 |
| R-04 | 移动端"电脑端打开"提示对无 daemon 用户语义含糊 | P2 | 移动端文案明确"工作区操作请在电脑端"+ 无 daemon 也可浏览文档（移动端仅列表提示） |
| R-05 | 概览 nudge 与各 daemon 依赖页空态重复引导，体验啰嗦 | P2 | **已消解**：Grill 自查发现概览已渲染 WorkspaceConfigCard（含 AccessGuide），Phase 3+6 合并复用它，不另建 nudge，避免重复 |

## 11. 决策追踪

- **D-001@v1** 进门权 = membership + platform_admin（用户确认）→ 覆盖 Phase 1
- **D-002@v1** binding 保留为可选配置，不删概念（用户确认）→ 覆盖 §8、Phase 6
- **D-003@v1** daemon 依赖页用内联空态引导（非阻断），不隐藏入口（用户确认）→ 覆盖 Phase 4/5
- **D-004@v1** 方案 A（门禁完全后移 + 统一空态），弃 B（最小留债）/ C（软提示违随时进）（用户确认）→ 覆盖 §5

## 12. 自审

- [x] 必填章节齐全：背景/目标/非目标/拆分/总体方案/文件清单/接口/数据模型/兼容/风险/决策/自审。
- [x] 依据：4 入口点代码、daemon-borrow 设计、workspace tabs/子页、daemon 依赖点（runtime/scan-docs/components/agent）均带 `文件:组件`。
- [x] 兼容策略：明确零回归路径（已绑定用户/canBorrow 判定移除/组件保留/空态纯增量）。
- [x] 数据模型：明确无变更（纯前端）。
- [x] 风险：daemon 依赖页漏接入（R-01，P0）有应对（逐一核实 + 180072 真实点页 verify）。
- [x] scale=large（多文件、跨多页、UX 模型变化）。
- ⚠️ 自审存疑：daemon 依赖页（runtime/scan-docs/components）的精确 daemon 耦合点（哪些 fetch 经 host_fs/daemon）需 plan 阶段逐一核实，确保空态接入不漏；agent 页确认不改（task-13 已覆盖）。
- [x] Design Grill 自查修正（tier=self 降级——独立子代理因账户 5h 限额 429 失败，同 daemon-borrow 先例）：发现概览页已渲染 `WorkspaceConfigCard`（含 AccessGuide）+ 已 fetch myBinding → Phase 3（soft nudge）与 Phase 6（设置页新卡片）与既有重复，已合并为"复用 WorkspaceConfigCard"（无新建），消解 R-05。其余定义层/一致性层 pass。
