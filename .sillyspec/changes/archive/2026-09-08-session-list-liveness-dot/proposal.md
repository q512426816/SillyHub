---
author: qinyi
created_at: 2026-09-08 00:20:00
---

# 提案书（Proposal）

## 动机

上一变更 2026-09-07-agent-liveness-states 已把 agent 会话活性状态（working/blocked/idle/ended/unknown）全链路落库并展示在「工作台状态总览卡」与「agent 日志面板徽章」，但用户最常驻留的**会话列表行没有状态小灯**（归档 verify-result NOTES 登记的两个已知 UI 缺口）。用户在会话列表看不到哪些 Agent 在干活、哪些在等人，需要切到工作台才能获知——本变更补齐这最后一层展示。

## 关键问题

1. **缺口①**：会话列表行无状态指示——归档时因需「SessionsPortal 与 platform_agent_logs 的 liveness 联表管道 + session-list-panel 大组件手术」单独留下。
2. **缺口②**：idle 未读提示缺失——working/blocked → idle 转移（Agent 从干活转为空闲等人反馈）用户无感知，错过及时跟进的时机。
3. **数据已就绪但未被消费**：`GET /api/agent-logs` 响应已含 state/state_evidence/state_derived_at/last_event_at/agent_session_id 全部所需字段（类型已在 api-types 生成），前端只差消费管道。

## 变更范围

- 新 hook `use-session-liveness.ts`：30s 轮询取数（固定 "all" 缓存槽）按 agent_session_id 建 map + 客户端转移检测状态机（D-001@v2）。
- session-list-panel.tsx：SessionRow 行尾 antd Popover 包裹的 18px 状态小灯（复用 LivenessDot 五态视觉）+ 悬停组合渲染详情卡 + idle 未读小红点（selected 置真清除）。
- 测试：既有 session-list-panel 测试补用例（含 vi.mock @/lib/agent-logs）+ 新 hook 测试。

## 不在范围内（显式清单）

- 不改后端任何代码（联表全在前端侧；无 gen:types 需要）。
- 不往 liveness 状态枚举加「未读」（用户硬约束；未读是纯 UI 本地状态）。
- 不做跨设备已读同步（localStorage 浏览器本地）。
- 不改工作台总览卡与日志面板徽章两处既有展示。
- 不做群聊行（GroupChatRow）的小灯。
- 不用 state_derived_at 做转移判定（Grill BL-01 实证其为 10s 心跳戳，已改客户端转移检测）。

## 成功标准（可验证）

- 列表布局零变化（不新增列、归档分组/机器小节/批量模式等既有逻辑零触碰）。
- 有关联日志的会话状态正确显示且随 30s 轮询刷新；无关联会话不显示灯。
- 双主题（blue/ai-native）正常（色值只用语义阶，themes.ts 铁律）。
- working/blocked → idle 转移的行出现未读红点，点开该会话（点击/Enter/深链三路）后消失；首见不亮、常 idle 不复现。
- 既有 session-list-panel 测试零回归 + tsc 干净 + 新增行为有测试。
