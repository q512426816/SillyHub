---
author: sillyspec-fr-index
created_at: 2026-10-15T18:08:11.679Z
---

# FR 索引 — app-workspace-pages

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/app-workspace-pages.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-app-workspace-pages-001 首屏按变更状态自适应
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景；在途首屏不出现执行用量全宽卡与并列时间线
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户打开任一变更详情页；When 页面渲染完成；Then 在途态首屏 MUST 呈现「概览」tab：待办卡（当前有待办时）+ 变更摘要（阶段/任务/已用时长/最后信号）+ 最近动态；归档态首屏 MUST 呈现成果语义（
- 场景：在途首屏不出现执行用量全宽卡与并列时间线 — Given 变更处于在途态（`isTerminalChange` 为假）；When 用户打开详情页；Then 首屏 MUST NOT 出现全宽「执行用量」卡；MUST NOT 出现「步骤时间线」与「真实留痕时间线」两张并列卡片
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-01
最近确认：fe8a71ed4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-change-detail-redesign:task-06:acc-0-70457341
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-06:acc-1-25b15f6b
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-06:acc-2-e8ee64c5
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-06:acc-3-cedde892
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-06:acc-4-13c7a8cf
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-08:acc-0-6efe121b
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-08:acc-1-5469922a
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-08:acc-2-51633d55
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-08:acc-3-1dc3e6e7
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-change-detail-redesign
  status: active

## FR-app-workspace-pages-002 页面骨架 = 顶部四 tab 分区
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景；阶段条常驻且与过程筛选联动；阶段条对非线性阶段静默不渲染
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 用户打开任一在途变更详情页；When 页面渲染完成；Then 主体 MUST 为四个 tab（概览 / 产出 / 过程 / 文件与对账），默认停在「概览」；tab 栏 MUST 位于常驻阶段条之下；MUST NOT 再呈现
- 场景：阶段条常驻且与过程筛选联动 — Given 详情页已加载且 `current_stage` 为五阶段之一；When 用户点击阶段条上某阶段节点；Then 页面 MUST 切到「过程」tab 并只显示该阶段条目，且 MUST 提供清除筛选入口
- 场景：阶段条对非线性阶段静默不渲染 — Given 变更的 `current_stage` 不在五阶段内（如 thin / quick / blocked）；When 页面渲染完成；Then 阶段条 MUST NOT 渲染（由页头状态胶囊承载），thin 出身 MUST 显示轻量流程条
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-02
最近确认：fe8a71ed4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-change-detail-redesign:task-01:acc-0-b6b4ce06
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-01:acc-1-f557746f
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-01:acc-2-09f25571
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-01:acc-3-5264118b
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-07:acc-0-953d5728
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-07:acc-1-afea81e4
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-07:acc-2-cda72b87
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-07:acc-3-c89b40fc
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-07:acc-4-949c8ca1
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active

## FR-app-workspace-pages-003 tab 状态写入 URL
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景；深链、刷新与非法值回落；收窄后非法 tab 值钳制
依据决策：D-013@v1、D-016@v1
场景正文：
- 场景：默认场景 — Given 用户处于详情页的任一 tab；When 用户切换 tab；Then URL MUST 更新为 `?tab=<值>`，MUST NOT 触发整页重载
- 场景：深链、刷新与非法值回落 — Given 用户直接访问 `.../changes/<cid>?tab=assets` / 刷新当前页 / 访问 `?tab=不存在`；When 页面渲染完成；Then 分别 MUST 停在「产出」tab / MUST 停在当前 tab / MUST 回落「概览」
- 场景：收窄后非法 tab 值钳制 — Given 归档态下 `?tab=files` 不在 `visibleTabs`（或切换变更时残留了上一变更的非法 tab 值）；When 页面渲染完成；Then MUST 以 `router.replace` 钳回 `?tab=overview`，MUST NOT 渲染空白面板
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-03
最近确认：fe8a71ed4

## FR-app-workspace-pages-004 tab 集随状态自适应且 thin 不特判
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景；归档态不残留悬空入口；thin 出身不特判 tab 集
依据决策：D-007@v1、D-015@v1、D-016@v1
场景正文：
- 场景：默认场景 — Given 变更处于归档态（`isTerminalChange` 为真，即 status=archived 或 location=archive）；When 页面渲染完成；Then tab 集 MUST 收窄为三个（概览/产出/过程），MUST NOT 渲染「文件与对账」tab
- 场景：归档态不残留悬空入口 — Given 归档态下「文件与对账」tab 不渲染；When 概览右侧信息栏渲染范围对账计数；Then 其入口 MUST 指向「产出 · 归档留档」，MUST NOT 指向不存在的 tab
- 场景：thin 出身不特判 tab 集 — Given 变更为 thin 出身（无五阶段、`change.steps` 恒空）；When 用户在途打开详情页；Then tab 集 MUST 与完整流程在途态一致（四个），MUST NOT 因 thin 收窄而隐藏「过程」（thin 的主线叙事由观测事件流承担）
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-04
最近确认：fe8a71ed4

## FR-app-workspace-pages-005 知识图谱独立成区
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景；图谱不可用时呈现分区级空态；资产卡失败与归档保底渲染
依据决策：D-003@v1、D-016@v1
场景正文：
- 场景：默认场景 — Given 变更存在知识图谱邻域数据（`neighbors` 查询以 `change_key` 为锚命中）；When 用户进入「产出」tab；Then 知识图谱 MUST 渲染为资产清单之外的独立分区（画布 + 节点详情栏），画布高度 MUST 不再受资产卡内嵌的 280px 约束
- 场景：图谱不可用时呈现分区级空态 — Given 图谱查询失败 / `available=false` / 节点为空；When 「产出」tab 渲染
- 场景：资产卡失败与归档保底渲染 — Given 资产主查询 `isError`（`change-assets-card.tsx:181` 现为整卡 `return null`）；When 「产出」tab 渲染；Then 资产卡 MUST 保留卡头并给出一行分区级错误说明；归档态下「归档留档」MUST 保底渲染（走其自身 patch 摘要取数），MUST NOT 因主查询失败而整
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-05
最近确认：fe8a71ed4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-change-detail-redesign:task-03:acc-0-811d996b
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-03:acc-1-fd744e6e
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-03:acc-2-fae494e7
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-03:acc-3-80e64ec0
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-03:acc-4-b4cfb05b
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active

## FR-app-workspace-pages-006 资产分组形态（自然高度 + 上限折叠）
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景；在途态不出现归档留档组
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 「产出」tab 渲染六组资产（需求规则 / 决策蒸馏 / 知识触达 / 测试绑定 / 模块触达 / 归档留档）；When 某组条目数超过 5；Then 该组 MUST 直接显示最多 5 行并提供「展开全部 N 条」（展开后 MUST 可收起）；MUST NOT 使用固定高度 + 组内独立滚动的分组形态
- 场景：在途态不出现归档留档组 — Given 变更处于在途态；When 「产出」tab 渲染；Then MUST NOT 渲染「归档留档」分组（MUST NOT 以空态或占位形态出现）
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-06
最近确认：fe8a71ed4

## FR-app-workspace-pages-007 范围对账下沉至「文件与对账」
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景；既有对账能力零损失
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 用户打开详情页；When 页面渲染完成；Then 范围对账卡 MUST NOT 挂载于任何常驻侧栏位置；其挂载点 MUST 为「文件与对账」tab
- 场景：既有对账能力零损失 — Given 范围对账卡被挂载于「文件与对账」tab；When 用户查看对账区；Then 三态计数（计划内/计划外/计划未动）、分仓分段、锚点、明细弹窗（含单文件 diff）、折叠的本地命令、归档态降级指路 MUST 全部保持可用
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-07
最近确认：fe8a71ed4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-change-detail-redesign:task-04:acc-0-5822db16
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-04:acc-1-91178521
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-04:acc-2-6406de70
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-04:acc-3-785d1180
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active

## FR-app-workspace-pages-008 概览右侧信息栏承载元信息
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景；窄栏文本不溢出
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 用户在「概览」tab；When 页面渲染完成；Then 右侧信息栏 MUST 呈现：基本信息（key/类型/创建/负责人）、执行用量（7 项指标，含按模型明细展开入口）、会话（最近若干条 + 工作台入口）、范围对账计
- 场景：窄栏文本不溢出 — Given 信息栏宽度受限（约 288px）；When 值文本超长（变更 key / 会话名 / 模型名）；Then 文本 MUST 单行截断且 MUST 提供悬浮全文
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-08
最近确认：fe8a71ed4

## FR-app-workspace-pages-009 两条时间线合并为一条统一时间线
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景；源内去重（稳定键）；task-done 事件折叠进任务清单；三个边界输入类的显式取舍；两源独有信息不丢
依据决策：D-005@v1、D-014@v1、D-016@v1
场景正文：
- 场景：默认场景 — Given 变更同时存在 steps（步骤）与 timeline 端点数据（事件/诞生锚）；When 用户进入「过程」tab；Then MUST 只渲染一条统一时间线；MUST NOT 同时挂载「步骤时间线」与「真实留痕时间线」两张卡
- 场景：源内去重（稳定键） — Given 同一源内存在重复条目；When 合并执行；Then 步骤 MUST 以 `stage + ordering` 为键去重、事件 MUST 以 `ts + kind + label` 为键去重；MUST NOT 使用
- 场景：task-done 事件折叠进任务清单 — Given 事件流中存在 `kind="task-done"` 且 detail 为「checked N→M」（tasks 域） 存在非 tasks 域的同形态事件（如 `；When 合并执行 合并执行；Then 该事件 MUST NOT 作为时间线行出现（其信息由 FR-10 任务清单承载） 该事件 MUST 保留为普通时间线行
- 场景：三个边界输入类的显式取舍 — Given 输入含 ①`completed_at` 为非 ISO 残留原串 ②同 `ts`+同 `kind`+同 `label` 的重复事件 ③task-done 推断断裂；When 合并执行；Then ① MUST 先做可解析判定，不可解析者与无时间戳者同置末尾（MUST NOT 混入字典序比较）；②MUST 按同键去重（同秒同类型同文本视为同一观测重复上报）
- 场景：两源独有信息不丢 — Given 合并后的统一时间线；When 用户查看任一行；Then 步骤侧 MUST 保留阶段归属、等待原因、输出全文；事件侧 MUST 保留提交短哈希与标题、文件/配置变更类事件与墙钟统计
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-09
最近确认：fe8a71ed4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-change-detail-redesign:task-02:acc-0-a895b71a
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-02:acc-1-cdcce484
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-02:acc-2-c0f70af2
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-02:acc-3-3a5205cb
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-02:acc-4-e94f6cb6
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-02:acc-5-d2eb2fc3
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active

## FR-app-workspace-pages-010 任务进度清单独立承载任务面
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景
依据决策：D-014@v1
场景正文：
- 场景：默认场景 — Given 变更 `tasks.md` 存在任务行（`- [x]/- [ ] task-NN: desc`）；When 用户进入「过程」tab；Then MUST 呈现任务进度清单：勾选态 + task id + 描述 + 推断勾选时刻（MUST 标 `≈` 以表推断值）+ 提交锚（有则显）+ 勾选比（check
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-10
最近确认：fe8a71ed4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-change-detail-redesign:task-05:acc-0-7333d032
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-05:acc-1-9957aa56
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-05:acc-2-babefae3
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active
- row: 2026-10-15-change-detail-redesign:task-05:acc-3-70f307c8
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: fe8a71ed4ce84edf41c8bc4a6d553c4360681f9b
  source_change: 2026-10-15-change-detail-redesign
  status: active

## FR-app-workspace-pages-011 变更文件在 tab 内直接内嵌
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景
依据决策：D-012@v1
场景正文：
- 场景：默认场景 — Given 用户进入「文件与对账」tab；When 页面渲染完成；Then MUST 直接渲染文件树与预览区（左侧点文件、右侧看内容/diff）；MUST NOT 以「打开」按钮 + 弹窗作为文件树的唯一入口
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-11
最近确认：fe8a71ed4

## FR-app-workspace-pages-012 实现按批准原型接线
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景；原型与实现分家防护
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given 已批准的原型（`prototype-change-detail-v2.html` 及其源码）在场；When 实施各面板；Then 实现结构 MUST 以批准稿为基准逐面板对照；发现结构无法对齐时 MUST 停机带截图裁决并留痕，MUST NOT 静默降级
- 场景：原型与实现分家防护 — Given 实施期需要修改原型源码；When 修改完成；Then MUST 重跑 `pnpm prototype:build` 并复核产物 diff（对账门），MUST NOT 手改产物 HTML
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-12
最近确认：fe8a71ed4

## FR-app-workspace-pages-013 冲突活需求显式取代并落盘
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景
依据决策：D-009@v1
场景正文：
- 场景：默认场景 — Given 本变更与 6 条活需求冲突（左主右辅布局 / 两时间线共存 / 图谱内嵌资产卡 / 主栏顺序 / 资产卡固定高度网格 / 详情页重排）；When 交付本变更；Then MUST 在 requirements/decisions 中以承接行引用被取代的全局 FR id，并 MUST 由归档链路将其翻为 superseded 建取
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-13
最近确认：fe8a71ed4

## FR-app-workspace-pages-014 改造边界与移动端契约兼容
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景；页模块导出不得随重写迁走；桌面卸载不等于删除
依据决策：D-011@v1、D-016@v1
场景正文：
- 场景：默认场景 — Given 移动端详情页直接引用桌面侧组件符号与**页模块导出**；When 桌面页重构完成；Then `frontend/src/components/mobile/mobile-change-detail.tsx:66-82` 的 import 面 **MUS
- 场景：页模块导出不得随重写迁走 — Given `isTerminalChange` 由 `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]；When 该页面被重写为 tab 容器；Then `isTerminalChange` MUST 保留在同一文件同一语义（`status === "archived" || location === "arch
- 场景：桌面卸载不等于删除 — Given `ChangeStepTimeline` 不再挂载于桌面页；When 检查交付物；Then 该组件文件与其导出 MUST 仍在场（移动端与既有测试仍引用），MUST NOT 以「清理死代码」名义删除
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-14
最近确认：fe8a71ed4

## FR-app-workspace-pages-015 一次性完整交付
变更：2026-10-15-change-detail-redesign
状态：active
摘要：默认场景
依据决策：D-010@v1
场景正文：
- 场景：默认场景 — Given 本变更包含四个面板 + 合并算法 + 状态自适应；When 提交验收；Then 四 tab 与两态自适应 MUST 全部可用；MUST NOT 交付「骨架已改、面板仍为旧卡」的中间态
全文：.sillyspec/changes/archive/2026-10-15-change-detail-redesign/requirements.md#FR-15
最近确认：fe8a71ed4

## FR-app-workspace-pages-016 visibleTabs 恒返回四 tab（archived 参数保留但不再收窄）
变更：2026-10-16-archived-files-tab
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-archived-files-tab/requirements.md#FR-01
最近确认：b5c80978eeff39258d70399f559fa678e3c77c6e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-archived-files-tab:flow:测试绑定FR-01
  tests: frontend/src/components/changes/detail/__tests__/change-tabs.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-archived-files-tab
  status: active

## FR-app-workspace-pages-017 归档态「文件与对账」面板可挂载，?tab=files 深链直达
变更：2026-10-16-archived-files-tab
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-archived-files-tab/requirements.md#FR-02
最近确认：b5c80978eeff39258d70399f559fa678e3c77c6e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-archived-files-tab:flow:测试绑定FR-02
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-archived-files-tab
  status: active

## FR-app-workspace-pages-018 概览右信息栏对账入口归档态同在途一样指向「文件与对账」
变更：2026-10-16-archived-files-tab
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-archived-files-tab/requirements.md#FR-03
最近确认：b5c80978eeff39258d70399f559fa678e3c77c6e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-archived-files-tab:flow:测试绑定FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-archived-files-tab
  status: active

## FR-app-workspace-pages-019 测试同步更新且质量门全绿
变更：2026-10-16-archived-files-tab
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-archived-files-tab/requirements.md#FR-04
最近确认：b5c80978eeff39258d70399f559fa678e3c77c6e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-archived-files-tab:flow:测试绑定FR-04
  tests: frontend/src/components/changes/detail/__tests__/change-tabs.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-archived-files-tab
  status: active

## FR-app-workspace-pages-020 详情页删除成功后按历史可退性返回列表
变更：2026-10-16-change-center-delete-back-keeps-state
状态：active
摘要：从列表进详情删除后返回；新标签深链详情后删除
全文：.sillyspec/changes/archive/2026-10-16-change-center-delete-back-keeps-state/requirements.md#FR-01
最近确认：7da2c5633e9545629ed1e8967bbeba405e4a1055

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-center-delete-back-keeps-state:flow:测试绑定FR-01
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-back-to-list.test.tsx「删除成功:历史可后退时 router.back() 回列表」 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-back-to-list.test.tsx「删除成功:无历史可退时兜底 push 默认列表」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-center-delete-back-keeps-state
  status: active

## FR-app-workspace-pages-021 列表页页码超界钳回最后一页
变更：2026-10-16-change-center-delete-back-keeps-state
状态：active
摘要：删除后当前页超界；真空列表不钳回
全文：.sillyspec/changes/archive/2026-10-16-change-center-delete-back-keeps-state/requirements.md#FR-02
最近确认：7da2c5633e9545629ed1e8967bbeba405e4a1055

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-center-delete-back-keeps-state:flow:测试绑定FR-02
  tests: changes/__tests__/page.test.tsx「页码超界钳回最后一页并重新请求」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-center-delete-back-keeps-state
  status: active

## FR-app-workspace-pages-022 测试零回归 + 新增断言
变更：2026-10-16-change-center-delete-back-keeps-state
状态：active
摘要：回归与新增断言
全文：.sillyspec/changes/archive/2026-10-16-change-center-delete-back-keeps-state/requirements.md#FR-03
最近确认：7da2c5633e9545629ed1e8967bbeba405e4a1055

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-center-delete-back-keeps-state:flow:测试绑定FR-03
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-back-to-list.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-center-delete-back-keeps-state
  status: active
