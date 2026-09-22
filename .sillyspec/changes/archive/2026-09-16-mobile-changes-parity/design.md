---
author: qinyi
created_at: 2026-09-16 21:05:46
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-16-mobile-changes-parity

## 背景

移动端 `/m/workspaces/[id]/changes` 列表页与 `/m/workspaces/[id]/changes/[cid]` 详情页由 2026-08-26-mobile-workspace-page 建立，当时按「变更中心核心版」（D-002@旧）裁剪了部分桌面功能。用户现在要求：**手机端变更中心内容与 PC 端页面功能保持一致**。逐项精读比对（2026-09-16）发现两页共 10 项功能缺口（详见 decisions.md D-003/D-004），全部为前端展示层缺口——后端 API 与 PC 组件均已存在，无需后端改动。

## 设计目标

1. 移动列表页补齐 5 项：重新扫描入口与反馈、卡片信息（负责人/执行用量/活动徽标/影响组件）、排序切换、`?tab=/?search=` URL 初始化、quicklog tab 筛选（状态/作者/空壳占位）。
2. 移动详情页补齐 5 项：执行用量卡、最后信号、范围对账卡、删除入口、阶段步骤条点击→时间线筛选联动。
3. 实现路线为「既有组件复用挂载 + 移动壳适配」（D-005@v1）：数据层函数与 query key 与桌面同构，共享 react-query 缓存与失效前缀，禁止复制第二份数据实现。

## 非目标

- 任务看板与任务执行页（`changes/[cid]/tasks/**`、`tasks/[tid]`）不移植，保留桌面引导条（D-002@v1，用户可否决后另立变更）。
- 变更级会话门户 deep-link 兜底（m/.../sessions redirect 壳）维持现状。
- 不改任何后端 API / 表结构 / DTO。
- 不新建 `/m/` 路由（所有补齐落在既有两页面与既有移动组件内）。

## 拆分判断

单一变更覆盖「列表页补齐 + 详情页补齐」两块：两者同属一个用户诉求（变更中心对齐），共享同一批差异盘点决策（D-003/D-004），拆开会造成两个变更重复引用同一 diff 基线；且均为前端展示层、无跨模块依赖，合并在一个变更内风险可控。不涉及批量模式（非多工作区同构改造）。

## 总体方案

**Wave 1 — 列表页（m/changes/page.tsx + MobileChangeCard）**

1. 重新扫描：工具栏搜索行右侧加 `↻ 重新扫描` 按钮（44px 热区）。逻辑照抄桌面 `handleReparse`（frontend/src/app/(dashboard)/workspaces/.../page.tsx:406-423）：`reparseChanges(workspaceId)` → `setStats/setWarnings` → 失效 `["changes", workspaceId]` 前缀（不含 changesTabTotals，与桌面语义一致）。stats 成功条 + warnings 列表卡的移动化样式（`rounded-[var(--radius-md)] border` 范式），文案与桌面逐字一致。
2. MobileChangeCard 增强（3 个新信息区，均复用既有实现）：
   - 活动徽标：`ChangeActivityBadge`（@/components/changes/change-activity-badge）直接挂载到徽标行，消费 `step_progress.current_step_status + last_pushed_at`，与桌面「待办状态」列同源。
   - 元信息行：负责人三态（owner_name → owner_id 前 8 位 mono → —，对齐桌面 renderOwner）+ 影响组件（`affected_components.join(", ")`，空则省略整段；truncate 单行）。
   - 执行用量行：`usage` 字段（null → 「—」；undefined → 整行不渲染，对齐桌面 UsageExecCell 两档判空）→ 耗时（formatDurationZh 同款）+ 进行中 pill（started_at 有且 finished_at 缺）+ token·次（formatTokensCompact/formatCount 同款）。格式化 helper 从桌面页 import 复用（需 export，桌面页已有 PENDING_REVIEW_LABEL export 先例）；起止时间无 hover，移动端不展示（详情页用量卡兜底）。
3. 排序：`MobileFilterDrawer` 加「排序（更新时间）」chip 组（↓ 最近优先 / ↑ 最早优先），`sortDir` 从常量 DEFAULT_SORT 升为 state，进 query key 第 5 槽位（与桌面 key 同构）。
4. URL 参数：`useSearchParams` 读 `?tab=`（active/archive/quicklog 白名单）与 `?search=` 初始化（对齐桌面 :230-239）。
5. quicklog 筛选：quicklog tab 搜索行也挂 `MobileFilterDrawer`（状态 4 态 chips / 作者 chips / 显示空壳占位开关）。作者选项数据源 = quicklog 列表响应 items 聚合去重（owner_name→author_name→author_raw 兜底链，口径与桌面 QuicklogTable（frontend/src/components/changes/quicklog-table.tsx 第 197-203 行）逐字一致，移动页已有同源 quicklogItems 零新增请求）；quicklog query key 的 `status/author/showPlaceholder` 槽位从固定默认值升为 state 真值。

**Wave 2 — 详情页（m/changes/[cid]/page.tsx + MobileChangeDetail）**

6. 三卡复用挂载（MobileChangeDetail 内、StageStepper 下方；PC 对应位置：ChangeLastSignal（frontend/src/app/(dashboard)/workspaces/.../page.tsx:330）、ChangeUsageCard（同文件 :338）在主线上方，ScopeAuditCommandCard（:432-437）在右辅栏——移动单列堆叠按此顺序排在详情区块流中）：
   - `ChangeLastSignal lastPushedAt={lastSignalFromSteps(change.steps)}`（纯前端派生，无信号不渲染）；
   - `ChangeUsageCard kind="change" workspaceId refKey={changeId}`（组件自取数）；
   - `ScopeAuditCommandCard target={{ kind: "change", workspaceId, changeKey }}`（已归档也可查）。
7. 阶段联动：`StageStepper` 节点升为可点 button（仅 `stepStages` 含有的阶段可点，对齐桌面 stepStages 派生），点击 set focusStage / 再点取消；时间线卡头加「阶段 ✕」清除 chip；`ChangeStepTimeline` 传 `focusStage`。
8. 删除入口：[cid]/page.tsx 的 ⋯ 菜单加 danger 项「删除变更」（`useChangeDeleteAccess` + `canDeleteChange(change, access)` 门控，change 来自页面级 query，change 为 null 加载态时不渲染该项）→ `DeleteChangeConfirm` 受控弹层 → `deleteChange` mutation 成功后失效 `["changes", workspaceId]` 前缀 + `router.push` 回移动列表；失败中文 toast（`useNotify`，403/404/409 统一 onError）。

**Wave 3 — 测试**

两页既有 `__tests__/page.test.tsx`、`page.m-change-detail.test.tsx` 补用例（见 tasks），跑 `pnpm test` 相关文件 + `pnpm exec tsc --noEmit`。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/app/m/workspaces/[id]/changes/page.tsx | 重新扫描按钮 + stats/warnings 反馈；sortDir state 化 + query key 真值；useSearchParams 初始化 tab/search；quicklog 筛选 state（status/author/showPlaceholder）+ MobileFilterDrawer 挂载 + query key 真值；重置语义扩展 |
| 修改 | frontend/src/components/mobile/mobile-change-card.tsx | 徽标行挂 ChangeActivityBadge；新增元信息行（负责人三态/影响组件）与执行用量行（UsageExecCell 移动化） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | export formatTokensCompact/formatCount/formatDurationZh（供 MobileChangeCard 复用；PENDING_REVIEW_LABEL export 同款先例，不改逻辑） |
| 修改 | frontend/src/app/m/workspaces/[id]/changes/[cid]/page.tsx | ⋯ 菜单加删除项（canDeleteChange 门控）+ DeleteChangeConfirm + deleteMutation（成功回列表） |
| 修改 | frontend/src/components/mobile/mobile-change-detail.tsx | StageStepper 下方挂 ChangeLastSignal/ChangeUsageCard/ScopeAuditCommandCard；StageStepper 可点 + focusStage state + 时间线清除 chip + ChangeStepTimeline focusStage 透传 |
| 修改 | frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx | 补用例：重新扫描入口与反馈、排序切换、URL 参数初始化、quicklog 筛选 |
| 修改 | frontend/src/components/mobile/mobile-change-card.test.tsx | 补用例：负责人三态、用量行两档判空、活动徽标挂载 |
| 修改 | frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx | 补用例：删除入口权限门控与确认流、三卡挂载、阶段联动筛选 |

字段数据流：本变更无新增对外字段/接口/DTO（全部消费 ChangeSummary 既有 `usage/owner_name/owner_id/affected_components/step_progress/last_pushed_at` 字段，producer=后端 changes 列表投影，consumer=移动卡片；移动详情三卡各自既有取数链路不变）。

## 接口定义

无新接口。消费的既有数据函数（全部已存在，grep 确认）：

- `reparseChanges(workspaceId): Promise<ChangeReparseResult>`（frontend/src/lib/changes.ts，桌面在用）
- `deleteChange(workspaceId, changeId)`、`canDeleteChange(change, access)`、`useChangeDeleteAccess(workspaceId)`、`DeleteChangeConfirm`（@/components/delete-change-confirm）
- `lastSignalFromSteps(steps)`、`ChangeLastSignal`、`ChangeActivityBadge`（@/components/changes/change-activity-badge）
- `ChangeUsageCard`（@/components/changes/detail/change-usage-card）
- `ScopeAuditCommandCard`（@/components/changes/scope-audit-command-card）
- `ChangeStepTimeline`（focusStage prop 已存在，桌面在用）

组件签名变化（移动内部，无对外契约）：

- `MobileChangeCard`：props 不变（change/onClick），纯渲染增强。
- `StageStepper`（mobile-change-detail.tsx 模块私有）：`{ currentStage } → { currentStage, stepStages, focusStage, onStageClick }`。

## 生命周期契约表

不涉及生命周期契约。

## 数据模型

无 schema 变更（纯前端展示层；api-types.ts 不动，无需 pnpm gen:types）。

## 兼容策略（brownfield 必填）

- `usage === undefined`（旧 mock/旧后端响应缺字段）→ 用量行整行不渲染，卡片其余信息照常——对齐桌面 UsageExecCell 两档判空先例。
- `stageFilter/sortDir/quicklog 筛选` 默认值与改造前一致（"" / updated_at_desc / 全部·全部·true），未操作筛选时请求参数与现状逐字相同。
- query key 变化点（sort 真值化、quicklog 槽位真值化）在默认值下与旧 key 深度相等（值不变），不产生额外请求；桌面/移动共享缓存语义保持。
- 删除入口未授权（canDeleteChange false）时 ⋯ 菜单不出现该项，页面其余动作不受影响。
- 回退路径：所有改动为新增渲染分支/新增入口，git revert 单 commit 即回退。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | ScopeAuditCommandCard/ChangeUsageCard 小屏溢出（桌面卡内表格/栅格未在 390px 验证过） | P1 | execute 时 headless 390px 视口实测；溢出就地加移动断点样式，不重写组件（D-005 约束） |
| R-02 | 卡片信息密度上升导致列表可扫读性下降 | P2 | 用量行/元信息行用弱化色 + 分隔虚线（原型已定稿）；空值整段省略不占行 |
| R-03 | sortDir/quicklog key 真值化若默认值漂移会造成桌面共享缓存 key 不一致 | P1 | 测试断言默认参数下 key 与桌面逐字同构（既有 x-04-query-key-lock 同款断言扩展） |
| R-04 | 删除入口启发式判漏（非 owner 且非管理员误判） | P2 | 后端 DELETE 组合权限为权威，403 走中文 toast（桌面同语义，非新增风险面） |
| R-05 | quicklog 作者聚合依赖列表响应 author 字段（部分条目 author_raw 兜底） | P2 | 聚合口径照抄桌面 QuicklogTable（owner_name→author_name→author_raw 链），不另造口径 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 范围界定 → 设计目标 1/2、文件变更清单（仅两页 + 组件 + 测试） | 已覆盖 |
| D-002@v1 | 非目标第 1 条（任务域不移植，保留引导条） | 已覆盖 |
| D-003@v1 | 总体方案 Wave 1（列表页 5 项） | 已覆盖 |
| D-004@v1 | 总体方案 Wave 2（详情页 5 项） | 已覆盖 |
| D-005@v1 | 总体方案路线（复用挂载）、R-01 应对（加断点不重写） | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-001@v1 ~ D-005@v1
- [x] 生命周期豁免短语已紧邻标题（「不涉及生命周期契约」）
- [x] UI 原型已生成：prototype-mobile-changes-parity.html（分级：组件级变化·建议生成）
- [x] 无「⚠️ 自审存疑」项；方案选择 D-005 为自主裁定已在 decisions.md 如实标注，最终汇报列为可否决项
