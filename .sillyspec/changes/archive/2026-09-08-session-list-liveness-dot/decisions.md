---
author: qinyi
created_at: 2026-09-07 23:45:12
---

# 决策记录 — 2026-09-08-session-list-liveness-dot

## D-001@v2 liveness 联表取数与未读转移检测（客户端状态机）

- type: architecture
- priority: P0
- status: accepted
- supersedes: D-001@v1
- source: design-grill（BL-01/BL-03/CC-01 实证修订；v1 的「state_derived_at 当转移时刻比较」公式被证伪）
- question: 未读小红点如何判定才不被 10s 心跳戳干扰？取数缓存槽如何取？
- answer: **客户端转移检测状态机**：hook 每轮（30s）对每个有 liveness 的会话，取 localStorage 存的该会话「上次已知 state」与当前 state 比较——`prevState ∈ {working, blocked}` 且 `current == idle` 时置未读标记（`sillyhub:liveness-unread:${sessionId}` = 转移发现时间戳）；随后更新 `sillyhub:liveness-state:${sessionId}` = current。红点显示 = 未读标记存在；`selected` 置真（覆盖点击/Enter/深链三路）时清除未读标记。首次见到该会话（无 prevState，含 unknown/无记录）不亮红点，避免初次打开刷屏。取数缓存槽固定 `"all"`（queryKey `["agent-liveness-overview", "all"]`）——API 本就不按 workspace 过滤（鉴权 scope 全量），固定槽让悬浮宿主/门户多挂载共享同一份缓存与轮询；与总览卡（wsId 槽）各自独立互不干扰（跨路由 gcTime 内仍可复用 react-query 缓存）。
- reason:
  - `state_derived_at` 是 tailer 每 10s tick 无条件覆写的心跳戳（tailer.ts:243 → daemon.ts:5167 → platform_sync/service.py:1091 三点铁证），不是转移时刻——v1 公式会导致红点对所有 idle 会话常亮复现（BL-01）；
  - 客户端转移检测保持纯前端/不动状态枚举/不动后端三约束全不破；30s 轮询窗口内 working→idle 转移最迟 30s 后被发现，可接受；
  - 已读写入点挂 `selected` 置真而非 onSelect——深链 `?session=` 经 useEffect 直置 selectedSessionId 不走 onSelect（BL-03）；
  - 固定 "all" 槽消除 wsId 槽碎片化（API 无 workspace 过滤参数，槽位带 wsId 只是缓存分裂，CC-01）。
- normalized_requirement: localStorage 两键（state 记忆 + unread 标记）均按会话 id；未读仅由 working/blocked→idle 边触发；清除仅由 selected 置真触发；hook queryKey 固定第二段 "all"；异常 try/catch 降级（存储不可用=不亮红点不崩）。
- impacts: [FR-01, FR-03, task-01, task-02]
- 模块域: frontend
- evidence: Grill CC-02/CC-03/CC-01（sillyhub-daemon/src/agent-log/liveness/tailer.ts:206-225,243、src/daemon.ts:5165-5169、backend/app/modules/platform_sync/service.py:1089-1091、frontend/src/components/sessions/sessions-portal.tsx:152-176、frontend/src/components/daemon/floating-session-host.tsx:471）。

## D-003@v1 未读转移语义继承（归档草案 D-006 落地）

- type: definition
- priority: P1
- status: accepted
- source: user（归档变更 2026-09-07-agent-liveness-states 的 sillyspec 仓草案 D-006 语义 + 本次用户规格；仓内归档 decisions.md 未收录该编号，本条把语义正式落本变更决策台账，消除悬空引用）
- question: 「idle 未读小红点」的触发边与清除语义是什么？
- answer: 触发边 = `working/blocked → idle` 状态转移（用户原话）；清除 = 用户看过该会话（点开）；**不往状态枚举加「未读」**（用户硬约束）。
- normalized_requirement: 见 D-001@v2（本条为其语义来源）；实现与测试均以此边为准，unknown→idle 不触发。
- impacts: [FR-03]
- 模块域: frontend
- evidence: 用户规格（「working/blocked → idle 转移时…用户看过（点开该会话）后消失…不要往状态枚举里加"未读"」）；归档 design.md §5.4 对草案 D-006 的引用。

## D-002@v1 展示硬约束继承（D-004 两层 + 双主题 + 悬停卡定位）

- type: boundary
- priority: P1
- status: accepted
- source: user（继承归档变更 2026-09-07-agent-liveness-states 的用户决策 D-004@v1 与本次用户规格）+ design-grill（BL-02/CC-04 悬停卡定位与内容修订）
- question: 会话列表行的状态展示边界与悬停卡如何落地？
- answer: 行尾**只加 ~18px 状态小灯**（复用 `liveness-badge.tsx` 的 LivenessDot 与 LIVENESS_META，不重写五态视觉）；**不新增列、不改列表布局**；完整信息只出现在悬停卡；无关联日志的会话不显示灯；色值只用语义阶。悬停卡用 **antd Popover（trigger=hover，默认 portal 渲染）**包住 18px 小灯实现——SessionRow 根节点 `overflow-hidden` 会裁剪 absolute 定位卡片（session-list-panel.tsx:2640，Grill BL-02），portal 渲染是唯一不破行布局的落法；悬停卡内容为**组合渲染**（LIVENESS_META 状态名 + 静默时长相对时间（last_event_at）+ 证据摘要（state_evidence 截断）+ 推导时间（state_derived_at）），不直接用 livenessTitle 单行字符串（其为原生 tooltip 拼接形态）；「关联」行删除（AgentLogListItem 无 change_key/quick_id 数据源，Grill CC-04）。
- normalized_requirement: 列表布局零变化；SessionRow 行结构仅追加 Popover 包裹的小灯节点；悬停卡=Popover content 组合渲染四行信息；无 agent_session_id 命中=不渲染。
- impacts: [FR-02, task-02]
- 模块域: frontend
- evidence: 归档 decisions.md D-004@v1（用户 AskUserQuestion 实答选 A）；归档 design.md §5.4；本次用户规格验收段；Grill CC-04/CC-05（liveness-badge.tsx:52/:90 签名、session-list-panel.tsx:2640 overflow-hidden）。
