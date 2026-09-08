---
author: qinyi
created_at: 2026-09-08 00:20:00
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 会话列表浏览者（登录用户） | 在会话门户/悬浮会话宿主浏览会话树的用户；被动接收状态展示与未读提示，无新增操作 |
| 前端数据管道（hook） | use-session-liveness：取数、建 map、客户端转移检测（本变更新增的唯一"主动方"） |

## 功能需求

### FR-01: 会话行状态小灯
覆盖决策：D-001@v2, D-002@v1
Given 会话列表已渲染且该会话在 liveness map 中命中（有 agent_session_id 关联的日志行）
When 30s 轮询数据到达
Then 行尾（相对时间后、hover 按钮前）渲染 18px 状态小灯，颜色/闪烁形态与 LivenessDot 五态视觉一致（working/blocked 呼吸闪烁），随轮询刷新

Given 会话无关联日志（map 未命中）或查询失败/加载中
When 列表渲染
Then 不渲染小灯（fail-open），列表其余功能不受影响

### FR-02: 悬停详情卡
覆盖决策：D-002@v1
Given 会话行有小灯
When 鼠标悬停小灯
Then antd Popover（portal 渲染，不被行容器 overflow-hidden 裁剪）弹出详情卡：状态全名（LIVENESS_META）+ 静默时长（last_event_at 相对时间）+ 证据摘要（state_evidence 截断）+ 推导时间（state_derived_at）；不展示无数据源的「关联」行

### FR-03: idle 未读小红点
覆盖决策：D-001@v2, D-003@v1
Given localStorage 记录的该会话上次已知 state ∈ {working, blocked}
When 30s 轮询发现当前 state = idle
Then 写未读标记，小灯右上角显示 7px 红点（bg-destructive）

Given 红点存在
When 该会话行 selected 置真（点击选中 / Enter / 深链 ?session= 三路之一）
Then 清除未读标记，红点消失

Given 首次见到该会话（无历史 state 记录）或 state 从 unknown/ended 直接变为 idle
When 轮询处理
Then 不亮红点（避免初次打开刷屏）；常 idle 会话（无新转移）不重复亮

Given localStorage 不可用（隐私模式/配额异常）
When hook 处理
Then try/catch 降级：转移检测停摆（不亮红点）、不崩溃、小灯照常

### FR-04: 布局与主题约束
Given 任意会话列表视图（树/平铺、归档视图、批量模式）
When 小灯与红点渲染
Then 不新增列、不改行布局（行内 flex 尾部追加 flex-none 节点）；双主题下色值均走语义阶（brand-*/muted/destructive 等，themes.ts 单源）

## 非功能需求

- 兼容性：纯前端增量，无后端/schema/API 改动；既有 session-list-panel 测试零回归。
- 可测试：hook 状态机（转移检测各边）与组件渲染（灯/卡/红点）均可单测；测试需 vi.mock("@/lib/agent-logs")。
- 性能：Popover 懒渲染（hover 才挂载 content）；固定 "all" 槽多挂载共享一份缓存与轮询。
- 数据口径：limit=100 与总览卡一致；同 agent_session_id 多行取最新（DESC 首个胜出）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v2 | FR-01, FR-03 | 客户端转移检测状态机 + 固定 "all" 缓存槽（supersedes D-001@v1） |
| D-002@v1 | FR-01, FR-02, FR-04 | 展示硬约束（18px/不新增列/Popover portal/组合渲染） |
| D-003@v1 | FR-03 | 未读转移语义（working/blocked→idle 边；归档草案 D-006 落地） |
