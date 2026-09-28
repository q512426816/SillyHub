---
author: sillyspec-fr-index
created_at: 2026-09-22T16:33:05.472Z
---

# FR 索引 — auto-frontend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-frontend-001 会话行状态小灯
变更：2026-09-08-session-list-liveness-dot
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
依据决策：D-001@v2、D-002@v1
场景正文：
- 场景：默认场景 — Given 会话列表已渲染且该会话在 liveness map 中命中（有 agent_session_id 关联的日志行） 会话无关联日志（map 未命中）或查询失败/加；When 30s 轮询数据到达 列表渲染；Then 行尾（相对时间后、hover 按钮前）渲染 18px 状态小灯，颜色/闪烁形态与 LivenessDot 五态视觉一致（working/blocked 呼吸闪烁
全文：.sillyspec/changes/archive/2026-09-08-session-list-liveness-dot/requirements.md#FR-01
最近确认：35f3d6528

## FR-auto-frontend-002 悬停详情卡
变更：2026-09-08-session-list-liveness-dot
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 会话行有小灯；When 鼠标悬停小灯；Then antd Popover（portal 渲染，不被行容器 overflow-hidden 裁剪）弹出详情卡：状态全名（LIVENESS_META）+ 静默时长（
全文：.sillyspec/changes/archive/2026-09-08-session-list-liveness-dot/requirements.md#FR-02
最近确认：35f3d6528

## FR-auto-frontend-003 idle 未读小红点
变更：2026-09-08-session-list-liveness-dot
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
依据决策：D-001@v2、D-003@v1
场景正文：
- 场景：默认场景 — Given localStorage 记录的该会话上次已知 state ∈ {working, blocked} 红点存在 首次见到该会话（无历史 state 记录）或 s；Then 写未读标记，小灯右上角显示 7px 红点（bg-destructive） 清除未读标记，红点消失 不亮红点（避免初次打开刷屏）；常 idle 会话（无新转移）不
全文：.sillyspec/changes/archive/2026-09-08-session-list-liveness-dot/requirements.md#FR-03
最近确认：35f3d6528

## FR-auto-frontend-004 布局与主题约束
变更：2026-09-08-session-list-liveness-dot
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 任意会话列表视图（树/平铺、归档视图、批量模式）；When 小灯与红点渲染；Then 不新增列、不改行布局（行内 flex 尾部追加 flex-none 节点）；双主题下色值均走语义阶（brand-*/muted/destructive 等，th
全文：.sillyspec/changes/archive/2026-09-08-session-list-liveness-dot/requirements.md#FR-04
最近确认：35f3d6528

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
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 用户在移动变更列表页（任一变更 tab） 重新扫描返回警告列表 重新扫描请求失败；When 点击工具栏「重新扫描」按钮 警告数 > 0 返回 ApiError；Then 调用 reparseChanges(workspaceId)，成功后显示「已重新扫描：解析 N，新增 N · 更新 N · 删除 N。W 个警告。」反馈条（文案
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-01
最近确认：d33092ea3

## FR-auto-frontend-009 列表卡片信息补齐
变更：2026-09-16-mobile-changes-parity
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given ChangeSummary.owner_name 非空 owner_name 空且 owner_id 有值 owner_name 与 owner_id 均空 a；When 渲染卡片元信息行 渲染元信息行 渲染元信息行 渲染元信息行 渲染执行用量行 渲染执行用量行 渲染执行用量行 渲染徽标行；Then 显示负责人名（owner_name） 显示 owner_id 前 8 位（mono 弱化色） 负责人段显示「—」 影响组件段省略（不占位） 显示「—」占位 整行
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-02
最近确认：d33092ea3

## FR-auto-frontend-010 列表排序切换与 URL 参数
变更：2026-09-16-mobile-changes-parity
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 用户打开筛选抽屉 URL 含 ?tab=quicklog 或 ?tab=archive（合法值） URL 含 ?search=词 未操作任何筛选、URL 无参数；When 切换「排序」chip（↓ 最近优先 / ↑ 最早优先）并确定 页面初始加载 页面初始加载 页面加载；Then sortDir 生效进主列表 query key，列表按所选方向请求 初始 tab 为该值（非法值回 active） 搜索词初始化为该值（输入框与已提交 sta
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-03
最近确认：d33092ea3

## FR-auto-frontend-011 quicklog tab 筛选
变更：2026-09-16-mobile-changes-parity
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 用户在快速修复 tab 用户选择状态=疑似中断并确定 作者选项数据 用户关闭「显示空壳占位」并确定 quicklog tab 处于抽屉筛选状态；When 打开筛选抽屉 quicklog 列表请求发出 quicklog 列表响应到达 请求发出 点击重置；Then 可见状态 4 态 chips、作者 chips、显示空壳占位开关 query key 与请求参数带 status="stale"（槽位与桌面 QuicklogT
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-04
最近确认：d33092ea3

## FR-auto-frontend-012 详情页三卡挂载
变更：2026-09-16-mobile-changes-parity
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given change.steps 存在且至少一步有 completed_at change.steps 无 completed_at（或 steps 缺失） 任意变更详；When 详情页渲染 详情页渲染 渲染；Then StageStepper 下方显示 ChangeLastSignal（最后信号相对时间） 最后信号行不渲染 挂载 ChangeUsageCard(kind="c
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-05
最近确认：d33092ea3

## FR-auto-frontend-013 详情页阶段-时间线联动
变更：2026-09-16-mobile-changes-parity
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given steps 中某阶段有条目 时间线处于阶段筛选态 某阶段在 steps 中无条目；When 点击步骤条该阶段节点 再次点击同阶段节点或点清除 chip 渲染步骤条；Then 时间线仅显示该阶段步骤，卡头出现「阶段名 ✕」清除 chip 取消筛选恢复全量 该节点不可点（无筛选效果）
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-06
最近确认：d33092ea3

## FR-auto-frontend-014 详情页删除入口
变更：2026-09-16-mobile-changes-parity
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 用户对目标变更有删除权限（canDeleteChange 启发式通过） 用户无权限 change 尚在加载（null） 用户点击删除并确认 deleteChan；When 打开 ⋯ 菜单 打开 ⋯ 菜单 渲染 ⋯ 菜单 deleteChange 成功 mutation onError；Then 出现 danger 项「删除变更」 不出现删除项（其余动作不受影响） 不出现删除项 toast「变更 {change_key} 已删除」+ 失效 ["chang
全文：.sillyspec/changes/archive/2026-09-16-mobile-changes-parity/requirements.md#FR-07
最近确认：d33092ea3

## FR-auto-frontend-015 precipitate-dialog「快速修复」蒸馏源分段带存量标注，空态文案不
变更：2026-09-25-knowledge-quick-legacy-copy
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
场景正文：
- 场景：默认场景 — Given 平台按当前契约运行；When 本变更交付并运行；Then precipitate-dialog「快速修复」蒸馏源分段带存量标注，空态文案不再引导产生新 quick 条目
全文：.sillyspec/changes/archive/2026-09-25-knowledge-quick-legacy-copy/requirements.md#FR-01
最近确认：5ae347894da3d03154c45783d115e634c8bc2390

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-quick-legacy-copy:flow:FR-01
  tests: frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-knowledge-quick-legacy-copy
  status: active

## FR-auto-frontend-016 distill-task-bar 与 distill-history-dialo
变更：2026-09-25-knowledge-quick-legacy-copy
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
场景正文：
- 场景：默认场景 — Given 平台按当前契约运行；When 本变更交付并运行；Then distill-task-bar 与 distill-history-dialog 的 quick 相关文案带存量口径
全文：.sillyspec/changes/archive/2026-09-25-knowledge-quick-legacy-copy/requirements.md#FR-02
最近确认：5ae347894da3d03154c45783d115e634c8bc2390

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-quick-legacy-copy:flow:FR-02
  tests: frontend/src/components/knowledge/__tests__/distill-history-dialog.test.tsx | frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-knowledge-quick-legacy-copy
  status: active

## FR-auto-frontend-017 knowledge/page.tsx 头部过时注释更新（快速修复 tab 已是存
变更：2026-09-25-knowledge-quick-legacy-copy
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
场景正文：
- 场景：默认场景 — Given 平台按当前契约运行；When 本变更交付并运行；Then knowledge/page.tsx 头部过时注释更新（快速修复 tab 已是存量口径）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-quick-legacy-copy/requirements.md#FR-03
最近确认：5ae347894da3d03154c45783d115e634c8bc2390

## FR-auto-frontend-018 聚焦验证（tsc + 相关组件测试）全绿，存量蒸馏功能行为零改动（纯文案面）
变更：2026-09-25-knowledge-quick-legacy-copy
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
场景正文：
- 场景：默认场景 — Given 平台按当前契约运行；When 本变更交付并运行；Then 聚焦验证（tsc + 相关组件测试）全绿，存量蒸馏功能行为零改动（纯文案面）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-quick-legacy-copy/requirements.md#FR-04
最近确认：5ae347894da3d03154c45783d115e634c8bc2390

## FR-auto-frontend-019 变更详情页重新挂载沉淀资产卡
变更：2026-09-26-change-detail-restore-assets
状态：active
摘要：默认场景
待复核：2026-09-28-turn-nav-hover-flyout
场景正文：
- 场景：默认场景 — Given main 分支的变更详情页（`[cid]/page.tsx`）在 304eba982 被夹带的旧版页面覆盖，；When 用户打开任一变更详情页，
全文：.sillyspec/changes/archive/2026-09-26-change-detail-restore-assets/requirements.md#FR-01
最近确认：83bde5d52c29cd07960e1d300d9541bf6a44a5ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-change-detail-restore-assets:flow:FR-01
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-change-detail-restore-assets
  status: active

## FR-auto-frontend-020 标题阶段徽章恢复 thin/quick 口径
变更：2026-09-26-change-detail-restore-assets
状态：active
摘要：默认场景
待复核：2026-09-28-turn-nav-hover-flyout
场景正文：
- 场景：默认场景 — Given `current_stage="thin"` 的轻量变更在标题旁只显示弱化的 outline 徽章（fallback 路径），；When 详情页渲染 thin 或 quick 阶段变更，；Then thin 显示品牌紫 default 徽章「轻量变更」、quick 显示 default 徽章「快速任务（存量）」（`STATUS_BADGE` 四态：quic
全文：.sillyspec/changes/archive/2026-09-26-change-detail-restore-assets/requirements.md#FR-02
最近确认：83bde5d52c29cd07960e1d300d9541bf6a44a5ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-change-detail-restore-assets:flow:FR-02
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-change-detail-restore-assets
  status: active

## FR-auto-frontend-021 范围对账卡恢复 archived 降级指路
变更：2026-09-26-change-detail-restore-assets
状态：active
摘要：默认场景
待复核：2026-09-28-turn-nav-hover-flyout
场景正文：
- 场景：默认场景 — Given 已归档变更（status=archived 或 location=archive）的范围对账降级态，；When `ScopeAuditCommandCard` 渲染降级横幅，；Then 重新收到 `archived={isTerminalChange(change)}` 传参，横幅追加「真实改动面见沉淀资产 · 归档留档」指路（组件侧逻辑 9c
全文：.sillyspec/changes/archive/2026-09-26-change-detail-restore-assets/requirements.md#FR-03
最近确认：83bde5d52c29cd07960e1d300d9541bf6a44a5ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-change-detail-restore-assets:flow:FR-03
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-change-detail-restore-assets
  status: active

## FR-auto-frontend-022 聚焦测试与类型门禁全绿
变更：2026-09-26-change-detail-restore-assets
状态：active
摘要：默认场景
待复核：2026-09-28-turn-nav-hover-flyout
场景正文：
- 场景：默认场景 — Given 三处恢复落盘，；Then 全部用例通过且类型检查 0 错。
全文：.sillyspec/changes/archive/2026-09-26-change-detail-restore-assets/requirements.md#FR-04
最近确认：83bde5d52c29cd07960e1d300d9541bf6a44a5ec

## FR-auto-frontend-023 测试文件预览路径解析兜底（归一 + 文件名搜索 + 后缀救回）
变更：2026-09-26-assets-testfile-path-resolve
状态：active
摘要：默认场景
待复核：2026-09-28-turn-nav-hover-flyout
场景正文：
- 场景：默认场景 — Given 归档件 test-trace.json 记录的测试文件路径可能是短路径（如 `tests/test_full_sync_convergence.py`，实为仓库；When 用户在沉淀资产卡「测试绑定」行点开测试文件预览，；Then 弹窗先对记录路径做知识库同款字符串归一（反斜杠→斜杠、去 `./` 前缀），再按文件名调 explorer search 全树搜索：命中路径与归一路径**等值*
全文：.sillyspec/changes/archive/2026-09-26-assets-testfile-path-resolve/requirements.md#FR-01
最近确认：49117b2a8bfc07fb875117a81dcd1c9a8d9f6ba1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-assets-testfile-path-resolve:flow:FR-01
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-assets-testfile-path-resolve
  status: active

## FR-auto-frontend-024 未命中走中性文案，消除「工作区目录可能已被移动或删除」误导
变更：2026-09-26-assets-testfile-path-resolve
状态：active
摘要：默认场景
待复核：2026-09-28-turn-nav-hover-flyout
场景正文：
- 场景：默认场景 — Given 记录路径在仓库内零命中或多候选（用户需自选），；When 预览弹窗渲染解析结果，；Then 前端显示中性提示（未在仓库中找到该测试文件、路径可能不完整或已被移动/删除；多候选时列候选），不出现「工作区目录可能已被移动或删除」语义；explorer 后端
全文：.sillyspec/changes/archive/2026-09-26-assets-testfile-path-resolve/requirements.md#FR-02
最近确认：49117b2a8bfc07fb875117a81dcd1c9a8d9f6ba1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-assets-testfile-path-resolve:flow:FR-02
  tests: backend/tests/modules/explorer/test_explorer.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-assets-testfile-path-resolve
  status: active

## FR-auto-frontend-025 前端组件测试补齐且既有用例不回归
变更：2026-09-26-assets-testfile-path-resolve
状态：active
摘要：默认场景
待复核：2026-09-28-turn-nav-hover-flyout
场景正文：
- 场景：默认场景 — Given 路径解析逻辑落盘，；When 运行 change-assets-card 组件套件，；Then 新增用例（等值命中直用、短路径唯一后缀救回、worktree 副本排除后救回、零命中中性文案）与既有 10 用例全部通过。
全文：.sillyspec/changes/archive/2026-09-26-assets-testfile-path-resolve/requirements.md#FR-03
最近确认：49117b2a8bfc07fb875117a81dcd1c9a8d9f6ba1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-assets-testfile-path-resolve:flow:FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-assets-testfile-path-resolve
  status: active

## FR-auto-frontend-026 后端聚焦测试与类型门禁全绿
变更：2026-09-26-assets-testfile-path-resolve
状态：active
摘要：默认场景
待复核：2026-09-28-turn-nav-hover-flyout
场景正文：
- 场景：默认场景 — Given explorer 文案修改落盘，；When 运行后端 explorer 聚焦测试与 `frontend tsc --noEmit`，；Then 全部通过且类型检查 0 错。
全文：.sillyspec/changes/archive/2026-09-26-assets-testfile-path-resolve/requirements.md#FR-04
最近确认：49117b2a8bfc07fb875117a81dcd1c9a8d9f6ba1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-assets-testfile-path-resolve:flow:FR-04
  tests: backend/tests/modules/explorer/test_explorer.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-assets-testfile-path-resolve
  status: active

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
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When ChangeSummary 含 is_thin（bool，default False 零破坏），后端投影测试覆盖三分支+时间窗负向；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-change-list-is-thin/requirements.md#FR-01
最近确认：4d340be72fb09d9a120c2f65a6416da45f4f293e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-change-list-is-thin:flow:FR-01
  tests: backend/app/modules/change/tests/test_enrich_projection.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
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
待复核：2026-09-28-turn-nav-hover-flyout
场景正文：
- 场景：默认场景 — Given 系统就绪；When normalizeTestFilePath 剥离路径中的「…」注解段（支持一段或多段），剥离后为空仍按未找到处理；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-assets-testfile-bracket-note/requirements.md#FR-01
最近确认：99c508227642192dc929cd0702441f3303a6ceff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-assets-testfile-bracket-note:flow:FR-01
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-assets-testfile-bracket-note
  status: active

## FR-auto-frontend-053 TestFileBody 用剥离后的文件名发起 explorer search，粘注解路径可等值
变更：2026-09-27-assets-testfile-bracket-note
状态：active
摘要：默认场景
待复核：2026-09-28-turn-nav-hover-flyout
场景正文：
- 场景：默认场景 — Given 系统就绪；When TestFileBody 用剥离后的文件名发起 explorer search，粘注解路径可等值；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-assets-testfile-bracket-note/requirements.md#FR-02
最近确认：99c508227642192dc929cd0702441f3303a6ceff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-assets-testfile-bracket-note:flow:FR-02
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-assets-testfile-bracket-note
  status: active

## FR-auto-frontend-054 后缀命中并打开真实测试文件预览
变更：2026-09-27-assets-testfile-bracket-note
状态：active
摘要：默认场景
待复核：2026-09-28-turn-nav-hover-flyout
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 后缀命中并打开真实测试文件预览；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-assets-testfile-bracket-note/requirements.md#FR-03
最近确认：99c508227642192dc929cd0702441f3303a6ceff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-assets-testfile-bracket-note:flow:FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-assets-testfile-bracket-note
  status: active

## FR-auto-frontend-055 既有 change-assets-card 路径解析用例全绿，新增用例覆盖多段注解与搜索入参为干净文
变更：2026-09-27-assets-testfile-bracket-note
状态：active
摘要：默认场景
待复核：2026-09-28-turn-nav-hover-flyout
场景正文：
- 场景：默认场景 — Given 系统就绪；When 既有 change-assets-card 路径解析用例全绿，新增用例覆盖多段注解与搜索入参为干净文件名；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-assets-testfile-bracket-note/requirements.md#FR-04
最近确认：99c508227642192dc929cd0702441f3303a6ceff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-assets-testfile-bracket-note:flow:FR-04
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
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
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
场景正文：
- 场景：默认场景 — Given 系统就绪；When TimelineTask 增加 time 字段（翻格顺序推断的勾选时刻，游标衔接赋值、中段断裂停止、尾部未勾不标断裂——CLI inferFlipTimes 同；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-timeline-task-time/requirements.md#FR-01
最近确认：365d909efbe7a04dc4429d377c5a7487713fa2b7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-timeline-task-time:flow:FR-01
  tests: backend/app/modules/change/tests/test_timeline.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-timeline-task-time
  status: active

## FR-auto-frontend-060 前端任务面显示 ≈HH:mm:ss 时刻列（已勾无时刻显示 ?，未勾不显示）
变更：2026-09-27-timeline-task-time
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
场景正文：
- 场景：默认场景 — Given 前端 相关模块就绪；When 前端任务面显示 ≈HH:mm:ss 时刻列（已勾无时刻显示 ?，未勾不显示）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-timeline-task-time/requirements.md#FR-02
最近确认：365d909efbe7a04dc4429d377c5a7487713fa2b7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-timeline-task-time:flow:FR-02
  tests: frontend/src/components/changes/detail/__tests__/change-timeline-card.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-timeline-task-time
  status: active

## FR-auto-frontend-061 openapi.json + api-types.ts 同步再生，后端/前端相关测试通过
变更：2026-09-27-timeline-task-time
状态：active
摘要：默认场景
待复核：2026-09-27-thin-affected-modules-from-patch-manifest
场景正文：
- 场景：默认场景 — Given api / 前端 / 测试 相关模块就绪；When openapi.json + api-types.ts 同步再生，后端/前端相关测试通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-timeline-task-time/requirements.md#FR-03
最近确认：365d909efbe7a04dc4429d377c5a7487713fa2b7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-timeline-task-time:flow:FR-03
  tests: backend/app/modules/change/tests/test_timeline.py | frontend/src/components/changes/detail/__tests__/change-timeline-card.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-timeline-task-time
  status: active

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
