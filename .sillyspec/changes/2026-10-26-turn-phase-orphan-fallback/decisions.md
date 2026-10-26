# 决策记录

## D-001@v1 回退安全性前提=单会话单活跃 run 不变式(反例排查)

- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: 阶段事件回退归属到"当前活跃轮"的安全性依据是什么？跨轮子代理等场景会不会出现多活跃轮（用户质疑）？
- answer: 前提=平台「单会话单活跃 run」硬不变式。反例逐一排查：①跨轮子代理——parent_tool_use_id 归属派生轮，是轮内事件不建轮，不产生 turn_phase；②团队分身——parent_session_id 独立会话树，事件按 agent_session:{id} 频道各自路由；③忙轮守卫——已有活跃轮时后端拒绝新 run（DaemonSessionTurnConflict）或转排队（排队消息非活跃轮，派发建轮才活跃）；④steering 中途注入——沿用活跃 run 不建新轮；⑤自动续跑——前轮终态后才建新轮。实现侧保险：回退只写 currentRunId 指向的轮（现有状态机维护，只指向 pending/running/interrupting），不做模糊匹配。
- normalized_requirement: 若未来平台放松单活跃 run 不变式（如允许会话内并行多轮），本回退语义必须重新评估（FR-05）。
- impacts: [FR-01, FR-04, FR-05]
- evidence: backend/app/modules/daemon/session/service/queue.py 忙轮守卫（DaemonSessionTurnConflict）；backend/app/modules/agent/model.py AgentSession.parent_session_id 会话树；frontend/src/components/daemon/session-panel/turn-state.ts:73（currentRunId 只指向 pending/running/interrupting）

