---
author: flow-machine-draft
created_at: 2026-10-13T04:48:36.107Z
---
# 决策记录（Decisions）— 2026-10-13-turn-live-visibility

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险是共享文件混提交：turn-segment-views.tsx / session-panel-page.tsx 工作区带有进行中变更（2026-10-13-subagent-stub-reconcile、2026-10-13-session-taskwakeup-hide）的未提交 hunk，本变更提交必须选择性暂存（git add -p 仅取本变更 hunk），禁止整文件 add 裹挟。次要风险：①「running→终态对账提权」与 stub-reconcile 的「元数据>对账>段三态」优先级契约交叉——本变更只放宽 running 态方向（终态快照可收敛 running 元数据），契约在 subagentHeaderOf/reconcileTaskStatusForDisplay 注释双向写明；若其收口验证发现冲突，以并集语义（终态优先）收口。②daemon 提频的后端容量——最坏 2 条/s/call 的 usage_update 走既有落库+publish 批量管线，THINKING_FLUSH（字符/时间双节流）已是同量级先例；若后端观测到压力，时间门限 500ms→1000ms 单点可调。③dialog 旧宿主无 Provider——lookup null 路径全部回退既有推导（测试守卫）。 试过但放弃的方案：①前端按 tok/s 假插值补齐刷新（无真实增量的伪造数字，放弃）；②等待提示并入 TurnStatusBar 全局横幅（丢失时间线位置语义、与工具行信息重复，放弃）；③daemon 补发 [TASK_*] 终态行协议修复残留（动 daemon 协议面且 stub-reconcile 的快照对账已在同方向覆盖，放弃）；④段数据层收敛（turn-state reducer 把快照终态写回 segment.taskStatus）——侵入归并状态机、与装配器 [TASK_*] 路由双写打架，渲染层对账已覆盖全部消费面，放弃。
