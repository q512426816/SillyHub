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
依据决策：D-001@v2、D-002@v1
场景正文：
- 场景：默认场景 — Given 会话列表已渲染且该会话在 liveness map 中命中（有 agent_session_id 关联的日志行） 会话无关联日志（map 未命中）或查询失败/加；When 30s 轮询数据到达 列表渲染；Then 行尾（相对时间后、hover 按钮前）渲染 18px 状态小灯，颜色/闪烁形态与 LivenessDot 五态视觉一致（working/blocked 呼吸闪烁
全文：.sillyspec/changes/archive/2026-09-08-session-list-liveness-dot/requirements.md#FR-01
最近确认：35f3d6528

## FR-auto-frontend-002 悬停详情卡
变更：2026-09-08-session-list-liveness-dot
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 会话行有小灯；When 鼠标悬停小灯；Then antd Popover（portal 渲染，不被行容器 overflow-hidden 裁剪）弹出详情卡：状态全名（LIVENESS_META）+ 静默时长（
全文：.sillyspec/changes/archive/2026-09-08-session-list-liveness-dot/requirements.md#FR-02
最近确认：35f3d6528

## FR-auto-frontend-003 idle 未读小红点
变更：2026-09-08-session-list-liveness-dot
状态：active
摘要：默认场景
依据决策：D-001@v2、D-003@v1
场景正文：
- 场景：默认场景 — Given localStorage 记录的该会话上次已知 state ∈ {working, blocked} 红点存在 首次见到该会话（无历史 state 记录）或 s；Then 写未读标记，小灯右上角显示 7px 红点（bg-destructive） 清除未读标记，红点消失 不亮红点（避免初次打开刷屏）；常 idle 会话（无新转移）不
全文：.sillyspec/changes/archive/2026-09-08-session-list-liveness-dot/requirements.md#FR-03
最近确认：35f3d6528

## FR-auto-frontend-004 布局与主题约束
变更：2026-09-08-session-list-liveness-dot
状态：active
摘要：默认场景
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
