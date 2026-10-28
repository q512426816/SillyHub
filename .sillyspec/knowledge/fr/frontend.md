---
author: sillyspec-fr-index
created_at: 2026-09-28T13:29:15.726Z
---

# FR 索引 — frontend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/frontend.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-auto-frontend-001 会话行状态小灯
变更：2026-09-08-session-list-liveness-dot
状态：active
摘要：默认场景
依据决策：D-001@v2、D-002@v1
场景正文：
- 场景：默认场景 — Given 会话列表已渲染且该会话在 liveness map 中命中（有 agent_session_id 关联的日志行） 会话无关联日志（map 未命中）或查询失败/加；When 30s 轮询数据到达 列表渲染；Then 行尾（相对时间后、hover 按钮前）渲染 18px 状态小灯，颜色/闪烁形态与 LivenessDot 五态视觉一致（working/blocked 呼吸闪烁
全文：.sillyspec/changes/archive/2026-09-08-session-list-liveness-dot/requirements.md#FR-01
最近确认：35f3d6528

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcgxdq:frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-08-session-list-liveness-dot
  status: active

## FR-auto-frontend-002 悬停详情卡
变更：2026-09-08-session-list-liveness-dot
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 会话行有小灯；When 鼠标悬停小灯；Then antd Popover（portal 渲染，不被行容器 overflow-hidden 裁剪）弹出详情卡：状态全名（LIVENESS_META）+ 静默时长（
全文：.sillyspec/changes/archive/2026-09-08-session-list-liveness-dot/requirements.md#FR-02
最近确认：35f3d6528

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcgxmv:frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-08-session-list-liveness-dot
  status: active

## FR-auto-frontend-003 idle 未读小红点
变更：2026-09-08-session-list-liveness-dot
状态：active
摘要：默认场景
依据决策：D-001@v2、D-003@v1
场景正文：
- 场景：默认场景 — Given localStorage 记录的该会话上次已知 state ∈ {working, blocked} 红点存在 首次见到该会话（无历史 state 记录）或 s；Then 写未读标记，小灯右上角显示 7px 红点（bg-destructive） 清除未读标记，红点消失 不亮红点（避免初次打开刷屏）；常 idle 会话（无新转移）不
全文：.sillyspec/changes/archive/2026-09-08-session-list-liveness-dot/requirements.md#FR-03
最近确认：35f3d6528

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcgy8x:frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-08-session-list-liveness-dot
  status: active

## FR-auto-frontend-004 布局与主题约束
变更：2026-09-08-session-list-liveness-dot
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 任意会话列表视图（树/平铺、归档视图、批量模式）；When 小灯与红点渲染；Then 不新增列、不改行布局（行内 flex 尾部追加 flex-none 节点）；双主题下色值均走语义阶（brand-*/muted/destructive 等，th
全文：.sillyspec/changes/archive/2026-09-08-session-list-liveness-dot/requirements.md#FR-04
最近确认：35f3d6528

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcgxy9:frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-08-session-list-liveness-dot
  status: active

## FR-auto-frontend-005 预会话草稿按入口隔离（草稿串台修复）
变更：2026-09-13-session-group-ux-fixes
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户在入口 P1（工作区 W1 + 机器 R1）的预会话输入框输入内容未发送；When 用户返回列表后从另一入口 P2（工作区 W2 或机器 R2）新建预会话；Then P2 输入框为空（或 P2 自有历史草稿），P1 的内容不出现在 P2；同一入口重进仍恢复 P1 草稿
全文：.sillyspec/changes/archive/2026-09-13-session-group-ux-fixes/requirements.md#FR-1
最近确认：39d3d8c5c

## FR-auto-frontend-006 输入框高度拖拽触摸可用（拖拽修复）
变更：2026-09-13-session-group-ux-fixes
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 移动端（触摸屏）会话输入框或群聊输入框；When 用户按住输入胶囊上缘拖拽手柄竖向拖动；Then 输入框高度实时增减，钳制在 44-480px（且 ≤ 视口 60%）；松手高度持久化（刷新后保持）；双击手柄恢复默认高度
全文：.sillyspec/changes/archive/2026-09-13-session-group-ux-fixes/requirements.md#FR-2
最近确认：39d3d8c5c

## FR-auto-frontend-007 群聊跨工作区可见（可见性修复）
变更：2026-09-13-session-group-ux-fixes
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 群 G 直接归属工作区 D、关联项目 A，项目 A 关联工作区 D 与 F，当前用户是 G 的成员；When 用户分别在工作区 D 与工作区 F 打开会话列表（桌面左栏 / 移动端列表页）；Then 两处的群聊分区均显示群 G
全文：.sillyspec/changes/archive/2026-09-13-session-group-ux-fixes/requirements.md#FR-3
最近确认：39d3d8c5c

## FR-auto-frontend-008 列表页重新扫描
变更：2026-09-16-mobile-changes-parity
状态：superseded
superseded_by：FR-styles-012
取代链：FR-auto-frontend-008 ← FR-styles-012（2026-09-26-core-pages-visual-redesign 承接）
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 用户在移动变更列表页（任一变更 tab） 重新扫描返回警告列表 重新扫描请求失败；When 点击工具栏「重新扫描」按钮 警告数 > 0 返回 ApiError；Then 调用 reparseChanges(workspaceId)，成功后显示「已重新扫描：解析 N，新增 N · 更新 N · 删除 N。W 个警告。」反馈条（文案
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-01
最近确认：f41468b59

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulch5zh:frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
  tests: frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-16-mobile-changes-parity
  status: superseded

## FR-auto-frontend-009 列表卡片信息补齐
变更：2026-09-16-mobile-changes-parity
状态：superseded
superseded_by：FR-styles-012
取代链：FR-auto-frontend-009 ← FR-styles-012（2026-09-26-core-pages-visual-redesign 承接）
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given ChangeSummary.owner_name 非空 owner_name 空且 owner_id 有值 owner_name 与 owner_id 均空 a；When 渲染卡片元信息行 渲染元信息行 渲染元信息行 渲染元信息行 渲染执行用量行 渲染执行用量行 渲染执行用量行 渲染徽标行；Then 显示负责人名（owner_name） 显示 owner_id 前 8 位（mono 弱化色） 负责人段显示「—」 影响组件段省略（不占位） 显示「—」占位 整行
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-02
最近确认：f41468b59

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulch72a:frontend/src/components/mobile/mobile-change-card.test.tsx
  tests: frontend/src/components/mobile/mobile-change-card.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-16-mobile-changes-parity
  status: superseded

## FR-auto-frontend-010 列表排序切换与 URL 参数
变更：2026-09-16-mobile-changes-parity
状态：superseded
superseded_by：FR-styles-012
取代链：FR-auto-frontend-010 ← FR-styles-012（2026-09-26-core-pages-visual-redesign 承接）
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 用户打开筛选抽屉 URL 含 ?tab=quicklog 或 ?tab=archive（合法值） URL 含 ?search=词 未操作任何筛选、URL 无参数；When 切换「排序」chip（↓ 最近优先 / ↑ 最早优先）并确定 页面初始加载 页面初始加载 页面加载；Then sortDir 生效进主列表 query key，列表按所选方向请求 初始 tab 为该值（非法值回 active） 搜索词初始化为该值（输入框与已提交 sta
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-03
最近确认：f41468b59

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulch69z:frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
  tests: frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-16-mobile-changes-parity
  status: superseded

## FR-auto-frontend-011 quicklog tab 筛选
变更：2026-09-16-mobile-changes-parity
状态：superseded
superseded_by：FR-styles-010
取代链：FR-auto-frontend-011 ← FR-styles-010（2026-09-26-core-pages-visual-redesign 承接）
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 用户在快速修复 tab 用户选择状态=疑似中断并确定 作者选项数据 用户关闭「显示空壳占位」并确定 quicklog tab 处于抽屉筛选状态；When 打开筛选抽屉 quicklog 列表请求发出 quicklog 列表响应到达 请求发出 点击重置；Then 可见状态 4 态 chips、作者 chips、显示空壳占位开关 query key 与请求参数带 status="stale"（槽位与桌面 QuicklogT
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-04
最近确认：f41468b59

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulch6pm:frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
  tests: frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-16-mobile-changes-parity
  status: superseded

## FR-auto-frontend-012 详情页三卡挂载
变更：2026-09-16-mobile-changes-parity
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given change.steps 存在且至少一步有 completed_at change.steps 无 completed_at（或 steps 缺失） 任意变更详；When 详情页渲染 详情页渲染 渲染；Then StageStepper 下方显示 ChangeLastSignal（最后信号相对时间） 最后信号行不渲染 挂载 ChangeUsageCard(kind="c
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-05
最近确认：d33092ea3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulchehg:frontend/src/components/mobile/mobile-change-detail.test.tsx
  tests: frontend/src/components/mobile/mobile-change-detail.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-16-mobile-changes-parity
  status: active

## FR-auto-frontend-013 详情页阶段-时间线联动
变更：2026-09-16-mobile-changes-parity
状态：superseded
superseded_by：FR-styles-011
取代链：FR-auto-frontend-013 ← FR-styles-011（2026-09-26-core-pages-visual-redesign 承接）
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given steps 中某阶段有条目 时间线处于阶段筛选态 某阶段在 steps 中无条目；When 点击步骤条该阶段节点 再次点击同阶段节点或点清除 chip 渲染步骤条；Then 时间线仅显示该阶段步骤，卡头出现「阶段名 ✕」清除 chip 取消筛选恢复全量 该节点不可点（无筛选效果）
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-06
最近确认：f41468b59

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulchesj:frontend/src/components/mobile/mobile-change-detail.test.tsx
  tests: frontend/src/components/mobile/mobile-change-detail.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-16-mobile-changes-parity
  status: superseded

## FR-auto-frontend-014 详情页删除入口
变更：2026-09-16-mobile-changes-parity
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 用户对目标变更有删除权限（canDeleteChange 启发式通过） 用户无权限 change 尚在加载（null） 用户点击删除并确认 deleteChan；When 打开 ⋯ 菜单 打开 ⋯ 菜单 渲染 ⋯ 菜单 deleteChange 成功 mutation onError；Then 出现 danger 项「删除变更」 不出现删除项（其余动作不受影响） 不出现删除项 toast「变更 {change_key} 已删除」+ 失效 ["chang
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-07
最近确认：d33092ea3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulchf2s:frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx
  tests: frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-16-mobile-changes-parity
  status: active

## FR-auto-frontend-015 precipitate-dialog「快速修复」蒸馏源分段带存量标注，空态文案不
变更：2026-09-25-knowledge-quick-legacy-copy
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台按当前契约运行；When 本变更交付并运行；Then precipitate-dialog「快速修复」蒸馏源分段带存量标注，空态文案不再引导产生新 quick 条目
全文：.sillyspec/changes/archive/2026-09-25-knowledge-quick-legacy-copy/requirements.md#FR-01
最近确认：5ae347894da3d03154c45783d115e634c8bc2390

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-quick-legacy-copy:flow:FR-01
  tests: frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b9f40ac174b1f01efb0e1b73a5d00cac47efe383
  source_change: 2026-09-25-knowledge-quick-legacy-copy
  status: active

## FR-auto-frontend-016 distill-task-bar 与 distill-history-dialo
变更：2026-09-25-knowledge-quick-legacy-copy
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台按当前契约运行；When 本变更交付并运行；Then distill-task-bar 与 distill-history-dialog 的 quick 相关文案带存量口径
全文：.sillyspec/changes/archive/2026-09-25-knowledge-quick-legacy-copy/requirements.md#FR-02
最近确认：5ae347894da3d03154c45783d115e634c8bc2390

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-quick-legacy-copy:flow:FR-02
  tests: frontend/src/components/knowledge/__tests__/distill-history-dialog.test.tsx | frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b9f40ac174b1f01efb0e1b73a5d00cac47efe383
  source_change: 2026-09-25-knowledge-quick-legacy-copy
  status: active

## FR-auto-frontend-017 knowledge/page.tsx 头部过时注释更新（快速修复 tab 已是存
变更：2026-09-25-knowledge-quick-legacy-copy
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台按当前契约运行；When 本变更交付并运行；Then knowledge/page.tsx 头部过时注释更新（快速修复 tab 已是存量口径）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-quick-legacy-copy/requirements.md#FR-03
最近确认：5ae347894da3d03154c45783d115e634c8bc2390

## FR-auto-frontend-018 聚焦验证（tsc + 相关组件测试）全绿，存量蒸馏功能行为零改动（纯文案面）
变更：2026-09-25-knowledge-quick-legacy-copy
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台按当前契约运行；When 本变更交付并运行；Then 聚焦验证（tsc + 相关组件测试）全绿，存量蒸馏功能行为零改动（纯文案面）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-quick-legacy-copy/requirements.md#FR-04
最近确认：5ae347894da3d03154c45783d115e634c8bc2390

## FR-auto-frontend-019 变更详情页重新挂载沉淀资产卡
变更：2026-09-26-change-detail-restore-assets
状态：superseded
superseded_by：FR-styles-011
取代链：FR-auto-frontend-019 ← FR-styles-011（2026-09-26-core-pages-visual-redesign 承接）
摘要：默认场景
场景正文：
- 场景：默认场景 — Given main 分支的变更详情页（`[cid]/page.tsx`）在 304eba982 被夹带的旧版页面覆盖，；When 用户打开任一变更详情页，
全文：.sillyspec/changes/archive/2026-09-26-change-detail-restore-assets/requirements.md#FR-01
最近确认：f41468b59

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-change-detail-restore-assets:flow:FR-01
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-26-change-detail-restore-assets
  status: superseded

## FR-auto-frontend-020 标题阶段徽章恢复 thin/quick 口径
变更：2026-09-26-change-detail-restore-assets
状态：superseded
superseded_by：FR-styles-011
取代链：FR-auto-frontend-020 ← FR-styles-011（2026-09-26-core-pages-visual-redesign 承接）
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `current_stage="thin"` 的轻量变更在标题旁只显示弱化的 outline 徽章（fallback 路径），；When 详情页渲染 thin 或 quick 阶段变更，；Then thin 显示品牌紫 default 徽章「轻量变更」、quick 显示 default 徽章「快速任务（存量）」（`STATUS_BADGE` 四态：quic
全文：.sillyspec/changes/archive/2026-09-26-change-detail-restore-assets/requirements.md#FR-02
最近确认：f41468b59

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-change-detail-restore-assets:flow:FR-02
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b9f40ac174b1f01efb0e1b73a5d00cac47efe383
  source_change: 2026-09-26-change-detail-restore-assets
  status: superseded

## FR-auto-frontend-021 范围对账卡恢复 archived 降级指路
变更：2026-09-26-change-detail-restore-assets
状态：superseded
superseded_by：FR-app-workspace-pages-007
取代链：FR-auto-frontend-021 ← FR-app-workspace-pages-007（2026-10-15-change-detail-redesign 承接）
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已归档变更（status=archived 或 location=archive）的范围对账降级态，；When `ScopeAuditCommandCard` 渲染降级横幅，；Then 重新收到 `archived={isTerminalChange(change)}` 传参，横幅追加「真实改动面见沉淀资产 · 归档留档」指路（组件侧逻辑 9c
全文：.sillyspec/changes/archive/2026-09-26-change-detail-restore-assets/requirements.md#FR-03
最近确认：fe8a71ed4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-change-detail-restore-assets:flow:FR-03
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b9f40ac174b1f01efb0e1b73a5d00cac47efe383
  source_change: 2026-09-26-change-detail-restore-assets
  status: superseded

## FR-auto-frontend-022 聚焦测试与类型门禁全绿
变更：2026-09-26-change-detail-restore-assets
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 三处恢复落盘，；Then 全部用例通过且类型检查 0 错。
全文：.sillyspec/changes/archive/2026-09-26-change-detail-restore-assets/requirements.md#FR-04
最近确认：83bde5d52c29cd07960e1d300d9541bf6a44a5ec

## FR-auto-frontend-023 测试文件预览路径解析兜底（归一 + 文件名搜索 + 后缀救回）
变更：2026-09-26-assets-testfile-path-resolve
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 归档件 test-trace.json 记录的测试文件路径可能是短路径（如 `tests/test_full_sync_convergence.py`，实为仓库；When 用户在沉淀资产卡「测试绑定」行点开测试文件预览，；Then 弹窗先对记录路径做知识库同款字符串归一（反斜杠→斜杠、去 `./` 前缀），再按文件名调 explorer search 全树搜索：命中路径与归一路径**等值*
全文：.sillyspec/changes/archive/2026-09-26-assets-testfile-path-resolve/requirements.md#FR-01
最近确认：49117b2a8bfc07fb875117a81dcd1c9a8d9f6ba1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-assets-testfile-path-resolve:flow:FR-01
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b9f40ac174b1f01efb0e1b73a5d00cac47efe383
  source_change: 2026-09-26-assets-testfile-path-resolve
  status: active

## FR-auto-frontend-024 未命中走中性文案，消除「工作区目录可能已被移动或删除」误导
变更：2026-09-26-assets-testfile-path-resolve
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 记录路径在仓库内零命中或多候选（用户需自选），；When 预览弹窗渲染解析结果，；Then 前端显示中性提示（未在仓库中找到该测试文件、路径可能不完整或已被移动/删除；多候选时列候选），不出现「工作区目录可能已被移动或删除」语义；explorer 后端
全文：.sillyspec/changes/archive/2026-09-26-assets-testfile-path-resolve/requirements.md#FR-02
最近确认：49117b2a8bfc07fb875117a81dcd1c9a8d9f6ba1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcgamb:frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: b9f40ac174b1f01efb0e1b73a5d00cac47efe383
  source_change: 2026-09-26-assets-testfile-path-resolve
  status: active

## FR-auto-frontend-025 前端组件测试补齐且既有用例不回归
变更：2026-09-26-assets-testfile-path-resolve
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 路径解析逻辑落盘，；When 运行 change-assets-card 组件套件，；Then 新增用例（等值命中直用、短路径唯一后缀救回、worktree 副本排除后救回、零命中中性文案）与既有 10 用例全部通过。
全文：.sillyspec/changes/archive/2026-09-26-assets-testfile-path-resolve/requirements.md#FR-03
最近确认：49117b2a8bfc07fb875117a81dcd1c9a8d9f6ba1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-assets-testfile-path-resolve:flow:FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b9f40ac174b1f01efb0e1b73a5d00cac47efe383
  source_change: 2026-09-26-assets-testfile-path-resolve
  status: active

## FR-auto-frontend-026 后端聚焦测试与类型门禁全绿
变更：2026-09-26-assets-testfile-path-resolve
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given explorer 文案修改落盘，；When 运行后端 explorer 聚焦测试与 `frontend tsc --noEmit`，；Then 全部通过且类型检查 0 错。
全文：.sillyspec/changes/archive/2026-09-26-assets-testfile-path-resolve/requirements.md#FR-04
最近确认：49117b2a8bfc07fb875117a81dcd1c9a8d9f6ba1

## FR-auto-frontend-027 卡片视图不再把整行 HTML 注释当正文渲染（与原文视图口径一致：注释不可见）
变更：2026-09-26-knowledge-card-machine-block
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 卡片视图不再把整行 HTML 注释当正文渲染（与原文视图口径一致：注释不可见）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-knowledge-card-machine-block/requirements.md#FR-01
最近确认：963dde53e652652befc497ed379f1eaefe60924b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-knowledge-card-machine-block:flow:FR-01
  tests: frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-knowledge-card-machine-block
  status: active

## FR-auto-frontend-028 测试绑定机器块（注释标记 + row 行 + 缩进键值行）解析为结构化数据，以紧凑只读行展示 tes
变更：2026-09-26-knowledge-card-machine-block
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 测试绑定机器块（注释标记 + row 行 + 缩进键值行）解析为结构化数据，以紧凑只读行展示 tests 路径与 state，不再整块 YAML 倾泻；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-knowledge-card-machine-block/requirements.md#FR-02
最近确认：963dde53e652652befc497ed379f1eaefe60924b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-knowledge-card-machine-block:flow:FR-02
  tests: frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-knowledge-card-machine-block
  status: active

## FR-auto-frontend-029 机器块的「测试绑定：」空字段头不再以悬空空值字段行出现在字段网格
变更：2026-09-26-knowledge-card-machine-block
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 机器块的「测试绑定：」空字段头不再以悬空空值字段行出现在字段网格；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-knowledge-card-machine-block/requirements.md#FR-03
最近确认：963dde53e652652befc497ed379f1eaefe60924b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-knowledge-card-machine-block:flow:FR-03
  tests: frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-knowledge-card-machine-block
  status: active

## FR-auto-frontend-030 无机器块的既有条目（decisions/fr/手册）渲染零回归
变更：2026-09-26-knowledge-card-machine-block
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 无机器块的既有条目（decisions/fr/手册）渲染零回归；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-knowledge-card-machine-block/requirements.md#FR-04
最近确认：963dde53e652652befc497ed379f1eaefe60924b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-knowledge-card-machine-block:flow:FR-04
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-knowledge-card-machine-block
  status: active

## FR-auto-frontend-031 聚焦测试全绿 + tsc 0 错
变更：2026-09-26-knowledge-card-machine-block
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 聚焦测试全绿 + tsc 0 错；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-knowledge-card-machine-block/requirements.md#FR-05
最近确认：963dde53e652652befc497ed379f1eaefe60924b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-knowledge-card-machine-block:flow:FR-05
  tests: frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-knowledge-card-machine-block
  status: active

## FR-auto-frontend-032 工作区列表每行为单行紧凑条目（无 dl 字段表/独立 footer），hover 显操作，拖拽/别名
变更：2026-09-27-visual-gap-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 工作区列表每行为单行紧凑条目（无 dl 字段表/独立 footer），hover 显操作，拖拽/别名/重扫/删除行为全部保留；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-gap-fix/requirements.md#FR-01
最近确认：cf8d14e36eab43d5b4c5b9ab1d1f27620f81d1bc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-visual-gap-fix:flow:FR-01
  tests: frontend/src/app/page.test.tsx | frontend/src/components/__tests__/workspace-card.test.tsx | frontend/src/components/__tests__/workspace-drag-grid.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-visual-gap-fix
  status: active

## FR-auto-frontend-033 概览页呈 统计四格+左主右辅两栏，Hero 之后的旧卡片流结构收敛
变更：2026-09-27-visual-gap-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 概览页呈 统计四格+左主右辅两栏，Hero 之后的旧卡片流结构收敛；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-gap-fix/requirements.md#FR-02
最近确认：cf8d14e36eab43d5b4c5b9ab1d1f27620f81d1bc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-visual-gap-fix:flow:FR-02
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/page-sync.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-visual-gap-fix
  status: active

## FR-auto-frontend-034 会话左栏条目高密度两段式，选中态清晰
变更：2026-09-27-visual-gap-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 会话左栏条目高密度两段式，选中态清晰；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-gap-fix/requirements.md#FR-03
最近确认：cf8d14e36eab43d5b4c5b9ab1d1f27620f81d1bc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-visual-gap-fix:flow:FR-03
  tests: frontend/src/app/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-visual-gap-fix
  status: active

## FR-auto-frontend-035 相关测试全绿 + tsc 0
变更：2026-09-27-visual-gap-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 相关测试全绿 + tsc 0；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-gap-fix/requirements.md#FR-04
最近确认：cf8d14e36eab43d5b4c5b9ab1d1f27620f81d1bc

## FR-auto-frontend-036 变更中心每行两段层级与原型一致（标题主行+key 副行），底部有显示 x
变更：2026-09-27-visual-align-2
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 变更中心每行两段层级与原型一致（标题主行+key 副行），底部有显示 x；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-align-2/requirements.md#FR-01
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-visual-align-2:flow:FR-01
  tests: frontend/src/app/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-visual-align-2
  status: active

## FR-auto-frontend-037 y
变更：2026-09-27-visual-align-2
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When y；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-align-2/requirements.md#FR-02
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

## FR-auto-frontend-038 变更详情右侧为单块 MetaPanel 分组（负责人/消耗/变更文件/关联会话/快速任务/观测事件）
变更：2026-09-27-visual-align-2
状态：superseded
superseded_by：FR-app-workspace-pages-008
取代链：FR-auto-frontend-038 ← FR-app-workspace-pages-008（2026-10-15-change-detail-redesign 承接）
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 变更详情右侧为单块 MetaPanel 分组（负责人/消耗/变更文件/关联会话/快速任务/观测事件），时间线为竖线节点形态；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-align-2/requirements.md#FR-03
最近确认：fe8a71ed4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-visual-align-2:flow:FR-03
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/page-sync.test.tsx | frontend/src/app/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-visual-align-2
  status: superseded

## FR-auto-frontend-039 概览右栏为 About 侧栏（路径/技术栈/关联项目/成员/创建时间）
变更：2026-09-27-visual-align-2
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 概览右栏为 About 侧栏（路径/技术栈/关联项目/成员/创建时间）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-align-2/requirements.md#FR-04
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

## FR-auto-frontend-040 相关测试全绿 + tsc 0 + 部署后截图与原型并排核对一致
变更：2026-09-27-visual-align-2
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 相关测试全绿 + tsc 0 + 部署后截图与原型并排核对一致；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-align-2/requirements.md#FR-05
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

## FR-auto-frontend-041 详情页对 thin 出身变更（判定：current_stage=thin 或 change_type
变更：2026-09-27-thin-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 详情页对 thin 出身变更（判定：current_stage=thin 或 change_type=quick 或 steps 全无标准阶段痕迹）显示轻量流程；Then 干活
全文：.sillyspec/changes/archive/2026-09-27-thin-display-fix/requirements.md#FR-01
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-042 审批区对 thin 出身变更显示轻量只读说明卡而非「当前无可审批事项」
变更：2026-09-27-thin-display-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 审批区对 thin 出身变更显示轻量只读说明卡而非「当前无可审批事项」；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-display-fix/requirements.md#FR-02
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-043 标题区影响字段空值时不渲染占位噪音
变更：2026-09-27-thin-display-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 标题区影响字段空值时不渲染占位噪音；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-display-fix/requirements.md#FR-03
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-044 列表行 active thin（stage=thin）状态图标为琥珀闪电
变更：2026-09-27-thin-display-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 列表行 active thin（stage=thin）状态图标为琥珀闪电；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-display-fix/requirements.md#FR-04
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-045 判定函数导出+单测覆盖三分支
变更：2026-09-27-thin-display-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 判定函数导出+单测覆盖三分支；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-display-fix/requirements.md#FR-05
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-046 相关测试全绿 + tsc 0 + 部署后浏览器验证 hover-polish 详情
变更：2026-09-27-thin-display-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 相关测试全绿 + tsc 0 + 部署后浏览器验证 hover-polish 详情；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-display-fix/requirements.md#FR-06
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-047 遗留如实登记：归档 flow-thin 在列表行无出身信号（列表投影无 steps，需后端加 is_
变更：2026-09-27-thin-display-fix
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 遗留如实登记：归档 flow-thin 在列表行无出身信号（列表投影无 steps，需后端加 is_thin 投影——记入后续建议不在本刀）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-display-fix/requirements.md#FR-07
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-048 ChangeSummary 含 is_thin（bool，default False 零破坏），后端
变更：2026-09-27-change-list-is-thin
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When ChangeSummary 含 is_thin（bool，default False 零破坏），后端投影测试覆盖三分支+时间窗负向；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-change-list-is-thin/requirements.md#FR-01
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-change-list-is-thin:flow:FR-01
  tests: backend/app/modules/change/tests/test_enrich_projection.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-27-change-list-is-thin
  status: active

## FR-auto-frontend-049 前端 api-types 重生成（gen:types）+ 列表行 is_thin=true 时标题行
变更：2026-09-27-change-list-is-thin
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 / api 相关模块就绪；When 前端 api-types 重生成（gen:types）+ 列表行 is_thin=true 时标题行显示「轻量」琥珀徽章，归档轻量与已归档状态并存；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-change-list-is-thin/requirements.md#FR-02
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-050 后端相关测试全绿 + 前端列表测试全绿 + tsc 0 + openapi.json 同批提交
变更：2026-09-27-change-list-is-thin
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 / 前端 / api 相关模块就绪；When 后端相关测试全绿 + 前端列表测试全绿 + tsc 0 + openapi.json 同批提交；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-change-list-is-thin/requirements.md#FR-03
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-051 部署后浏览器验证归档区轻量行出身标识
变更：2026-09-27-change-list-is-thin
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 部署后浏览器验证归档区轻量行出身标识；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-change-list-is-thin/requirements.md#FR-04
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-052 normalizeTestFilePath 剥离路径中的「…」注解段（支持一段或多段），剥离后为空仍
变更：2026-09-27-assets-testfile-bracket-note
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When normalizeTestFilePath 剥离路径中的「…」注解段（支持一段或多段），剥离后为空仍按未找到处理；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-assets-testfile-bracket-note/requirements.md#FR-01
最近确认：99c508227642192dc929cd0702441f3303a6ceff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcgis1:frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-27-assets-testfile-bracket-note
  status: active

## FR-auto-frontend-053 TestFileBody 用剥离后的文件名发起 explorer search，粘注解路径可等值
变更：2026-09-27-assets-testfile-bracket-note
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When TestFileBody 用剥离后的文件名发起 explorer search，粘注解路径可等值；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-assets-testfile-bracket-note/requirements.md#FR-02
最近确认：99c508227642192dc929cd0702441f3303a6ceff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcgj9n:frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-27-assets-testfile-bracket-note
  status: active

## FR-auto-frontend-054 后缀命中并打开真实测试文件预览
变更：2026-09-27-assets-testfile-bracket-note
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 后缀命中并打开真实测试文件预览；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-assets-testfile-bracket-note/requirements.md#FR-03
最近确认：99c508227642192dc929cd0702441f3303a6ceff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcgjvf:frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-27-assets-testfile-bracket-note
  status: active

## FR-auto-frontend-055 既有 change-assets-card 路径解析用例全绿，新增用例覆盖多段注解与搜索入参为干净文
变更：2026-09-27-assets-testfile-bracket-note
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 既有 change-assets-card 路径解析用例全绿，新增用例覆盖多段注解与搜索入参为干净文件名；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-assets-testfile-bracket-note/requirements.md#FR-04
最近确认：99c508227642192dc929cd0702441f3303a6ceff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcgkh1:frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-27-assets-testfile-bracket-note
  status: active

## FR-auto-frontend-056 变更详情页步骤时间线卡与真实留痕时间线卡共存：steps 非空时合成时间线卡也渲染（组件自身空态静默
变更：2026-09-27-timeline-coexist
状态：superseded
superseded_by：FR-app-workspace-pages-009
取代链：FR-auto-frontend-056 ← FR-app-workspace-pages-009（2026-10-15-change-detail-redesign 承接）
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 相关模块就绪；When 变更详情页步骤时间线卡与真实留痕时间线卡共存：steps 非空时合成时间线卡也渲染（组件自身空态静默隐藏兜底不变）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-timeline-coexist/requirements.md#FR-01
最近确认：fe8a71ed4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-timeline-coexist:flow:FR-01
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-timeline-coexist
  status: superseded

## FR-auto-frontend-057 thin 在途（steps 恒空）行为不变：合成卡独立承担叙事
变更：2026-09-27-timeline-coexist
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When thin 在途（steps 恒空）行为不变：合成卡独立承担叙事；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-timeline-coexist/requirements.md#FR-02
最近确认：d3ee2bbd7cc53faf6cabdfc312554ef032dcddb3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-timeline-coexist:flow:FR-02
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-timeline-coexist
  status: active

## FR-auto-frontend-058 相关前端测试同步更新并全部通过
变更：2026-09-27-timeline-coexist
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 / 测试 相关模块就绪；When 相关前端测试同步更新并全部通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-timeline-coexist/requirements.md#FR-03
最近确认：d3ee2bbd7cc53faf6cabdfc312554ef032dcddb3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-timeline-coexist:flow:FR-03
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx | frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-timeline-coexist
  status: active

## FR-auto-frontend-059 TimelineTask 增加 time 字段（翻格顺序推断的勾选时刻，游标衔接赋值、中段断裂停止、
变更：2026-09-27-timeline-task-time
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When TimelineTask 增加 time 字段（翻格顺序推断的勾选时刻，游标衔接赋值、中段断裂停止、尾部未勾不标断裂——CLI inferFlipTimes 同；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-timeline-task-time/requirements.md#FR-01
最近确认：365d909efbe7a04dc4429d377c5a7487713fa2b7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-timeline-task-time:flow:FR-01
  tests: backend/app/modules/change/tests/test_timeline.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-27-timeline-task-time
  status: active

## FR-auto-frontend-060 前端任务面显示 ≈HH:mm:ss 时刻列（已勾无时刻显示 ?，未勾不显示）
变更：2026-09-27-timeline-task-time
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 相关模块就绪；When 前端任务面显示 ≈HH:mm:ss 时刻列（已勾无时刻显示 ?，未勾不显示）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-timeline-task-time/requirements.md#FR-02
最近确认：365d909efbe7a04dc4429d377c5a7487713fa2b7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcgb8x:frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx
  tests: frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: b9f40ac174b1f01efb0e1b73a5d00cac47efe383
  source_change: 2026-09-27-timeline-task-time
  status: active

## FR-auto-frontend-061 openapi.json + api-types.ts 同步再生，后端/前端相关测试通过
变更：2026-09-27-timeline-task-time
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given api / 前端 / 测试 相关模块就绪；When openapi.json + api-types.ts 同步再生，后端/前端相关测试通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-timeline-task-time/requirements.md#FR-03
最近确认：365d909efbe7a04dc4429d377c5a7487713fa2b7

## FR-auto-frontend-062 变更详情页不再挂载观测事件卡（desktop 与移动端全挂载点清除）
变更：2026-09-28-drop-observation-card
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 变更详情页不再挂载观测事件卡（desktop 与移动端全挂载点清除）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-drop-observation-card/requirements.md#FR-01
最近确认：7e998a5c6bfd9fffb426588186c47e250ddf2bf5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-drop-observation-card:flow:FR-01
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-drop-observation-card
  status: active

## FR-auto-frontend-063 卡组件与其前端封装若无其他引用则一并删除（不留死代码）
变更：2026-09-28-drop-observation-card
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 / 前端 相关模块就绪；When 卡组件与其前端封装若无其他引用；Then 一并删除（不留死代码）
全文：.sillyspec/changes/archive/2026-09-28-drop-observation-card/requirements.md#FR-02
最近确认：7e998a5c6bfd9fffb426588186c47e250ddf2bf5

## FR-auto-frontend-064 相关测试同步更新（原断言该卡在场的用例改口径）并全部通过
变更：2026-09-28-drop-observation-card
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 相关测试同步更新（原断言该卡在场的用例改口径）并全部通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-drop-observation-card/requirements.md#FR-03
最近确认：7e998a5c6bfd9fffb426588186c47e250ddf2bf5

## FR-auto-frontend-065 后端 /changes/{name}/events 端点不动（CLI 推送与调试面仍在用）
变更：2026-09-28-drop-observation-card
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 端点 相关模块就绪；When 后端 /changes/{name}/events 端点不动（CLI 推送与调试面仍在用）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-drop-observation-card/requirements.md#FR-04
最近确认：7e998a5c6bfd9fffb426588186c47e250ddf2bf5

## FR-auto-frontend-066 无摘要轮显示中性占位「（无内容记录）」（muted 样式），不再出现「未加载
变更：2026-09-28-turn-nav-empty-hint
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 无摘要轮显示中性占位「（无内容记录）」（muted 样式），不再出现「未加载；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-empty-hint/requirements.md#FR-01
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-turn-nav-empty-hint:flow:FR-01
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-turn-nav-empty-hint
  status: active

## FR-auto-frontend-067 点击加载」误导文案
变更：2026-09-28-turn-nav-empty-hint
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 点击加载」误导文案；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-empty-hint/requirements.md#FR-02
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb

## FR-auto-frontend-068 「未加载」状态语义保留在 aria-label（读屏可辨）与视觉（未加载行 muted 降调不变）
变更：2026-09-28-turn-nav-empty-hint
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 「未加载」状态语义保留在 aria-label（读屏可辨）与视觉（未加载行 muted 降调不变）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-empty-hint/requirements.md#FR-03
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb

## FR-auto-frontend-069 桌面窄轨
变更：2026-09-28-turn-nav-empty-hint
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 桌面窄轨；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-empty-hint/requirements.md#FR-04
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-turn-nav-empty-hint:flow:FR-04
  tests: frontend/src/components/sessions/__tests__/turn-catalog.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-turn-nav-empty-hint
  status: active

## FR-auto-frontend-070 浮层行与 mobile Drawer 的同源占位文案一并修正
变更：2026-09-28-turn-nav-empty-hint
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 浮层行与 mobile Drawer 的同源占位文案一并修正；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-empty-hint/requirements.md#FR-05
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb

## FR-auto-frontend-071 相关测试改断言不改意图全绿，tsc
变更：2026-09-28-turn-nav-empty-hint
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 相关测试改断言不改意图全绿，tsc；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-empty-hint/requirements.md#FR-06
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb

## FR-auto-frontend-072 eslint 零新增
变更：2026-09-28-turn-nav-empty-hint
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When eslint 零新增；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-empty-hint/requirements.md#FR-07
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb

## FR-auto-frontend-073 目标：每个信号用人话说明（这是什么/要不要紧/影响什么），可机械处理的给一键按钮（推荐目标预填 +
变更：2026-09-28-knowledge-gov-ux
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 目标：每个信号用人话说明（这是什么/要不要紧/影响什么），可机械处理的给一键按钮（推荐目标预填 + 确认弹窗 + 完成反馈），不能一键的（需内容判断的）明说建议；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-01
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-knowledge-gov-ux:flow:FR-01
  tests: frontend/src/components/knowledge/__tests__/governance-cards.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-knowledge-gov-ux
  status: active

## FR-auto-frontend-074 动作复用既有 POST /knowledge/governance/actions（redomain
变更：2026-09-28-knowledge-gov-ux
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 动作复用既有 POST /knowledge/governance/actions（redomain/repair），不加新写通道；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-02
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

## FR-auto-frontend-075 伪域各池（auto-sillyhub-daemon/auto-backend/auto-fronte
变更：2026-09-28-knowledge-gov-ux
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 伪域各池（auto-sillyhub-daemon/auto-backend/auto-frontend/auto-sillyspec）每池一行：人话描述+条数；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-03
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

## FR-auto-frontend-076 信号卡标题
变更：2026-09-28-knowledge-gov-ux
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 信号卡标题；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-04
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

## FR-auto-frontend-077 说明全部改为非开发者可懂文案，不再出现 CLI 命令字样
变更：2026-09-28-knowledge-gov-ux
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 说明全部改为非开发者可懂文案，不再出现 CLI 命令字样；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-05
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

## FR-auto-frontend-078 操作成功/失败有明确反馈（结果行/toast + 刷新）
变更：2026-09-28-knowledge-gov-ux
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 操作成功/失败有明确反馈（结果行/toast + 刷新）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-06
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

## FR-auto-frontend-079 既有 governance 前端测试同步更新全绿，tsc
变更：2026-09-28-knowledge-gov-ux
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 / 测试 相关模块就绪；When 既有 governance 前端测试同步更新全绿，tsc；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-07
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-knowledge-gov-ux:flow:FR-07
  tests: frontend/src/components/knowledge/__tests__/governance-cards.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-knowledge-gov-ux
  status: active

## FR-auto-frontend-080 eslint 0 错
变更：2026-09-28-knowledge-gov-ux
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When eslint 0 错；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-08
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

## FR-auto-frontend-081 列表行描述单行截断不再溢出覆盖右列/影响模块（min-w-0 修复），悬浮全文保留
变更：2026-09-28-change-ux-detail-batch
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 列表行描述单行截断不再溢出覆盖右列/影响模块（min-w-0 修复），悬浮全文保留；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-01
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-01
  tests: frontend/src/app/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-ux-detail-batch
  status: active

## FR-auto-frontend-082 详情页头部显示变更描述（单行截断+悬浮全文）
变更：2026-09-28-change-ux-detail-batch
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 详情页头部显示变更描述（单行截断+悬浮全文）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-02
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-02
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-ux-detail-batch
  status: active

## FR-auto-frontend-083 平台同步处理区收进工具条按钮（搜索/重置旁），点开抽屉承载原处理区
变更：2026-09-28-change-ux-detail-batch
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 平台同步处理区收进工具条按钮（搜索/重置旁），点开抽屉承载原处理区；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-03
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-03
  tests: frontend/src/app/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-ux-detail-batch
  status: active

## FR-auto-frontend-084 无绑定数据源时抽屉内中性提示
变更：2026-09-28-change-ux-detail-batch
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 无绑定数据源时抽屉内中性提示；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-04
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-04
  tests: frontend/src/app/page.test.tsx | frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-ux-detail-batch
  status: active

## FR-auto-frontend-085 详情页轻量变更说明卡（协议 1/2、2/2 长文案）不再渲染
变更：2026-09-28-change-ux-detail-batch
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 详情页轻量变更说明卡（协议 1/2、2/2 长文案）不再渲染；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-05
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-05
  tests: frontend/src/components/changes/detail/__tests__/change-stage-actions.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-ux-detail-batch
  status: active

## FR-auto-frontend-086 顶部轻量流程条保留
变更：2026-09-28-change-ux-detail-batch
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 顶部轻量流程条保留；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-06
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-06
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-ux-detail-batch
  status: active

## FR-auto-frontend-087 沉淀资产卡默认展开、移入主栏，各分组卡片固定高度（超出滚动）网格对齐
变更：2026-09-28-change-ux-detail-batch
状态：superseded
superseded_by：FR-app-workspace-pages-006
取代链：FR-auto-frontend-087 ← FR-app-workspace-pages-006（2026-10-15-change-detail-redesign 承接）
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 沉淀资产卡默认展开、移入主栏，各分组卡片固定高度（超出滚动）网格对齐；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-07
最近确认：fe8a71ed4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-07
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-ux-detail-batch
  status: superseded

## FR-auto-frontend-088 智能体运行状态卡自桌面详情页移除（组件与移动端用法保留）
变更：2026-09-28-change-ux-detail-batch
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 相关模块就绪；When 智能体运行状态卡自桌面详情页移除（组件与移动端用法保留）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-08
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-08
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx | frontend/src/components/changes/detail/__tests__/change-agent-run-log.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-ux-detail-batch
  status: active

## FR-auto-frontend-089 关联快速任务卡无关联时不渲染（有数据才显示）
变更：2026-09-28-change-ux-detail-batch
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 关联快速任务卡无关联时不渲染（有数据才显示）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-09
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-09
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-ux-detail-batch
  status: active

## FR-auto-frontend-090 范围对账卡去头部说明副标题与降级双段说明，压缩为单行降级提示（归档指路保留）
变更：2026-09-28-change-ux-detail-batch
状态：superseded
superseded_by：FR-app-workspace-pages-007
取代链：FR-auto-frontend-090 ← FR-app-workspace-pages-007（2026-10-15-change-detail-redesign 承接）
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 范围对账卡去头部说明副标题与降级双段说明，压缩为单行降级提示（归档指路保留）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-10
最近确认：fe8a71ed4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-10
  tests: frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-ux-detail-batch
  status: superseded

## FR-auto-frontend-091 相关前端测试更新通过，tsc/eslint 0 错
变更：2026-09-28-change-ux-detail-batch
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 / 测试 相关模块就绪；When 相关前端测试更新通过，tsc/eslint 0 错；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-11
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

## FR-auto-rontend-001 每池/每域/收件箱加「查看明细」深链（?file=fr/<domain>.md / uncatego
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 每池/每域/收件箱加「查看明细」深链（?file=fr/<domain>.md / uncategorized.md，复用页面既有深链消费能力，同页软导航）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-01
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-knowledge-gov-ux-detail:flow:FR-01
  tests: frontend/src/components/knowledge/__tests__/governance-cards.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-knowledge-gov-ux-detail
  status: active

## FR-auto-rontend-002 rot/收件箱卡加「复制 AI 处理指令」按钮（clipboard 复制即用提示词，含分布/计数；失
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When rot/收件箱卡加「复制 AI 处理指令」按钮（clipboard 复制即用提示词，含分布/计数；失败降级为内联展示提示词文本）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-02
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-003 binding-unresolved 卡正文补明细（锚点 id 列表）
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When binding-unresolved 卡正文补明细（锚点 id 列表）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-03
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-004 伪域未知池（如 auto-round5）也给查看链接
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 伪域未知池（如 auto-round5）也给查看链接；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-04
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-005 四类卡都能看到具体数据入口（深链到本页对应知识文件）
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 四类卡都能看到具体数据入口（深链到本页对应知识文件）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-05
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-006 rot
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When rot；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-06
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-knowledge-gov-ux-detail:flow:FR-06
  tests: frontend/src/components/knowledge/__tests__/governance-cards.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-knowledge-gov-ux-detail
  status: active

## FR-auto-rontend-007 inbox 有一键复制处理指令入口（复制成功有反馈
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When inbox 有一键复制处理指令入口（复制成功有反馈；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-07
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-008 clipboard 不可用时内联显示可手动复制）
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When clipboard 不可用时内联显示可手动复制）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-08
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-009 分池行查看链接跳转参数正确（?file=fr/<domain>.md）
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 分池行查看链接跳转参数正确（?file=fr/<domain>.md）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-09
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-010 既有测试同步更新全绿，tsc
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 既有测试同步更新全绿，tsc；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-10
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-011 eslint 0 错
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When eslint 0 错；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-11
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-unmapped-109 日志区域宽度自适应
变更：2026-06-05-agent-74b61b
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Agent 控制台页面加载完成；When 用户在"已完成运行"表格中点击"查看日志"展开日志区域；Then 日志区域宽度应填满 AppShell 主内容区的可用宽度（viewport 减去 sidebar）
全文：.sillyspec/changes/archive/2026-06-05-agent-74b61b/requirements.md#FR-01
最近确认：90ddec4bc

## FR-unmapped-110 长日志行显示
变更：2026-06-05-agent-74b61b
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 日志区域已展开；When 日志内容包含超过容器宽度的长文本行；Then 长文本行应自然折行显示（`white-space: pre-wrap; word-break: break-all`）
全文：.sillyspec/changes/archive/2026-06-05-agent-74b61b/requirements.md#FR-02
最近确认：90ddec4bc

## FR-unmapped-111 小屏兼容
变更：2026-06-05-agent-74b61b
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在 1280px 或更小屏幕上访问 Agent 控制台；When 页面加载完成；Then 页面布局正常，内容不溢出
全文：.sillyspec/changes/archive/2026-06-05-agent-74b61b/requirements.md#FR-03
最近确认：90ddec4bc

## FR-unmapped-112 日志块内水平滚动
变更：2026-06-08-2026-06-05-agent-log-width
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-08-2026-06-05-agent-log-width/requirements.md#FR-01
最近确认：f311f977d

## FR-unmapped-113 页面无 X 轴滚动条
变更：2026-06-08-2026-06-05-agent-log-width
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-08-2026-06-05-agent-log-width/requirements.md#FR-02
最近确认：f311f977d

## FR-unmapped-114 日志内容完整性
变更：2026-06-08-2026-06-05-agent-log-width
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-08-2026-06-05-agent-log-width/requirements.md#FR-03
最近确认：f311f977d

## FR-unmapped-115 现有功能不受影响
变更：2026-06-08-2026-06-05-agent-log-width
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-08-2026-06-05-agent-log-width/requirements.md#FR-04
最近确认：f311f977d

## FR-unmapped-217 Design Token 单一源
变更：2026-06-21-2026-06-21-frontend-style-system
状态：active
摘要：（无场景名）
依据决策：D-004@v2、D-005@v1、D-006@v1
全文：.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/requirements.md#FR-01
最近确认：4fcf52daa

## FR-unmapped-218 统一"现代明亮活力"视觉
变更：2026-06-21-2026-06-21-frontend-style-system
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/requirements.md#FR-02
最近确认：4fcf52daa

## FR-unmapped-219 统一状态语义色
变更：2026-06-21-2026-06-21-frontend-style-system
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/requirements.md#FR-03
最近确认：4fcf52daa

## FR-unmapped-220 共享布局组件
变更：2026-06-21-2026-06-21-frontend-style-system
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/requirements.md#FR-04
最近确认：4fcf52daa

## FR-unmapped-221 AppShell 升级
变更：2026-06-21-2026-06-21-frontend-style-system
状态：active
摘要：（无场景名）
依据决策：D-003@v1
全文：.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/requirements.md#FR-05
最近确认：4fcf52daa

## FR-unmapped-222 登录页同色系
变更：2026-06-21-2026-06-21-frontend-style-system
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/requirements.md#FR-06
最近确认：4fcf52daa

## FR-unmapped-223 Inter 字体
变更：2026-06-21-2026-06-21-frontend-style-system
状态：active
摘要：（无场景名）
依据决策：D-004@v2
全文：.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/requirements.md#FR-07
最近确认：4fcf52daa

## FR-unmapped-229 单一 SSE 客户端（合并）
变更：2026-06-22-2026-06-22-unify-agent-run-sse-hook
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 前端存在 `streamAgentRunLogs`（函数）与 `AgentRunStreamClient`（class）两套 SSE 客户端；When 本次变更完成；Then `AgentRunStreamClient` 是唯一底层 SSE 客户端；`streamAgentRunLogs` 从 `agent.ts` 删除；4 个调用点
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-unify-agent-run-sse-hook/requirements.md#FR-01
最近确认：76d31620a

## FR-unmapped-230 useAgentRunStream hook 封装实时流状态
变更：2026-06-22-2026-06-22-unify-agent-run-sse-hook
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 一个活跃 agent run（workspaceId + runId，status∈{pending,running}）；When 调用 `useAgentRunStream(workspaceId, runId, { isActive: true })`；Then hook 内部 `new AgentRunStreamClient` 并连接，返回 `{ logs, status, streaming, loading, e
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-unify-agent-run-sse-hook/requirements.md#FR-02
最近确认：76d31620a

## FR-unmapped-231 AgentRunPanel 面板组件
变更：2026-06-22-2026-06-22-unify-agent-run-sse-hook
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 调用点需要展示一个 run 的实时日志 + 审批 + input；When 渲染 `<AgentRunPanel workspaceId runId isActive title ... />`；Then 内部调 `useAgentRunStream`，把 logs/perms/input（适配后）/loading 注入 `<AgentLogViewer>`，调用
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-unify-agent-run-sse-hook/requirements.md#FR-03
最近确认：76d31620a

## FR-unmapped-232 AskUserQuestion 审批卡片在 /agent 与 changes/[cid] 渲染（bug 修复）
变更：2026-06-22-2026-06-22-unify-agent-run-sse-hook
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given `/agent` 或 `changes/[cid]` 页的活跃 run 中 Claude Code 触发 AskUserQuestion（daemon 发 pe；When 事件到达 `AgentRunStreamClient` 卡片自调 `respondSessionPermission` 成功后 onResolved，或 SSE；Then hook 的 `perms` 增加该 request（按 request_id 去重），`AgentRunPanel`→`AgentLogViewer` 渲染审
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-unify-agent-run-sse-hook/requirements.md#FR-04
最近确认：76d31620a

## FR-unmapped-233 pending_input 回复纳入 hook + UI 统一
变更：2026-06-22-2026-06-22-unify-agent-run-sse-hook
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 活跃 run 输出 pending_input 日志（人工指导请求）；When 用户在 input 控件填写并提交；Then hook 的 `input.submit(logId)` 调 `submitAgentRunInput`，成功后标记 `replied`；三处调用点（根/age
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-unify-agent-run-sse-hook/requirements.md#FR-05
最近确认：76d31620a

## FR-unmapped-234 非活跃 run 仅 prefetch 历史（isActive 语义）
变更：2026-06-22-2026-06-22-unify-agent-run-sse-hook
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given runId 对应非活跃 run（completed/failed/killed），`isActive=false`；When 调用 `useAgentRunStream(workspaceId, runId, { isActive: false })`；Then hook 仅 prefetch 历史日志（`AgentRunStreamClient.connect` 内 `getAgentRunLogs`），**不建立 S
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-unify-agent-run-sse-hook/requirements.md#FR-06
最近确认：76d31620a

## FR-unmapped-235 dialog 恢复（刷新前未答的 AskUserQuestion）
变更：2026-06-22-2026-06-22-unify-agent-run-sse-hook
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 页面刷新前已有 pending 的 AskUserQuestion 对话（dialog_kind 待答）；When hook 连接一个 isActive run（runId 变化）；Then hook 内部 `getAgentRun` 取 `session_id` → `fetchPendingDialogs(session_id)` 恢复未答 di
全文：.sillyspec/changes/archive/2026-06-22-2026-06-22-unify-agent-run-sse-hook/requirements.md#FR-07
最近确认：76d31620a

## FR-unmapped-246 会话弹窗化（runtime 专属工作台）
变更：2026-06-23-runtimes-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在 /runtimes 页面，存在在线 runtime（claude/codex） 弹窗已打开（runtime A） 弹窗打开且该 runtime 有活跃会；When 用户点击某 runtime 卡片的「会话」按钮 用户点击另一 runtime B 的「会话」按钮 弹窗渲染 弹窗渲染；Then 弹出该 runtime 专属会话工作台（左历史会话列表 + 右会话区），不滚动页面 弹窗切换为 B（单例，A 关闭 B 打开，状态重置） 右侧默认 attach
全文：.sillyspec/changes/archive/2026-06-23-runtimes-session-dialog/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-247 active 会话续聊
变更：2026-06-23-runtimes-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 弹窗左侧列表有一 active 会话 active 会话 attach 后有进行中 run；When 用户点击该 active 会话项 SSE 推送进行中 run 的 log；Then 右侧进入 attach 模式：拉历史 logs → `logsToTurns` 预填 → 建 SSE → 轮询到 active → 输入框可用可发送续聊（非只读
全文：.sillyspec/changes/archive/2026-06-23-runtimes-session-dialog/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-248 页面精简
变更：2026-06-23-runtimes-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户进入 /runtimes；When 页面渲染；Then 无底部常驻会话区，主体为摘要卡 + runtime 卡片列表，卡片更舒展
全文：.sillyspec/changes/archive/2026-06-23-runtimes-session-dialog/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-249 ended/failed 会话回看与续聊
变更：2026-06-23-runtimes-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 弹窗左侧有 ended/failed claude 会话（有 agent_session_id） ended/failed codex 会话；When 用户点击 用户点击；Then 右侧只读回看 + 「继续对话」按钮可用（reopen → attach） 右侧只读回看，「继续对话」置灰（codex 不支持续聊）
全文：.sillyspec/changes/archive/2026-06-23-runtimes-session-dialog/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-250 关闭清理
变更：2026-06-23-runtimes-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 弹窗打开且会话 attach 中（SSE/轮询活跃）；When 用户关闭弹窗；Then SSE 关闭 + 轮询清理无泄漏；`?session=` 被清除
全文：.sillyspec/changes/archive/2026-06-23-runtimes-session-dialog/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-251 URL `?session=` 恢复
变更：2026-06-23-runtimes-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given URL 含 `?session=<活跃会话>` URL 含 `?session=<ended/failed/不存在>`；When 页面 mount/刷新 页面 mount；Then 自动打开对应 runtime 弹窗并 attach 该会话 清 param，不开弹窗，降级 idle
全文：.sillyspec/changes/archive/2026-06-23-runtimes-session-dialog/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-267 卡片展示 token / 缓存 / 费用数字
变更：2026-06-24-runtime-usage-stats
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 某 runtime 在选定时间窗内有用量数据 该 runtime 无 cache 数据(如 codex)；When 用户打开运行时列表页 渲染缓存数字；Then 该 runtime 卡片显示「输入 / 输出 / 缓存 / 费用」4 个数字(token 用 k/M 格式化,费用 $USD) 显示「—」;无费用数据显示 $0
全文：.sillyspec/changes/archive/2026-06-24-runtime-usage-stats/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-268 cache 采集(daemon)
变更：2026-06-24-runtime-usage-stats
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — When stream-json 的 message_delta 携带 `event.usage.cache_creation_input_tokens` / `cach；Then daemon 累加并经 `usage_update` 透传到后端,写入 `AgentRun.cache_read_tokens` / `cache_creati
全文：.sillyspec/changes/archive/2026-06-24-runtime-usage-stats/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-269 批量聚合接口
变更：2026-06-24-runtime-usage-stats
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v2、D-004@v1
场景正文：
- 场景：默认场景 — Given 多个 runtime 存在归属它们的 agent_runs interactive run 同时挂 agent_session_id + lease_id wi；When `GET /api/daemon/runtimes/usage?window=7d` 聚合 返回 daily 返回 daily 聚合；Then 返回每个 runtime 的 `{summary: input/output/cache_read/cache_creation/cost, daily: [.
全文：.sillyspec/changes/archive/2026-06-24-runtime-usage-stats/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-270 时间窗折线图(sparkline)
变更：2026-06-24-runtime-usage-stats
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 卡片拿到某 runtime 的 daily 序列 某时间窗该 runtime 无数据；When 渲染 sparkline 渲染；Then 画输入(蓝)/ 输出(绿)双线;切换时间窗时折线随之更新 折线为空占位,数字显示「—」/0
全文：.sillyspec/changes/archive/2026-06-24-runtime-usage-stats/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-271 兼容与回退
变更：2026-06-24-runtime-usage-stats
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 老 daemon 不上报 cache / 历史数据 cache 列为 NULL；When 聚合查询；Then `SUM(COALESCE(...,0))` 忽略 NULL 不报错;现有 `/runtimes`、`/sessions` 端点行为不变
全文：.sillyspec/changes/archive/2026-06-24-runtime-usage-stats/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-278 errMessage 纯函数取中文文案
变更：2026-06-25-2026-06-25-frontend-error-handling
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个 ApiError(code="HTTP_409_DAEMON_RUNTIME_IN_USE", message="该 daemon 仍被 1 个 work；When 调用 errMessage(err) 调用 errMessage(err) 调用 errMessage(err)  /  errMessage(err, "加载；Then 返回 "该 daemon 仍被 1 个 workspace 绑定…"（后端中文 message 原样） 返回 "网络连接失败，请检查网络后重试"（中文兜底） 返
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-frontend-error-handling/requirements.md#FR-01
最近确认：0ab898669

## FR-unmapped-279 useNotify hook 统一通知入口
变更：2026-06-25-2026-06-25-frontend-error-handling
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件渲染在 <AntApp> 内（dashboard 全局已包裹） 操作成功；When 调用 const notify = useNotify(); notify.error(err) 调用 notify.success("运行时已移除")；Then 调用 antd messageApi.error(errMessage(err))，弹出中文 toast 弹出 antd 成功 toast
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-frontend-error-handling/requirements.md#FR-02
最近确认：0ab898669

## FR-unmapped-280 daemon runtime 删除落地
变更：2026-06-25-2026-06-25-frontend-error-handling
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在 runtimes 页点某 runtime 的「移除」 确认删除后后端返回 409（被 workspace 绑定） 确认删除后后端返回 204；When 触发删除 ApiError 抛出 成功；Then 弹出 antd Modal.confirm（destructive 主题，中文警告），而非原生 window.confirm notify.error(err)
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-frontend-error-handling/requirements.md#FR-03
最近确认：0ab898669

## FR-unmapped-281 D 模式 16 处收敛
变更：2026-06-25-2026-06-25-frontend-error-handling
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 16 处 `${err.code}: ${err.message}` 拼接（精确清单见 design §6）；When 替换为 errMessage(err) / notify.error(err)；Then 用户不再看到英文 code；原展示方式（toast/inline）保持；grep 残留 = 0
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-frontend-error-handling/requirements.md#FR-04
最近确认：0ab898669

## FR-unmapped-282 合并 3 处重复 errMessage util
变更：2026-06-25-2026-06-25-frontend-error-handling
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given kanban.ts / ppm problem-list / problem-changes 各有局部 errMessage；When 改为 import 全局 lib/errors.ts 的 errMessage；Then 行为等价（全局版多 network 兜底，属增强）；局部函数删除
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-frontend-error-handling/requirements.md#FR-05
最近确认：0ab898669

## FR-unmapped-283 展示策略规范文档化
变更：2026-06-25-2026-06-25-frontend-error-handling
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本次确立的展示策略（操作 toast / 加载 inline / 表单 inline / 确认 Modal）；When 写入模块文档（lib-errors.md 注意事项区）；Then 后续开发者有明确约定可循
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-frontend-error-handling/requirements.md#FR-06
最近确认：0ab898669

## FR-unmapped-353 工作区上下文 store（缓存层）
变更：2026-07-09-2026-07-09-workspace-prioritization
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-workspace-prioritization/requirements.md#FR-01
最近确认：af41fac1d

## FR-unmapped-354 登录后强制选工作区（客户端守卫）
变更：2026-07-09-2026-07-09-workspace-prioritization
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-workspace-prioritization/requirements.md#FR-02
最近确认：af41fac1d

## FR-unmapped-355 落地页改工作区选择器
变更：2026-07-09-2026-07-09-workspace-prioritization
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-workspace-prioritization/requirements.md#FR-03
最近确认：af41fac1d

## FR-unmapped-356 顶栏工作区切换器
变更：2026-07-09-2026-07-09-workspace-prioritization
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-workspace-prioritization/requirements.md#FR-04
最近确认：af41fac1d

## FR-unmapped-357 daemon 绑定弹窗
变更：2026-07-09-2026-07-09-workspace-prioritization
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-workspace-prioritization/requirements.md#FR-05
最近确认：af41fac1d

## FR-unmapped-358 daemon 状态数据接入
变更：2026-07-09-2026-07-09-workspace-prioritization
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-workspace-prioritization/requirements.md#FR-06
最近确认：af41fac1d

## FR-unmapped-367 SessionListLayout 公共组件
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 两处会话列表（runtimes 弹窗 / 变更会话）需要一致的视觉 列表为空；When 调用方传入标准化 `SessionListEntry[]` + `onSelect`/`onNewSession`/`onRetry`（可选 `onDelete；Then 组件渲染圆角卡片（`rounded-md border bg-slate-50`）+ header + 顶部「新建会话」虚线按钮 + 列表项（`title ??
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-01
最近确认：f7f73d86c

## FR-unmapped-368 RuntimeSessionDialog 样式对齐 + 二态化
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户打开 `/runtimes?session=<id>` 弹窗 用户点击任意状态会话（active/pending/reconnecting/ended/fa；When 弹窗渲染 handleSelect 触发 触发 触发；Then 左侧使用 `SessionListLayout`（带删除按钮，字段=title/status/提供方·轮数/时间），右侧直接挂 `InteractiveSess
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-02
最近确认：f7f73d86c

## FR-unmapped-369 ChangeSessionSection 改用公共组件 + ended/failed reopen
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更详情页会话区块 用户点击 ended/failed 会话；When 渲染 handleSelect 触发；Then 左侧使用 `SessionListLayout`（不传 `onDelete`，`secondaryText`=作者·提供方），右侧 `InteractiveSe
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-03
最近确认：f7f73d86c

## FR-unmapped-370 消息渲染 BUG 修复（sanitizeSessionLogContent + logsToTurns）
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given attach 历史会话预填 turn 实时 SSE log attach 后 SSE 与 initialTurns 可能重叠；When `logsToTurns(getAgentSessionLogs)` 处理每条 log `renderLogContent` 处理 daemon 推送历史 lo；Then 对 `content_redacted` 先调 `sanitizeSessionLogContent(content, channel)` 过滤（`[SYSTE
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-04
最近确认：f7f73d86c

## FR-unmapped-371 AgentSession.deleted_at 软删字段
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given AgentSession 模型 migration downgrade；When migration apply 执行；Then 新增 `deleted_at TIMESTAMP NULL` 列 + `ix_agent_sessions_deleted_at` 索引；现有行 `delete
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-05
最近确认：f7f73d86c

## FR-unmapped-372 delete_agent_session 改软删
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户删除 active/pending/reconnecting 会话 用户删除 ended/failed 会话；When `delete_agent_session` 执行 执行；Then 先 best-effort `_end_session_for_delete`（WS SESSION_END + currentRun killed + lea
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-06
最近确认：f7f73d86c

## FR-unmapped-373 list/get 过滤软删
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任一用户调 `list_agent_sessions` / `list_change_sessions`；When 查询；Then 仅返回 `deleted_at IS NULL` 的会话；`get_agent_session` 对软删会话抛 `DaemonSessionNotFound`（
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-07
最近确认：f7f73d86c

## FR-unmapped-374 list_agent_sessions 补 title
变更：2026-07-11-unify-runtime-session-dialog
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `list_agent_sessions` 返回 前端 `AgentSessionRead`；When 构造响应 类型定义；Then 每条含 `title`（首条 `channel=user_input` 的 AgentRunLog 摘要前 30 字，复用 `list_change_sessi
全文：.sillyspec/changes/archive/2026-07-11-unify-runtime-session-dialog/requirements.md#FR-08
最近确认：f7f73d86c

## FR-unmapped-381 项目状态用 StatusBadge 渲染
变更：2026-07-14-2026-07-14-ppm-projects-style-redesign
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given projects 页项目状态字段 option 配置了 `statusKind` 状态 option 无 `statusKind`、仅有 `color`；When 表格渲染状态列 渲染状态列；Then 显示带圆点 pill（进行中=info蓝 / 已完成=success绿 / 已暂停=warning橙） 退化为 antd Tag（向后兼容，不影响 custom
全文：.sillyspec/changes/archive/2026-07-14-2026-07-14-ppm-projects-style-redesign/requirements.md#FR-01
最近确认：54207135f

## FR-unmapped-382 项目类型用 antd Tag 渲染
变更：2026-07-14-2026-07-14-ppm-projects-style-redesign
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 类型字段 `color` 为 `blue` / `cyan` / `default` `color="default"`；When 渲染类型列 渲染；Then 显示对应色块 Tag（研发=blue / 实施=cyan / 运维=default 灰） 显示无 color 的默认灰 `<Tag>`（非 antd 自定义色字
全文：.sillyspec/changes/archive/2026-07-14-2026-07-14-ppm-projects-style-redesign/requirements.md#FR-02
最近确认：54207135f

## FR-unmapped-383 浮层换 antd Drawer/Modal 且点遮罩不关
变更：2026-07-14-2026-07-14-ppm-projects-style-redesign
状态：active
摘要：默认场景
依据决策：D-002@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 用户打开编辑抽屉 / 删除确认 / 成员管理抽屉 projects 页点「成员管理」打开外层 Drawer，内嵌成员表；When 点击遮罩层（mask） 点击右上角 `✕` / 底部「取消」/ 按 ESC 在成员表内点「编辑成员」；Then 弹窗**不**关闭（`maskClosable={false}`） 弹窗关闭 内层 Drawer/Modal 正常打开，z-index 高于外层，ESC 关最上
全文：.sillyspec/changes/archive/2026-07-14-2026-07-14-ppm-projects-style-redesign/requirements.md#FR-03
最近确认：54207135f

## FR-unmapped-384 toast / error 提示语义化
变更：2026-07-14-2026-07-14-ppm-projects-style-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 操作成功 / 失败；When 显示 toast；Then 用语义色（success=emerald / error=red），无硬编码 `emerald-300`/`bg-emerald-50`
全文：.sillyspec/changes/archive/2026-07-14-2026-07-14-ppm-projects-style-redesign/requirements.md#FR-04
最近确认：54207135f

## FR-unmapped-385 搜索区布局保持现状
变更：2026-07-14-2026-07-14-ppm-projects-style-redesign
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 搜索字段数 > 4 搜索字段数 ≤ 4；When 渲染搜索区 渲染搜索区；Then 操作按钮行在字段**上方右对齐**（数据组：导出/新增 在左；基础组：查询/重置/展开 在**最右**；中间分隔线）；字段 4 列网格显示前 4 个 + 「展开
全文：.sillyspec/changes/archive/2026-07-14-2026-07-14-ppm-projects-style-redesign/requirements.md#FR-05
最近确认：54207135f

## FR-unmapped-386 project_name 列加粗
变更：2026-07-14-2026-07-14-ppm-projects-style-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 表格渲染项目名称列；Then `project_name` 文字加粗（font-medium），项目编号独立成列、不加粗
全文：.sillyspec/changes/archive/2026-07-14-2026-07-14-ppm-projects-style-redesign/requirements.md#FR-06
最近确认：54207135f

## FR-unmapped-400 项目→成员两级可展开表
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 用户进入 `/ppm/project-members` 一级项目列表已加载 项目未展开；When 页面加载 用户点击某项目行（展开图标）；Then 显示**一级项目列表**（项目名称/项目编号/负责人/成员数/项目状态/项目类型/更新时间/操作），而非成员平铺 **懒加载**该项目成员（调 `GET /pr
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-01
最近确认：a4c99d382

## FR-unmapped-401 一级表展示负责人（推算）与成员数（聚合）
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — When 聚合接口返回该项目行 推算负责人 渲染负责人列 聚合接口返回；Then 「负责人」= 该类成员中 `created_at` **最早**者的 `user_name` 取 `created_at` 最早的一个（唯一确定） 显示「—」（
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-02
最近确认：a4c99d382

## FR-unmapped-402 6 维搜索
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 搜索区有 6 个筛选项（项目名/项目状态/项目类型/负责人姓名/成员姓名·账号/角色） 填「成员姓名/账号」= "zhang" 填「负责人」= "张" 点「重置；When 用户填写任意组合并点「查询」 查询 查询 重置搜索；Then 一级项目表按条件刷新（调 summary 接口带筛选），结果只命中匹配项目 命中「该项目下存在成员 `user_name` 或 `users.username`
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-03
最近确认：a4c99d382

## FR-unmapped-403 成员子表显示登录账号列
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 后端 `ProjectMemberService.page()` LEFT JOIN `users` 成员子表渲染 某成员 `username` 为空（None；When 返回成员 某成员有 `username` 渲染账号列；Then `ProjectMemberResp` 含可选 `username`（登录账号） 「账号」列显示其登录账号 显示「—」（兜底）
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-04
最近确认：a4c99d382

## FR-unmapped-404 两种新增成员入口
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 用户点页头「+ 添加项目成员」（全局） 用户在某项目展开行的子表点「+ 新增成员」（项目内） 新增成员表单（选用户联动回填部门/姓名、角色多选逗号拼接）；When 打开成员表单抽屉 打开成员表单抽屉 提交；Then 抽屉显示「所属项目」选择（跨项目），提交后成员入所选项目 项目已锁定（不显示「所属项目」选择），提交后成员入当前项目 沿用现有 `PpmProjectMembe
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-05
最近确认：a4c99d382

## FR-unmapped-405 增删成员后成员数实时更新
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-007@v1
场景正文：
- 场景：默认场景 — Given 用户在展开行子表新增/编辑/删除成员成功；When `PpmProjectMembersTable` 的 `onChanged` 回调触发；Then 父级 `PpmProjectMembersGroupTable` 重新拉 summary，该行「成员数」实时刷新
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-06
最近确认：a4c99d382

## FR-unmapped-406 projects 页成员抽屉不回归（兼容）
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-004@v1、D-006@v1
场景正文：
- 场景：默认场景 — When 渲染 `<PpmProjectMembersTable projectId />` projects 抽屉不传这两个 prop；Then 行为与现状一致（CRUD/搜索/分页正常），`ProjectMember.username` 可选字段不破坏现有消费 行为同现状（不回调、非嵌入式渲染）
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-07
最近确认：a4c99d382

## FR-unmapped-407 默认排序（不做成员数排序）
变更：2026-07-15-2026-07-15-project-members-rebuild
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 一级项目表未指定排序 派生列 owner_name/member_count；When 加载 试图排序；Then 默认按 `updated_at` 倒序 不在排序白名单内，被静默忽略（仅支持 updated_at/created_at/project_name/projec
全文：.sillyspec/changes/archive/2026-07-15-2026-07-15-project-members-rebuild/requirements.md#FR-08
最近确认：a4c99d382

## FR-unmapped-416 设备自动分流（middleware rewrite，无 FOUC）
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
依据决策：D-002@v2、D-005@v1
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-01
最近确认：1326f184d

## FR-unmapped-417 移动外壳 + 底部 5 Tab 导航
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-004@v1
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-02
最近确认：1326f184d

## FR-unmapped-418 移动登录页
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-03
最近确认：1326f184d

## FR-unmapped-419 个人工作台移动视图（全功能）
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-008@v1
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-04
最近确认：1326f184d

## FR-unmapped-420 计划任务移动视图（全功能）
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
依据决策：D-007@v1、D-008@v1
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-05
最近确认：1326f184d

## FR-unmapped-421 问题清单移动视图（全功能）
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
依据决策：D-007@v1、D-008@v1
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-06
最近确认：1326f184d

## FR-unmapped-422 工作区选择移动视图（列表全功能 + 详情提示电脑端）
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
依据决策：D-006@v1、D-008@v1
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-07
最近确认：1326f184d

## FR-unmapped-423 数据层 100% 复用 + 桌面完全零回归
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
依据决策：D-003@v1
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-08
最近确认：1326f184d

## FR-unmapped-424 断点 token + 样式文档
变更：2026-07-22-2026-07-22-mobile-app-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-22-2026-07-22-mobile-app-ui/requirements.md#FR-09
最近确认：1326f184d

## FR-unmapped-437 进门自由化（4 入口点）
变更：2026-07-26-2026-07-26-ungate-workspace-entry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户是某工作区成员（或平台管理员） 用户非该工作区成员（且非平台管理员）；When 用户在列表页 / 顶栏 switcher / 移动端点击该工作区 点击该工作区；Then 直接导航/切换进入工作区（不弹 daemon 绑定 Dialog），与有无 binding 无关 不可进（后端 membership 鉴权拒绝，前端不展示或引导
全文：.sillyspec/changes/archive/2026-07-26-2026-07-26-ungate-workspace-entry/requirements.md#FR-01
最近确认：ffb9a7cc1

## FR-unmapped-438 Guard 降级（不再阻断详情页）
变更：2026-07-26-2026-07-26-ungate-workspace-entry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 成员进入工作区详情页 成员已绑定 daemon；When 成员未绑定 daemon（unbound） 进入详情页；Then WorkspaceBindingGuard 不渲染绑定表单（return null），详情页内容（tabs/概览/文档）正常展示，不阻断 guard 显示"编辑
全文：.sillyspec/changes/archive/2026-07-26-2026-07-26-ungate-workspace-entry/requirements.md#FR-02
最近确认：ffb9a7cc1

## FR-unmapped-439 概览 binding 配置（复用既有 WorkspaceConfigCard）
变更：2026-07-26-2026-07-26-ungate-workspace-entry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 成员在工作区概览页 成员已绑定 daemon；When 成员未绑定 daemon 在概览页；Then 概览的 WorkspaceConfigCard 渲染首次绑定引导（含 WorkspaceAccessGuide），作为**可选**配置入口，非阻断，与文档/变更
全文：.sillyspec/changes/archive/2026-07-26-2026-07-26-ungate-workspace-entry/requirements.md#FR-03
最近确认：ffb9a7cc1

## FR-unmapped-440 daemon 依赖功能统一内联空态（DaemonRequiredNotice）
变更：2026-07-26-2026-07-26-ungate-workspace-entry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 成员无自有 daemon（无 binding），访问 daemon 依赖页（运行时 / 扫描文档 / 组件拓扑源码） 成员已绑定/可借；When 页面主数据需 daemon（host_fs / daemon 实体） 访问 daemon 依赖页；Then 主区渲染 `DaemonRequiredNotice`："⚠ {feature} 需要守护进程" + [配置我的 daemon]（展开 WorkspaceAcc
全文：.sillyspec/changes/archive/2026-07-26-2026-07-26-ungate-workspace-entry/requirements.md#FR-04
最近确认：ffb9a7cc1

## FR-unmapped-441 文档类页面 daemon 无关（不动）
变更：2026-07-26-2026-07-26-ungate-workspace-entry
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 成员（任意绑定状态）；When 访问文件中心 / 变更中心 / 成员管理 / 知识库 / 审计 / 审批 / 发布 / 事故；Then 正常浏览（数据在服务器，不经 daemon），无 daemon 要求、无空态
全文：.sillyspec/changes/archive/2026-07-26-2026-07-26-ungate-workspace-entry/requirements.md#FR-05
最近确认：ffb9a7cc1

## FR-unmapped-442 预设供应商模版一键填表单
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户进入「新建供应商」表单 用户点「＋自定义」预设；When 用户点一个预设（如 Kimi For Coding） 进入表单；Then 表单自动填好 name / base_url / auth_field / 默认模型 / 官网（api_key 留空给用户填） 所有字段空白，用户手填（行为同现
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-01
最近确认：13920f895

## FR-unmapped-443 预设分类排序展示
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 预设选择器展示；Then 按分类分组：官方 → 国内官方 → 聚合站，每家带图标；支持用量的标「💰 可查用量」
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-02
最近确认：13920f895

## FR-unmapped-444 用量查询端点
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户有一个支持用量的供应商（如 DeepSeek） 供应商 base_url 识别不到对应 handler；When 前端调 `POST /api/llm-providers/{id}/usage` 查询
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-03
最近确认：13920f895

## FR-unmapped-445 用量查询错误两态
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 上游瞬时失败（网络 / 5xx / 429 / 超时） 上游确定性失败（401 / 403 鉴权失败）；When 查询 查询；Then 后端 raise（HTTP 5xx），前端保留上次成功值 10 分钟 返回 `success:false, is_valid:false`，前端翻红（仍保留上次
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-04
最近确认：13920f895

## FR-unmapped-446 用量多窗口展示
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 供应商返回多 tier（如智谱 5 小时窗 + 周限额）；When 前端展示；Then 每个 tier 一行（plan_name / used / remaining / unit + 重置时间 + 进度条）
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-05
最近确认：13920f895

## FR-unmapped-447 用量触发方式
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户进入供应商列表页 用户点某行「查余额」按钮；When 页面加载完成 触发；Then 对支持用量的供应商自动查一次余额 手动刷新该供应商余额
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-06
最近确认：13920f895

## FR-unmapped-448 不支持用量的友好提示
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 不支持用量的供应商（百炼 / Anthropic 官方 / detect 不到）；When 列表展示；Then 显示「该供应商暂不支持余额查询」（不带 cc-switch 字样），不报错
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-07
最近确认：13920f895

## FR-unmapped-449 安全（SSRF + api_key）
变更：2026-07-28-2026-07-28-llm-provider-presets-and-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用量查询代查外部 URL api_key 处理；When 发请求前 全链路；Then 过 SSRF 防护（复用 `tool_policy.assert_public_hostname`，IPv4+IPv6） 明文不出后端 / 不入响应 / 不入日
全文：.sillyspec/changes/archive/2026-07-28-2026-07-28-llm-provider-presets-and-usage/requirements.md#FR-08
最近确认：13920f895

## FR-unmapped-450 claude 模型调用失败归类为结构化错误
变更：2026-07-29-model-error-visibility
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1、D-005@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given claude code 交互会话中 claude 调模型失败（result.is_error=true 或 api_retry 带 error 或 assist；When daemon 收到 result / 错误事件；Then 归类为 ModelError{type, code, message, retryable, hint, raw}；type ∈ {auth_failed, q
全文：.sillyspec/changes/archive/2026-07-29-model-error-visibility/requirements.md#FR-01
最近确认：aae96b965

## FR-unmapped-451 错误结构化存储与透传
变更：2026-07-29-model-error-visibility
状态：active
摘要：默认场景
依据决策：D-005@v1、D-007@v1、D-009@v1
场景正文：
- 场景：默认场景 — Given daemon 归类出 ModelError；When notifyRunResult 回传后端（payload 带 error）；Then AgentRun.error_detail（JSON）存储完整 ModelError；run status=failed；`GET /sessions/{id}
全文：.sillyspec/changes/archive/2026-07-29-model-error-visibility/requirements.md#FR-02
最近确认：aae96b965

## FR-unmapped-452 错误项展示与操作
变更：2026-07-29-model-error-visibility
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given run failed 且有 error_detail；When 前端渲染会话；Then 消息流插入 RunErrorItem（图标按 type + 「运行失败」+ message + hint）；run/session 标 failed（标红）；带
全文：.sillyspec/changes/archive/2026-07-29-model-error-visibility/requirements.md#FR-03
最近确认：aae96b965

## FR-unmapped-453 成功路径与既有日志不回归
变更：2026-07-29-model-error-visibility
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given run is_error=false（成功）或历史 run 无 error_detail；When 前端渲染；Then 成功路径无 ModelError（error_detail=None，不受影响）；历史 failed run 兜底显示「运行失败（无详情）」；agent-log
全文：.sillyspec/changes/archive/2026-07-29-model-error-visibility/requirements.md#FR-04
最近确认：aae96b965

## FR-unmapped-454 菜单按功能域重组
变更：2026-07-30-sidebar-menu-restructure
状态：active
摘要：默认场景
依据决策：D-001@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 用户已登录 SillyHub 且处于非 ppm 路径；When 查看侧边栏；Then 菜单按 5 组渲染（工作区/智能体/配置中心/协作治理/系统管理），各菜单项归属符合 design §5.1，且守护进程运行时位于配置中心组。
全文：.sillyspec/changes/archive/2026-07-30-sidebar-menu-restructure/requirements.md#FR-01
最近确认：82c01fcfc

## FR-unmapped-455 我的供应商独立菜单直达
变更：2026-07-30-sidebar-menu-restructure
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 用户具有 `llm_provider:read` 权限或为 platform admin 用户无 `llm_provider:read` 且非 platform；When 点击侧边栏"我的供应商" 查看侧边栏；Then 直达 `/settings/providers` 页面，可管理自己的供应商（复用 `LlmProviderSection`）。 不显示"我的供应商"菜单项。
全文：.sillyspec/changes/archive/2026-07-30-sidebar-menu-restructure/requirements.md#FR-02
最近确认：82c01fcfc

## FR-unmapped-456 技能管理 / MCP 管理独立菜单（平台级）
变更：2026-07-30-sidebar-menu-restructure
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 用户具有 `settings:admin` 权限或为 platform admin；When 点击侧边栏"技能管理"或"MCP 管理"；Then 分别直达 `/settings/skills`、`/settings/mcp`（平台级页面）。
全文：.sillyspec/changes/archive/2026-07-30-sidebar-menu-restructure/requirements.md#FR-03
最近确认：82c01fcfc

## FR-unmapped-457 设置页瘦身
变更：2026-07-30-sidebar-menu-restructure
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 用户打开 `/settings`；When 页面渲染；Then 仅显示工作区信息/智能体配置/安全策略/集成 4 个 Tab，默认选中工作区信息；无供应商 Tab、无 4 个 EntryCard 卡片入口。
全文：.sillyspec/changes/archive/2026-07-30-sidebar-menu-restructure/requirements.md#FR-04
最近确认：82c01fcfc

## FR-unmapped-458 供应商可见性可分配
变更：2026-07-30-sidebar-menu-restructure
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 后端 `permissions.py` 已含 `llm_provider:read`；When 重启后端；Then `seed_platform_admin_role` 自动将该权限绑定至 platform_admin 角色（无需 migration），且角色管理中可为任意角
全文：.sillyspec/changes/archive/2026-07-30-sidebar-menu-restructure/requirements.md#FR-05
最近确认：82c01fcfc

## FR-unmapped-459 菜单视觉统一
变更：2026-07-30-sidebar-menu-restructure
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 侧边栏渲染；When 查看任意菜单项；Then 图标均为 lucide 线条图标（含新增 3 项）、无 emoji；分组间距与选中高亮样式统一；ppm 隔离与 `navHidden` 二级页逻辑保持不变。
全文：.sillyspec/changes/archive/2026-07-30-sidebar-menu-restructure/requirements.md#FR-06
最近确认：82c01fcfc

## FR-unmapped-466 backend SSE envelope 透传 segment_id（覆盖 D-001@v1）
变更：2026-08-03-session-stream-partial-revoke
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given backend `run_sync/service.py` 处理一条 session 消息（partial 或 complete）；When 构造 `published_logs`（:595）与 `session_payload`（:164）；Then envelope 含 `segment_id` 字段；**partial 行 = `main:msg_xxx:N`（非空），complete/其他行 = `No
全文：.sillyspec/changes/archive/2026-08-03-session-stream-partial-revoke/requirements.md#FR-01
最近确认：f7f73d86c

## FR-unmapped-467 backend override 信号 publish 到 SSE 且不落库（覆盖 D-001@v1）
变更：2026-08-03-session-stream-partial-revoke
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given backend override 分支（:413 thinking / :445 assistant）收到 `[ASSISTANT_OVERRIDE]/[THI；When 处理该信号；Then (1) 保留 task-14 的 `_revoke_committed_partials` DELETE + `flushed_partials.pop`（落库
全文：.sillyspec/changes/archive/2026-08-03-session-stream-partial-revoke/requirements.md#FR-02
最近确认：f7f73d86c

## FR-unmapped-468 frontend SessionStreamEnvelope 加字段（覆盖 D-002@v1）
变更：2026-08-03-session-stream-partial-revoke
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given `frontend/src/lib/daemon.ts` `SessionStreamEnvelope`（:711）；When 定义类型；Then 含 `segment_id: string | null` 与 `stale: boolean`（默认 false，override 行 true）。
全文：.sillyspec/changes/archive/2026-08-03-session-stream-partial-revoke/requirements.md#FR-03
最近确认：f7f73d86c

## FR-unmapped-469 frontend classifySessionLog 识别 override（覆盖 D-002@v1）
变更：2026-08-03-session-stream-partial-revoke
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given `session-log-sanitize.ts` `classifySessionLog`（:60）收到 content `sanitizeSessionLo；When content 匹配 `^\[(ASSISTANT_OVERRIDE|THINKING_OVERRIDE)\]\s+(\S+)` 处理；Then 返回 `{kind:"override", segmentId:<捕获>, variant:"assistant"|"thinking", text:""}`；
全文：.sillyspec/changes/archive/2026-08-03-session-stream-partial-revoke/requirements.md#FR-04
最近确认：f7f73d86c

## FR-unmapped-470 frontend onLog 按 segmentId 撤回 partial（覆盖 D-002@v1）
变更：2026-08-03-session-stream-partial-revoke
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given onLog 收到 `seg.kind==="reply"` 且 `env.segment_id` 非空（半截） onLog 收到 `seg.kind==="ov；When 处理 处理 turn 收尾 并发 partial + override；Then 记录 `partialSegments[segmentId] = {outputStart: turn.output.length}`，再 concat 文本（
全文：.sillyspec/changes/archive/2026-08-03-session-stream-partial-revoke/requirements.md#FR-05
最近确认：f7f73d86c

## FR-unmapped-471 frontend logsToTurns 历史兼容
变更：2026-08-03-session-stream-partial-revoke
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 历史回看 `logsToTurns`；When 处理 GET `/sessions/{id}/logs` 返回的历史数据；Then 不加撤回逻辑（数据本就干净：partial 已 DELETE、override 不落库）；envelope 新字段在历史 GET 不返回（DTO 不含），`lo
全文：.sillyspec/changes/archive/2026-08-03-session-stream-partial-revoke/requirements.md#FR-06
最近确认：f7f73d86c

## FR-unmapped-472 测试覆盖（覆盖 D-001/D-002/D-003）
变更：2026-08-03-session-stream-partial-revoke
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given backend + frontend 实现；When 跑测试；Then backend：override publish 到 SSE + 不落库（断言 `agent_run_logs` 无 override 行）+ segment_
全文：.sillyspec/changes/archive/2026-08-03-session-stream-partial-revoke/requirements.md#FR-07
最近确认：f7f73d86c

## FR-unmapped-473 侧边栏一级菜单入口
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-007@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-01
最近确认：63710e533

## FR-unmapped-474 全局聚合视图
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-004@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-02
最近确认：63710e533

## FR-unmapped-475 聚合端点可见性越权防护
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-03
最近确认：63710e533

## FR-unmapped-476 卡片墙列表
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-04
最近确认：63710e533

## FR-unmapped-477 搜索与筛选
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-001@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-05
最近确认：63710e533

## FR-unmapped-478 带实时预览的重做表单
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-003@v1、D-006@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-06
最近确认：63710e533

## FR-unmapped-479 人设预览
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-07
最近确认：63710e533

## FR-unmapped-480 系统预置档案只读(保留前置变更行为)
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-08
最近确认：63710e533

## FR-unmapped-481 选档下拉视觉对齐
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-09
最近确认：63710e533

## FR-unmapped-482 工作区内页复用卡片墙
变更：2026-08-04-agent-profile-ui-redesign
状态：active
摘要：（无场景名）
依据决策：D-001@v1
全文：.sillyspec/changes/archive/2026-08-04-agent-profile-ui-redesign/requirements.md#FR-10
最近确认：63710e533

## FR-unmapped-497 左主右辅布局
变更：2026-08-11-change-detail-layout-rework
状态：superseded
superseded_by：FR-app-workspace-pages-002
取代链：FR-unmapped-497 ← FR-app-workspace-pages-002（2026-10-15-change-detail-redesign 承接）
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户打开任一变更详情页（桌面宽屏 ≥1024px） 视口宽度 <1024px；When 页面渲染完成 页面渲染；Then 主体为两栏：左侧主线区（当前阶段操作 + 智能体执行日志），右侧 320px 次线侧栏（变更文件/会话调试/审核历史/任务看板） 退化为单列：主线在上，次线卡片
全文：.sillyspec/changes/archive/2026-08-11-change-detail-layout-rework/requirements.md#FR-01
最近确认：fe8a71ed4

## FR-unmapped-498 会话与执行日志分离
变更：2026-08-11-change-detail-layout-rework
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 详情页已加载；When 用户查看主线区；Then 只见「智能体执行日志」（流程自动 run），不见「会话」；「会话调试」出现在次线侧栏
全文：.sillyspec/changes/archive/2026-08-11-change-detail-layout-rework/requirements.md#FR-02
最近确认：12ea22a84

## FR-unmapped-499 审核历史读真实数据
变更：2026-08-11-change-detail-layout-rework
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 某变更存在审核记录（`change.stages.review_history` 非空） `review_history` 数组同时含 gate 形状（`{de；When 用户展开次线「审核历史」卡 渲染审核历史
全文：.sillyspec/changes/archive/2026-08-11-change-detail-layout-rework/requirements.md#FR-03
最近确认：12ea22a84

## FR-unmapped-500 删除旧区块
变更：2026-08-11-change-detail-layout-rework
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 详情页已加载；When 渲染完成；Then 不再出现「审批状态」区块；「审查记录」旧实现（读 listReviews 死表）被「审核历史」取代
全文：.sillyspec/changes/archive/2026-08-11-change-detail-layout-rework/requirements.md#FR-04
最近确认：12ea22a84

## FR-unmapped-501 智能体入口收敛
变更：2026-08-11-change-detail-layout-rework
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 详情页已加载且当前阶段有待办操作 主线「智能体执行日志」内含子步骤进度（SillySpecStepProgress）；When 用户查看主线「当前阶段操作区」 渲染；Then 推进/审核/触发智能体/运行验证门禁/Agent 供应商·模型/团队开关集中在该区内，页面其它位置无重复入口 其内嵌「触发智能体/执行下一步」按钮不渲染（组合时
全文：.sillyspec/changes/archive/2026-08-11-change-detail-layout-rework/requirements.md#FR-05
最近确认：12ea22a84

## FR-unmapped-502 组件化与死代码清除
变更：2026-08-11-change-detail-layout-rework
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 本变更完成；When 查看代码结构；Then page.tsx 瘦身为编排层；7 个区块组件位于 `components/changes/detail/` 并各有测试；`handleExecute`/`ha
全文：.sillyspec/changes/archive/2026-08-11-change-detail-layout-rework/requirements.md#FR-06
最近确认：12ea22a84

## FR-unmapped-511 McpToken 列表展示
变更：2026-08-11-mcp-token-management-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-11-mcp-token-management-ui/requirements.md#FR-01
最近确认：23ffff4b7

## FR-unmapped-512 签发 McpToken
变更：2026-08-11-mcp-token-management-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-11-mcp-token-management-ui/requirements.md#FR-02
最近确认：23ffff4b7

## FR-unmapped-513 吊销 McpToken
变更：2026-08-11-mcp-token-management-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-11-mcp-token-management-ui/requirements.md#FR-03
最近确认：23ffff4b7

## FR-unmapped-514 workspace 子导航入口
变更：2026-08-11-mcp-token-management-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-11-mcp-token-management-ui/requirements.md#FR-04
最近确认：23ffff4b7

## FR-unmapped-515 viewer 无权限兜底
变更：2026-08-11-mcp-token-management-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-11-mcp-token-management-ui/requirements.md#FR-05
最近确认：23ffff4b7

## FR-unmapped-516 统计卡片
变更：2026-08-11-mcp-token-management-ui
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-11-mcp-token-management-ui/requirements.md#FR-06
最近确认：23ffff4b7

## FR-unmapped-551 新建会话四选择器联动
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-005@v1、D-010@v1、D-013@v1
场景正文：
- 场景：默认场景 — Given 用户在 /sessions 点「新建会话」；When 提交；Then 表单依次为：守护进程（必选，仅在线机器可选、离线置灰；默认=上次选择(localStorage)→最近会话的在线机器→最新心跳）、智能体（必选，所选机器在线 r
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-01
最近确认：6453d9ca0

## FR-unmapped-552 会话列表（所有会话）
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-003@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 用户进入 /sessions；When 点击会话；Then 左侧列出跨机器/智能体的全部会话（含已结束/失败），紧凑两行条目（状态点+标题+相对时间 / 机器+引擎+档案+供应商+轮数 chips，chips 读会话快照
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-02
最近确认：6453d9ca0

## FR-unmapped-553 未选供应商/档案零回归
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 用户不选供应商和档案（或经 /runtimes 弹窗开会在话）；When 会话执行；Then 行为与现状一致：全局默认供应商配置注入、无人格、模型走既有覆盖链
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-03
最近确认：6453d9ca0

## FR-unmapped-554 会话级配置生效
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-011@v1、D-013@v1
场景正文：
- 场景：默认场景 — Given 用户选了档案和/或供应商；When 会话执行；Then 档案只注入人格提示词（system_prompt，Claude）+ mcp/skill 透传，不派生引擎/模型/供应商；供应商优先级=会话选择 > 全局默认（不
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-04
最近确认：6453d9ca0

## FR-unmapped-555 会话内配置热切换（样式 B）
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-004@v2、D-007@v1、D-012@v1
场景正文：
- 场景：默认场景 — Given 会话 active 且当前轮完成（idle） 当前轮运行中；When 用户点输入框下方配置控件条中「供应商/档案」并选择新值、发送消息；Then inject 携带新配置+prompt；后端建新 AgentRun（新快照）并下发 SESSION_SWITCH_CONFIG；daemon 在轮次边界 rel
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-05
最近确认：6453d9ca0

## FR-unmapped-556 切换合法性校验
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-004@v2、D-013@v1
场景正文：
- 场景：默认场景 — Given 用户绕过前端以不匹配供应商（agent_kind 与引擎不符、非本人供应商）发起切换；When 后端 inject_session 校验；Then 返回 4xx 中文错误；会话状态不变（档案无引擎属性，无需引擎校验，D-013）
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-06
最近确认：6453d9ca0

## FR-unmapped-557 每轮配置快照（历史不跟随）
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given 会话发生过配置切换；When 渲染消息流；Then 每条回复 who 行显示该轮生效配置（`档案 · 智能体 · 供应商`，未选如实显示「未指定/本机默认」），切换后旧消息保持原配置不变
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-07
最近确认：6453d9ca0

## FR-unmapped-558 上下文用量 + 供应商额度
变更：2026-08-19-sessions-portal
状态：active
摘要：默认场景
依据决策：D-009@v1、D-014@v1
场景正文：
- 场景：默认场景 — Given 会话面板；When 切换供应商；Then 输入框上方一行显示上下文用量环形进度（累计 usage/模型窗口，分母=供应商配置派生（1M 勾选→1000k）→模型默认常量表（200k）→无则只显示累计 t
全文：.sillyspec/changes/archive/2026-08-19-sessions-portal/requirements.md#FR-08
最近确认：6453d9ca0

## FR-unmapped-559 新建会话表单新增工作区选择器
变更：2026-08-19-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-19-sessions-workspace-selector/requirements.md#FR-01
最近确认：b0f2a115c

## FR-unmapped-560 选工作区后自动联动机器选择器
变更：2026-08-19-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-19-sessions-workspace-selector/requirements.md#FR-02
最近确认：b0f2a115c

## FR-unmapped-561 选工作区后表单显示上下文提示
变更：2026-08-19-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-19-sessions-workspace-selector/requirements.md#FR-03
最近确认：b0f2a115c

## FR-unmapped-562 提交体携带 workspace_id
变更：2026-08-19-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-19-sessions-workspace-selector/requirements.md#FR-04
最近确认：b0f2a115c

## FR-unmapped-563 后端 workspace 归属校验
变更：2026-08-19-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-19-sessions-workspace-selector/requirements.md#FR-05
最近确认：b0f2a115c

## FR-unmapped-564 NewSessionFormValues 增加 workspaceId 字段
变更：2026-08-19-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-19-sessions-workspace-selector/requirements.md#FR-06
最近确认：b0f2a115c

## FR-unmapped-565 主题注册表与 brand 语义色阶
变更：2026-08-20-frontend-ai-native-style
状态：active
摘要：默认场景
依据决策：D-101@v1、D-003@v2
场景正文：
- 场景：默认场景 — Given `themes.ts` 定义 `blue`/`ai-native` 两套完整 ThemeDef（radius/shadow/font/spacing 共享）；When 前端构建；Then `:root` 注入 ai-native 变量值 + brand 阶紫阶值，`[data-theme="blue"]` 覆盖为旧蓝值 + brand 阶蓝阶值；
全文：.sillyspec/changes/archive/2026-08-20-frontend-ai-native-style/requirements.md#FR-01
最近确认：f7f73d86c

## FR-unmapped-566 主题切换与持久化
变更：2026-08-20-frontend-ai-native-style
状态：active
摘要：默认场景
依据决策：D-101@v1、D-102@v1
场景正文：
- 场景：默认场景 — Given 用户在任一页面；When 点击顶栏主题切换按钮 刷新页面 / 新开标签 localStorage 无值或值非法；Then `<html data-theme>` 与 antd token 同步切换，全站即时生效；`localStorage["sillyhub-theme"]` 写入
全文：.sillyspec/changes/archive/2026-08-20-frontend-ai-native-style/requirements.md#FR-02
最近确认：f7f73d86c

## FR-unmapped-567 antd 主题动态跟随
变更：2026-08-20-frontend-ai-native-style
状态：active
摘要：默认场景
依据决策：D-101@v1
场景正文：
- 场景：默认场景 — Given antd ConfigProvider token/components 改从 `useThemeStore` 当前主题取；When 切换主题；Then antd 组件（按钮/菜单选中/表格头/Tabs/Tag/Badge 等）跟随变色，无散落 hex
全文：.sillyspec/changes/archive/2026-08-20-frontend-ai-native-style/requirements.md#FR-03
最近确认：f7f73d86c

## FR-unmapped-568 蓝色清扫
变更：2026-08-20-frontend-ai-native-style
状态：active
摘要：默认场景
依据决策：D-003@v2
场景正文：
- 场景：默认场景 — Given 198 处 `bg/text/border-blue-*`（56 文件）与 17 处 hex 及登录页渐变、kanban PALETTE、globals.css；When 执行清扫；Then 品牌用途（含全部浅档）改 `brand-*` 类或主题引用；真信息蓝保留 blue 阶（逐一判断）；grep 复核模式 `bg-blue|text-blue|b
全文：.sillyspec/changes/archive/2026-08-20-frontend-ai-native-style/requirements.md#FR-04
最近确认：f7f73d86c

## FR-unmapped-569 会话页 AI 原生细节
变更：2026-08-20-frontend-ai-native-style
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given /sessions 聊天流（turn-timeline 等）；When SSE 流式输出进行中；Then 末尾显示闪烁光标；等待首个响应块时显示 typing 三点指示；上下文引用以 chip 样式展示（数据源=turn 快照 whoLine，无自然接入位则仅交付样
全文：.sillyspec/changes/archive/2026-08-20-frontend-ai-native-style/requirements.md#FR-05
最近确认：f7f73d86c

## FR-unmapped-570 blue 主题原样平移
变更：2026-08-20-frontend-ai-native-style
状态：active
摘要：默认场景
依据决策：D-102@v1、D-003@v2
场景正文：
- 场景：默认场景 — Given 用户切回 blue 主题；When 逐页核对核心页（工作区/会话/PPM 表格/登录/kanban）；Then 主色/选中态/表格头/卡片边框/按钮/徽章色与重构前同页一致（语义色位逐项核对，不要求像素 diff）
全文：.sillyspec/changes/archive/2026-08-20-frontend-ai-native-style/requirements.md#FR-06
最近确认：f7f73d86c

## FR-unmapped-571 新建会话表单新增工作区选择器
变更：2026-08-20-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-20-sessions-workspace-selector/requirements.md#FR-01
最近确认：dc34d63a9

## FR-unmapped-572 选工作区后自动联动机器选择器
变更：2026-08-20-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-20-sessions-workspace-selector/requirements.md#FR-02
最近确认：dc34d63a9

## FR-unmapped-573 选工作区后表单显示上下文提示
变更：2026-08-20-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-20-sessions-workspace-selector/requirements.md#FR-03
最近确认：dc34d63a9

## FR-unmapped-574 提交体携带 workspace_id
变更：2026-08-20-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-20-sessions-workspace-selector/requirements.md#FR-04
最近确认：dc34d63a9

## FR-unmapped-575 后端 workspace 归属校验
变更：2026-08-20-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-20-sessions-workspace-selector/requirements.md#FR-05
最近确认：dc34d63a9

## FR-unmapped-576 NewSessionFormValues 增加 workspaceId 字段
变更：2026-08-20-sessions-workspace-selector
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-20-sessions-workspace-selector/requirements.md#FR-06
最近确认：dc34d63a9

## FR-unmapped-577 入口唯一化
变更：2026-08-20-workspace-nav-consolidate
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 概览页；Then 无快速入口宫格（QuickEntryGrid 退役删除，全仓引用清零）
全文：.sillyspec/changes/archive/2026-08-20-workspace-nav-consolidate/requirements.md#FR-01
最近确认：4c9827c38

## FR-unmapped-578 菜单全量与滑动
变更：2026-08-20-workspace-nav-consolidate
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任一非 standalone 子页；Then 顶部菜单 13 项（概览/组件/变更/会话/文件/扫描文档/运行时/智能体档案/Skills/MCP/MCP 令牌/成员/方案文件），href 与原宫格/现菜单
全文：.sillyspec/changes/archive/2026-08-20-workspace-nav-consolidate/requirements.md#FR-02
最近确认：4c9827c38

## FR-unmapped-579 子页菜单补全
变更：2026-08-20-workspace-nav-consolidate
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given components / changes / changes-[cid] 等页；Then 渲染于 workspace layout 内含顶部菜单；topology 整屏页保留 standalone（无菜单，h-screen 零回归）
全文：.sillyspec/changes/archive/2026-08-20-workspace-nav-consolidate/requirements.md#FR-03
最近确认：4c9827c38

## FR-unmapped-580 头部横幅
变更：2026-08-20-workspace-overview-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工作区详情页已加载；Then 顶部渲染渐变横幅（from-brand-700 via-brand-800 to-slate-950，blue 主题自动回旧蓝渐变），含工作区名（大字白）、状态
全文：.sillyspec/changes/archive/2026-08-20-workspace-overview-redesign/requirements.md#FR-01
最近确认：040fbc235

## FR-unmapped-581 统计卡行
变更：2026-08-20-workspace-overview-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工作区详情页已加载；Then 统计四卡（项目组组件/进行中变更/已归档变更/运行时阶段）以图标+数值+标签形态渲染，图标软底 bg-brand-50 text-brand-600
全文：.sillyspec/changes/archive/2026-08-20-workspace-overview-redesign/requirements.md#FR-02
最近确认：040fbc235

## FR-unmapped-582 快速入口宫格
变更：2026-08-20-workspace-overview-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工作区详情页已加载；Then 6 个入口（项目组件/变更中心/扫描文档/运行时/智能体档案/方案文件）以图标卡片宫格渲染（grid 3 列），lucide 图标+中文标签，href 与现状一
全文：.sillyspec/changes/archive/2026-08-20-workspace-overview-redesign/requirements.md#FR-03
最近确认：040fbc235

## FR-unmapped-583 分组信息区
变更：2026-08-20-workspace-overview-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工作区详情页已加载；Then antd Collapse ghost 两组：「基本信息」默认展开（路径字段/类型/角色/用途/时间戳/编辑态/绑定守护进程区 WorkspaceDaemonS
全文：.sillyspec/changes/archive/2026-08-20-workspace-overview-redesign/requirements.md#FR-04
最近确认：040fbc235

## FR-unmapped-584 行为等价与测试
变更：2026-08-20-workspace-overview-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 重构完成；Then 所有数据 hook/编辑保存/绑定交互行为与重构前等价（九块映射表 10 行对账）
全文：.sillyspec/changes/archive/2026-08-20-workspace-overview-redesign/requirements.md#FR-05
最近确认：040fbc235

## FR-unmapped-585 统一错误条
变更：2026-08-20-workspace-subpages-style-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任一子页面加载失败；Then 渲染公共 ErrorBanner（destructive 主题色+可选重试按钮），8 处（含 explorer:124-131 与 shared-daemon-
全文：.sillyspec/changes/archive/2026-08-20-workspace-subpages-style-unify/requirements.md#FR-01
最近确认：5959b30d9

## FR-unmapped-586 返回链接规范化
变更：2026-08-20-workspace-subpages-style-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given components/skills/mcp/mcp-tokens 页头；Then 无 title 内 hack；PageHeader actions 统一"← 工作区"链接，目标一致 /workspaces/${id}
全文：.sillyspec/changes/archive/2026-08-20-workspace-subpages-style-unify/requirements.md#FR-02
最近确认：5959b30d9

## FR-unmapped-587 空态与列表卡质感
变更：2026-08-20-workspace-subpages-style-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given skills/mcp/members/components 无数据；Then 渲染现成 EmptyState；skills/mcp 列表卡 SectionCard hover="lift"
全文：.sillyspec/changes/archive/2026-08-20-workspace-subpages-style-unify/requirements.md#FR-03
最近确认：5959b30d9

## FR-unmapped-588 语义色主题化
变更：2026-08-20-workspace-subpages-style-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given changes/explorer/mcp/mcp-tokens 的 tone 卡与提示文字；Then amber/emerald/red/blue 硬编码（5 处）改 warning/success/error/info 语义色+透明度修饰，双主题跟随
全文：.sillyspec/changes/archive/2026-08-20-workspace-subpages-style-unify/requirements.md#FR-04
最近确认：5959b30d9

## FR-unmapped-589 表格/按钮/文案规格统一
变更：2026-08-20-workspace-subpages-style-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given members 与 mcp-tokens 手写表、3 页 h-7 小按钮、members 英文文案；Then 两表表头规格逐字段一致（px-4 py-3 bg-muted/40/行 hover）；小按钮换 shadcn Button size=sm（components
全文：.sillyspec/changes/archive/2026-08-20-workspace-subpages-style-unify/requirements.md#FR-05
最近确认：5959b30d9

## FR-unmapped-590 容器与锚修正
变更：2026-08-20-workspace-subpages-style-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given sessions 右侧面板与 explorer 布局；Then session-section 自写容器换 SectionCard；explorer 高度锚 56px→64px、antd Button（2 处）换 shadc
全文：.sillyspec/changes/archive/2026-08-20-workspace-subpages-style-unify/requirements.md#FR-06
最近确认：5959b30d9

## FR-unmapped-591 可拖拽手柄
变更：2026-08-21-table-column-resize
状态：active
摘要：默认场景
依据决策：D-502@v2
场景正文：
- 场景：默认场景 — Given DataTable 渲染的表格；Then `typeof width === "number"` 的列表头右缘渲染拖拽手柄（col 光标/hover 主题高亮）；无 width 或 string wid
全文：.sillyspec/changes/archive/2026-08-21-table-column-resize/requirements.md#FR-01
最近确认：16c8fa5dc

## FR-unmapped-592 拖拽不误触排序
变更：2026-08-21-table-column-resize
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 排序列的表头手柄；When 按住手柄拖拽；Then 不触发 onChange(sorter)；3px 内微动视为点击不误判拖拽
全文：.sillyspec/changes/archive/2026-08-21-table-column-resize/requirements.md#FR-02
最近确认：16c8fa5dc

## FR-unmapped-593 PPM 资源表覆盖
变更：2026-08-21-table-column-resize
状态：active
摘要：默认场景
依据决策：D-502@v2
场景正文：
- 场景：默认场景 — Given PpmResourceTable（projects/customers/project-stakeholders）；Then 业务列经默认宽兜底（类型映射 110-200px）全部可拖
全文：.sillyspec/changes/archive/2026-08-21-table-column-resize/requirements.md#FR-03
最近确认：16c8fa5dc

## FR-unmapped-594 受控回调接口
变更：2026-08-21-table-column-resize
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 页面传 onColumnsResize；Then 拖拽结束回调 { [dataIndex]: width }；不传=纯本地拖拽
全文：.sillyspec/changes/archive/2026-08-21-table-column-resize/requirements.md#FR-04
最近确认：16c8fa5dc

## FR-unmapped-595 适配层删除与消费方直迁
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given `interactive-session-panel.tsx`（127 行适配层）存在且被 4 个渲染消费方引用；When 执行本变更；Then 该文件整文件删除；4 消费方（runtime-session-dialog.tsx...:338 /
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-01
最近确认：4d7adc1d9

## FR-unmapped-596 类型 import 归位
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 4 消费方从适配层 import 5 个类型（SessionProcessItem / SessionToolEvent /；When 适配层删除；Then import 路径改指 `@/components/daemon/turn-timeline`（5 类型已全部导出于
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-02
最近确认：4d7adc1d9

## FR-unmapped-597 dialog 分支 chrome 基元 antd 化
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given session-panel.tsx dialog 分支含 5 处 shadcn 基元（UiButton :2334/2352/2398/2409、；When 统一 antd；Then UiButton×4 → antd Button（新建/团队分析默认 32px；打断 size="small" 24px；
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-03
最近确认：4d7adc1d9

## FR-unmapped-598 TurnStatusBadge antd 化
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given frontend/src/components/daemon/turn-timeline.tsx:930-983 TurnStatusBadge 为纯样式 span 胶囊（两模式共用）；When 统一 antd；Then 内部渲染改 antd Badge status：running/interrupting→processing、
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-04
最近确认：4d7adc1d9

## FR-unmapped-599 SessionInputBar 基元 antd 化
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given session-input-bar.tsx 含 2 处 shadcn Button（发送 :196、📎 ghost :169）；When 统一 antd；Then 发送 → antd Button type="primary"；📎 → antd Button type="text"；
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-05
最近确认：4d7adc1d9

## FR-unmapped-600 测试迁移与守护
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 3 套 ISP 测试（interactive-session-panel{,-offline,-changeid}.test.tsx，；When 适配层删除；Then 迁移为 `session-panel-dialog{,-offline,-changeid}.test.tsx` 直测
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-06
最近确认：4d7adc1d9

## FR-unmapped-601 主题铁律合规
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given FRONTEND_PAGE_STYLE §0.5 双主题系统（blue/ai-native）；When 本次 antd 化；Then 新增代码零硬编码 hex；antd 组件色不写 style 覆盖（差异走 ConfigProvider
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-07
最近确认：4d7adc1d9

## FR-unmapped-602 团队变更顺序协调
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given team-unify task-11 allowed_paths 与本变更正面重叠；When 本变更执行；Then 硬前置门：本变更先于 task-11 执行并合入 main；执行期若发现 task-11 已
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-08
最近确认：4d7adc1d9

## FR-unmapped-603 注释锚点校正
变更：2026-08-22-session-panel-unify
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 3 个文件注释含适配层历史锚点（frontend/src/components/ask-user-dialog-card.tsx:15、；When 适配层删除；Then 注释中指向已删文件的行号锚点按 CLAUDE.md 规则 18 校正（仅注释零逻辑改动）。
全文：.sillyspec/changes/archive/2026-08-22-session-panel-unify/requirements.md#FR-09
最近确认：4d7adc1d9

## FR-unmapped-604 共享门户组件
变更：2026-08-22-workspace-sessions-portal
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given /sessions 页现有外壳（列表+两态+page 面板+页级数据）；When 提取为 SessionsPortal；Then 组件接受可选 scope（WorkspaceScope{kind,workspaceId} | ChangeScope{kind,workspaceId,cha
全文：.sillyspec/changes/archive/2026-08-22-workspace-sessions-portal/requirements.md#FR-01
最近确认：3f7192561

## FR-unmapped-605 工作区入口
变更：2026-08-22-workspace-sessions-portal
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given /workspaces/[id]/sessions 页；When 本变更后；Then 整页渲染 `<SessionsPortal scope={kind:workspace, workspaceId}>`——列表仅该工作区、创建锁定绑定 work
全文：.sillyspec/changes/archive/2026-08-22-workspace-sessions-portal/requirements.md#FR-02
最近确认：3f7192561

## FR-unmapped-606 变更级入口
变更：2026-08-22-workspace-sessions-portal
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 变更详情侧边窄卡与无专属会话页；When 本变更后；Then 侧卡变入口（listChangeSessions 仅本人过滤取前 3 条预览 + 打开工作台按钮）；新路由 /workspaces/[id]/changes/[
全文：.sillyspec/changes/archive/2026-08-22-workspace-sessions-portal/requirements.md#FR-03
最近确认：3f7192561

## FR-unmapped-607 列表 scope 化
变更：2026-08-22-workspace-sessions-portal
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given SessionListPanel 现仅支持全局真分页；When 加可选 scope；Then workspace/change 模式切 listWorkspaceAgentSessions(include_ended)/listChangeSession
全文：.sillyspec/changes/archive/2026-08-22-workspace-sessions-portal/requirements.md#FR-04
最近确认：3f7192561

## FR-unmapped-608 深链恢复
变更：2026-08-22-workspace-sessions-portal
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 旧工作区页有 ?session= 初始选中；When 门户化后；Then SessionsPortal 统一支持 ?session=<id> 挂载时解析初始选中（无效/无参静默忽略），三入口通用；变更入口卡直达经此链路。
全文：.sillyspec/changes/archive/2026-08-22-workspace-sessions-portal/requirements.md#FR-05
最近确认：3f7192561

## FR-unmapped-609 退役清理
变更：2026-08-22-workspace-sessions-portal
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given workspace-session-section 与 change-session-section 两组件及其测试；When 消费面重组完成后；Then 两组件与两测试文件删除，全仓无 dangling import；语义迁移四项（仅本人过滤/创建绑定/ended 恢复/深链）均有新测试落点；ended 会话恢复
全文：.sillyspec/changes/archive/2026-08-22-workspace-sessions-portal/requirements.md#FR-06
最近确认：3f7192561

## FR-unmapped-610 回归与实证
变更：2026-08-22-workspace-sessions-portal
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 全部改动；When 收尾；Then 全量 vitest/tsc/lint 零失败；受影响测试（sessions 页 18 用例、list-panel、new-session-form、change
全文：.sillyspec/changes/archive/2026-08-22-workspace-sessions-portal/requirements.md#FR-07
最近确认：3f7192561

## FR-unmapped-623 工作区入口解除门禁
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已登录用户在 `/m/workspaces` 列表页看到工作区卡片；When 点击卡片；Then 导航到 `/m/workspaces/[id]`（经主页 redirect 落到变更列表），不再提示"请在电脑端打开"
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-01
最近确认：976a21965

## FR-unmapped-624 工作区主页与双 Tab 导航
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户位于 `/m/workspaces/[id]/changes` 或 `/m/workspaces/[id]/sessions`；When 顶栏段控切换「变更中心 / 会话」；Then 路由跳转到对应列表页（真实路由，非 query）；顶栏显示返回箭头（→ /m/workspaces）与工作区名
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-02
最近确认：976a21965

## FR-unmapped-625 变更列表（三 Tab + 搜索 + 筛选）
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户位于 `/m/workspaces/[id]/changes`；When 切换 进行中/已归档/快速修复 Tab 输入关键词或打开筛选抽屉（阶段/只看待我处理）后应用 点击变更卡片；Then 列表与计数徽标（["changesTabTotals"]）刷新；进行中列表按 changesRefetchInterval 语义智能轮询 列表按条件过滤（que
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-03
最近确认：976a21965

## FR-unmapped-626 变更详情与审批操作
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户位于变更详情页；When 点击 通过/驳回 点击文档 点击关联会话卡；Then 可见：阶段步骤条、审批操作卡（有待办时默认展开）、规范文档列表、阶段时间线、执行日志（折叠）、关联会话卡、任务区桌面引导条 调 submitStageRevie
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-04
最近确认：976a21965

## FR-unmapped-627 快速修复（quicklog）Tab
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在变更列表切到「快速修复」Tab；When 点击条目；Then 展示 quicklog 卡片列表（listQuicklogEntries + quicklogPollInterval 轮询语义） MobileDetailSh
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-05
最近确认：976a21965

## FR-unmapped-628 会话列表
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户位于 `/m/workspaces/[id]/sessions`；When 点击会话卡片 通过卡片菜单执行 删除/归档/取消归档；Then 展示按机器分组的会话卡片（在线/离线分组、状态 Tab 全部/进行中/已归档）；数据用 listAgentSessions + workspace_id，que
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-06
最近确认：976a21965

## FR-unmapped-629 会话对话（SessionPanel 第四宿主，完整内核）
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户位于 `/m/workspaces/[id]/sessions/[sid]`；When 会话被切换（路由 sid 变化）；Then 直接渲染 SessionPanel(mode="page", key=sid)，具备桌面同等全部能力：SSE 流式对话、发消息、中断、结束/重开、消息队列、子代
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-07
最近确认：976a21965

## FR-unmapped-630 新建会话（两步浮层移动化）
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在会话列表点 ＋；When 依次选择机器、智能体（PreSessionPicker variant="bottomSheet" 底部抽屉两步）；Then 进入预会话态（SessionPanel sessionId=null + preContext），首句发送 createSession 成功后切真会话路由
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-08
最近确认：976a21965

## FR-unmapped-631 布局层级（列表 vs 钻取）
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户位于列表页（changes / sessions）；Then 保留底部 5 Tab（平台切换高亮）；位于钻取页（changes/[cid]、sessions/[sid]） 隐藏底部 Tab，页面自渲染返回顶栏（m/layo
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-09
最近确认：976a21965

## FR-unmapped-632 深链兜底
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 手机 UA 访问桌面专属门户 URL `/workspaces/[id]/changes/[cid]/sessions` 或 `/workspaces/[id]；Then redirect 到 `/m/workspaces/[id]/sessions`（不落 404）
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-10
最近确认：976a21965

## FR-unmapped-633 桌面零回归
变更：2026-08-26-mobile-workspace-page
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 桌面 UA 或未传 variant 的既有调用点；Then SessionPanel/PreSessionPicker 行为与改动前完全一致；`(dashboard)/**` 全部既有测试保持绿色；m/ 既有页面（log
全文：.sillyspec/changes/archive/2026-08-26-mobile-workspace-page/requirements.md#FR-11
最近确认：976a21965

## FR-unmapped-656 Playwright 基础设施
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-001@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given frontend 目录存在 @playwright/test devDep；When 新增 `frontend/playwright.config.ts`（chromium 单浏览器 / workers:1 / timeout 60s / ret；Then `pnpm test:e2e` 可发现并执行 `frontend/e2e/*.spec.ts`，不配置 webServer（本机手动前置）
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-01
最近确认：0ea257289

## FR-unmapped-657 测试身份与数据准备
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-002@v2
场景正文：
- 场景：默认场景 — Given bootstrap 平台管理员凭据（E2E_BOOTSTRAP_EMAIL/PASSWORD，本机 backend/.env 或 CI env）；When 每次测试运行；Then admin 先 `POST /api/admin/roles` 幂等创建角色（key=`e2e_smoke_<runid>` 下划线、permission_ke
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-02
最近确认：0ea257289

## FR-unmapped-658 API 登录与会话注入
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given FR-02 创建的冒烟用户；When TestApiClient 调 `POST /api/auth/login`（首登无 captcha）+ `GET /api/auth/me`；Then `page.addInitScript` 注入 `localStorage["multi-agent-platform.session"]`，格式 `{stat
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-03
最近确认：0ea257289

## FR-unmapped-659 真实 UI 登录链路用例（auth.spec）
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given dev 环境前后端在跑；When 执行 4 用例：A1 未登录访问 /workspaces 重定向 /login；A2 表单登录成功跳 /workspaces 且 PageHeader/侧边栏可；Then 全部断言通过；等待策略一律关键元素/文本，禁用 networkidle（SSE 长连接）
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-04
最近确认：0ea257289

## FR-unmapped-660 导航冒烟用例（navigation.spec）
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-002@v2
场景正文：
- 场景：默认场景 — Given FR-03 注入登录的冒烟用户（挂 workspace:read）；When 执行 4 用例：N1 /workspaces 列表页渲染（PageHeader「选择工作区」/列表容器）；N2 侧边栏→智能体会话 /sessions；N3 侧；Then 全部断言通过
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-05
最近确认：0ea257289

## FR-unmapped-661 本机运行文档与凭据卫生
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given 开发者首次使用 e2e 体系；When 阅读 `frontend/e2e/README.md`；Then 可按文档完成前置（dev compose 起 pg/redis、backend/.env 含 bootstrap admin + `AUTH_LOGIN_RAT
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-06
最近确认：0ea257289

## FR-unmapped-662 CI e2e job
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-004@v1、D-007@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given push/PR 触发 paths frontend/**（或手动 workflow_dispatch）；When e2e-ci.yml 执行：services postgres:16 + redis:7 → uv sync → uvicorn（env 含 AUTH_LOGI；Then job 在 20min 超时内全绿；失败时 playwright-report/ 与 test-results/ 上传为 artifact
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-07
最近确认：0ea257289

## FR-unmapped-663 双测试栈隔离与类型覆盖
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-009@v1
场景正文：
- 场景：默认场景 — Given vitest.config.ts 无 include 配置（默认必扫 e2e/*.spec.ts）；Then `pnpm test` 不收集 e2e 用例（157 个现有测试不受影响）；`pnpm typecheck` 覆盖 e2e 代码
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-08
最近确认：0ea257289

## FR-unmapped-664 依赖清理
变更：2026-08-29-frontend-e2e-playwright
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given frontend devDependencies 含零引用的 puppeteer；When 移除 puppeteer 并更新 pnpm-lock.yaml（与 package.json 同 commit）；Then 依赖树无 puppeteer，`pnpm install --frozen-lockfile` 一致，@playwright/test 保留
全文：.sillyspec/changes/archive/2026-08-29-frontend-e2e-playwright/requirements.md#FR-09
最近确认：0ea257289

## FR-auto-frontend-101 工作区详情页不再渲染 Agent 状态总览卡片
变更：2026-09-28-remove-liveness-overview-card
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 工作区详情页不再渲染 Agent 状态总览卡片；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-remove-liveness-overview-card/requirements.md#FR-01
最近确认：2f29e2693a12839bf3f71fb8684b5db57fc628b3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-remove-liveness-overview-card:flow:FR-01
  tests: frontend/src/app/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-remove-liveness-overview-card
  status: active

## FR-auto-frontend-102 agent-liveness-overview-card.tsx 组件文件删除且无残留 import
变更：2026-09-28-remove-liveness-overview-card
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 相关模块就绪；When agent-liveness-overview-card.tsx 组件文件删除且无残留 import；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-remove-liveness-overview-card/requirements.md#FR-02
最近确认：2f29e2693a12839bf3f71fb8684b5db57fc628b3

## FR-auto-frontend-103 page.test.tsx 清理对应 mock 后工作区详情页测试通过
变更：2026-09-28-remove-liveness-overview-card
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When page.test.tsx 清理对应 mock 后工作区详情页测试通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-remove-liveness-overview-card/requirements.md#FR-03
最近确认：2f29e2693a12839bf3f71fb8684b5db57fc628b3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-remove-liveness-overview-card:flow:FR-03
  tests: frontend/src/app/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-remove-liveness-overview-card
  status: active

## FR-auto-frontend-104 会话列表活性链路（use-session-liveness / liveness-badge）不受影
变更：2026-09-28-remove-liveness-overview-card
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 会话列表活性链路（use-session-liveness / liveness-badge）不受影响；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-remove-liveness-overview-card/requirements.md#FR-04
最近确认：2f29e2693a12839bf3f71fb8684b5db57fc628b3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-remove-liveness-overview-card:flow:FR-04
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-remove-liveness-overview-card
  status: active

## FR-auto-sillyspec-017 二次点击已在装配状态中的零正文轮，不再发起 run_id 单轮请求（调用计数不增长、无重复 prep
变更：2026-09-29-jump-empty-turn-dup
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 二次点击已在装配状态中的零正文轮，不再发起 run_id 单轮请求（调用计数不增长、无重复 prepend 块）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-jump-empty-turn-dup/requirements.md#FR-01
最近确认：46e58f4b3a574fafdc1f01d3250f768b8a9654f1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-29-jump-empty-turn-dup:flow:FR-01
  tests: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-29-jump-empty-turn-dup
  status: active

## FR-auto-sillyspec-018 首次点击未加载轮的单轮直达行为不变（一次请求 + prepend + 定位高亮 + 零翻页）
变更：2026-09-29-jump-empty-turn-dup
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 高亮 相关模块就绪；When 首次点击未加载轮的单轮直达行为不变（一次请求 + prepend + 定位高亮 + 零翻页）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-jump-empty-turn-dup/requirements.md#FR-02
最近确认：46e58f4b3a574fafdc1f01d3250f768b8a9654f1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-29-jump-empty-turn-dup:flow:FR-02
  tests: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-29-jump-empty-turn-dup
  status: active

## FR-auto-sillyspec-019 既有直达/回退/空日志兜底用例全绿，聚焦测试 + tsc/eslint 0 错
变更：2026-09-29-jump-empty-turn-dup
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 既有直达/回退/空日志兜底用例全绿，聚焦测试 + tsc/eslint 0 错；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-jump-empty-turn-dup/requirements.md#FR-03
最近确认：46e58f4b3a574fafdc1f01d3250f768b8a9654f1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-29-jump-empty-turn-dup:flow:FR-03
  tests: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-29-jump-empty-turn-dup
  status: active

## FR-auto-frontend-092 backend assets.py：knowledge_touch 并入实时命中——查本变更 inj
变更：2026-09-28-knowledge-touch-live
状态：active
骨架：thin
摘要：默认场景
待复核：2026-09-28-fr-review-batch
场景正文：
- 场景：默认场景 — Given 上限 相关模块就绪；When backend assets.py：knowledge_touch 并入实时命中——查本变更 inject 行的 matched_anchors（file#sl；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-01
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-knowledge-touch-live:flow:FR-01
  tests: backend/app/modules/change/tests/test_assets.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-knowledge-touch-live
  status: active

## FR-auto-frontend-093 frontend 资产卡：知识触达标题用用户语言——在途「知识触达（本变更参考过的知识 · 实时）」、归档「知识触达（本变更参考过的知识）」，机制口径收进 title 悬停；
变更：2026-09-28-knowledge-touch-live
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When frontend 资产卡：知识触达标题用用户语言——在途「知识触达（本变更参考过的知识 · 实时）」、归档「知识触达（本变更参考过的知识）」，数据口径（实时记录/待复核标记反查）收进 title 悬停；空态文案改写（在途也能有知识触达，FR/决策/测试绑定仍是归；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-02
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

## FR-auto-frontend-094 审计结论（不动）：文档区读变更目录实时可见；FR/决策/测试绑定/模块触达为归档时生成的结构化产物，
变更：2026-09-28-knowledge-touch-live
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 审计结论（不动）：文档区读变更目录实时可见；FR/决策/测试绑定/模块触达为归档时生成的结构化产物，设计内；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-03
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

## FR-auto-frontend-095 在途变更（未归档）若已有知识注入，资产卡即可见知识触达条目（数据来自 knowledge_hits
变更：2026-09-28-knowledge-touch-live
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 在途变更（未归档）若已有知识注入，资产卡即可见知识触达条目（数据来自 knowledge_hits inject 行，非标记）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-04
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-knowledge-touch-live:flow:FR-04
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-knowledge-touch-live
  status: active

## FR-auto-frontend-096 归档后标记反查与实时命中合并且去重（同一条目不重复出现）
变更：2026-09-28-knowledge-touch-live
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 归档后标记反查与实时命中合并且去重（同一条目不重复出现）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-05
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

## FR-auto-frontend-097 裸文件锚点（无 #）可显示
变更：2026-09-28-knowledge-touch-live
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 裸文件锚点（无 #）可显示；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-06
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

## FR-auto-frontend-098 live 合并上限 100 条
变更：2026-09-28-knowledge-touch-live
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 上限 相关模块就绪；When live 合并上限 100 条；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-07
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

## FR-auto-frontend-099 backend 资产测试新增在途命中用例 + frontend 卡测试同步，全绿
变更：2026-09-28-knowledge-touch-live
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When backend 资产测试新增在途命中用例 + frontend 卡测试同步，全绿；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-08
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

## FR-auto-frontend-100 tsc/eslint/ruff/mypy 0
变更：2026-09-28-knowledge-touch-live
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When tsc/eslint/ruff/mypy 0；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-09
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

## FR-auto-frontend-105 PageHeader 组件左侧内容列有 min-w-0，flex 收缩可用，超长标题/副标题不再撑破
变更：2026-09-28-change-detail-header-overflow
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 相关模块就绪；When PageHeader 组件左侧内容列有 min-w-0，flex 收缩可用，超长标题/副标题不再撑破头部宽度；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-detail-header-overflow/requirements.md#FR-01
最近确认：389282de4db4ae033db1905cd02834f70d14ba1b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-detail-header-overflow:flow:FR-01
  tests: frontend/src/components/layout/__tests__/page-header.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-detail-header-overflow
  status: active

## FR-auto-frontend-106 详情页头部描述行在 1600/1280 宽度下有省略号截断，document.scrollWidth
变更：2026-09-28-change-detail-header-overflow
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 详情页头部描述行在 1600/1280 宽度下有省略号截断，document.scrollWidth 等于视口宽（无横向滚动）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-detail-header-overflow/requirements.md#FR-02
最近确认：389282de4db4ae033db1905cd02834f70d14ba1b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-detail-header-overflow:flow:FR-02
  tests: frontend/src/components/layout/__tests__/page-header.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-detail-header-overflow
  status: active

## FR-auto-frontend-107 详情页标题超长时也能截断（flex 行内 truncate 项补 min-w-0）
变更：2026-09-28-change-detail-header-overflow
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 详情页标题超长时也能截断（flex 行内 truncate 项补 min-w-0）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-detail-header-overflow/requirements.md#FR-03
最近确认：389282de4db4ae033db1905cd02834f70d14ba1b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-detail-header-overflow:flow:FR-03
  tests: frontend/src/components/layout/__tests__/page-header.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-detail-header-overflow
  status: active

## FR-auto-frontend-108 相关前端测试与 tsc 通过
变更：2026-09-28-change-detail-header-overflow
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 / 测试 相关模块就绪；When 相关前端测试与 tsc 通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-detail-header-overflow/requirements.md#FR-04
最近确认：389282de4db4ae033db1905cd02834f70d14ba1b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-detail-header-overflow:flow:FR-04
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx | frontend/src/components/layout/__tests__/page-header.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-detail-header-overflow
  status: active

## FR-auto-frontend-109 263 条待复核条目逐条产出裁决：相符翻正（candidate 行 confirm 翻 active
变更：2026-09-28-fr-review-batch
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 263 条待复核条目逐条产出裁决：相符翻正（candidate 行 confirm 翻 active，无行；Then bind 真实测试）/ 绑定过时重绑 / 内容过时最小修正 / 特性已死标 superseded+退役理由 / 无测试面清标记留档报告
全文：.sillyspec/changes/archive/2026-09-28-fr-review-batch/requirements.md#FR-01
最近确认：bccffba0b0d15714673700b5743c33378eff8c06

## FR-auto-frontend-110 每条翻正的证据路径必须是盘上真实测试形态文件（test_*.py / *.test.*），不许悬空路
变更：2026-09-28-fr-review-batch
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 每条翻正的证据路径必须是盘上真实测试形态文件（test_*.py / *.test.*），不许悬空路径；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-fr-review-batch/requirements.md#FR-02
最近确认：bccffba0b0d15714673700b5743c33378eff8c06

## FR-auto-frontend-111 复核完成的条目清除「待复核：」标记行，未复核的不动
变更：2026-09-28-fr-review-batch
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 复核完成的条目清除「待复核：」标记行，未复核的不动；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-fr-review-batch/requirements.md#FR-03
最近确认：bccffba0b0d15714673700b5743c33378eff8c06

## FR-auto-frontend-112 fr 文件条目格式不被破坏（标题/状态/场景正文/绑定子块结构保持）
变更：2026-09-28-fr-review-batch
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When fr 文件条目格式不被破坏（标题/状态/场景正文/绑定子块结构保持）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-fr-review-batch/requirements.md#FR-04
最近确认：bccffba0b0d15714673700b5743c33378eff8c06

## FR-auto-frontend-113 sillyspec knowledge validate 无 errors
变更：2026-09-28-fr-review-batch
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When sillyspec knowledge validate 无 errors；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-fr-review-batch/requirements.md#FR-05
最近确认：bccffba0b0d15714673700b5743c33378eff8c06

## FR-auto-frontend-114 分批（按域分波）处理，每波显式 pathspec 提交
变更：2026-09-28-fr-review-batch
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 分批（按域分波）处理，每波显式 pathspec 提交；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-fr-review-batch/requirements.md#FR-06
最近确认：bccffba0b0d15714673700b5743c33378eff8c06

## FR-auto-frontend-115 QuicklogTable 表格 fixed 布局，标题按钮宽度跟随单元格（w-full），长标题在
变更：2026-09-28-quicklog-title-overflow
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When QuicklogTable 表格 fixed 布局，标题按钮宽度跟随单元格（w-full），长标题在单元格边界截断出省略号，不再压过相邻列；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-quicklog-title-overflow/requirements.md#FR-01
最近确认：e231b269b3b23711582a7b5e62f376be937624a6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-quicklog-title-overflow:flow:FR-01
  tests: frontend/src/components/changes/__tests__/quicklog-table.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-quicklog-title-overflow
  status: active

## FR-auto-frontend-116 状态列备注跟随单元格宽截断，不再有越过自身单元格的文本元素（生产实测扫描 0 越界）
变更：2026-09-28-quicklog-title-overflow
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 状态列备注跟随单元格宽截断，不再有越过自身单元格的文本元素（生产实测扫描 0 越界）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-quicklog-title-overflow/requirements.md#FR-02
最近确认：e231b269b3b23711582a7b5e62f376be937624a6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-quicklog-title-overflow:flow:FR-02
  tests: frontend/src/components/changes/__tests__/quicklog-table.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-quicklog-title-overflow
  status: active

## FR-auto-frontend-117 既有 quicklog-table 测试全绿 + 新增回归锁定用例 + tsc 0 错
变更：2026-09-28-quicklog-title-overflow
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 既有 quicklog-table 测试全绿 + 新增回归锁定用例 + tsc 0 错；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-quicklog-title-overflow/requirements.md#FR-03
最近确认：e231b269b3b23711582a7b5e62f376be937624a6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-quicklog-title-overflow:flow:FR-03
  tests: frontend/src/components/changes/__tests__/quicklog-table.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-quicklog-title-overflow
  status: active

## FR-auto-frontend-118 部署生产后 sillyspec 工作区快速修复 tab 全单元格扫描 0 越界
变更：2026-09-28-quicklog-title-overflow
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 部署生产后 sillyspec 工作区快速修复 tab 全单元格扫描 0 越界；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-quicklog-title-overflow/requirements.md#FR-04
最近确认：e231b269b3b23711582a7b5e62f376be937624a6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-quicklog-title-overflow:flow:FR-04
  tests: frontend/src/components/changes/__tests__/quicklog-table.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-quicklog-title-overflow
  status: active

## FR-auto-frontend-119 桌面端与移动端变更中心 tab 栏不再渲染「快速修复」tab
变更：2026-10-07-hide-quicklog-tab
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-07-hide-quicklog-tab/requirements.md#FR-01
最近确认：e62d98bcb7bddf9bc5c3313df3c47ee8ab04ab7d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-hide-quicklog-tab:flow:测试绑定FR-01
  tests: frontend/src/app/page.test.tsx「Tab 计数缓存含 quicklog，tab 栏徽标仅 active/archive 且 quicklog tab 缺席」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-hide-quicklog-tab
  status: active

## FR-auto-frontend-120 ?tab=quicklog 深链仍进入存量快速修复视图（工作区概览统计卡 / 变更详情关联快速任务卡 / 移动端详情重绘入口不失效）
变更：2026-10-07-hide-quicklog-tab
状态：active
摘要：深链进入
全文：.sillyspec/changes/archive/2026-10-07-hide-quicklog-tab/requirements.md#FR-02
最近确认：e62d98bcb7bddf9bc5c3313df3c47ee8ab04ab7d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-hide-quicklog-tab:flow:测试绑定FR-02
  tests: frontend/src/app/page.test.tsx「FR-03 URL ?tab=quicklog：初始 tab 为快速修复（tab 缺席 + 不发主列表请求）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-hide-quicklog-tab
  status: active

## FR-auto-frontend-121 深链存量视图内副标题计数、quicklog 搜索/筛选/详情抽屉/会话页等既有行为不变
变更：2026-10-07-hide-quicklog-tab
状态：active
摘要：副标题计数
全文：.sillyspec/changes/archive/2026-10-07-hide-quicklog-tab/requirements.md#FR-03
最近确认：e62d98bcb7bddf9bc5c3313df3c47ee8ab04ab7d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-hide-quicklog-tab:flow:测试绑定FR-03
  tests: frontend/src/app/page.test.tsx「quicklog 视图搜索/筛选抽屉/详情 Sheet（既有用例改深链进入后原断言保持）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-hide-quicklog-tab
  status: active

## FR-auto-frontend-122 受影响的前端测试改为深链进入并全部通过（仅跑受影响测试文件）
变更：2026-10-07-hide-quicklog-tab
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-07-hide-quicklog-tab/requirements.md#FR-04
最近确认：e62d98bcb7bddf9bc5c3313df3c47ee8ab04ab7d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-hide-quicklog-tab:flow:测试绑定FR-04
  tests: frontend/src/app/page.test.tsx | frontend/src/app/page.test.tsx「两文件全量用例通过（仅跑此两文件）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-hide-quicklog-tab
  status: active

## FR-auto-frontend-123 悬停窄轨刻度展开浮层后，浮层内当前指向的轮次行有可见指向标记（与 activeTurnKey 当前轮高亮视觉区分）
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：悬停刻度看浮层标记；指向行与当前轮同行
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-01
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「悬停刻度展开浮层后浮层内指向行有可见指向标记（与 active 高亮区分）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active

## FR-auto-frontend-124 指向标记随鼠标在刻度间/浮层行间移动实时跟随更新
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：刻度滑动跟随；浮层行同步
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-02
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「指向标记随刻度滑动与浮层行 hover 实时跟随」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active

## FR-auto-frontend-125 浮层内指向行超出可视区时自动滚入（block:nearest，不抢既有 active 联动语义之外的新滚动）
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：长会话指向滚入
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-03
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「指向行滚入可视区（scrollIntoView block:nearest，指向优先回落 active）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active

## FR-auto-frontend-126 鼠标移开组件后指向标记清除，既有展开/收起/pin/跳转/aria 行为零回归
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：移开清除
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-04
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-04
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「移开组件防抖到点清指向；收起点同步清除；既有行为零回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active

## FR-auto-frontend-127 turn-nav-list 组件单测覆盖上述新行为且既有用例全绿
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：测试全绿
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-05
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-05
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「turn-nav-list 既有用例全绿（vitest run 全文件）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active

## FR-auto-frontend-128 卡片正文 markdown 渲染
变更：2026-09-23-md-card-render
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given scan-docs 或 knowledge 页选中一份含表格/列表/加粗/行内代码的 md 文档；When 切换到「卡片」视图；Then 每张小节卡/单卡的正文按 markdown 正常渲染（表格 th/td、列表、加粗、行内 code 生效），且渲染**必须**经统一 rehype-saniti
全文：.sillyspec/changes/archive/2026-09-23-md-card-render/requirements.md#FR-01
最近确认：322c55edd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-23-md-card-render:task-01:acc-0-5268d069
  tests: frontend/src/components/knowledge/__tests__/card-markdown.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-01:acc-1-b237c25a
  tests: frontend/src/components/knowledge/__tests__/card-markdown.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-01:acc-2-c1042aed
  tests: frontend/src/components/knowledge/__tests__/card-markdown.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-01:acc-3-ef076ca2
  tests: frontend/src/components/knowledge/__tests__/card-markdown.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-02:acc-0-42de4f98
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-02:acc-1-2e486057
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-02:acc-2-f1575d52
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-02:acc-3-45b95137
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-02:acc-4-539d3b5a
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active

## FR-auto-frontend-129 卡片头视觉重构（manual 小节卡与 SingleCard）
变更：2026-09-23-md-card-render
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 卡片视图渲染一张小节卡或整文件单卡；When 卡片展示；Then 卡片左侧**必须**有 3px 品牌色条（brand-600 语义阶）、头部为 brand-50 底色带、小节标题 brand-700 加粗、右侧**必须**有
全文：.sillyspec/changes/archive/2026-09-23-md-card-render/requirements.md#FR-02
最近确认：322c55edd

## FR-auto-frontend-130 frontmatter 元信息条（含降级）
变更：2026-09-23-md-card-render
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 文档含 frontmatter（author / created_at 字段）；When 卡片头渲染；Then 头部下方显示一行小字元信息（✍ 作者 · 收录时间）；frontmatter 缺失或字段缺失时该行**必须**整体隐藏，**禁止**渲染空行、**禁止**抛错；
全文：.sillyspec/changes/archive/2026-09-23-md-card-render/requirements.md#FR-03
最近确认：322c55edd

## FR-auto-frontend-131 既有交互零回归
变更：2026-09-23-md-card-render
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 卡片模式完成改造；When ① 从知识库 INDEX 路由行点击跳转目标条目锚点；② 顶栏切换 blue / ai-native 主题；Then ① 页面**必须**滚动定位到目标卡片（data-entry-anchor + scrollIntoView 保留有效）；② 品牌色条/表头色/头底色**必须*
全文：.sillyspec/changes/archive/2026-09-23-md-card-render/requirements.md#FR-04
最近确认：322c55edd

## FR-auto-frontend-132 力场收敛后停止 stepForceLayout 步进（连续帧守卫防转折点误判）
变更：2026-10-09-graph-raf-settle
状态：active
摘要：页面开着不再恒耗 CPU
全文：.sillyspec/changes/archive/2026-10-09-graph-raf-settle/requirements.md#FR-01
最近确认：e39d596092c4282b08b7d04a889b7a0ae1282d34

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-raf-settle:flow:测试绑定FR-01
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「收敛帧数守卫常量：连续帧数 ≥30（转折点零速误判防线）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-raf-settle
  status: active

## FR-auto-frontend-133 收敛定格终局 fitView + tick 语义承接
变更：2026-10-09-graph-raf-settle
状态：active
摘要：未交互的收敛定格
全文：.sillyspec/changes/archive/2026-10-09-graph-raf-settle/requirements.md#FR-02
最近确认：e39d596092c4282b08b7d04a889b7a0ae1282d34

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-raf-settle:flow:测试绑定FR-02
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「全节点位移为零（x==px）判静止；单节点位移超阈值判未静止」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-raf-settle
  status: active

## FR-auto-frontend-134 数据重建与节点拖拽重启力场
变更：2026-10-09-graph-raf-settle
状态：active
摘要：拖放节点后重收敛
全文：.sillyspec/changes/archive/2026-10-09-graph-raf-settle/requirements.md#FR-03
最近确认：e39d596092c4282b08b7d04a889b7a0ae1282d34

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-raf-settle:flow:测试绑定FR-03
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「阈值参数生效：位移恰在阈值内/外两态；NaN 坐标防御性判未静止」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-raf-settle
  status: active

## FR-auto-frontend-135 判定提取导出纯函数 forceSettled 供测试；恢复被冲掉的 shouldAutoRefit 用例
变更：2026-10-09-graph-raf-settle
状态：active
摘要：相关面全绿
全文：.sillyspec/changes/archive/2026-10-09-graph-raf-settle/requirements.md#FR-04
最近确认：e39d596092c4282b08b7d04a889b7a0ae1282d34

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-raf-settle:flow:测试绑定FR-04
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「shouldAutoRefit 两用例（恢复）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-raf-settle
  status: active

## FR-auto-frontend-136 neighbors/impact/path 查询执行后，若结果节点集中含锚点节点（id 精确或 CLI 模糊解析回填的 query.key/anchor），该节点自动为选中态（选中环+一跳邻域高亮+右栏切节点详情）
变更：2026-10-09-graph-query-ux
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-graph-query-ux/requirements.md#FR-01
最近确认：0c2a8bd2264230f90dbcfc4199d33c88a325750b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-query-ux:flow:测试绑定FR-01
  tests: frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx「锚点自动选中」用例
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-query-ux
  status: active

## FR-auto-frontend-137 锚点不在结果集中时不报错不高亮（如 node_not_found 降级提示沿既有）
变更：2026-10-09-graph-query-ux
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-graph-query-ux/requirements.md#FR-02
最近确认：0c2a8bd2264230f90dbcfc4199d33c88a325750b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-query-ux:flow:测试绑定FR-02
  tests: frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx「sub 人话说明」用例
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-query-ux
  status: active

## FR-auto-frontend-138 sub 下拉每个选项悬浮（title）显示人话说明（孤儿节点=没人引用的知识条目…七条）
变更：2026-10-09-graph-query-ux
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-graph-query-ux/requirements.md#FR-03
最近确认：0c2a8bd2264230f90dbcfc4199d33c88a325750b

## FR-auto-frontend-139 选中 sub 后下拉下方显示一行动态说明文案（同 tooltip 内容）
变更：2026-10-09-graph-query-ux
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-graph-query-ux/requirements.md#FR-04
最近确认：0c2a8bd2264230f90dbcfc4199d33c88a325750b

## FR-auto-frontend-140 既有 16 页面用例零回归+新增用例（自动选中断言+说明文案断言）；tsc/eslint 零错
变更：2026-10-09-graph-query-ux
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-graph-query-ux/requirements.md#FR-05
最近确认：0c2a8bd2264230f90dbcfc4199d33c88a325750b

## FR-auto-frontend-141 单聊输入栏（session-input-bar）待发附件 chip 点击文件名区打开 FilePreviewModal 在线预览（复用已发送附件的 fetchAttachmentBlob + officeSource 链路）
变更：2026-10-09-pending-attachment-preview
状态：active
摘要：上传后未发送点击预览
全文：.sillyspec/changes/archive/2026-10-09-pending-attachment-preview/requirements.md#FR-01
最近确认：2c168156b0f004d395095ee5e3739f8b3719d795

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-pending-attachment-preview:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx「点击文件名区打开 FilePreviewModal 在线预览」

## FR-auto-frontend-141 thin 出身变更（isThinLineageChange 判定）详情页不再渲染「步骤时间线」卡，含归档补种 steps 场景
变更：2026-10-09-thin-hide-step-timeline
状态：active
摘要：归档 thin 补种 steps；在途 thin
全文：.sillyspec/changes/archive/2026-10-09-thin-hide-step-timeline/requirements.md#FR-01
最近确认：bb504f72b29ed001ef798b89b79e99bc8ce9b830

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-thin-hide-step-timeline:flow:测试绑定FR-01
  tests: frontend/src/components/mobile/mobile-change-detail.test.tsx「归档 thin（stage=archived + steps 无标准四阶段痕迹）→ 轻量说明卡而非「无可审批」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-pending-attachment-preview
  status: active

## FR-auto-frontend-142 群聊面板（group-chat-panel）待发附件 chip 同样支持点击预览
变更：2026-10-09-pending-attachment-preview
状态：active
摘要：群聊待发附件点击预览
全文：.sillyspec/changes/archive/2026-10-09-pending-attachment-preview/requirements.md#FR-02
最近确认：2c168156b0f004d395095ee5e3739f8b3719d795

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-pending-attachment-preview:flow:测试绑定FR-02
  tests: frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx「待发附件 chip 点击在线预览（2026-10-09-pending-attachment-preview）：FilePreviewModal 打开」
  source_change: 2026-10-09-thin-hide-step-timeline
  status: active

## FR-auto-frontend-142 非 thin 厚变更步骤时间线卡行为不变，仍正常渲染 steps 明细
变更：2026-10-09-thin-hide-step-timeline
状态：active
摘要：厚变更带 steps
全文：.sillyspec/changes/archive/2026-10-09-thin-hide-step-timeline/requirements.md#FR-02
最近确认：bb504f72b29ed001ef798b89b79e99bc8ce9b830

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-thin-hide-step-timeline:flow:测试绑定FR-02
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx「共存（厚变更）：steps 含标准阶段痕迹 + 观测数据 → 步骤时间线卡与真实留痕时间线卡双卡渲染」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-pending-attachment-preview
  status: active

## FR-auto-frontend-143 预览与移除互不干扰：点击 X 删除附件不触发预览，点击预览不影响删除
变更：2026-10-09-pending-attachment-preview
状态：active
摘要：点 X 删除不开预览
全文：.sillyspec/changes/archive/2026-10-09-pending-attachment-preview/requirements.md#FR-03
最近确认：2c168156b0f004d395095ee5e3739f8b3719d795

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-pending-attachment-preview:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx「点 X 删除附件不触发预览」
  source_change: 2026-10-09-thin-hide-step-timeline
  status: active

## FR-auto-frontend-143 真实留痕时间线卡恒挂载行为不变（2026-09-27-timeline-coexist 共存语义保留）
变更：2026-10-09-thin-hide-step-timeline
状态：active
摘要：厚变更归档双卡共存
全文：.sillyspec/changes/archive/2026-10-09-thin-hide-step-timeline/requirements.md#FR-03
最近确认：bb504f72b29ed001ef798b89b79e99bc8ce9b830

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-thin-hide-step-timeline:flow:测试绑定FR-03
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx「FR-03（2026-09-26-change-real-timeline）：steps 为空时主线挂载真实留痕时间线卡」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-pending-attachment-preview
  status: active

## FR-auto-frontend-144 既有上传/移除/发送行为零回归，相关测试全绿
变更：2026-10-09-pending-attachment-preview
状态：active
摘要：零回归验证
全文：.sillyspec/changes/archive/2026-10-09-pending-attachment-preview/requirements.md#FR-04
最近确认：2c168156b0f004d395095ee5e3739f8b3719d795

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-pending-attachment-preview:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx「一次选 12 个文件：toast 告知忽略多余的 2 个，只上传前 10 个」 | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  source_change: 2026-10-09-thin-hide-step-timeline
  status: active

## FR-auto-frontend-144 相关前端测试更新并通过（仅跑改动相关测试，不跑全量）
变更：2026-10-09-thin-hide-step-timeline
状态：active
摘要：定向测试
全文：.sillyspec/changes/archive/2026-10-09-thin-hide-step-timeline/requirements.md#FR-04
最近确认：bb504f72b29ed001ef798b89b79e99bc8ce9b830

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-thin-hide-step-timeline:flow:测试绑定FR-04
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx「本文件全部用例（vitest run 定向）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-pending-attachment-preview
  source_change: 2026-10-09-thin-hide-step-timeline
  status: active

## FR-auto-frontend-145 右击待发附件在正文末尾插入引用标签
变更：2026-10-09-attachment-inline-reference
状态：active
摘要：默认场景
依据决策：D-006@v3
场景正文：
- 场景：默认场景 — Given 会话输入区存在至少一个已上传未发送的附件 chip；When 用户右击（contextmenu）该 chip；Then 插入位置=**失焦前记住的光标位**（右击附件必先使输入框失焦，onBlur 记忆 selectionStart；输入框仍聚焦时用当前光标位；从未聚焦过才插正文
全文：.sillyspec/changes/archive/2026-10-09-attachment-inline-reference/requirements.md#FR-01
最近确认：4050ee624

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-attachment-inline-reference:task-03:acc-0-5e531a62
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active
- row: 2026-10-09-attachment-inline-reference:task-03:acc-1-efb19665
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active
- row: 2026-10-09-attachment-inline-reference:task-05:acc-0-7fd44e56
  tests: frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active

## FR-auto-frontend-146 同名附件引用唯一化
变更：2026-10-09-attachment-inline-reference
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 已存在引用标签的附件名与本次右击的附件同名；When 插入新引用；Then 新引用自动加序号后缀（`【文件名·2】`、`【文件名·3】`…），保证正文内每个引用标签文本指代唯一附件；删除任一附件不改变其它（同名）附件已插入引用的文本
全文：.sillyspec/changes/archive/2026-10-09-attachment-inline-reference/requirements.md#FR-02
最近确认：4050ee624

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-attachment-inline-reference:task-01:acc-0-befb68d6
  tests: frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx | frontend/src/components/daemon/__tests__/attachment-refs.test.ts | frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active
- row: 2026-10-09-attachment-inline-reference:task-01:acc-1-87bcb059
  tests: frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx | frontend/src/components/daemon/__tests__/attachment-refs.test.ts | frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active

## FR-auto-frontend-147 编辑态引用标签的渲染与删除
变更：2026-10-09-attachment-inline-reference
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v2
场景正文：
- 场景：默认场景 — Given 正文含引用标签；Then 输入框镜像高亮层将其渲染为标签样式（品牌色底、圆角、右上角 × 角标）；点 × 角标删除该处一次出现；退格键在光标贴标签尾部且无选区时**一次删除整个标签**（
全文：.sillyspec/changes/archive/2026-10-09-attachment-inline-reference/requirements.md#FR-03
最近确认：4050ee624

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-attachment-inline-reference:task-02:acc-0-1dfd89f5
  tests: frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx | frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active
- row: 2026-10-09-attachment-inline-reference:task-02:acc-1-3b4a90ee
  tests: frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx | frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active

## FR-auto-frontend-148 发送置换为 uuid 锚定正式引用
变更：2026-10-09-attachment-inline-reference
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 正文含引用标签且用户发送消息；When 发送组装 prompt；Then 每个可解析的编辑态 token 置换为 `[附件引用:<uuid>|<文件名>]`（uuid 与随消息附件、头部标记行对齐，同名附件可精确区分）；无法解析的孤儿
全文：.sillyspec/changes/archive/2026-10-09-attachment-inline-reference/requirements.md#FR-04
最近确认：4050ee624

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-attachment-inline-reference:task-04:acc-0-d7ea3659
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active
- row: 2026-10-09-attachment-inline-reference:task-04:acc-1-af4a2ac5
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active

## FR-auto-frontend-149 删除附件联动清空正文引用
变更：2026-10-09-attachment-inline-reference
状态：active
摘要：默认场景
依据决策：D-004@v2
场景正文：
- 场景：默认场景 — Given 正文含某附件的引用标签；When 用户点该附件 chip 的 X 删除；Then 正文内该附件的全部引用标签同步移除，其它附件的引用不受影响
全文：.sillyspec/changes/archive/2026-10-09-attachment-inline-reference/requirements.md#FR-05
最近确认：4050ee624

## FR-auto-frontend-150 历史消息引用标签渲染与点击预览
变更：2026-10-09-attachment-inline-reference
状态：active
摘要：默认场景
依据决策：D-005@v2
场景正文：
- 场景：默认场景 — Given 历史消息正文含 `[附件引用:<uuid>|<文件名>]`；When 气泡正文渲染；Then 引用渲染为标签节点（蓝色主气泡内用白色半透明色调保证可读，D-005@v2），点击打开 FilePreviewModal 按 uuid 在线预览附件内容（与已发
全文：.sillyspec/changes/archive/2026-10-09-attachment-inline-reference/requirements.md#FR-06
最近确认：4050ee624

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-attachment-inline-reference:task-06:acc-0-297e9c56
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active
- row: 2026-10-09-attachment-inline-reference:task-06:acc-1-c1496481
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active

## FR-auto-frontend-151 输入框内引用标签的×角标默认隐藏，鼠标移动到该标签上时才淡入显示（单聊+群聊）
变更：2026-10-10-att-ref-badge-hover
状态：active
摘要：悬停显示
全文：.sillyspec/changes/archive/2026-10-10-att-ref-badge-hover/requirements.md#FR-01
最近确认：b9b67aa80c9a306c4bfeeee1f03eaab6a192f7f0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-att-ref-badge-hover:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「角标默认隐藏、visibleBadgeIndex 命中才显示」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-att-ref-badge-hover
  status: active

## FR-auto-frontend-152 隐藏态不拦截点击（标签区域下方 textarea 的光标定位/选字不受影响），显示态可正常点击删除
变更：2026-10-10-att-ref-badge-hover
状态：active
摘要：隐藏态点击穿透
全文：.sillyspec/changes/archive/2026-10-10-att-ref-badge-hover/requirements.md#FR-02
最近确认：b9b67aa80c9a306c4bfeeee1f03eaab6a192f7f0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-att-ref-badge-hover:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「角标默认隐藏（opacity-0 + pointer-events-none），visibleBadgeIndex 命中才显示」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-att-ref-badge-hover
  status: active

## FR-auto-frontend-153 指针离开标签/输入区后角标隐藏；原×删除、退格整删、删附件联动行为零回归
变更：2026-10-10-att-ref-badge-hover
状态：active
摘要：移出隐藏
全文：.sillyspec/changes/archive/2026-10-10-att-ref-badge-hover/requirements.md#FR-03
最近确认：b9b67aa80c9a306c4bfeeee1f03eaab6a192f7f0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-att-ref-badge-hover:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「既有×删除回调行为不变」 | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx「× 角标删除该处一次出现；点 X 删附件联动剥离全部引用」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-att-ref-badge-hover
  status: active

## FR-auto-frontend-154 相关测试全绿+tsc 零错
变更：2026-10-10-att-ref-badge-hover
状态：active
摘要：验证通过
全文：.sillyspec/changes/archive/2026-10-10-att-ref-badge-hover/requirements.md#FR-04
最近确认：b9b67aa80c9a306c4bfeeee1f03eaab6a192f7f0

## FR-auto-frontend-182 enrichDisplayTurns 的 apiDurationMs 回填语义必须有行为测试锁定（上变更评审 P3）
变更：2026-10-10-turn-speed-enrich-backfill-test
状态：active
摘要：历史轮回填；实时值优先
全文：.sillyspec/changes/archive/2026-10-10-turn-speed-enrich-backfill-test/requirements.md#FR-01
最近确认：196c2280aeaf47428b5197da25e21c9224a890fc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-turn-speed-enrich-backfill-test:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/page-helpers-enrich-api-duration.test.ts「全部用例（回填/优先/缺失/null/未命中/引用稳定/新对象）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-turn-speed-enrich-backfill-test
  status: active

## FR-auto-frontend-183 测试全绿（不跑全量）
变更：2026-10-10-turn-speed-enrich-backfill-test
状态：active
摘要：相关测试绿
全文：.sillyspec/changes/archive/2026-10-10-turn-speed-enrich-backfill-test/requirements.md#FR-02
最近确认：196c2280aeaf47428b5197da25e21c9224a890fc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-turn-speed-enrich-backfill-test:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/page-helpers-enrich-api-duration.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-turn-speed-enrich-backfill-test
  status: active

## FR-auto-frontend-184 单轮会话（1 条轮目）左侧轮次导航可见，显示该轮并可点击定位
变更：2026-10-10-single-turn-nav-and-jump-head
状态：active
摘要：单轮会话导航可见；空轮次仍不渲染
全文：.sillyspec/changes/archive/2026-10-10-single-turn-nav-and-jump-head/requirements.md#FR-01
最近确认：d36f637fb53b872facafe40761c637f9b5acd6b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-single-turn-nav-and-jump-head:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「单轮（1 条）entries 渲染导航并可点击跳转」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-single-turn-nav-and-jump-head
  status: active

## FR-auto-frontend-185 桌面 TurnNavList 与移动端 Drawer 轮次导航行为一致（空态文案不回归）
变更：2026-10-10-single-turn-nav-and-jump-head
状态：active
摘要：移动端一致性
全文：.sillyspec/changes/archive/2026-10-10-single-turn-nav-and-jump-head/requirements.md#FR-02
最近确认：d36f637fb53b872facafe40761c637f9b5acd6b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-single-turn-nav-and-jump-head:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「0 条 entries 不渲染导航（空态语义保持）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-single-turn-nav-and-jump-head
  status: active

## FR-auto-frontend-186 时间线顶部在还有更早历史时提供「回到会话开头」入口，点击后程序化连续翻页直至游标到头，并定位到最早内容
变更：2026-10-10-single-turn-nav-and-jump-head
状态：active
摘要：点击直达开头；页上限兜底
全文：.sillyspec/changes/archive/2026-10-10-single-turn-nav-and-jump-head/requirements.md#FR-03
最近确认：d36f637fb53b872facafe40761c637f9b5acd6b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-single-turn-nav-and-jump-head:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「点击回到会话开头：连续 before 翻页到头并定位顶部」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-single-turn-nav-and-jump-head
  status: active

## FR-auto-frontend-187 连续加载期间有可见 loading 状态；到头后入口消失
变更：2026-10-10-single-turn-nav-and-jump-head
状态：active
摘要：loading 可见与消失
全文：.sillyspec/changes/archive/2026-10-10-single-turn-nav-and-jump-head/requirements.md#FR-04
最近确认：d36f637fb53b872facafe40761c637f9b5acd6b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-single-turn-nav-and-jump-head:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「回到会话开头 loading 态与到头后入口消失」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-single-turn-nav-and-jump-head
  status: active

## FR-auto-frontend-188 既有触顶翻页/跳转/贴底跟随相关测试全部保持通过
变更：2026-10-10-single-turn-nav-and-jump-head
状态：active
摘要：回归
全文：.sillyspec/changes/archive/2026-10-10-single-turn-nav-and-jump-head/requirements.md#FR-05
最近确认：d36f637fb53b872facafe40761c637f9b5acd6b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-single-turn-nav-and-jump-head:flow:测试绑定FR-05
  tests: frontend/src/components/sessions/__tests__/turn-catalog.test.tsx「隐藏阈值改写：0 条隐藏 / 1 条起出现」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-single-turn-nav-and-jump-head
  status: active

## FR-auto-frontend-189 ScopeAuditView 渲染 repos[]（非空数组时）：每仓一段=仓标识（key==='main' 显示「主仓」brand 色）+锚点 chip（anchor.label 文案+base 前 7 位短哈希，degraded 显示降级锚）+三态 chips（计划内/计划外/计划未动计数取 repos[].totals 单一源）+该仓 files/+−；degraded 仓段不渲染 chips，整段 ⚠️ degradedReason
变更：2026-10-10-change-patch-cross-repo-view
状态：active
摘要：跨仓冻结件按仓分段；降级仓整段警示
全文：.sillyspec/changes/archive/2026-10-10-change-patch-cross-repo-view/requirements.md#FR-01
最近确认：1f4ea92e5df86e3be6149b1f19d5fa046a8ee1ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-change-patch-cross-repo-view:flow:测试绑定FR-01
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-change-patch-cross-repo-view
  status: active

## FR-auto-frontend-163 rows 表 crossRepo 字段非空的行在路径后加仓标徽章（brand 色小标签，对齐 scope-audit-command-card 形态）
变更：2026-10-10-change-patch-cross-repo-view
状态：active
摘要：跨仓行与主仓行混排
全文：.sillyspec/changes/archive/2026-10-10-change-patch-cross-repo-view/requirements.md#FR-02
最近确认：1f4ea92e5df86e3be6149b1f19d5fa046a8ee1ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-change-patch-cross-repo-view:flow:测试绑定FR-02
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx「rows 跨仓行路径后仓标徽章」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-change-patch-cross-repo-view
  status: active

## FR-auto-frontend-164 repos[].patch 键在场（'patch' in 条目）时：非空 string 可折叠展开 DiffView 正文+patchSha256 短哈希（title 全量）；null 诚实显示「patch 未采集（采集失败或空窗）」；键缺省（旧形态/未开采集）零渲染——additive 契约旧读方零感知
变更：2026-10-10-change-patch-cross-repo-view
状态：active
摘要：patch 正文在场可展开；patch 采集失败诚实留痕；旧形态无 patch 键零渲染
全文：.sillyspec/changes/archive/2026-10-10-change-patch-cross-repo-view/requirements.md#FR-03
最近确认：1f4ea92e5df86e3be6149b1f19d5fa046a8ee1ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-change-patch-cross-repo-view:flow:测试绑定FR-03
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx「repos[].patch 折叠正文+sha/null 未采集/缺键零渲染」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-change-patch-cross-repo-view
  status: active

## FR-auto-frontend-165 旧形态（无 repos 键/无跨仓行）渲染与现状一致，既有测试零回归
变更：2026-10-10-change-patch-cross-repo-view
状态：active
摘要：旧冻结件回退
全文：.sillyspec/changes/archive/2026-10-10-change-patch-cross-repo-view/requirements.md#FR-04
最近确认：1f4ea92e5df86e3be6149b1f19d5fa046a8ee1ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-change-patch-cross-repo-view:flow:测试绑定FR-04
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx「旧形态无 repos 回退现状（既有用例零回归）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-change-patch-cross-repo-view
  status: active

## FR-auto-frontend-166 测试覆盖：跨仓 repos 段渲染/降级段/patch 展开+sha/null 未采集/缺键不渲染/行仓标徽章
变更：2026-10-10-change-patch-cross-repo-view
状态：active
摘要：回归面全绿
全文：.sillyspec/changes/archive/2026-10-10-change-patch-cross-repo-view/requirements.md#FR-05
最近确认：1f4ea92e5df86e3be6149b1f19d5fa046a8ee1ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-change-patch-cross-repo-view:flow:测试绑定FR-05
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx「跨仓展示用例组全绿」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-change-patch-cross-repo-view
  status: active

## FR-auto-frontend-167 session-panel-variant 回归锚用例断言随导航阈值放宽翻转（1 轮 fixture 导航列渲染）
变更：2026-10-10-variant-test-nav-flip
状态：active
摘要：断言翻转后全绿
全文：.sillyspec/changes/archive/2026-10-10-variant-test-nav-flip/requirements.md#FR-01
最近确认：589d2691b4a6dc32ae723617030bce6a58f4c339

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-variant-test-nav-flip:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx「不传 variant：根/头部 className 与改前字面量逐字一致，桌面 chrome 原位、无 ⋯ 菜单」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-variant-test-nav-flip
  status: active

## FR-auto-frontend-168 对话视图 ❓ 提问记录按时间戳穿插进对话流（不再整组前置轮头部）
变更：2026-10-10-dialog-qa-inplace
状态：active
摘要：一轮多问时序还原；仅有提问无对话段
全文：.sillyspec/changes/archive/2026-10-10-dialog-qa-inplace/requirements.md#FR-01
最近确认：21ea5d036cc57538deceda94ae85e4ff3ec9c6fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-dialog-qa-inplace:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx「两段之间的提问渲染在两段之间（created_at 落在段时刻中间）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-dialog-qa-inplace
  status: active

## FR-auto-frontend-169 问答块视觉样式逐字不变（复用同一标记），仅位置变化
变更：2026-10-10-dialog-qa-inplace
状态：active
摘要：回退路径不回归
全文：.sillyspec/changes/archive/2026-10-10-dialog-qa-inplace/requirements.md#FR-02
最近确认：21ea5d036cc57538deceda94ae85e4ff3ec9c6fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-dialog-qa-inplace:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx「旧回退路径（segments undefined）：❓ 块仍渲染，不回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-dialog-qa-inplace
  status: active

## FR-auto-frontend-170 全部视图穿插行为零改动
变更：2026-10-10-dialog-qa-inplace
状态：active
摘要：全部视图无双画
全文：.sillyspec/changes/archive/2026-10-10-dialog-qa-inplace/requirements.md#FR-03
最近确认：21ea5d036cc57538deceda94ae85e4ff3ec9c6fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-dialog-qa-inplace:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx「「全部」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-dialog-qa-inplace
  status: active

## FR-auto-frontend-171 既有对话/弹窗相关测试全部保持通过
变更：2026-10-10-dialog-qa-inplace
状态：active
摘要：回归
全文：.sillyspec/changes/archive/2026-10-10-dialog-qa-inplace/requirements.md#FR-04
最近确认：21ea5d036cc57538deceda94ae85e4ff3ec9c6fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-dialog-qa-inplace:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx「AC-10-01b 提问记录按 run_id 穿插到对应 turn（不堆顶）(ql-20260802-001)」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-dialog-qa-inplace
  status: active

## FR-auto-frontend-172 回放路径——系统注入开轮的占位槽（首条 user_input 剥空也占住 prompt 槽）
变更：2026-10-10-system-opened-turn-usermsg
状态：active
摘要：系统通知开轮 + 中途⚡消息（run 4296aa6a 实证）
全文：.sillyspec/changes/archive/2026-10-10-system-opened-turn-usermsg/requirements.md#FR-01
最近确认：f164a7fbca2264116fe5a3adaff5ad585a217b81

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-system-opened-turn-usermsg:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「系统通知开轮 + 中途消息：prompt 保持空，消息转 user_msg 段按 ts 插入输出之间」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-system-opened-turn-usermsg
  status: active

## FR-auto-frontend-173 实时路径——空 prompt 已有输出段的轮，user_input 转 user_msg 段
变更：2026-10-10-system-opened-turn-usermsg
状态：active
摘要：实时中途消息不前移轮首
全文：.sillyspec/changes/archive/2026-10-10-system-opened-turn-usermsg/requirements.md#FR-02
最近确认：f164a7fbca2264116fe5a3adaff5ad585a217b81

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-system-opened-turn-usermsg:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/steered-usermsg-guard.test.tsx「prompt 空 + 已有输出段（系统通知开轮）：追加 delivered 段，不再前移轮首」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-system-opened-turn-usermsg
  status: active

## FR-auto-frontend-174 既有行为零回归
变更：2026-10-10-system-opened-turn-usermsg
状态：active
摘要：正常轮与新鲜轮
全文：.sillyspec/changes/archive/2026-10-10-system-opened-turn-usermsg/requirements.md#FR-03
最近确认：f164a7fbca2264116fe5a3adaff5ad585a217b81

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-system-opened-turn-usermsg:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/steered-usermsg-guard.test.tsx「prompt 空 + 无输出段（新鲜轮）：原样返回——开轮正文走 prompt 写入路径」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-system-opened-turn-usermsg
  status: active

## FR-auto-frontend-175 mobile 子代理段渲染紧凑基本信息卡（children 不内联刷屏）
变更：2026-10-11-mobile-subagent-drawer
状态：active
摘要：手机端回显
全文：.sillyspec/changes/archive/2026-10-11-mobile-subagent-drawer/requirements.md#FR-01
最近确认：85f49e7333567bea28ef71b993f8b132fb4614b9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-mobile-subagent-drawer:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-panel-mobile-subagent.test.tsx「mobile：子代理段为紧凑卡（children 不内联刷屏），点击打开 Drawer 展示内部会话，✕ 关闭」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-mobile-subagent-drawer
  status: active

## FR-auto-frontend-176 点击紧凑卡打开移动端 Drawer 展示子代理内部会话
变更：2026-10-11-mobile-subagent-drawer
状态：active
摘要：点击-浏览-关闭
全文：.sillyspec/changes/archive/2026-10-11-mobile-subagent-drawer/requirements.md#FR-02
最近确认：85f49e7333567bea28ef71b993f8b132fb4614b9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-mobile-subagent-drawer:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-panel-mobile-subagent.test.tsx「mobile：再点已激活卡片为 toggle 关闭（与 PC 语义一致）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-mobile-subagent-drawer
  status: active

## FR-auto-frontend-177 PC 与旧宿主零回归
变更：2026-10-11-mobile-subagent-drawer
状态：active
摘要：desktop 悬浮宿主形态
全文：.sillyspec/changes/archive/2026-10-11-mobile-subagent-drawer/requirements.md#FR-03
最近确认：85f49e7333567bea28ef71b993f8b132fb4614b9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-mobile-subagent-drawer:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-panel-mobile-subagent.test.tsx「零回归锚：desktop 悬浮宿主形态（未装配右栏 props）仍内联展开（children 可见）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-mobile-subagent-drawer
  status: active

## FR-auto-frontend-178 approvals 与 audit 两页返回链接改指 /workspaces/${workspaceId}（工作区详情首页），文案与指向一致
变更：2026-10-12-workspace-dead-link-fix
状态：active
摘要：审批中心页返回链接；审计日志页返回链接
全文：.sillyspec/changes/archive/2026-10-12-workspace-dead-link-fix/requirements.md#FR-01
最近确认：b417851478119d5774b018a105ed0e2a5df813e1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-workspace-dead-link-fix:flow:测试绑定FR-01
  tests: frontend/src/app/(dashboard)/workspaces/[id]/audit/__tests__/page.test.tsx「页头「← 工作区」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-workspace-dead-link-fix
  status: active

## FR-auto-frontend-179 全仓不再存在指向 workspaces/[id]/components 的用户可见链接（grep 复核）
变更：2026-10-12-workspace-dead-link-fix
状态：active
摘要：残留清零
全文：.sillyspec/changes/archive/2026-10-12-workspace-dead-link-fix/requirements.md#FR-02
最近确认：b417851478119d5774b018a105ed0e2a5df813e1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-workspace-dead-link-fix:flow:测试绑定FR-02
  tests: frontend/src/app/(dashboard)/workspaces/[id]/approvals/__tests__/page.test.tsx「页头「← 工作区」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-workspace-dead-link-fix
  status: active

## FR-auto-frontend-180 两页既有测试全绿；如两页无既有链接断言则补最小断言钉住返回链接指向
变更：2026-10-12-workspace-dead-link-fix
状态：active
摘要：链接断言钉住
全文：.sillyspec/changes/archive/2026-10-12-workspace-dead-link-fix/requirements.md#FR-03
最近确认：b417851478119d5774b018a105ed0e2a5df813e1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-workspace-dead-link-fix:flow:测试绑定FR-03
  tests: frontend/src/app/(dashboard)/workspaces/[id]/approvals/__tests__/page.test.tsx「页头「← 工作区」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-workspace-dead-link-fix
  status: active

## FR-auto-frontend-181 仅跑本改动相关测试（规则 0）
变更：2026-10-12-workspace-dead-link-fix
状态：active
摘要：相关面回归
全文：.sillyspec/changes/archive/2026-10-12-workspace-dead-link-fix/requirements.md#FR-04
最近确认：b417851478119d5774b018a105ed0e2a5df813e1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-workspace-dead-link-fix:flow:测试绑定FR-04
  tests: frontend/src/app/(dashboard)/workspaces/[id]/audit/__tests__/page.test.tsx「页头「← 工作区」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-workspace-dead-link-fix
  status: active
||||||| C:/Users/12532/AppData/Local/Temp/k.base

## FR-auto-frontend-182 文件树右键添加引用
变更：2026-10-10-workspace-ref-intake
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given 会话页左栏处于「工作区文件」模式且中栏有输入区（真会话/预会话/群聊）；When 用户右键文件树中的文件或目录节点；Then 出现上下文菜单（单项）；点击「添加文件/目录到会话输入框」后，当前输入区光标处插入该节点的引用标签（输入区失焦时插入失焦前光标位）；空门户态（无输入区）时 to
全文：.sillyspec/changes/archive/2026-10-10-workspace-ref-intake/requirements.md#FR-01
最近确认：38bb5b21e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-workspace-ref-intake:task-03:acc-0-5c7e2814
  tests: frontend/src/components/explorer/__tests__/file-explorer.test.tsx | frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active
- row: 2026-10-10-workspace-ref-intake:task-03:acc-1-d7085b37
  tests: frontend/src/components/explorer/__tests__/file-explorer.test.tsx | frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active
- row: 2026-10-10-workspace-ref-intake:task-06:acc-0-f5647a9e
  tests: frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active
- row: 2026-10-10-workspace-ref-intake:task-06:acc-1-25ac9d78
  tests: frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active
- row: 2026-10-10-workspace-ref-intake:task-06:acc-2-f20c7f7d
  tests: frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active

## FR-auto-frontend-183 引用标签编辑与路径绑定
变更：2026-10-10-workspace-ref-intake
状态：active
摘要：默认场景
依据决策：D-005@v1、D-009@v1
场景正文：
- 场景：默认场景 — Given 输入区已插入工作区引用标签；Then 标签显示名称（代码块为「名称:起始行-结束行」）；悬停显示类型 + 工作区 + 完整相对路径（代码块含行号）；右上 × 角标删该处一次出现；光标贴标签尾按退格一
全文：.sillyspec/changes/archive/2026-10-10-workspace-ref-intake/requirements.md#FR-02
最近确认：38bb5b21e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-workspace-ref-intake:task-01:acc-0-c3d0e5a9
  tests: frontend/src/components/daemon/__tests__/attachment-refs.test.ts | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active
- row: 2026-10-10-workspace-ref-intake:task-05:acc-0-e31eee83
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active
- row: 2026-10-10-workspace-ref-intake:task-05:acc-1-da26c83e
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active
- row: 2026-10-10-workspace-ref-intake:task-05:acc-2-45bba167
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active
- row: 2026-10-10-workspace-ref-intake:task-05:acc-3-3024a717
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active

## FR-auto-frontend-184 类型角标
变更：2026-10-10-workspace-ref-intake
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 输入区存在引用标签（附件或工作区）；Then 镜像层标签左上角显示 lucide 类型角标：文件 FileText / 目录 Folder / 代码块 Braces / 附件 Paperclip（D-001
全文：.sillyspec/changes/archive/2026-10-10-workspace-ref-intake/requirements.md#FR-03
最近确认：38bb5b21e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-workspace-ref-intake:task-04:acc-0-2e832fd9
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active
- row: 2026-10-10-workspace-ref-intake:task-04:acc-1-4d931d00
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active

## FR-auto-frontend-185 预览区行号（前置）
变更：2026-10-10-workspace-ref-intake
状态：active
摘要：默认场景
依据决策：D-002@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 右侧预览列展示代码或纯文本文件；Then 内容按行显示行号；行号列不可被选中（选区锚点只落内容区）；.md/图片/PDF/二进制分支无行号且行为与现状一致
全文：.sillyspec/changes/archive/2026-10-10-workspace-ref-intake/requirements.md#FR-04
最近确认：38bb5b21e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-workspace-ref-intake:task-02:acc-0-e07fdcdd
  tests: frontend/src/components/explorer/__tests__/file-preview.test.tsx | frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active
- row: 2026-10-10-workspace-ref-intake:task-02:acc-1-2e44829d
  tests: frontend/src/components/explorer/__tests__/file-preview.test.tsx | frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active

## FR-auto-frontend-186 选区右键添加代码块引用
变更：2026-10-10-workspace-ref-intake
状态：active
摘要：默认场景
依据决策：D-002@v1、D-006@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 预览区为代码/纯文本文件且用户选中了若干行（选区非折叠且起止落在行元素内）；When 用户在选区内右键；Then 出现菜单「添加选中内容到会话输入框（名称:起始行-结束行）」，点击后光标处插入代码块引用标签；行号按选区起止行元素的文档实际位置计算（反向选区取 min-max
全文：.sillyspec/changes/archive/2026-10-10-workspace-ref-intake/requirements.md#FR-05
最近确认：38bb5b21e

## FR-auto-frontend-187 发送置换
变更：2026-10-10-workspace-ref-intake
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1、D-008@v2、D-009@v1
场景正文：
- 场景：默认场景 — Given 待发正文含工作区引用标签；When 消息发送（含定时发送、团队直发、群聊）；Then 标签全部置换为 `[文件引用:wid|path]` / `[目录引用:wid|path]` / `[代码引用:wid|path|L起-L止]`（全部组装位覆盖—
全文：.sillyspec/changes/archive/2026-10-10-workspace-ref-intake/requirements.md#FR-06
最近确认：38bb5b21e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-workspace-ref-intake:task-07:acc-0-af16cfc2
  tests: frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx | frontend/src/components/daemon/__tests__/attachment-refs.test.ts | frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active
- row: 2026-10-10-workspace-ref-intake:task-07:acc-1-74dc11c4
  tests: frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx | frontend/src/components/daemon/__tests__/attachment-refs.test.ts | frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active
- row: 2026-10-10-workspace-ref-intake:task-07:acc-2-b8e01635
  tests: frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx | frontend/src/components/daemon/__tests__/attachment-refs.test.ts | frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active

## FR-auto-frontend-188 历史渲染与预览
变更：2026-10-10-workspace-ref-intake
状态：active
摘要：默认场景
依据决策：D-004@v1、D-009@v1
场景正文：
- 场景：默认场景 — Given 历史消息正文含三类引用标记；Then 渲染为可点击标签（类型图标 + 名称 + 行号）；点击经 fetchDownload(workspaceId, path) 打开 FilePreviewModa
全文：.sillyspec/changes/archive/2026-10-10-workspace-ref-intake/requirements.md#FR-07
最近确认：38bb5b21e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-workspace-ref-intake:task-09:acc-0-f2b7b04e
  tests: frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active
- row: 2026-10-10-workspace-ref-intake:task-09:acc-1-e7a99eae
  tests: frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active

## FR-auto-frontend-189 三输入区一致
变更：2026-10-10-workspace-ref-intake
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given 单聊（session-input-bar）、预会话、群聊（group-chat-panel）任一输入区；Then FR-01/02/03/06 行为一致（同一槽位契约与置换接线）
全文：.sillyspec/changes/archive/2026-10-10-workspace-ref-intake/requirements.md#FR-08
最近确认：38bb5b21e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-workspace-ref-intake:task-08:acc-0-449ccf0e
  tests: frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active
- row: 2026-10-10-workspace-ref-intake:task-08:acc-1-f91784ba
  tests: frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspace-ref-intake
  status: active

## FR-auto-frontend-163 输入框内引用标签（附件/文件/目录/代码块）文本形如【📄 name】，图标与文字同处文本流零错位
变更：2026-10-12-ws-ref-emoji-inline
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 输入区经右键/槽位插入任一类型引用 / When token 渲染 / Then textarea 纯文本与 overlay 占位文本同串同宽（emoji 为文
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-emoji-inline/requirements.md#FR-01
最近确认：20058a3a97f47a4daab0165f5264f62f9fb442de

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-emoji-inline:flow:测试绑定FR-01
  tests: test/frontend/src/components/daemon/__tests__/attachment-refs.test.ts「基名 = 名称(+行号段无 L 前缀)；seq>1 加 ·N；emoji 按类型内嵌（📄/📁/🧾）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-emoji-inline
  status: active

## FR-auto-frontend-164 overlay 左上角类型角标移除，悬停 tooltip 元数据仍显示类型+路径+行号
变更：2026-10-12-ws-ref-emoji-inline
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 标签在场且指针悬停命中 / When hitTest 命中 / Then data-ws-ref-hover-tip 气泡渲染 title 文本；移出 → 气泡
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-emoji-inline/requirements.md#FR-02
最近确认：20058a3a97f47a4daab0165f5264f62f9fb442de

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-emoji-inline:flow:测试绑定FR-02
  tests: test/frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「hoverTip 传入时渲染 fixed 元数据气泡；null 时零渲染」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-emoji-inline
  status: active

## FR-auto-frontend-165 同名 ·2 唯一化口径不因 emoji 前缀失效（手打【name】与槽位插入【📄 name】按基名正确撞池）
变更：2026-10-12-ws-ref-emoji-inline
状态：active
摘要：同名碰撞
场景正文：
- 场景：同名碰撞 — 
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-emoji-inline/requirements.md#FR-03
最近确认：20058a3a97f47a4daab0165f5264f62f9fb442de

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-emoji-inline:flow:测试绑定FR-03
  tests: test/frontend/src/components/daemon/__tests__/attachment-refs.test.ts「同类型同名才互斥 ·2（emoji 前缀参与占用文本整体比对）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-emoji-inline
  status: active

## FR-auto-frontend-166 发送置换产物不变（map 全文匹配），退格整删/× 删除对新 token 形态正确
变更：2026-10-12-ws-ref-emoji-inline
状态：active
摘要：发送与删除
场景正文：
- 场景：发送与删除 — Given token【🧾 a.py:10-16】在场 / When 发送 / Then 置换为 [代码引用:wid|path|L10-L16]；贴尾退格一次整删整枚 t
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-emoji-inline/requirements.md#FR-04
最近确认：20058a3a97f47a4daab0165f5264f62f9fb442de

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-emoji-inline:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「× 角标 aria-label 剥离内嵌 emoji 前缀（提示语只留名称）」 | test/frontend/src/components/daemon/__tests__/attachment-refs.test.ts「file/dir/code 三类 token 置换为对应正式标记（emoji 内嵌形态全文匹配）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-emoji-inline
  status: active

## FR-auto-frontend-167 既有相关测试同步更新全绿，无引用时零视觉差异
变更：2026-10-12-ws-ref-emoji-inline
状态：active
摘要：零回归
场景正文：
- 场景：零回归 — Given 无引用 / Then overlay 不渲染（tokens 空返回 null），hoverTip 无渲染。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-emoji-inline/requirements.md#FR-05
最近确认：20058a3a97f47a4daab0165f5264f62f9fb442de

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-emoji-inline:flow:测试绑定FR-05
  tests: frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx | test/frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-emoji-inline
  status: active

## FR-auto-frontend-168 点击标签内部任意位置，光标吸附到标签前或后边界（不进入内部）
变更：2026-10-12-ws-ref-atomic-caret
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 标签在场且光标被点击/键盘落入内部 / When 落位吸附触发 / Then selectionStart 位于标签边界之一。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-atomic-caret/requirements.md#FR-01
最近确认：6199917b53ffc249caab23f350cb796e863a5a37

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-atomic-caret:flow:测试绑定FR-01
  tests: test/frontend/src/components/daemon/__tests__/use-atomic-ref-caret.test.tsx「光标落入标签前半 → 吸附块头；后半 → 吸附块尾」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-atomic-caret
  status: active

## FR-auto-frontend-169 左/右方向键在标签边界处一次跳过整块（贴尾按左到块头，贴头按右到块尾）；shift 选区扩展不受影响
变更：2026-10-12-ws-ref-atomic-caret
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 光标贴标签尾 / When 按 ← / Then 光标到块头；对称 → 从块头到块尾。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-atomic-caret/requirements.md#FR-02
最近确认：6199917b53ffc249caab23f350cb796e863a5a37

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-atomic-caret:flow:测试绑定FR-02
  tests: test/frontend/src/components/daemon/__tests__/use-atomic-ref-caret.test.tsx「贴尾按 ← 跳到块头；再按一次才离开标签」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-atomic-caret
  status: active

## FR-auto-frontend-170 标签内部打字/删字/IME 组字/粘贴（目标 range 与标签部分重叠）一律拒绝；选区完整覆盖整块的删除放行
变更：2026-10-12-ws-ref-atomic-caret
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 目标 range 部分触碰标签 / When beforeinput / Then 输入被拒绝、value 不变；Given range 完整覆盖标签 / Th
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-atomic-caret/requirements.md#FR-03
最近确认：6199917b53ffc249caab23f350cb796e863a5a37

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-atomic-caret:flow:测试绑定FR-03
  tests: test/frontend/src/components/daemon/__tests__/use-atomic-ref-caret.test.tsx「标签内部打字/删字（部分重叠）拒绝」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-atomic-caret
  status: active

## FR-auto-frontend-171 Home/End/Ctrl+方向落入标签内部时兜底吸附到最近边界
变更：2026-10-12-ws-ref-atomic-caret
状态：active
摘要：兜底
场景正文：
- 场景：兜底 — Given Home 落入标签内部 / When select 事件触发吸附 / Then 光标到最近边界。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-atomic-caret/requirements.md#FR-04
最近确认：6199917b53ffc249caab23f350cb796e863a5a37

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-atomic-caret:flow:测试绑定FR-04
  tests: test/frontend/src/components/daemon/__tests__/use-atomic-ref-caret.test.tsx「光标落入标签前半 → 吸附块头」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-atomic-caret
  status: active

## FR-auto-frontend-172 退格贴尾整删/× 角标删除/发送置换等既有行为零回归
变更：2026-10-12-ws-ref-atomic-caret
状态：active
摘要：零回归
场景正文：
- 场景：零回归 — Given 贴尾按退格 / Then 整枚标签删除（既有）；Given 联想浮层激活 / Then ↑↓/Enter/Tab/Esc 归浮层（既有）。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-atomic-caret/requirements.md#FR-05
最近确认：6199917b53ffc249caab23f350cb796e863a5a37

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-atomic-caret:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/session-input-bar-mention.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx | test/frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-atomic-caret
  status: active

## FR-auto-frontend-173 单聊+群聊两输入区一致；相关测试全绿
变更：2026-10-12-ws-ref-atomic-caret
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 群聊输入框 / Then 与单聊同款跳块/吸附/拒绝行为。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-atomic-caret/requirements.md#FR-06
最近确认：6199917b53ffc249caab23f350cb796e863a5a37

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-atomic-caret:flow:测试绑定FR-06
  tests: test/frontend/src/components/daemon/__tests__/use-atomic-ref-caret.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-atomic-caret
  status: active

## FR-auto-frontend-190 Write 工具展开区在有 edit_patch（structuredPatch）时渲染红删绿增 DiffView，与 Edit 分支同管线
变更：2026-10-13-write-tool-diff
状态：active
摘要：覆盖写真实 diff
场景正文：
- 场景：覆盖写真实 diff — Given 一条带合法 editPatch 的 Write 工具段（覆盖已有文件）；When 用户展开该工具卡；Then 删除行红底（仅旧侧行号）、新增行绿底（仅新侧行号），标题含「变更对比」，且保留复制完整原文按钮
全文：.sillyspec/changes/archive/2026-10-13-write-tool-diff/requirements.md#FR-01
最近确认：757aad15b51c9a47acc9ce4bb23c680a88d6742e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-write-tool-diff:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx「有 editPatch：structuredPatch 红删绿增渲染（覆盖写真实 diff），标题含「变更对比」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-write-tool-diff
  status: active

## FR-auto-frontend-191 无 edit_patch 时整文件按新增行全绿展示，保留复制内容按钮
变更：2026-10-13-write-tool-diff
状态：active
摘要：新建文件全绿展示
场景正文：
- 场景：新建文件全绿展示 — Given 无 editPatch 的 Write 工具段（新建文件或非 claude provider）；When 用户展开该工具卡；Then 内容行全部绿底 add 展示、标题「写入内容（N 行）」、复制按钮复制完整原文；超 2000 行时 DiffView 截断护栏生效且复制仍完整
全文：.sillyspec/changes/archive/2026-10-13-write-tool-diff/requirements.md#FR-02
最近确认：757aad15b51c9a47acc9ce4bb23c680a88d6742e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-write-tool-diff:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx「无 editPatch：整文件按新增行全绿展示（新侧行号自 1 起计）+ 复制内容按钮」 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「Write 超长内容：diff 行 2000 行截断护栏（DiffView 复用），复制仍带完整原文」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-write-tool-diff
  status: active

## FR-auto-frontend-192 相关前端测试通过，不改动 Edit 分支现有行为
变更：2026-10-13-write-tool-diff
状态：active
摘要：Edit 接线回归
场景正文：
- 场景：Edit 接线回归 — Given 既有 tool-args-detail / turn-segment-views 测试套件；When 跑这两个文件的全部用例；Then 全绿——Edit 既有用例零改动通过，Write 用例按新契约通过，`pnpm typecheck` 零错误
全文：.sillyspec/changes/archive/2026-10-13-write-tool-diff/requirements.md#FR-03
最近确认：757aad15b51c9a47acc9ce4bb23c680a88d6742e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-write-tool-diff:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx「parseStructuredPatch」组 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「Edit 展开渲染行级 diff：红底 - 旧行 / 绿底 + 新行 + 双侧行号列，不再是两个裸代码块」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-write-tool-diff
  status: active

## FR-auto-frontend-193 子代理容器头(stub 与无任务元数据且运行中的 tool 段)按 tool_use_id 匹配任务快照:匹配到终态行时徽章/状态点/时长按快照展示(已完成/失败/已停止+权威时长),不再恒显「运行中」;无匹配维持现状
变更：2026-10-13-subagent-stub-reconcile
状态：active
摘要：历史 stub 段对账收敛；快照无匹配
全文：.sillyspec/changes/archive/2026-10-13-subagent-stub-reconcile/requirements.md#FR-01
最近确认：d8473ae21044785fe944065eaa431147d0b5a82e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-subagent-stub-reconcile:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/subagent-task-reconcile.test.ts「buildSubagentTaskLookup 终态优先/stub 命中终态收敛/未命中维持现状」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-subagent-stub-reconcile
  status: active

## FR-auto-frontend-194 容器头名称优先快照 task_name(真实任务名),stub 不再显示类型名 general-purpose;无匹配维持 subagentType 回退
变更：2026-10-13-subagent-stub-reconcile
状态：active
摘要：stub 名称显示真实任务名
全文：.sillyspec/changes/archive/2026-10-13-subagent-stub-reconcile/requirements.md#FR-02
最近确认：d8473ae21044785fe944065eaa431147d0b5a82e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-subagent-stub-reconcile:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/subagent-task-reconcile.test.ts「stub 名称显示快照 task_name」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-subagent-stub-reconcile
  status: active

## FR-auto-frontend-195 有任务元数据的 tool 段与已配对结果的段行为不变(零回归);补前端回归测试
变更：2026-10-13-subagent-stub-reconcile
状态：active
摘要：优先级与回归防线
全文：.sillyspec/changes/archive/2026-10-13-subagent-stub-reconcile/requirements.md#FR-03
最近确认：d8473ae21044785fe944065eaa431147d0b5a82e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-subagent-stub-reconcile:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/subagent-task-reconcile.test.ts「tool 段三优先级(元数据>对账>三态)」 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-subagent-stub-reconcile
  status: active

## FR-auto-frontend-196 轮次很多(内容高超过面板高)时窄轨刻度不再溢出面板,超出部分在轨内滚动(turn-nav-rail 去掉 shrink-0,nav flex-1+overflow-y-auto 真正生效)
变更：2026-10-13-turn-nav-rail-overflow-fix
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 53 轮长会话（刻度内容高 > 面板剩余高） / When 打开会话页 desktop 面板 / Then 刻度止于聊天区底缘，全部刻度可在轨内滚动查看，输入区
全文：.sillyspec/changes/archive/2026-10-13-turn-nav-rail-overflow-fix/requirements.md#FR-01
最近确认：79968f77eb4ed6dc337f3c7fd2bd0bec5045acda

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-nav-rail-overflow-fix:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「turn-nav-rail 不带 shrink-0（长会话轨道可随面板高度收缩，不溢出叠到输入区）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-nav-rail-overflow-fix
  status: active

## FR-auto-frontend-197 轨内滚动不显示滚动条(与 turn-catalog 同款 scrollbar-width:none + webkit hidden)
变更：2026-10-13-turn-nav-rail-overflow-fix
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 轮次超出可视高度触发轨内滚动 / When 用户在窄轨滚动查看 / Then 轨道右缘不出现可见滚动条（44px 窄轨视觉不变）。
全文：.sillyspec/changes/archive/2026-10-13-turn-nav-rail-overflow-fix/requirements.md#FR-02
最近确认：79968f77eb4ed6dc337f3c7fd2bd0bec5045acda

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-nav-rail-overflow-fix:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「turn-nav-rail-ticks 轨内滚动且隐藏滚动条（与 turn-catalog 同款）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-nav-rail-overflow-fix
  status: active

## FR-auto-frontend-198 少量轮次时形态不变(44px 窄轨+把手+居中刻度,浮层行为不受影响)
变更：2026-10-13-turn-nav-rail-overflow-fix
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 3 轮短会话 / When 打开会话页 / Then 窄轨高度=内容高、刻度居中，悬停/pin 展开浮层（top-0 bottom-0 absolute）行为与
全文：.sillyspec/changes/archive/2026-10-13-turn-nav-rail-overflow-fix/requirements.md#FR-03
最近确认：79968f77eb4ed6dc337f3c7fd2bd0bec5045acda

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-nav-rail-overflow-fix:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「密集刻度契约：>60 轮刻度 mini（h-1.5），≤60 轮常规（h-2.5）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-nav-rail-overflow-fix
  status: active

## FR-auto-frontend-199 turn-nav-list 单测补齐布局契约断言(rail 无 shrink-0、nav 可滚动+滚动条隐藏),既有测试全绿
变更：2026-10-13-turn-nav-rail-overflow-fix
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 修复后的 turn-nav-list.tsx / When 运行 `pnpm vitest run src/components/sessions/__test
全文：.sillyspec/changes/archive/2026-10-13-turn-nav-rail-overflow-fix/requirements.md#FR-04
最近确认：79968f77eb4ed6dc337f3c7fd2bd0bec5045acda

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-nav-rail-overflow-fix:flow:测试绑定FR-04
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-nav-rail-overflow-fix
  status: active

## FR-auto-frontend-200 首挂载带 activeTurnKey 时窄轨刻度立即 scrollIntoView(block:nearest) 对齐当前轮
变更：2026-10-13-turn-nav-initial-scroll
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 53 轮长会话、activeTurnKey=最新轮 / When 打开会话页桌面面板（窄轨首挂载） / Then 当前轮刻度被滚入轨内可视区（scrollInt
全文：.sillyspec/changes/archive/2026-10-13-turn-nav-initial-scroll/requirements.md#FR-01
最近确认：ca86e918a7762cc0b88ec32abe61616ea3ed56dd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-nav-initial-scroll:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「activeTurnKey 命中刻度/行 aria-current=true；首挂载即滚对齐当前轮，变化时轨内 scrollIntoView（block:nearest）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-nav-initial-scroll
  status: active

## FR-auto-frontend-201 activeTurnKey 为 null(无活跃轮)首挂载不滚
变更：2026-10-13-turn-nav-initial-scroll
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 3 轮短会话、activeTurnKey=null / When 组件首挂载 / Then scrollIntoView 零调用。
全文：.sillyspec/changes/archive/2026-10-13-turn-nav-initial-scroll/requirements.md#FR-02
最近确认：ca86e918a7762cc0b88ec32abe61616ea3ed56dd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-nav-initial-scroll:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「首挂载 activeTurnKey=null 不滚（无活跃轮无对齐目标）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-nav-initial-scroll
  status: active

## FR-auto-frontend-202 active 变化/hover 指向/浮层展开的既有滚动联动语义不变
变更：2026-10-13-turn-nav-initial-scroll
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 指向第 3 轮刻度触发展开浮层 / When 指向行与 active 行切换 / Then 刻度与浮层行两元素均按指向优先/回落 active 语义滚入（与 2
全文：.sillyspec/changes/archive/2026-10-13-turn-nav-initial-scroll/requirements.md#FR-03
最近确认：ca86e918a7762cc0b88ec32abe61616ea3ed56dd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-nav-initial-scroll:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「指向行滚入可视区（指向优先 scrollIntoView block:nearest）；指向清除后回落 active 联动」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-nav-initial-scroll
  status: active

## FR-auto-frontend-203 既有「首渲不滚」测试断言按新行为更新(行为有意变更,非为绿改测试),turn-nav-list 全绿
变更：2026-10-13-turn-nav-initial-scroll
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 更新后的实现与测试 / When 运行 `pnpm vitest run src/components/sessions/__tests__/turn-nav-
全文：.sillyspec/changes/archive/2026-10-13-turn-nav-initial-scroll/requirements.md#FR-04
最近确认：ca86e918a7762cc0b88ec32abe61616ea3ed56dd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-nav-initial-scroll:flow:测试绑定FR-04
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-nav-initial-scroll
  status: active

## FR-auto-frontend-204 antd Select 下拉 DOM 挂进宫 DialogContent 内（getPopupContainer=closest role=dialog），真实浏览器中选项可点击切换变更
变更：2026-10-13-session-changefiles-select-fix
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 悬浮面板弹窗已打开（radix Dialog modal 模式，body pointer-events:none）；When 用户点开头部变更切换下拉；Then 下拉项 DOM 位于 `[role="dialog"]` 内（可点击、不触发弹窗 outside-close）
全文：.sillyspec/changes/archive/2026-10-13-session-changefiles-select-fix/requirements.md#FR-01
最近确认：bc898a68c4dac4dd9fba71daa57cb317429efc50

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-session-changefiles-select-fix:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「弹窗头部 Select 切换变更：ChangeFileTree key 重挂载换 changeId」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-session-changefiles-select-fix
  status: active

## FR-auto-frontend-205 下拉选择后 ChangeFileTree 以新 changeId 重挂载（既有切换用例保持全绿并加挂载位置断言）
变更：2026-10-13-session-changefiles-select-fix
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 弹窗内当前展示变更 A 的文件树；When 通过下拉选中变更 B；Then ChangeFileTree 重挂载为 changeId=B（autoRefreshMs=15000 不变），选项元素经断言确认在弹窗 DOM 内
全文：.sillyspec/changes/archive/2026-10-13-session-changefiles-select-fix/requirements.md#FR-02
最近确认：bc898a68c4dac4dd9fba71daa57cb317429efc50

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-session-changefiles-select-fix:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「弹窗头部 Select 切换变更：ChangeFileTree key 重挂载换 changeId」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-session-changefiles-select-fix
  status: active

## FR-auto-frontend-206 轻量变更（is_thin 且 current_stage=thin）的阶段标签显示「干活中」不再「轻量·轻量变更」重复
变更：2026-10-13-session-changefiles-select-fix
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 关联变更为轻量变更进行中（is_thin=true 且 current_stage=thin）；When 悬浮下拉渲染该项；Then 阶段 pill 文本为「干活中」，页面无「轻量变更」文本
全文：.sillyspec/changes/archive/2026-10-13-session-changefiles-select-fix/requirements.md#FR-03
最近确认：bc898a68c4dac4dd9fba71daa57cb317429efc50

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-session-changefiles-select-fix:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「轻量变更进行中（current_stage=thin）阶段标签为「干活中」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-session-changefiles-select-fix
  status: active

## FR-auto-frontend-207 前端聚焦测试全绿 + tsc 0 错
变更：2026-10-13-session-changefiles-select-fix
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 修复代码与测试就位；When 跑悬浮组件测试文件 + tsc；Then 用例全绿（含新增「干活中」用例与下拉挂载位置断言），tsc 零错误
全文：.sillyspec/changes/archive/2026-10-13-session-changefiles-select-fix/requirements.md#FR-04
最近确认：bc898a68c4dac4dd9fba71daa57cb317429efc50

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-session-changefiles-select-fix:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-session-changefiles-select-fix
  status: active

## FR-auto-frontend-208 splitByArchive 与 stageLabel 的归档判定对齐平台双条件口径（status==='archived' 或 location==='archive' 任一命中即归已归档/显示已归档）
变更：2026-10-13-session-changefiles-archive-gate
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 关联变更的 status='archived' 而 location 仍为 'active'（平台 status 侧信号先到、reparse 未收敛）；When 打开悬浮下拉；Then 该变更归入「已归档」组（默认折叠可展开），阶段标签显示「已归档」而非「干活中」
全文：.sillyspec/changes/archive/2026-10-13-session-changefiles-archive-gate/requirements.md#FR-01
最近确认：12c4cb4c9f30ce86631ca5388bd79f74ea20fe52

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-session-changefiles-archive-gate:flow:测试绑定FR-01
  tests: test/frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「status=archived 而 location=active 的变更归入已归档组（用户实测：平台已归档但仍显示进行中）」

## FR-auto-frontend-208 触顶加载一页后，若页顶边界切在轮中间，该轮被完整加载（拉全整轮行并合并装配成一个轮块，含提问）
变更：2026-10-13-load-earlier-full-turn
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 初始窗口满页且翻页页满页、页顶最旧行与其紧邻更早行同 run，When 触顶触发
全文：.sillyspec/changes/archive/2026-10-13-load-earlier-full-turn/requirements.md#FR-01
最近确认：a20ae3e3dea00f945697455f3c920858fcf01da5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-load-earlier-full-turn:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-panel-load-earlier-full-turn.test.tsx「窗口跨界 + 页顶跨界轮直达整轮合并：提问出现、旧行单显、窗口同轮旧块被摘」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-session-changefiles-archive-gate
  status: active

## FR-auto-frontend-209 新增用例：status=archived 且 location=active 的变更归入已归档组、不计数进行中徽标、阶段标签显示「已归档」
变更：2026-10-13-session-changefiles-archive-gate
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 测试数据含 status=archived 且 location=active 的变更；When 渲染面板并展开归档组；Then 进行中计数为 0、归档组含该项、标签「已归档」、页面无「干活中」文本
全文：.sillyspec/changes/archive/2026-10-13-session-changefiles-archive-gate/requirements.md#FR-02
最近确认：12c4cb4c9f30ce86631ca5388bd79f74ea20fe52

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-session-changefiles-archive-gate:flow:测试绑定FR-02
  tests: test/frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「双条件口径：status=archived 而 location=active（status 侧先到）也归归档组」
  source_change: 2026-10-13-load-earlier-full-turn
  status: active

## FR-auto-frontend-209 回到会话开头到头后，顶部第一轮完整（跨页/跨窗口边界的轮合并为单块显示）
变更：2026-10-13-load-earlier-full-turn
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 会话历史跨多页且存在跨边界轮，When 点击「回到会话开头」到头，Then 顶部
全文：.sillyspec/changes/archive/2026-10-13-load-earlier-full-turn/requirements.md#FR-02
最近确认：a20ae3e3dea00f945697455f3c920858fcf01da5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-load-earlier-full-turn:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「回到会话开头（2026-10-10-single-turn-nav-and-jump-head）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-session-changefiles-archive-gate
  status: active

## FR-auto-frontend-210 既有 8 用例保持全绿 + tsc 0 错
变更：2026-10-13-session-changefiles-archive-gate
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 修复与新增用例就位；When 跑组件测试文件 + tsc；Then 10/10 全绿、tsc 0 错
全文：.sillyspec/changes/archive/2026-10-13-session-changefiles-archive-gate/requirements.md#FR-03
最近确认：12c4cb4c9f30ce86631ca5388bd79f74ea20fe52

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-session-changefiles-archive-gate:flow:测试绑定FR-03
  tests: test/frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx
  source_change: 2026-10-13-load-earlier-full-turn
  status: active

## FR-auto-frontend-210 跨「已加载窗口与翻页页」边界的轮同样合并，不再出现同轮分裂双块
变更：2026-10-13-load-earlier-full-turn
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 轮 A 的后半段在已加载窗口（终态块）、前半段在翻页页内，When 触顶加载，；Then A 收敛为单个完整块，窗口内 A 旧块不再渲染（文本单显不双条）。
全文：.sillyspec/changes/archive/2026-10-13-load-earlier-full-turn/requirements.md#FR-03
最近确认：a20ae3e3dea00f945697455f3c920858fcf01da5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-load-earlier-full-turn:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-panel-load-earlier-full-turn.test.tsx「窗口跨界 + 页顶跨界轮直达整轮合并：提问出现、旧行单显、窗口同轮旧块被摘」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-session-changefiles-archive-gate
  status: active

## FR-auto-frontend-211 四个入口页面不再渲染可见的标题/副标题文字块（DOM 中不再出现该副标题文案，标题仅保留无障碍隐藏语义）。
变更：2026-10-13-sessions-portal-header-remove
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 任意用户打开 /sessions（或三 scoped 入口任一，不区分登录后数据多少） / When 页面渲染完成 / Then 视口顶部不存在「智能体会话…」
全文：.sillyspec/changes/archive/2026-10-13-sessions-portal-header-remove/requirements.md#FR-01
最近确认：c7a48c2e1a9d161b1f79bdff052013cdc77fb317

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-sessions-portal-header-remove:flow:测试绑定FR-01
  tests: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx「无选中：左会话列表 + 右空门户态 + 页标题语义（sr-only，页头块 2026-10-13 移除）」
  source_change: 2026-10-13-load-earlier-full-turn
  status: active

## FR-auto-frontend-211 直达请求失败时静默降级为现状行为（照常 prepend 当页），不报错不卡死
变更：2026-10-13-load-earlier-full-turn
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 跨界轮的直达请求 reject，When 触顶加载完成，Then 当页内容照常渲染（现状
全文：.sillyspec/changes/archive/2026-10-13-load-earlier-full-turn/requirements.md#FR-04
最近确认：a20ae3e3dea00f945697455f3c920858fcf01da5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-load-earlier-full-turn:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-panel-load-earlier-full-turn.test.tsx「直达失败 → 静默降级：当页原样 prepend，不报错不卡死」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-sessions-portal-header-remove
  status: active

## FR-auto-frontend-212 标题块移除后，下方左列表＋右面板分栏容器向上占满可用视口高度，无标题占位留下的空白。
变更：2026-10-13-sessions-portal-header-remove
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 1440×900 视口打开 /sessions（全局 scope；workspace scope 同判定，其分栏顶边在紧凑 Git 条行之下——FR-03 优先
全文：.sillyspec/changes/archive/2026-10-13-sessions-portal-header-remove/requirements.md#FR-02
最近确认：c7a48c2e1a9d161b1f79bdff052013cdc77fb317

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-sessions-portal-header-remove:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「页头标题块移除（2026-10-13-sessions-portal-header-remove）：副标题文案不再渲染、标题降级 sr-only、分栏 flex-1 占满视口高度」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-sessions-portal-header-remove
  status: active

## FR-auto-frontend-213 workspace scope 的紧凑 Git 状态条功能不回归（仍渲染且可查询到）。
变更：2026-10-13-sessions-portal-header-remove
状态：active
摘要：主路径；边界
场景正文：
- 场景：主路径 — Given workspace scope 门户（干净工作区固件） / When 页面渲染 / Then `git-status-bar` 存在且 `data-varian
- 场景：边界 — Given 本机无 backend / daemon 的真页渲染取证（route mock） / When 打开 /workspaces/ws-1/sessions / T
全文：.sillyspec/changes/archive/2026-10-13-sessions-portal-header-remove/requirements.md#FR-03
最近确认：c7a48c2e1a9d161b1f79bdff052013cdc77fb317

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-sessions-portal-header-remove:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「workspace scope：列表走 listAgentSessions({limit, workspace_id})，标题「智能体会话 · 工作区」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-sessions-portal-header-remove
  status: active

## FR-auto-frontend-214 相关单测更新并通过（sessions-portal / sessions page 冒烟），不破坏其它会话功能断言。
变更：2026-10-13-sessions-portal-header-remove
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 改动后的工作区 / When `pnpm -C frontend exec vitest run src/components/sessions/__tests
全文：.sillyspec/changes/archive/2026-10-13-sessions-portal-header-remove/requirements.md#FR-04
最近确认：c7a48c2e1a9d161b1f79bdff052013cdc77fb317

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-sessions-portal-header-remove:flow:测试绑定FR-04
  tests: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  source_change: 2026-10-13-load-earlier-full-turn
  status: active

## FR-auto-frontend-212 运行中的轮（当前 currentRunId）不做合并重建，保持现状路径
变更：2026-10-13-load-earlier-full-turn
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 当前轮超长横跨窗口最旧行边界（历史段在翻页方向），When 触顶加载，Then 该轮
全文：.sillyspec/changes/archive/2026-10-13-load-earlier-full-turn/requirements.md#FR-05
最近确认：a20ae3e3dea00f945697455f3c920858fcf01da5

## FR-auto-frontend-213 既有翻页/跳转/回到开头相关测试全部保持通过
变更：2026-10-13-load-earlier-full-turn
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given main 基线测试状态，When 应用本次变更，Then 除基线存量失败外无新增失败，
全文：.sillyspec/changes/archive/2026-10-13-load-earlier-full-turn/requirements.md#FR-06
最近确认：a20ae3e3dea00f945697455f3c920858fcf01da5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-load-earlier-full-turn:flow:测试绑定FR-06
  tests: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx | frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx | frontend/src/components/daemon/__tests__/session-panel-history-race.test.tsx | frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-sessions-portal-header-remove
  source_change: 2026-10-13-load-earlier-full-turn
  status: active

## FR-auto-frontend-215 「连续 before 翻页到头」用例 mock 必须对 limit=1 页顶探查返回空响应且不计入 beforeCursors
变更：2026-10-14-ci-flaky-probe-mock
状态：active
摘要：满页翻页含探查的完整序列
全文：.sillyspec/changes/archive/2026-10-14-ci-flaky-probe-mock/requirements.md#FR-01
最近确认：0756c886494656426818263e03a6520f548b4185

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-ci-flaky-probe-mock:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「点击回到会话开头：连续 before 翻页到头并定位顶部（FR-03）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-ci-flaky-probe-mock
  status: active

## FR-auto-frontend-216 该用例及同文件全部 11 用例必须本地转绿，且断言不再依赖竞速窗口
变更：2026-10-14-ci-flaky-probe-mock
状态：active
摘要：CI 慢机下断言稳定
全文：.sillyspec/changes/archive/2026-10-14-ci-flaky-probe-mock/requirements.md#FR-02
最近确认：0756c886494656426818263e03a6520f548b4185

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-ci-flaky-probe-mock:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「点击回到会话开头：连续 before 翻页到头并定位顶部（FR-03）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-ci-flaky-probe-mock
  status: active

## FR-auto-frontend-217 零生产代码改动
变更：2026-10-14-ci-flaky-probe-mock
状态：active
摘要：交付面审查
全文：.sillyspec/changes/archive/2026-10-14-ci-flaky-probe-mock/requirements.md#FR-03
最近确认：0756c886494656426818263e03a6520f548b4185

## FR-auto-frontend-218 6 处确认脆弱点全部改为渲染锚等待：同步 getByXxx/textContent 断言包进 await waitFor（或等价 findByXxx），断言不再早于渲染提交
变更：2026-10-14-ci-flaky-render-anchor-sweep
状态：active
摘要：mock 调用早于渲染提交的慢机形态
全文：.sillyspec/changes/archive/2026-10-14-ci-flaky-render-anchor-sweep/requirements.md#FR-01
最近确认：26bd59982827d1622c7b52e30f0c7ff7fa5a431c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-ci-flaky-render-anchor-sweep:flow:测试绑定FR-01
  tests: frontend/src/components/ask-user-dialog-card.test.tsx「409 已回答关闭提示两变体」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-ci-flaky-render-anchor-sweep
  status: active

## FR-auto-frontend-219 涉及 5 个测试文件本地全量转绿
变更：2026-10-14-ci-flaky-render-anchor-sweep
状态：active
摘要：定向回归
全文：.sillyspec/changes/archive/2026-10-14-ci-flaky-render-anchor-sweep/requirements.md#FR-02
最近确认：26bd59982827d1622c7b52e30f0c7ff7fa5a431c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-ci-flaky-render-anchor-sweep:flow:测试绑定FR-02
  tests: frontend/src/app/(dashboard)/settings/api-keys/__tests__/page.test.tsx「全文件」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-ci-flaky-render-anchor-sweep
  status: active

## FR-auto-frontend-220 零生产代码改动：仅测试文件时序加固
变更：2026-10-14-ci-flaky-render-anchor-sweep
状态：active
摘要：交付面审查
全文：.sillyspec/changes/archive/2026-10-14-ci-flaky-render-anchor-sweep/requirements.md#FR-03
最近确认：26bd59982827d1622c7b52e30f0c7ff7fa5a431c

## FR-frontend-001 图谱分区卡头新增层级选择器（1跳/2跳/3跳 三档 chips），默认 1 跳；点击切换按所选深度重新发起 neighbors 查询（depth 参数进 query key，getKnowledgeGraphQuery 既有 depth 参数直通，零后端改动）；
变更：2026-10-15-assets-graph-depth
状态：active
摘要：切换深度重查询
全文：.sillyspec/changes/archive/2026-10-15-assets-graph-depth/requirements.md#FR-01
最近确认：2d3c285319fdf676ddfe02309fe7b19e69e1e48b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-assets-graph-depth:flow:测试绑定FR-01
  tests: frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx「层级选择器：默认 1 跳，点击 2跳/3跳 按所选深度重新发起 neighbors 查询」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-assets-graph-depth
  status: active

## FR-frontend-002 切换层级时用 keepPreviousData 保持上一份图渲染不闪空（仓内 changes 列表页先例）；深度切换后选中态回退锚点节点（原选中节点不在新切片时自然兜底，无悬空引用）；
变更：2026-10-15-assets-graph-depth
状态：active
摘要：切换不闪空
全文：.sillyspec/changes/archive/2026-10-15-assets-graph-depth/requirements.md#FR-02
最近确认：2d3c285319fdf676ddfe02309fe7b19e69e1e48b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-assets-graph-depth:flow:测试绑定FR-02
  tests: frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx「层级切换不闪空：keepPreviousData 保持上一份渲染」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-assets-graph-depth
  status: active

## FR-frontend-003 fail-open 语义随深度保持：新深度查询失败/空结果 → 整区隐藏（与既有口径一致）；
变更：2026-10-15-assets-graph-depth
状态：active
摘要：新深度失败隐藏
全文：.sillyspec/changes/archive/2026-10-15-assets-graph-depth/requirements.md#FR-03
最近确认：2d3c285319fdf676ddfe02309fe7b19e69e1e48b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-assets-graph-depth:flow:测试绑定FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-assets-graph-depth
  status: active

## FR-frontend-004 仅跑本改动相关测试（change-assets-graph + change-assets-card），全量留给 CI。
变更：2026-10-15-assets-graph-depth
状态：active
摘要：相关面全绿
全文：.sillyspec/changes/archive/2026-10-15-assets-graph-depth/requirements.md#FR-04
最近确认：2d3c285319fdf676ddfe02309fe7b19e69e1e48b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-assets-graph-depth:flow:测试绑定FR-04
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-assets-graph-depth
  status: active

## FR-frontend-005 storage 回放改为只回放与本地当前状态实际不同的字段，回放值与本地完全一致时不调用 setState（不产生 localStorage 写盘），切断乒乓环路
变更：2026-10-17-session-replay-pingpong-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-session-replay-pingpong-fix/requirements.md#FR-01
最近确认：ec360c91bacb3ba997a8249f7c3e6d015d2f3e78

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-session-replay-pingpong-fix:flow:测试绑定FR-01
  tests: frontend/src/stores/session.test.ts「同值回放（user 经 JSON 往返产生新引用）静默跳过：不改状态、不写 localStorage」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-session-replay-pingpong-fix
  status: active

## FR-frontend-006 真实跨标签同步语义保留：对方标签的 accessToken/refreshToken/user 真实变化仍正确回放到本页
变更：2026-10-17-session-replay-pingpong-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-session-replay-pingpong-fix/requirements.md#FR-02
最近确认：ec360c91bacb3ba997a8249f7c3e6d015d2f3e78

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-session-replay-pingpong-fix:flow:测试绑定FR-02
  tests: frontend/src/stores/session.test.ts「仅 token 变化时只回放 token（本页 user 对象引用保持不动）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-session-replay-pingpong-fix
  status: active

## FR-frontend-007 新增单测覆盖：同值回放跳过、异值回放生效、部分字段差异只回放差异字段
变更：2026-10-17-session-replay-pingpong-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-session-replay-pingpong-fix/requirements.md#FR-03
最近确认：ec360c91bacb3ba997a8249f7c3e6d015d2f3e78

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-session-replay-pingpong-fix:flow:测试绑定FR-03
  tests: frontend/src/stores/session.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-session-replay-pingpong-fix
  status: active

## FR-frontend-008 既有 token-refresh 等相关测试不回归
变更：2026-10-17-session-replay-pingpong-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-session-replay-pingpong-fix/requirements.md#FR-04
最近确认：ec360c91bacb3ba997a8249f7c3e6d015d2f3e78

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-session-replay-pingpong-fix:flow:测试绑定FR-04
  tests: frontend/src/lib/__tests__/token-refresh.test.ts | frontend/src/stores/session.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-session-replay-pingpong-fix
  status: active

## FR-frontend-009 SessionState 新增单调 rev 计数器：setTokens/setUser/clear 三个用户驱动变更加一，storage 回放不自动加一而是采纳远端 rev
变更：2026-10-17-session-envelope-rev-stale-guard
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-session-envelope-rev-stale-guard/requirements.md#FR-01
最近确认：166ea374aaa46cc0045c43bb4cb71a25e87063fa

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-session-envelope-rev-stale-guard:flow:测试绑定FR-01
  tests: frontend/src/stores/session.test.ts「用户驱动变更加一：setTokens/clear 各 +1，markHydrated 不加」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-session-envelope-rev-stale-guard
  status: active

## FR-frontend-010 回放守卫：远端信封 rev 严格小于本地 rev 时整体忽略（陈旧）；等于时走既有内容比对（同值静默）；大于时采纳内容并同步 rev；内容全等但 rev 更新时仅同步 rev
变更：2026-10-17-session-envelope-rev-stale-guard
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-session-envelope-rev-stale-guard/requirements.md#FR-02
最近确认：166ea374aaa46cc0045c43bb4cb71a25e87063fa

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-session-envelope-rev-stale-guard:flow:测试绑定FR-02
  tests: frontend/src/stores/session.test.ts「陈旧信封（rev 小于本地）整体忽略：内容不同也不采纳、不写盘」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-session-envelope-rev-stale-guard
  status: active

## FR-frontend-011 向后兼容：无 rev 字段的旧形状信封走既有内容比对路径，既有 6+3 用例语义不变
变更：2026-10-17-session-envelope-rev-stale-guard
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-session-envelope-rev-stale-guard/requirements.md#FR-03
最近确认：166ea374aaa46cc0045c43bb4cb71a25e87063fa

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-session-envelope-rev-stale-guard:flow:测试绑定FR-03
  tests: frontend/src/stores/session.test.ts「无 rev 旧形状信封 → 走既有内容比对路径（向后兼容）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-session-envelope-rev-stale-guard
  status: active

## FR-frontend-012 新增单测覆盖：陈旧忽略、新 rev 采纳并同步、同内容仅同步 rev、等值同内容静默、变更加一
变更：2026-10-17-session-envelope-rev-stale-guard
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-session-envelope-rev-stale-guard/requirements.md#FR-04
最近确认：166ea374aaa46cc0045c43bb4cb71a25e87063fa

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-session-envelope-rev-stale-guard:flow:测试绑定FR-04
  tests: frontend/src/stores/session.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-session-envelope-rev-stale-guard
  status: active

## FR-frontend-013 既有 token-refresh/session 测试不回归
变更：2026-10-17-session-envelope-rev-stale-guard
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-session-envelope-rev-stale-guard/requirements.md#FR-05
最近确认：166ea374aaa46cc0045c43bb4cb71a25e87063fa

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-session-envelope-rev-stale-guard:flow:测试绑定FR-05
  tests: frontend/src/lib/__tests__/token-refresh.test.ts | frontend/src/stores/session.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-session-envelope-rev-stale-guard
  status: active

## FR-frontend-014 改动文件清单超 5 条时显示「展开全部 N 个文件」按钮，点击展开完整清单，再点「收起」回到 5 条
变更：2026-10-19-assets-audit-expand-toggle
状态：active
摘要：主路径；大清单（用户实证）
全文：.sillyspec/changes/archive/2026-10-19-assets-audit-expand-toggle/requirements.md#FR-01
最近确认：c86998d373e27dba83a1ff8c4e7ed39924cad0c8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-assets-audit-expand-toggle:flow:测试绑定FR-01
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「归档留档：改动文件超 5 条可展开全部/收起」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-assets-audit-expand-toggle
  status: active

## FR-frontend-015 清单 5 条及以内不显示展开按钮，与其它分组形态一致
变更：2026-10-19-assets-audit-expand-toggle
状态：active
摘要：小清单
全文：.sillyspec/changes/archive/2026-10-19-assets-audit-expand-toggle/requirements.md#FR-02
最近确认：c86998d373e27dba83a1ff8c4e7ed39924cad0c8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-assets-audit-expand-toggle:flow:测试绑定FR-02
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「归档留档：清单 ≤5 条不显示展开按钮」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-assets-audit-expand-toggle
  status: active

## FR-frontend-016 既有分组交互、清单截断标注行为不变，聚焦测试全绿且 tsc 零错误
变更：2026-10-19-assets-audit-expand-toggle
状态：active
摘要：回归面
全文：.sillyspec/changes/archive/2026-10-19-assets-audit-expand-toggle/requirements.md#FR-03
最近确认：c86998d373e27dba83a1ff8c4e7ed39924cad0c8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-assets-audit-expand-toggle:flow:测试绑定FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「归档留档：清单渲染 + 点开命中文件出 diff 弹窗（FR-04）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-assets-audit-expand-toggle
  status: active

## FR-auto-frontend-268 决策 pill 入口与显隐
变更：2026-10-16-session-decision-pill
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 会话面板处于真会话态（sessionId 非空）；When 当前会话存在任一决策信息（pending 提问/Plan 审批，或已答历史非空且已加载）；Then 输入条上方右侧渲染"待决策"悬浮 pill（与变更文件 pill 并排同一悬浮行），计数徽标 = 当前待决策数（pending 提问 + plan 审批 + p
全文：.sillyspec/changes/archive/2026-10-16-session-decision-pill/requirements.md#FR-01
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-decision-pill:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「三类全空（pending 空 + 历史空/未加载）不渲染入口（FR-01）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-decision-pill
  status: active

## FR-auto-frontend-269 分组下拉列表
变更：2026-10-16-session-decision-pill
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given pill 已渲染；When 用户 hover（或触屏点击）pill；Then 弹出分组下拉：待决策（N）置顶——每项显示问题标题（resolvePendingTitle 同口径）、类型徽标（plan_approval/planPendin
全文：.sillyspec/changes/archive/2026-10-16-session-decision-pill/requirements.md#FR-02
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-decision-pill:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「hover 弹下拉：待决策置顶（提问/Plan 徽标），已答历史默认折叠（FR-02）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-decision-pill
  status: active

## FR-auto-frontend-270 pending 项点击定位还原
变更：2026-10-16-session-decision-pill
状态：active
摘要：默认场景
依据决策：D-002@v2、D-004@v1
场景正文：
- 场景：默认场景 — Given 下拉打开且待决策组非空；When 用户点击一条 pending dialog 项 用户点击 planPending 项；Then 下拉收起，时间线滚动到顶，对应 sticky 提问卡高亮闪烁（约 1.2s）；若该卡处于最小化状态则先还原再高亮 下拉收起，滚动定位到输入区上方 Plan 审批
全文：.sillyspec/changes/archive/2026-10-16-session-decision-pill/requirements.md#FR-03
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-decision-pill:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「点 pending dialog 项：上抛 onFocusPending(requestId)；点 plan 项上抛 'plan' 哨兵（FR-03）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-decision-pill
  status: active

## FR-auto-frontend-271 历史只读详情弹窗
变更：2026-10-16-session-decision-pill
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 下拉打开且历史组已展开；When 用户点击一条历史项
全文：.sillyspec/changes/archive/2026-10-16-session-decision-pill/requirements.md#FR-04
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-decision-pill:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「点历史项收起下拉并开只读详情弹窗：问题/选项/当时选择 ✓/时间（FR-04）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-decision-pill
  status: active

## FR-auto-frontend-272 兼容与挂载改造
变更：2026-10-16-session-decision-pill
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 既有调用点（dialog 模式/其它潜在消费方）；When session-change-files-hover 未传新可选 prop embedded、TurnTimeline 未传 focusDialogReques；Then 两组件行为与改造前完全一致（可选 prop 默认值兜底）
全文：.sillyspec/changes/archive/2026-10-16-session-decision-pill/requirements.md#FR-05
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-decision-pill:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-decision-pill
  status: active

## FR-frontend-017 会话导出数据移出免鉴权静态服务面
变更：2026-10-21-proto-data-exposure-guard
状态：active
摘要：静态暴露通道关闭；staging 数据仍可被服务端读取
全文：.sillyspec/changes/archive/2026-10-21-proto-data-exposure-guard/requirements.md#FR-01
最近确认：c4eaa0643bc55e62fd2457cefbf504d4266a1522

## FR-frontend-018 proto 预览读取路径随迁，dev 预览能力不回归
变更：2026-10-21-proto-data-exposure-guard
状态：active
摘要：SSR 预览主路径不回归；容错路径行为保持
全文：.sillyspec/changes/archive/2026-10-21-proto-data-exposure-guard/requirements.md#FR-02
最近确认：c4eaa0643bc55e62fd2457cefbf504d4266a1522

## FR-frontend-019 .gitignore 机制防线覆盖全部残留产物
变更：2026-10-21-proto-data-exposure-guard
状态：active
摘要：误提交面收敛
全文：.sillyspec/changes/archive/2026-10-21-proto-data-exposure-guard/requirements.md#FR-03
最近确认：c4eaa0643bc55e62fd2457cefbf504d4266a1522

## FR-frontend-020 gitShow/gitDiffFile/gitStatus 的 git 调用统一带 -c core.quotepath=false，numstat 残余 C 引号路径在 daemon 侧解码为原文
变更：2026-10-21-gitlog-quotepath-fix
状态：active
摘要：中文路径主路径；残余强制引号；diff pathspec 回查
全文：.sillyspec/changes/archive/2026-10-21-gitlog-quotepath-fix/requirements.md#FR-01
最近确认：5bbb1a830ca0bee507747635b639a3be0ac85947

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-gitlog-quotepath-fix:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/host-fs-handler-git-log-quotepath.test.ts「真实仓中文路径 gitShow 解码 + gitDiffFile 回查非空 diff」 | sillyhub-daemon/tests/host-fs-handler-git-log.test.ts「GL46 命令构造——gitShow/gitDiffFile/gitStatus 带 -c core.quotepath=false」
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3da9e8d44310bfa5fe016e010780e4c9606a726e
  source_change: 2026-10-21-gitlog-quotepath-fix
  status: active

## FR-frontend-021 daemon 单测覆盖中文路径 numstat 解码与 diff pathspec 回查，前端 file-tree 覆盖中文路径聚合
变更：2026-10-21-gitlog-quotepath-fix
状态：active
摘要：前端中文路径聚合
全文：.sillyspec/changes/archive/2026-10-21-gitlog-quotepath-fix/requirements.md#FR-02
最近确认：5bbb1a830ca0bee507747635b639a3be0ac85947

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-gitlog-quotepath-fix:flow:测试绑定FR-02
  tests: frontend/src/components/git-log/__tests__/file-tree.test.tsx「中文路径聚合与叶子点击发起中文 path 请求」 | sillyhub-daemon/tests/host-fs-handler-git-log.test.ts「GL47 decodeGitCQuote 纯函数五形态」 | sillyhub-daemon/tests/host-fs-handler-git-log.test.ts「GL48 中文引号路径 numstat 解码」
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3da9e8d44310bfa5fe016e010780e4c9606a726e
  source_change: 2026-10-21-gitlog-quotepath-fix
  status: active

## FR-frontend-022 实测含中文目录提交：树展示正确中文、点击文件返回非空 diff
变更：2026-10-21-gitlog-quotepath-fix
状态：active
摘要：真实仓端到端
全文：.sillyspec/changes/archive/2026-10-21-gitlog-quotepath-fix/requirements.md#FR-03
最近确认：5bbb1a830ca0bee507747635b639a3be0ac85947

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-gitlog-quotepath-fix:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/host-fs-handler-git-log-quotepath.test.ts「真实临时仓端到端：含中文目录真实提交」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-gitlog-quotepath-fix
  status: active

## FR-frontend-023 总览卡主管线为 brainstorm→plan→execute→verify→archive 五段，无 scan 点位；brainstorm 阶段变更不渲染「scan 已完成」
变更：2026-10-21-overview-card-mainflow-scan
状态：active
摘要：brainstorm 阶段行；verify 阶段行
场景正文：
- 场景：brainstorm 阶段行 — Given envelope 变更行 current_stage='brainstorm'；When 渲染主管线；Then aria 语义含「brainstorm 进行中」与「plan 待办」，且不含任何 scan 点位（「scan 已完成/进行中/待办」均不出现）。
- 场景：verify 阶段行 — Given envelope 变更行 current_stage='verify'；When 渲染主管线；Then 「brainstorm/plan/execute 已完成」各一、「verify 进行中」、「archive 待办」，无 scan 点位。
全文：.sillyspec/changes/archive/2026-10-21-overview-card-mainflow-scan/requirements.md#FR-01
最近确认：23c936e92bf7871cd0ea0edba46cdf5387e49079

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-overview-card-mainflow-scan:flow:测试绑定FR-01
  tests: frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx「渲染——健康条计数/管线两态/stage 徽标/steps 进度/相对时间/倒序（fixture 含 envelope readable/command 容忍字段）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-overview-card-mainflow-scan
  status: active

## FR-frontend-024 current_stage='thin' 的变更行渲染「◈ thin」旁路徽标且不显示「步骤 0/0」文案（quick/explore 存量行为不动）
变更：2026-10-21-overview-card-mainflow-scan
状态：active
摘要：thin 变更行
场景正文：
- 场景：thin 变更行 — Given envelope 变更行 current_stage='thin'、stage_label='◈ 轻量变更'、steps={0,0}；When 渲染活跃变更行；Then 出现「◈ thin」徽标与「◈ 轻量变更」标签，不出现主管线点位，不出现「步骤 0/0」。
全文：.sillyspec/changes/archive/2026-10-21-overview-card-mainflow-scan/requirements.md#FR-02
最近确认：23c936e92bf7871cd0ea0edba46cdf5387e49079

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-overview-card-mainflow-scan:flow:测试绑定FR-02
  tests: frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx「thin 变更行——◈ thin 旁路徽标 + 隐藏步骤 0/0（2026-10-21-overview-card-mainflow-scan）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-overview-card-mainflow-scan
  status: active

## FR-frontend-025 changes-overview-card 既有测试更新后全绿
变更：2026-10-21-overview-card-mainflow-scan
状态：active
摘要：测试面回归
场景正文：
- 场景：测试面回归 — Given 组件与测试改毕；When 运行该测试文件；Then 全部用例通过、零失败。
全文：.sillyspec/changes/archive/2026-10-21-overview-card-mainflow-scan/requirements.md#FR-03
最近确认：23c936e92bf7871cd0ea0edba46cdf5387e49079

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-overview-card-mainflow-scan:flow:测试绑定FR-03
  tests: frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx「渲染——健康条计数/管线两态/stage 徽标/steps 进度/相对时间/倒序（fixture 含 envelope readable/command 容忍字段）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-overview-card-mainflow-scan
  status: active

## FR-frontend-026 .tmp/hooks 会话等价 hook 面删除，仓内无任何链路再引用它（配置注释与知识文档统一指向官方链 + export PRE_COMMIT_HOME 会话指引）
变更：2026-10-21-precommit-cleanup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-21-precommit-cleanup/requirements.md#FR-01
最近确认：68ae72e85d8261a4c49924cc6edaec5dc61d4f4c

## FR-frontend-027 .sillyspec/knowledge 新增「agent 沙箱 python 子树 Low IL 限制」条目：症状（python→msys 嵌套 0xC0000022 崩、profile 缓存写被拒）、根因（沙箱驱动降 IL、token 无 CodexSandboxUsers、DACL 修复无效）、WSL bash 误解析坑（python spawn bash 命中 System32 WSL 而非 Git Bash）、处置（去 msys 入口 + PRE_COMMIT_HOME 会话指引），INDEX 可路由
变更：2026-10-21-precommit-cleanup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-21-precommit-cleanup/requirements.md#FR-02
最近确认：68ae72e85d8261a4c49924cc6edaec5dc61d4f4c

## FR-frontend-028 sillyspec knowledge search 关键词实证命中；交付提交走默认官方 hook 链留痕
变更：2026-10-21-precommit-cleanup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-21-precommit-cleanup/requirements.md#FR-03
最近确认：68ae72e85d8261a4c49924cc6edaec5dc61d4f4c

## FR-frontend-029 /proto/session-redesign/page.tsx 显式 export const dynamic = 'force-dynamic'（对齐 session-trajectory/page.tsx:24 同款），消除构建期静态预渲染读盘
变更：2026-10-22-review-risk-fixes
状态：active
摘要：工作树构建不烘数据；dev 预览能力不回归（对齐知识 FR-frontend-018）
全文：.sillyspec/changes/archive/2026-10-22-review-risk-fixes/requirements.md#FR-01
最近确认：c975a003a577bfb5ce79a8445906f9f358939c82

## FR-frontend-030 frontend/.dockerignore 追加 /.proto-staging/，工作树 docker build 不再拷入真实会话导出
变更：2026-10-22-review-risk-fixes
状态：active
摘要：从含导出文件的工作树构建镜像
全文：.sillyspec/changes/archive/2026-10-22-review-risk-fixes/requirements.md#FR-02
最近确认：c975a003a577bfb5ce79a8445906f9f358939c82

## FR-frontend-031 event-loop-watch 正常窗口走完后 AbortSignal 的 abort 监听器计数不随窗口数增长（新增测试以真实 defaultSleep 断言）
变更：2026-10-22-review-risk-fixes
状态：active
摘要：连续多窗口后监听器计数归零；abort 路径行为不变
全文：.sillyspec/changes/archive/2026-10-22-review-risk-fixes/requirements.md#FR-03
最近确认：c975a003a577bfb5ce79a8445906f9f358939c82

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-review-risk-fixes:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/event-loop-watch.test.ts「defaultSleep 正常到期路径摘除 abort 监听器（连续窗口后计数归零）+ abort 路径 reject 行为不变（真实 defaultSleep 走 runEventLoopWatch）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-review-risk-fixes
  status: active

## FR-frontend-032 decodeGitCQuote 对含字面引号与非 ASCII 混合路径（如 中文"x.md）完整还原原文（新增单测，UTF-8 多字节按原字节组装）
变更：2026-10-22-review-risk-fixes
状态：active
摘要：字面引号转义 + 原样非 ASCII 混合形态；增补平面字符（代理对）；既有形态回归
全文：.sillyspec/changes/archive/2026-10-22-review-risk-fixes/requirements.md#FR-04
最近确认：c975a003a577bfb5ce79a8445906f9f358939c82

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-review-risk-fixes:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/host-fs-handler-git-log.test.ts「GL49: 混合路径（字面引号转义 + 原样非 ASCII/增补平面）解码逐字符还原原文」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-review-risk-fixes
  status: active

## FR-frontend-033 顶部固定布局
变更：2026-10-22-trajectory-view-redesign
状态：active
摘要：主路径
依据决策：D-002@v1、D-017@v1
场景正文：
- 场景：主路径 — Given 轨迹视图有足够多的账本行；When 向下滚动到底部；Then 工具栏与三泳道时间线仍在原位，仅账本内容滚动。
全文：.sillyspec/changes/archive/2026-10-22-trajectory-view-redesign/requirements.md#FR-01
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-trajectory-view-redesign:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-trajectory-view-redesign
  status: active

## FR-frontend-034 工具栏四项
变更：2026-10-22-trajectory-view-redesign
状态：active
摘要：主路径；时长切换
依据决策：D-003@v1、D-013@v1、D-016@v1、D-020@v1
场景正文：
- 场景：主路径 — Given 轨迹视图已打开；When 输入搜索词；Then 账本只显示命中行且折叠被绕过；When 清空搜索；Then 恢复原折叠状态。
- 场景：时长切换 — Given 默认实际时长；When 切到等宽；Then 时间线条块按等宽排列，账本结构不变；刷新后仍为等宽。
全文：.sillyspec/changes/archive/2026-10-22-trajectory-view-redesign/requirements.md#FR-02
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-trajectory-view-redesign:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx | frontend/src/components/daemon/trajectory/__tests__/trajectory-view-model.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-trajectory-view-redesign
  status: active

## FR-frontend-035 两列账本
变更：2026-10-22-trajectory-view-redesign
状态：active
摘要：主路径
依据决策：D-004@v1、D-019@v1
场景正文：
- 场景：主路径 — Given 一轮包含助手、工具、子工具记录；When 查看账本；Then 首行显示该轮起始标签，后续行共用竖线，子工具缩进，行内只有类型与摘要。
全文：.sillyspec/changes/archive/2026-10-22-trajectory-view-redesign/requirements.md#FR-03
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-trajectory-view-redesign:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-trajectory-view-redesign
  status: active

## FR-frontend-036 折叠摘要行
变更：2026-10-22-trajectory-view-redesign
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 某轮有 5 条记录；When 点击「轮次 → 收起」；Then 该轮只剩 1 条内容行 + 1 条摘要行；再次展开恢复 5 条。
全文：.sillyspec/changes/archive/2026-10-22-trajectory-view-redesign/requirements.md#FR-04
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-trajectory-view-redesign:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx | frontend/src/components/daemon/trajectory/__tests__/trajectory-view-model.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-trajectory-view-redesign
  status: active

## FR-frontend-037 多标签详情
变更：2026-10-22-trajectory-view-redesign
状态：active
摘要：主路径
依据决策：D-005@v1、D-007@v1、D-008@v1、D-018@v1
场景正文：
- 场景：主路径 — Given 选中一条工具行；When 查看详情；Then 出现四个标签，参数/结果可 JSON 美化与复制，计时显示开始/总时长；When 选中一条助手行；Then 只有概
全文：.sillyspec/changes/archive/2026-10-22-trajectory-view-redesign/requirements.md#FR-05
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-trajectory-view-redesign:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts | frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-trajectory-view-redesign
  status: active

## FR-frontend-038 数据边界与空态
变更：2026-10-22-trajectory-view-redesign
状态：active
摘要：主路径
依据决策：D-006@v1
场景正文：
- 场景：主路径 — Given 会话没有时间锚点；When 打开轨迹；Then 显示「没有可绘制的时间数据」提示，不渲染账本与时间线。
全文：.sillyspec/changes/archive/2026-10-22-trajectory-view-redesign/requirements.md#FR-06
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-trajectory-view-redesign:flow:测试绑定FR-06
  tests: frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx | frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-trajectory-view-redesign
  status: active

## FR-frontend-039 主题、入口与回归
变更：2026-10-22-trajectory-view-redesign
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 变更落盘；When 跑轨迹、会话面板相关测试与 tsc；Then 全部通过，三态切换行为不变。
全文：.sillyspec/changes/archive/2026-10-22-trajectory-view-redesign/requirements.md#FR-07
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-trajectory-view-redesign:flow:测试绑定FR-07
  tests: frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-trajectory-view-redesign
  status: active

## FR-frontend-040 轮内已提交（git commit）的文件必须出现在本轮文件变更卡中；文件清单来源为 git status ∪ git diff --name-status <baselineHead>，行数取 numstat
变更：2026-10-22-file-changes-card-fix
状态：active
摘要：轮内 commit 后工作区干净；轮内新增/删除并提交；未跟踪文件仍在列
全文：.sillyspec/changes/archive/2026-10-22-file-changes-card-fix/requirements.md#FR-01
最近确认：c2a675686324f2ee56e0a3b2a7a5c5c27a1754b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-file-changes-card-fix:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/turn-file-changes.test.ts「轮内 commit 的改动进入文件清单」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-file-changes-card-fix
  status: active

## FR-frontend-041 慢盘工作区（/mnt/ 等）不再固定超时：自适应/放大超时预算且可配置；numstat 超时仍保留已采集的 status/name-status 文件清单（行数显示破折号）
变更：2026-10-22-file-changes-card-fix
状态：active
摘要：慢盘首轮超时后升级；numstat 超时保留清单
全文：.sillyspec/changes/archive/2026-10-22-file-changes-card-fix/requirements.md#FR-02
最近确认：c2a675686324f2ee56e0a3b2a7a5c5c27a1754b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-file-changes-card-fix:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/turn-file-changes.test.ts「numstat 超时保留 status 清单」 | sillyhub-daemon/tests/interactive/turn-file-changes.test.ts「慢盘预算自适应」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-file-changes-card-fix
  status: active

## FR-frontend-042 未跟踪新文件、删除文件、mtime 探测行有明确状态展示；删除行不可点击；改N次=真实编辑调用次数
变更：2026-10-22-file-changes-card-fix
状态：active
摘要：未跟踪新文件；删除文件；同一文件多次 Edit
全文：.sillyspec/changes/archive/2026-10-22-file-changes-card-fix/requirements.md#FR-03
最近确认：c2a675686324f2ee56e0a3b2a7a5c5c27a1754b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-file-changes-card-fix:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx「状态徽标/删除行不可点/未跟踪破折号」 | frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts「status/untracked/编辑次数映射」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-file-changes-card-fix
  status: active

## FR-frontend-043 notice 按精确 reason（timeout/queue_overflow/无 reason）与采集耗时生成文案，notice 态也显示共享工作区提示
变更：2026-10-22-file-changes-card-fix
状态：active
摘要：timeout 提示；queue_overflow 提示
全文：.sillyspec/changes/archive/2026-10-22-file-changes-card-fix/requirements.md#FR-04
最近确认：c2a675686324f2ee56e0a3b2a7a5c5c27a1754b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-file-changes-card-fix:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx「notice 态共享工作区提示」 | frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts「notice 按 reason 与耗时生成」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-file-changes-card-fix
  status: active

## FR-frontend-044 daemon/前端定向测试全绿，既有卡片与快照契约零回归
变更：2026-10-22-file-changes-card-fix
状态：active
摘要：回归
全文：.sillyspec/changes/archive/2026-10-22-file-changes-card-fix/requirements.md#FR-05
最近确认：c2a675686324f2ee56e0a3b2a7a5c5c27a1754b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-file-changes-card-fix:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx「既有卡片交互回归」 | sillyhub-daemon/tests/interactive/turn-file-changes.test.ts「既有六类夹具/降级路径回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-file-changes-card-fix
  status: active

## FR-frontend-045 pending AskUser 问答卡渲染于真会话底部输入框位置（互斥替换 SessionInputBar，session-panel-page 与 session-panel-dialog 两挂载点同款），时间线滚动区不再渲染 pending 卡
变更：2026-10-22-askuser-dock-inputbar
状态：active
摘要：pending 到达；两挂载点一致
全文：.sillyspec/changes/archive/2026-10-22-askuser-dock-inputbar/requirements.md#FR-01
最近确认：17f2273dc06c094cd830f77fce052c55e8606933

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-askuser-dock-inputbar:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/pending-dialog-dock.test.tsx「pending 到达渲染卡区（互斥由挂载点条件渲染承担，dock 渲染卡列断言）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-askuser-dock-inputbar
  status: active

## FR-frontend-046 问答卡区有固定最大高度（约 45vh 量级），内容超出时区内上下滚动；提交回答或 resolved 后输入框自动恢复
变更：2026-10-22-askuser-dock-inputbar
状态：active
摘要：超高内容内滚；答完恢复
全文：.sillyspec/changes/archive/2026-10-22-askuser-dock-inputbar/requirements.md#FR-02
最近确认：17f2273dc06c094cd830f77fce052c55e8606933

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-askuser-dock-inputbar:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/pending-dialog-dock.test.tsx「卡区 max-h + overflow-y-auto 类名断言」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-askuser-dock-inputbar
  status: active

## FR-frontend-047 最小化（收起为右下角胶囊）与待决策 pill 定位还原能力保留，pill 点击还原+高亮闪烁（不再滚顶）
变更：2026-10-22-askuser-dock-inputbar
状态：active
摘要：最小化与还原；pill 定位
全文：.sillyspec/changes/archive/2026-10-22-askuser-dock-inputbar/requirements.md#FR-03
最近确认：17f2273dc06c094cd830f77fce052c55e8606933

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-askuser-dock-inputbar:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/pending-dialog-dock.test.tsx「还原保留已填内容：选项 + 手动输入原样恢复」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-askuser-dock-inputbar
  status: active

## FR-frontend-048 ended/failed 会话不渲染问答区，输入框正常显示
变更：2026-10-22-askuser-dock-inputbar
状态：active
摘要：终态会话
全文：.sillyspec/changes/archive/2026-10-22-askuser-dock-inputbar/requirements.md#FR-04
最近确认：17f2273dc06c094cd830f77fce052c55e8606933

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-askuser-dock-inputbar:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/pending-dialog-dock.test.tsx「ended 会话不渲染卡区（胶囊同样不渲染）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-askuser-dock-inputbar
  status: active

## FR-frontend-049 TurnTimeline 移除 pending 卡渲染与相关 props，群聊面板零变化，受影响测试全绿 + tsc 零错
变更：2026-10-22-askuser-dock-inputbar
状态：active
摘要：验证
全文：.sillyspec/changes/archive/2026-10-22-askuser-dock-inputbar/requirements.md#FR-05
最近确认：17f2273dc06c094cd830f77fce052c55e8606933

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-askuser-dock-inputbar:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-askuser-dock-inputbar
  status: active

## FR-frontend-050 复制按钮改用 getText 惰性取值，渲染期不构建 diff 文本，点击复制内容与现行为逐字一致
变更：2026-10-23-diff-copy-p3-cleanup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-diff-copy-p3-cleanup/requirements.md#FR-01
最近确认：e849e16ee3a34212c2abfd144b0503f6064b6b1d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-diff-copy-p3-cleanup:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「每段补丁有常显复制按钮，点击写入完整 diff 文本（FR-01）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-diff-copy-p3-cleanup
  status: active

## FR-frontend-051 补丁区脚注含「不含 hunk 头，不可直接用于 git apply」语义的如实说明
变更：2026-10-23-diff-copy-p3-cleanup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-diff-copy-p3-cleanup/requirements.md#FR-02
最近确认：e849e16ee3a34212c2abfd144b0503f6064b6b1d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-diff-copy-p3-cleanup:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「补丁区脚注声明复制文本边界（不含 hunk 头/不可直接 git apply）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-diff-copy-p3-cleanup
  status: active

## FR-frontend-052 无补丁说明态用例先等到说明文案出现再断言无复制按钮（不再在 loading 态误断言）
变更：2026-10-23-diff-copy-p3-cleanup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-diff-copy-p3-cleanup/requirements.md#FR-03
最近确认：e849e16ee3a34212c2abfd144b0503f6064b6b1d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-diff-copy-p3-cleanup:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「无补丁说明态 / 删除说明态不出现复制按钮（FR-03）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-diff-copy-p3-cleanup
  status: active

## FR-frontend-053 触及面测试绿 + tsc 零错
变更：2026-10-23-diff-copy-p3-cleanup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-diff-copy-p3-cleanup/requirements.md#FR-04
最近确认：e849e16ee3a34212c2abfd144b0503f6064b6b1d

## FR-frontend-054 单选问题：选项勾选与手动输入互斥
变更：2026-10-23-askuser-dialog-draft
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-23-askuser-dialog-draft/requirements.md#FR-01
最近确认：89eab69bc8d2ed766383f510f0f5c84e228d352c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-askuser-dialog-draft:flow:测试绑定FR-01
  tests: frontend/src/components/ask-user-dialog-card.test.tsx「单选互斥：勾选选项后手动输入框禁用，取消选择后恢复可用」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-askuser-dialog-draft
  status: active

## FR-frontend-055 多选问题保持现状（回归锁定）
变更：2026-10-23-askuser-dialog-draft
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-23-askuser-dialog-draft/requirements.md#FR-02
最近确认：89eab69bc8d2ed766383f510f0f5c84e228d352c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-askuser-dialog-draft:flow:测试绑定FR-02
  tests: frontend/src/components/ask-user-dialog-card.test.tsx「多选保持现状：可同时勾多项且手动输入可合并作答」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-askuser-dialog-draft
  status: active

## FR-frontend-056 未提交作答跨刷新 / 跨会话切换保留
变更：2026-10-23-askuser-dialog-draft
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-23-askuser-dialog-draft/requirements.md#FR-03
最近确认：89eab69bc8d2ed766383f510f0f5c84e228d352c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-askuser-dialog-draft:flow:测试绑定FR-03
  tests: frontend/src/components/ask-user-dialog-card.test.tsx「未提交作答卸载重挂载后原样恢复（刷新/切换会话同路径）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-askuser-dialog-draft
  status: active

## FR-frontend-057 草稿清理不残留
变更：2026-10-23-askuser-dialog-draft
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-23-askuser-dialog-draft/requirements.md#FR-04
最近确认：89eab69bc8d2ed766383f510f0f5c84e228d352c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-askuser-dialog-draft:flow:测试绑定FR-04
  tests: frontend/src/components/ask-user-dialog-card.test.tsx「提交成功后清除该提问草稿，不残留」 | frontend/src/components/ask-user-dialog-draft.test.ts「草稿读写/TTL 过期清理/损坏数据降级」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-askuser-dialog-draft
  status: active

## FR-frontend-058 条目达到 200 条上限后，每次窗口滑动只平滑前进一条，位移不得累积越过内容边界
变更：2026-10-23-marquee-blank-track-fix
状态：active
摘要：超过 200 条后继续新增；连续多次滑动
全文：.sillyspec/changes/archive/2026-10-23-marquee-blank-track-fix/requirements.md#FR-01
最近确认：d32d1a2b1f4f1d6bff5ad855aee08edf0e154678

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-marquee-blank-track-fix:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「窗口滑动目标回到 base，连续滑动不累积越界（FR-01）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-marquee-blank-track-fix
  status: active

## FR-frontend-059 长会话持续新增事件时，跑马灯始终能显示最近条目，不再出现空白轨道
变更：2026-10-23-marquee-blank-track-fix
状态：active
摘要：真实长会话
全文：.sillyspec/changes/archive/2026-10-23-marquee-blank-track-fix/requirements.md#FR-02
最近确认：d32d1a2b1f4f1d6bff5ad855aee08edf0e154678

## FR-frontend-060 新增回归测试模拟 200→201 条滑动，断言轨道位移不越界；现有 23 用例通过
变更：2026-10-23-marquee-blank-track-fix
状态：active
摘要：回归核验
全文：.sillyspec/changes/archive/2026-10-23-marquee-blank-track-fix/requirements.md#FR-03
最近确认：d32d1a2b1f4f1d6bff5ad855aee08edf0e154678

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-marquee-blank-track-fix:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「轨道速度随距离缓出，接近目标时减速（FR-01）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-marquee-blank-track-fix
  status: active

## FR-frontend-061 turn_trigger 段在轨迹账本显示为「上下文」类型行（kind=system + meta.contextEvent），摘要为段 text，锚点取段 ts（缺失用轮首，不伪造）
变更：2026-10-24-trajectory-context-rows
状态：active
摘要：主路径；零回归
场景正文：
- 场景：主路径 — Given 一轮含 `turn_trigger` 段（trigger=task_wakeup，text="[后台任务通知] 任务完成"，ts=轮中段）；When 打开轨迹；
- 场景：零回归 — Given 一轮不含 turn_trigger 段；When 派生；Then 行集合与改动前一致（user_msg 仍为「用户」行）。
全文：.sillyspec/changes/archive/2026-10-24-trajectory-context-rows/requirements.md#FR-01
最近确认：b1d1ed8ee47ffcd26dba1175753a470e3caf08e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-24-trajectory-context-rows:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-24-trajectory-context-rows
  status: active

## FR-frontend-062 段锚点统一「先 startedAt 再 ts」读取
变更：2026-10-24-trajectory-context-rows
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given user_msg 段 ts=轮中段时刻；When 派生；Then 该行 startedAt=ts（不再挤在轮首）。
全文：.sillyspec/changes/archive/2026-10-24-trajectory-context-rows/requirements.md#FR-02
最近确认：b1d1ed8ee47ffcd26dba1175753a470e3caf08e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-24-trajectory-context-rows:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-24-trajectory-context-rows
  status: active

## FR-frontend-063 processItems.system_event 派生保留（回放路径零回归）
变更：2026-10-24-trajectory-context-rows
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 变更落盘；When 跑轨迹目录测试与 tsc；Then 全部通过。
全文：.sillyspec/changes/archive/2026-10-24-trajectory-context-rows/requirements.md#FR-03
最近确认：b1d1ed8ee47ffcd26dba1175753a470e3caf08e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-24-trajectory-context-rows:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-24-trajectory-context-rows
  status: active

## FR-frontend-064 最新条目非运行中时，追加「等待模型响应 · 耗时」合成条目：带转圈、计时每秒递增
变更：2026-10-23-marquee-awaiting-indicator
状态：active
摘要：工具完成后的间隙；思考进行中
全文：.sillyspec/changes/archive/2026-10-23-marquee-awaiting-indicator/requirements.md#FR-01
最近确认：0fa5913d2e4444e1dc0f9a6f01469da91a958814

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-marquee-awaiting-indicator:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「最新条目非运行中时出现等待模型响应条目」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-marquee-awaiting-indicator
  status: active

## FR-frontend-065 新事件到达或最新条目回到运行中时，等待条目立即消失；不进入事件队列、不影响窗口滑动
变更：2026-10-23-marquee-awaiting-indicator
状态：active
摘要：新事件到达
全文：.sillyspec/changes/archive/2026-10-23-marquee-awaiting-indicator/requirements.md#FR-02
最近确认：0fa5913d2e4444e1dc0f9a6f01469da91a958814

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-marquee-awaiting-indicator:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「新事件到达后等待条目消失」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-marquee-awaiting-indicator
  status: active

## FR-frontend-066 最新条目运行中时不显示等待条目；reduced-motion 下显示静态文本（转圈静止）
变更：2026-10-23-marquee-awaiting-indicator
状态：active
摘要：减少动态效果
全文：.sillyspec/changes/archive/2026-10-23-marquee-awaiting-indicator/requirements.md#FR-03
最近确认：0fa5913d2e4444e1dc0f9a6f01469da91a958814

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-marquee-awaiting-indicator:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「最新条目运行中时无等待条目」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-marquee-awaiting-indicator
  status: active

## FR-frontend-067 新增出现/消失/计时断言测试，全部用例通过；lint与typecheck通过
变更：2026-10-23-marquee-awaiting-indicator
状态：active
摘要：回归核验
全文：.sillyspec/changes/archive/2026-10-23-marquee-awaiting-indicator/requirements.md#FR-04
最近确认：0fa5913d2e4444e1dc0f9a6f01469da91a958814

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-marquee-awaiting-indicator:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-marquee-awaiting-indicator
  status: active

## FR-frontend-068 外部跑马灯不再收集子代理内部消息：tool 带 children 与 subagent_stub 分支都不递归 children，仅保留容器条目
变更：2026-10-25-marquee-subagent-outer-only
状态：active
摘要：子代理派发；子代理卡片（不变）
全文：.sillyspec/changes/archive/2026-10-25-marquee-subagent-outer-only/requirements.md#FR-01
最近确认：c596944e9698db5bfd828734cc1958b27b36ba61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-marquee-subagent-outer-only:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「子代理内部工具不进入外部轨道，仅容器条目」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-marquee-subagent-outer-only
  status: active

## FR-frontend-069 子代理容器条目显示名称、运行状态（转圈）与时间：运行中显示走秒计时（优先用段 startedAt，缺省用客户端首次观察起点），完成后显示总耗时
变更：2026-10-25-marquee-subagent-outer-only
状态：active
摘要：子代理运行中；无段起点的思考条目
全文：.sillyspec/changes/archive/2026-10-25-marquee-subagent-outer-only/requirements.md#FR-02
最近确认：c596944e9698db5bfd828734cc1958b27b36ba61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-marquee-subagent-outer-only:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「运行中条目显示走秒计时」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-marquee-subagent-outer-only
  status: active

## FR-frontend-070 工具条目同样获得运行中走秒计时；无起点数据时只转圈不显示时间
变更：2026-10-25-marquee-subagent-outer-only
状态：active
摘要：Bash 运行中
全文：.sillyspec/changes/archive/2026-10-25-marquee-subagent-outer-only/requirements.md#FR-03
最近确认：c596944e9698db5bfd828734cc1958b27b36ba61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-marquee-subagent-outer-only:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「无段起点的运行中条目用客户端起点计时（FR-02）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-marquee-subagent-outer-only
  status: active

## FR-frontend-071 更新子代理递归相关测试并新增走秒计时用例，全部通过；lint与typecheck通过
变更：2026-10-25-marquee-subagent-outer-only
状态：active
摘要：回归核验
全文：.sillyspec/changes/archive/2026-10-25-marquee-subagent-outer-only/requirements.md#FR-04
最近确认：c596944e9698db5bfd828734cc1958b27b36ba61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-marquee-subagent-outer-only:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-marquee-subagent-outer-only
  status: active

## FR-frontend-072 SubagentBlockView 删除内联展开分支：无面板上下文时渲染同款头部纯展示（不可点击），不再原地展开 children
变更：2026-10-25-subagent-card-unify-panel
状态：active
摘要：无 Provider 宿主（回放/悬浮助手等）；整页会话（有 Provider）
全文：.sillyspec/changes/archive/2026-10-25-subagent-card-unify-panel/requirements.md#FR-01
最近确认：2e0ff863327ec51edee4eb034e54adfaaeb1db5e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-subagent-card-unify-panel:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「无 Provider 渲染纯展示头部：信息完整、不可点击、children 不挂载」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-subagent-card-unify-panel
  status: active

## FR-frontend-073 会话弹窗（dialog 模式）挂 SubagentPanelContext：点击紧凑卡片右侧滑出 Drawer，内嵌 SubagentDetailPanel 展示子代理完整内部过程
变更：2026-10-25-subagent-card-unify-panel
状态：active
摘要：弹窗点击子代理卡片；会话切换
全文：.sillyspec/changes/archive/2026-10-25-subagent-card-unify-panel/requirements.md#FR-02
最近确认：2e0ff863327ec51edee4eb034e54adfaaeb1db5e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-subagent-card-unify-panel:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-panel-dialog-subagent-drawer.test.tsx「点击子代理卡片打开 Drawer 详情，再点关闭」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-subagent-card-unify-panel
  status: active

## FR-frontend-074 整页会话行为零变化（右栏详情照旧）
变更：2026-10-25-subagent-card-unify-panel
状态：active
摘要：整页回归
全文：.sillyspec/changes/archive/2026-10-25-subagent-card-unify-panel/requirements.md#FR-03
最近确认：2e0ff863327ec51edee4eb034e54adfaaeb1db5e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-subagent-card-unify-panel:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「紧凑卡片模式（subagent-three-pane）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-subagent-card-unify-panel
  status: active

## FR-frontend-075 内联展开相关测试改写为纯展示断言；弹窗新增点击开 Drawer 用例；全部通过
变更：2026-10-25-subagent-card-unify-panel
状态：active
摘要：回归核验
全文：.sillyspec/changes/archive/2026-10-25-subagent-card-unify-panel/requirements.md#FR-04
最近确认：2e0ff863327ec51edee4eb034e54adfaaeb1db5e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-subagent-card-unify-panel:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-subagent-card-unify-panel
  status: active

## FR-frontend-076 子代理卡片内嵌内部活动流动条（与外部跑马灯同款机制）
变更：2026-10-25-subagent-card-unify-panel
状态：active
摘要：子代理运行中；无 children
全文：.sillyspec/changes/archive/2026-10-25-subagent-card-unify-panel/requirements.md#FR-05
最近确认：2e0ff863327ec51edee4eb034e54adfaaeb1db5e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-subagent-card-unify-panel:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「子代理卡片内嵌内部活动流动条（FR-05）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-subagent-card-unify-panel
  status: active

## FR-frontend-077 三个分组标题可点击切换展开/收起（箭头随状态翻转，带 aria-expanded）
变更：2026-10-26-worktree-group-collapse
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 卡片已渲染出至少一组内容；When 点击该组头按钮；Then 该组内容隐藏、aria-expanded=false；再次点击恢复显示、aria-expanded=true
全文：.sillyspec/changes/archive/2026-10-26-worktree-group-collapse/requirements.md#FR-01
最近确认：01714da0c91b515bd6e12b0c4a02ae2cc9ae2401

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-worktree-group-collapse:flow:测试绑定FR-01
  tests: frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx「分组折叠：untracked/ignored 默认收起、更改默认展开、点击切换」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-worktree-group-collapse
  status: active

## FR-frontend-078 未纳入版本管理与已忽略默认收起、更改默认展开
变更：2026-10-26-worktree-group-collapse
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 含 untracked 与 ignored 条目的工作区数据；When 卡片渲染完成（未点任何组头）；Then 更改组文件行在 DOM；untracked 行与 ignored 行不在 DOM；两组头可见且带计数
全文：.sillyspec/changes/archive/2026-10-26-worktree-group-collapse/requirements.md#FR-02
最近确认：01714da0c91b515bd6e12b0c4a02ae2cc9ae2401

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-worktree-group-collapse:flow:测试绑定FR-02
  tests: frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx「分组折叠：untracked/ignored 默认收起、更改默认展开、点击切换」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-worktree-group-collapse
  status: active

## FR-frontend-079 既有 worktree-changes-card 聚焦测试按新默认态更新并全绿（仅跑该测试文件）
变更：2026-10-26-worktree-group-collapse
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 本变更代码与测试更新落盘；When 运行 vitest 单文件 worktree-changes-card.test.tsx；Then 全部用例通过（14/14）
全文：.sillyspec/changes/archive/2026-10-26-worktree-group-collapse/requirements.md#FR-03
最近确认：01714da0c91b515bd6e12b0c4a02ae2cc9ae2401

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-worktree-group-collapse:flow:测试绑定FR-03
  tests: frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-worktree-group-collapse
  status: active

## FR-frontend-080 daemon 层 turn_phase POST 失败从 debug 提为首警 warn（复用 turn-phase-observability 的 warnOncePhaseFailure 同 session+phase 去重惯例），成功仍静默
变更：2026-10-27-turn-phase-observability-monotonic
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 桥层收到 phase 上报桥消息 / When notifyTurnPhase reject（网络故障）/ Then 不抛出且 logger.warn 恰好一次
全文：.sillyspec/changes/archive/2026-10-27-turn-phase-observability-monotonic/requirements.md#FR-01
最近确认：38656992777af5c16d135235ce71f55efd29ecc4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-turn-phase-observability-monotonic:flow:测试绑定FR-01
  tests: test/sillyhub-daemon/tests/turn-phase-report.test.ts「② daemon.onTurnMessage turn_phase_report 拦截 > notifyTurnPhase reject → 首警 warn 一次（同 session+phase 去重）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-turn-phase-observability-monotonic
  status: active

## FR-frontend-081 前端 applyTurnPhase 单调守卫：dispatched/delivered 不覆盖已是执行期阶段（skills_sync 至 inject_received）或 first_event 的 currentPhase（回退写静默丢弃，正常推进与乱序前跳不受影响）
变更：2026-10-27-turn-phase-observability-monotonic
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 轮 currentPhase=first_event（或 spawning/inject_received）/ When delivered 事件（steeri
全文：.sillyspec/changes/archive/2026-10-27-turn-phase-observability-monotonic/requirements.md#FR-02
最近确认：38656992777af5c16d135235ce71f55efd29ecc4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-turn-phase-observability-monotonic:flow:测试绑定FR-02
  tests: test/frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts「applyTurnPhase 单调守卫 > 词表外值不参与守卫照常覆盖（兼容零回归）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-turn-phase-observability-monotonic
  status: active

## FR-frontend-082 log 到达退位集合从 {dispatched, delivered} 扩展含 inject_received（AI 已输出的场合送达信号同样失去展示意义）
变更：2026-10-27-turn-phase-observability-monotonic
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 轮 currentPhase={phase:"inject_received"} / When 该轮 log 信封经 upsertTurn / Then cur
全文：.sillyspec/changes/archive/2026-10-27-turn-phase-observability-monotonic/requirements.md#FR-03
最近确认：38656992777af5c16d135235ce71f55efd29ecc4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-turn-phase-observability-monotonic:flow:测试绑定FR-03
  tests: test/frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts「retireDeliveryPhase（log 兜底退位）> inject_received 清 null / ready 保留」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-turn-phase-observability-monotonic
  status: active

## FR-frontend-083 既有相关测试全绿，新增用例覆盖上述三项行为
变更：2026-10-27-turn-phase-observability-monotonic
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 本次改动 / When 跑相关测试文件 / Then 全绿且新增用例覆盖三项行为与对照场景。
全文：.sillyspec/changes/archive/2026-10-27-turn-phase-observability-monotonic/requirements.md#FR-04
最近确认：38656992777af5c16d135235ce71f55efd29ecc4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-turn-phase-observability-monotonic:flow:测试绑定FR-04
  tests: test/sillyhub-daemon/tests/turn-phase-report.test.ts「（既有 ①②③ 段全量回归）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-turn-phase-observability-monotonic
  status: active

## FR-frontend-084 后端 backend 代码零改动（daemon 与 frontend 各自范围内）
变更：2026-10-27-turn-phase-observability-monotonic
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 变更收口 / When 检查 git diff 文件清单 / Then 改动仅限 daemon 1 文件 + frontend 2 文件 + 两侧测试文件。
全文：.sillyspec/changes/archive/2026-10-27-turn-phase-observability-monotonic/requirements.md#FR-05
最近确认：38656992777af5c16d135235ce71f55efd29ecc4

## FR-frontend-085 变更详情右侧信息栏不再渲染「范围对账」与「产出速览」两组区块及其取数请求（getScopeAudit/getChangeAssets 两 query 随区块一并移除）
变更：2026-10-28-change-detail-side-assets-scroll
状态：active
摘要：侧栏三组形态
全文：.sillyspec/changes/archive/2026-10-28-change-detail-side-assets-scroll/requirements.md#FR-01
最近确认：1c284302f17b3561362dd04f2d262a1b2cd64a61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-detail-side-assets-scroll:flow:测试绑定FR-01
  tests: test/frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx「三组渲染：基本信息 / 执行用量 / 会话（范围对账与产出速览已移除）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-detail-side-assets-scroll
  status: active

## FR-frontend-086 沉淀资产卡全部六组卡片内容区设统一最大高度，超出部分隐藏并显示纵向滚动条
变更：2026-10-28-change-detail-side-assets-scroll
状态：active
摘要：条目多时组内滚动
全文：.sillyspec/changes/archive/2026-10-28-change-detail-side-assets-scroll/requirements.md#FR-02
最近确认：1c284302f17b3561362dd04f2d262a1b2cd64a61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-detail-side-assets-scroll:flow:测试绑定FR-02
  tests: test/frontend/src/components/changes/detail/__tests__/change-assets-fallback.test.tsx「分组限高滚动：卡片最大高度固定 + 组内滚动容器（2026-10-28-change-detail-side-assets-scroll 用户裁决，推翻 2026-10-15 自然高度口径）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-detail-side-assets-scroll
  status: active

## FR-frontend-087 「展开全部/收起」按钮固定在卡片底部不被滚动带走
变更：2026-10-28-change-detail-side-assets-scroll
状态：active
摘要：展开按钮可达性
全文：.sillyspec/changes/archive/2026-10-28-change-detail-side-assets-scroll/requirements.md#FR-03
最近确认：1c284302f17b3561362dd04f2d262a1b2cd64a61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-detail-side-assets-scroll:flow:测试绑定FR-03
  tests: test/frontend/src/components/changes/detail/__tests__/change-assets-fallback.test.tsx「分组限高滚动…」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-detail-side-assets-scroll
  status: active

## FR-frontend-088 既有分组交互（点击弹窗预览/展开全部）行为不回归
变更：2026-10-28-change-detail-side-assets-scroll
状态：active
摘要：展开收起往返
全文：.sillyspec/changes/archive/2026-10-28-change-detail-side-assets-scroll/requirements.md#FR-04
最近确认：1c284302f17b3561362dd04f2d262a1b2cd64a61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-detail-side-assets-scroll:flow:测试绑定FR-04
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-detail-side-assets-scroll
  status: active

## FR-frontend-089 相关前端测试通过，tsc 与 eslint 0 error
变更：2026-10-28-change-detail-side-assets-scroll
状态：active
摘要：验证面
全文：.sillyspec/changes/archive/2026-10-28-change-detail-side-assets-scroll/requirements.md#FR-05
最近确认：1c284302f17b3561362dd04f2d262a1b2cd64a61
