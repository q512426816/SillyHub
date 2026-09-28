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
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 用户在移动变更列表页（任一变更 tab） 重新扫描返回警告列表 重新扫描请求失败；When 点击工具栏「重新扫描」按钮 警告数 > 0 返回 ApiError；Then 调用 reparseChanges(workspaceId)，成功后显示「已重新扫描：解析 N，新增 N · 更新 N · 删除 N。W 个警告。」反馈条（文案
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-01
最近确认：d33092ea3

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
  status: active

## FR-auto-frontend-009 列表卡片信息补齐
变更：2026-09-16-mobile-changes-parity
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given ChangeSummary.owner_name 非空 owner_name 空且 owner_id 有值 owner_name 与 owner_id 均空 a；When 渲染卡片元信息行 渲染元信息行 渲染元信息行 渲染元信息行 渲染执行用量行 渲染执行用量行 渲染执行用量行 渲染徽标行；Then 显示负责人名（owner_name） 显示 owner_id 前 8 位（mono 弱化色） 负责人段显示「—」 影响组件段省略（不占位） 显示「—」占位 整行
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-02
最近确认：d33092ea3

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
  status: active

## FR-auto-frontend-010 列表排序切换与 URL 参数
变更：2026-09-16-mobile-changes-parity
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 用户打开筛选抽屉 URL 含 ?tab=quicklog 或 ?tab=archive（合法值） URL 含 ?search=词 未操作任何筛选、URL 无参数；When 切换「排序」chip（↓ 最近优先 / ↑ 最早优先）并确定 页面初始加载 页面初始加载 页面加载；Then sortDir 生效进主列表 query key，列表按所选方向请求 初始 tab 为该值（非法值回 active） 搜索词初始化为该值（输入框与已提交 sta
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-03
最近确认：d33092ea3

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
  status: active

## FR-auto-frontend-011 quicklog tab 筛选
变更：2026-09-16-mobile-changes-parity
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 用户在快速修复 tab 用户选择状态=疑似中断并确定 作者选项数据 用户关闭「显示空壳占位」并确定 quicklog tab 处于抽屉筛选状态；When 打开筛选抽屉 quicklog 列表请求发出 quicklog 列表响应到达 请求发出 点击重置；Then 可见状态 4 态 chips、作者 chips、显示空壳占位开关 query key 与请求参数带 status="stale"（槽位与桌面 QuicklogT
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-04
最近确认：d33092ea3

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
  status: active

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
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given steps 中某阶段有条目 时间线处于阶段筛选态 某阶段在 steps 中无条目；When 点击步骤条该阶段节点 再次点击同阶段节点或点清除 chip 渲染步骤条；Then 时间线仅显示该阶段步骤，卡头出现「阶段名 ✕」清除 chip 取消筛选恢复全量 该节点不可点（无筛选效果）
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-06
最近确认：d33092ea3

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
  status: active

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
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given main 分支的变更详情页（`[cid]/page.tsx`）在 304eba982 被夹带的旧版页面覆盖，；When 用户打开任一变更详情页，
全文：.sillyspec/changes/archive/2026-09-26-change-detail-restore-assets/requirements.md#FR-01
最近确认：83bde5d52c29cd07960e1d300d9541bf6a44a5ec

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
  status: active

## FR-auto-frontend-020 标题阶段徽章恢复 thin/quick 口径
变更：2026-09-26-change-detail-restore-assets
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `current_stage="thin"` 的轻量变更在标题旁只显示弱化的 outline 徽章（fallback 路径），；When 详情页渲染 thin 或 quick 阶段变更，；Then thin 显示品牌紫 default 徽章「轻量变更」、quick 显示 default 徽章「快速任务（存量）」（`STATUS_BADGE` 四态：quic
全文：.sillyspec/changes/archive/2026-09-26-change-detail-restore-assets/requirements.md#FR-02
最近确认：83bde5d52c29cd07960e1d300d9541bf6a44a5ec

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
  status: active

## FR-auto-frontend-021 范围对账卡恢复 archived 降级指路
变更：2026-09-26-change-detail-restore-assets
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已归档变更（status=archived 或 location=archive）的范围对账降级态，；When `ScopeAuditCommandCard` 渲染降级横幅，；Then 重新收到 `archived={isTerminalChange(change)}` 传参，横幅追加「真实改动面见沉淀资产 · 归档留档」指路（组件侧逻辑 9c
全文：.sillyspec/changes/archive/2026-09-26-change-detail-restore-assets/requirements.md#FR-03
最近确认：83bde5d52c29cd07960e1d300d9541bf6a44a5ec

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
  status: active

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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 工作区列表每行为单行紧凑条目（无 dl 字段表/独立 footer），hover 显操作，拖拽/别名/重扫/删除行为全部保留；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-gap-fix/requirements.md#FR-01
最近确认：cf8d14e36eab43d5b4c5b9ab1d1f27620f81d1bc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-visual-gap-fix:flow:FR-01
  tests: frontend/src/components/__tests__/workspace-card.test.ts | frontend/src/components/__tests__/workspace-drag-grid.test.ts | workspaces/__tests__/page.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 概览页呈 统计四格+左主右辅两栏，Hero 之后的旧卡片流结构收敛；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-gap-fix/requirements.md#FR-02
最近确认：cf8d14e36eab43d5b4c5b9ab1d1f27620f81d1bc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-visual-gap-fix:flow:FR-02
  tests: __tests__/page-sync.test.ts | frontend/src/components/workspace/__tests__/changes-overview-card.test.ts | page.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 会话左栏条目高密度两段式，选中态清晰；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-gap-fix/requirements.md#FR-03
最近确认：cf8d14e36eab43d5b4c5b9ab1d1f27620f81d1bc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-visual-gap-fix:flow:FR-03
  tests: sessions/__tests__/page.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 相关测试全绿 + tsc 0；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-gap-fix/requirements.md#FR-04
最近确认：cf8d14e36eab43d5b4c5b9ab1d1f27620f81d1bc

## FR-auto-frontend-036 变更中心每行两段层级与原型一致（标题主行+key 副行），底部有显示 x
变更：2026-09-27-visual-align-2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 变更中心每行两段层级与原型一致（标题主行+key 副行），底部有显示 x；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-align-2/requirements.md#FR-01
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-visual-align-2:flow:FR-01
  tests: changes/__tests__/page.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When y；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-align-2/requirements.md#FR-02
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

## FR-auto-frontend-038 变更详情右侧为单块 MetaPanel 分组（负责人/消耗/变更文件/关联会话/快速任务/观测事件）
变更：2026-09-27-visual-align-2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 变更详情右侧为单块 MetaPanel 分组（负责人/消耗/变更文件/关联会话/快速任务/观测事件），时间线为竖线节点形态；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-align-2/requirements.md#FR-03
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-visual-align-2:flow:FR-03
  tests: __tests__/page-sync.test.ts | page.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-visual-align-2
  status: active

## FR-auto-frontend-039 概览右栏为 About 侧栏（路径/技术栈/关联项目/成员/创建时间）
变更：2026-09-27-visual-align-2
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 概览右栏为 About 侧栏（路径/技术栈/关联项目/成员/创建时间）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-visual-align-2/requirements.md#FR-04
最近确认：05218185395f1b6b94a0557de0af22ab7fae78d7

## FR-auto-frontend-040 相关测试全绿 + tsc 0 + 部署后截图与原型并排核对一致
变更：2026-09-27-visual-align-2
状态：active
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 审批区对 thin 出身变更显示轻量只读说明卡而非「当前无可审批事项」；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-display-fix/requirements.md#FR-02
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-043 标题区影响字段空值时不渲染占位噪音
变更：2026-09-27-thin-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 标题区影响字段空值时不渲染占位噪音；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-display-fix/requirements.md#FR-03
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-044 列表行 active thin（stage=thin）状态图标为琥珀闪电
变更：2026-09-27-thin-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 列表行 active thin（stage=thin）状态图标为琥珀闪电；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-display-fix/requirements.md#FR-04
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-045 判定函数导出+单测覆盖三分支
变更：2026-09-27-thin-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 判定函数导出+单测覆盖三分支；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-display-fix/requirements.md#FR-05
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-046 相关测试全绿 + tsc 0 + 部署后浏览器验证 hover-polish 详情
变更：2026-09-27-thin-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 相关测试全绿 + tsc 0 + 部署后浏览器验证 hover-polish 详情；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-display-fix/requirements.md#FR-06
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-047 遗留如实登记：归档 flow-thin 在列表行无出身信号（列表投影无 steps，需后端加 is_
变更：2026-09-27-thin-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 遗留如实登记：归档 flow-thin 在列表行无出身信号（列表投影无 steps，需后端加 is_thin 投影——记入后续建议不在本刀）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-thin-display-fix/requirements.md#FR-07
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-048 ChangeSummary 含 is_thin（bool，default False 零破坏），后端
变更：2026-09-27-change-list-is-thin
状态：active
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 / api 相关模块就绪；When 前端 api-types 重生成（gen:types）+ 列表行 is_thin=true 时标题行显示「轻量」琥珀徽章，归档轻量与已归档状态并存；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-change-list-is-thin/requirements.md#FR-02
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-050 后端相关测试全绿 + 前端列表测试全绿 + tsc 0 + openapi.json 同批提交
变更：2026-09-27-change-list-is-thin
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 / 前端 / api 相关模块就绪；When 后端相关测试全绿 + 前端列表测试全绿 + tsc 0 + openapi.json 同批提交；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-change-list-is-thin/requirements.md#FR-03
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-051 部署后浏览器验证归档区轻量行出身标识
变更：2026-09-27-change-list-is-thin
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 部署后浏览器验证归档区轻量行出身标识；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-change-list-is-thin/requirements.md#FR-04
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

## FR-auto-frontend-052 normalizeTestFilePath 剥离路径中的「…」注解段（支持一段或多段），剥离后为空仍
变更：2026-09-27-assets-testfile-bracket-note
状态：active
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
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 相关模块就绪；When 变更详情页步骤时间线卡与真实留痕时间线卡共存：steps 非空时合成时间线卡也渲染（组件自身空态静默隐藏兜底不变）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-timeline-coexist/requirements.md#FR-01
最近确认：d3ee2bbd7cc53faf6cabdfc312554ef032dcddb3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-timeline-coexist:flow:FR-01
  tests: __tests__/page-restore-assets.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-timeline-coexist
  status: active

## FR-auto-frontend-057 thin 在途（steps 恒空）行为不变：合成卡独立承担叙事
变更：2026-09-27-timeline-coexist
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When thin 在途（steps 恒空）行为不变：合成卡独立承担叙事；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-timeline-coexist/requirements.md#FR-02
最近确认：d3ee2bbd7cc53faf6cabdfc312554ef032dcddb3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-timeline-coexist:flow:FR-02
  tests: __tests__/page-restore-assets.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 / 测试 相关模块就绪；When 相关前端测试同步更新并全部通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-timeline-coexist/requirements.md#FR-03
最近确认：d3ee2bbd7cc53faf6cabdfc312554ef032dcddb3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-timeline-coexist:flow:FR-03
  tests: __tests__/page-restore-assets.test.ts | change-timeline-card.test.ts | page-last-signal.test.ts | page-team-toggle.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given api / 前端 / 测试 相关模块就绪；When openapi.json + api-types.ts 同步再生，后端/前端相关测试通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-timeline-task-time/requirements.md#FR-03
最近确认：365d909efbe7a04dc4429d377c5a7487713fa2b7

## FR-auto-frontend-062 变更详情页不再挂载观测事件卡（desktop 与移动端全挂载点清除）
变更：2026-09-28-drop-observation-card
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 变更详情页不再挂载观测事件卡（desktop 与移动端全挂载点清除）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-drop-observation-card/requirements.md#FR-01
最近确认：7e998a5c6bfd9fffb426588186c47e250ddf2bf5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-drop-observation-card:flow:FR-01
  tests: __tests__/page-restore-assets.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 相关测试同步更新（原断言该卡在场的用例改口径）并全部通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-drop-observation-card/requirements.md#FR-03
最近确认：7e998a5c6bfd9fffb426588186c47e250ddf2bf5

## FR-auto-frontend-065 后端 /changes/{name}/events 端点不动（CLI 推送与调试面仍在用）
变更：2026-09-28-drop-observation-card
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 端点 相关模块就绪；When 后端 /changes/{name}/events 端点不动（CLI 推送与调试面仍在用）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-drop-observation-card/requirements.md#FR-04
最近确认：7e998a5c6bfd9fffb426588186c47e250ddf2bf5

## FR-auto-frontend-066 无摘要轮显示中性占位「（无内容记录）」（muted 样式），不再出现「未加载
变更：2026-09-28-turn-nav-empty-hint
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 无摘要轮显示中性占位「（无内容记录）」（muted 样式），不再出现「未加载；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-empty-hint/requirements.md#FR-01
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-turn-nav-empty-hint:flow:FR-01
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 点击加载」误导文案；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-empty-hint/requirements.md#FR-02
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb

## FR-auto-frontend-068 「未加载」状态语义保留在 aria-label（读屏可辨）与视觉（未加载行 muted 降调不变）
变更：2026-09-28-turn-nav-empty-hint
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 「未加载」状态语义保留在 aria-label（读屏可辨）与视觉（未加载行 muted 降调不变）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-empty-hint/requirements.md#FR-03
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb

## FR-auto-frontend-069 桌面窄轨
变更：2026-09-28-turn-nav-empty-hint
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 桌面窄轨；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-empty-hint/requirements.md#FR-04
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-turn-nav-empty-hint:flow:FR-04
  tests: frontend/src/components/sessions/__tests__/turn-catalog.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 浮层行与 mobile Drawer 的同源占位文案一并修正；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-empty-hint/requirements.md#FR-05
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb

## FR-auto-frontend-071 相关测试改断言不改意图全绿，tsc
变更：2026-09-28-turn-nav-empty-hint
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 相关测试改断言不改意图全绿，tsc；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-empty-hint/requirements.md#FR-06
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb

## FR-auto-frontend-072 eslint 零新增
变更：2026-09-28-turn-nav-empty-hint
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When eslint 零新增；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-empty-hint/requirements.md#FR-07
最近确认：efcfdb431ec658f274de81ca9028bbee247b6beb

## FR-auto-frontend-073 目标：每个信号用人话说明（这是什么/要不要紧/影响什么），可机械处理的给一键按钮（推荐目标预填 +
变更：2026-09-28-knowledge-gov-ux
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 目标：每个信号用人话说明（这是什么/要不要紧/影响什么），可机械处理的给一键按钮（推荐目标预填 + 确认弹窗 + 完成反馈），不能一键的（需内容判断的）明说建议；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-01
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-knowledge-gov-ux:flow:FR-01
  tests: frontend/src/components/knowledge/__tests__/governance-cards.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 动作复用既有 POST /knowledge/governance/actions（redomain/repair），不加新写通道；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-02
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

## FR-auto-frontend-075 伪域各池（auto-sillyhub-daemon/auto-backend/auto-fronte
变更：2026-09-28-knowledge-gov-ux
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 伪域各池（auto-sillyhub-daemon/auto-backend/auto-frontend/auto-sillyspec）每池一行：人话描述+条数；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-03
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

## FR-auto-frontend-076 信号卡标题
变更：2026-09-28-knowledge-gov-ux
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 信号卡标题；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-04
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

## FR-auto-frontend-077 说明全部改为非开发者可懂文案，不再出现 CLI 命令字样
变更：2026-09-28-knowledge-gov-ux
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 说明全部改为非开发者可懂文案，不再出现 CLI 命令字样；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-05
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

## FR-auto-frontend-078 操作成功/失败有明确反馈（结果行/toast + 刷新）
变更：2026-09-28-knowledge-gov-ux
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 操作成功/失败有明确反馈（结果行/toast + 刷新）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-06
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

## FR-auto-frontend-079 既有 governance 前端测试同步更新全绿，tsc
变更：2026-09-28-knowledge-gov-ux
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 / 测试 相关模块就绪；When 既有 governance 前端测试同步更新全绿，tsc；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-07
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-knowledge-gov-ux:flow:FR-07
  tests: frontend/src/components/knowledge/__tests__/governance-cards.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When eslint 0 错；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux/requirements.md#FR-08
最近确认：5d0197df01aea20721421612c2b497a8ecc38be2

## FR-auto-frontend-081 列表行描述单行截断不再溢出覆盖右列/影响模块（min-w-0 修复），悬浮全文保留
变更：2026-09-28-change-ux-detail-batch
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 列表行描述单行截断不再溢出覆盖右列/影响模块（min-w-0 修复），悬浮全文保留；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-01
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-01
  tests: changes/__tests__/page.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 详情页头部显示变更描述（单行截断+悬浮全文）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-02
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-02
  tests: __tests__/page-restore-assets.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 平台同步处理区收进工具条按钮（搜索/重置旁），点开抽屉承载原处理区；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-03
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-03
  tests: changes/__tests__/page.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 无绑定数据源时抽屉内中性提示；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-04
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-04
  tests: changes/__tests__/page.test.ts | platform-sync-section.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 详情页轻量变更说明卡（协议 1/2、2/2 长文案）不再渲染；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-05
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-05
  tests: frontend/src/components/changes/detail/__tests__/change-stage-actions.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 顶部轻量流程条保留；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-06
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-06
  tests: __tests__/page-restore-assets.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-ux-detail-batch
  status: active

## FR-auto-frontend-087 沉淀资产卡默认展开、移入主栏，各分组卡片固定高度（超出滚动）网格对齐
变更：2026-09-28-change-ux-detail-batch
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 沉淀资产卡默认展开、移入主栏，各分组卡片固定高度（超出滚动）网格对齐；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-07
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-07
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-ux-detail-batch
  status: active

## FR-auto-frontend-088 智能体运行状态卡自桌面详情页移除（组件与移动端用法保留）
变更：2026-09-28-change-ux-detail-batch
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 相关模块就绪；When 智能体运行状态卡自桌面详情页移除（组件与移动端用法保留）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-08
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-08
  tests: __tests__/page-team-toggle.test.ts | change-agent-run-log.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 关联快速任务卡无关联时不渲染（有数据才显示）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-09
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-09
  tests: __tests__/page-team-toggle.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-ux-detail-batch
  status: active

## FR-auto-frontend-090 范围对账卡去头部说明副标题与降级双段说明，压缩为单行降级提示（归档指路保留）
变更：2026-09-28-change-ux-detail-batch
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 范围对账卡去头部说明副标题与降级双段说明，压缩为单行降级提示（归档指路保留）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-10
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-ux-detail-batch:flow:FR-10
  tests: frontend/src/components/changes/__tests__/scope-audit-command-card.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-ux-detail-batch
  status: active

## FR-auto-frontend-091 相关前端测试更新通过，tsc/eslint 0 错
变更：2026-09-28-change-ux-detail-batch
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 / 测试 相关模块就绪；When 相关前端测试更新通过，tsc/eslint 0 错；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/requirements.md#FR-11
最近确认：cde844492f904c089f4a044415a56b755f9e6bb5

## FR-auto-rontend-001 每池/每域/收件箱加「查看明细」深链（?file=fr/<domain>.md / uncatego
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 每池/每域/收件箱加「查看明细」深链（?file=fr/<domain>.md / uncategorized.md，复用页面既有深链消费能力，同页软导航）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-01
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-knowledge-gov-ux-detail:flow:FR-01
  tests: frontend/src/components/knowledge/__tests__/governance-cards.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When rot/收件箱卡加「复制 AI 处理指令」按钮（clipboard 复制即用提示词，含分布/计数；失败降级为内联展示提示词文本）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-02
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-003 binding-unresolved 卡正文补明细（锚点 id 列表）
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When binding-unresolved 卡正文补明细（锚点 id 列表）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-03
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-004 伪域未知池（如 auto-round5）也给查看链接
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 伪域未知池（如 auto-round5）也给查看链接；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-04
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-005 四类卡都能看到具体数据入口（深链到本页对应知识文件）
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 四类卡都能看到具体数据入口（深链到本页对应知识文件）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-05
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-006 rot
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When rot；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-06
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-knowledge-gov-ux-detail:flow:FR-06
  tests: frontend/src/components/knowledge/__tests__/governance-cards.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When inbox 有一键复制处理指令入口（复制成功有反馈；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-07
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-008 clipboard 不可用时内联显示可手动复制）
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When clipboard 不可用时内联显示可手动复制）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-08
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-009 分池行查看链接跳转参数正确（?file=fr/<domain>.md）
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 分池行查看链接跳转参数正确（?file=fr/<domain>.md）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-09
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-010 既有测试同步更新全绿，tsc
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 既有测试同步更新全绿，tsc；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-10
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-011 eslint 0 错
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
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
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户打开任一变更详情页（桌面宽屏 ≥1024px） 视口宽度 <1024px；When 页面渲染完成 页面渲染；Then 主体为两栏：左侧主线区（当前阶段操作 + 智能体执行日志），右侧 320px 次线侧栏（变更文件/会话调试/审核历史/任务看板） 退化为单列：主线在上，次线卡片
全文：.sillyspec/changes/archive/2026-08-11-change-detail-layout-rework/requirements.md#FR-01
最近确认：12ea22a84

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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 工作区详情页不再渲染 Agent 状态总览卡片；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-remove-liveness-overview-card/requirements.md#FR-01
最近确认：2f29e2693a12839bf3f71fb8684b5db57fc628b3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-remove-liveness-overview-card:flow:FR-01
  tests: page.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 相关模块就绪；When agent-liveness-overview-card.tsx 组件文件删除且无残留 import；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-remove-liveness-overview-card/requirements.md#FR-02
最近确认：2f29e2693a12839bf3f71fb8684b5db57fc628b3

## FR-auto-frontend-103 page.test.tsx 清理对应 mock 后工作区详情页测试通过
变更：2026-09-28-remove-liveness-overview-card
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When page.test.tsx 清理对应 mock 后工作区详情页测试通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-remove-liveness-overview-card/requirements.md#FR-03
最近确认：2f29e2693a12839bf3f71fb8684b5db57fc628b3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-remove-liveness-overview-card:flow:FR-03
  tests: page.test.ts
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 会话列表活性链路（use-session-liveness / liveness-badge）不受影响；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-remove-liveness-overview-card/requirements.md#FR-04
最近确认：2f29e2693a12839bf3f71fb8684b5db57fc628b3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-remove-liveness-overview-card:flow:FR-04
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.ts | frontend/src/hooks/__tests__/use-session-liveness.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-remove-liveness-overview-card
  status: active
