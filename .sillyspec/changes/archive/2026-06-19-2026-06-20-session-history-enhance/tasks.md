---
author: qinyi
created_at: 2026-06-20T00:45:00
---

# tasks: 交互式会话历史回看体验增强

仅列任务名，细节在 plan 阶段（Wave 分组 + 依赖 + 验收）展开。
决策引用：D-001@v1（prompt落user log）/ D-002@v1（续聊resume机制）/ D-003@v1（任意删+active先end）/ D-004@v1（failed重开=agent_session_id存在）/ D-005@v1（历史不补）。

## Wave 0 — 问题①③（独立可先行）
- [ ] T1 · backend create_session/inject_session 落 AgentRunLog(channel="user")（D-001@v1, D-005@v1）
- [ ] T2 · frontend SessionHistoryView 按 channel 渲染用户/agent 气泡（D-001@v1）
- [ ] T3 · backend delete_agent_session 去 active 拒绝、active 先内部 end 再硬删（D-003@v1）
- [ ] T4 · frontend SessionsSidebar 去 {!active} 删除限制（D-003@v1）

## Wave 1 — 问题②续聊链路（后端 + daemon）
- [ ] T5 · backend reopen_session 方法 + POST /sessions/{id}/reopen 路由 + 错误码 RESUME_UNSUPPORTED/NO_AGENT_SESSION/OFFLINE（D-002@v1, D-004@v1）
- [ ] T6 · backend protocol.py 加 SESSION_RESUME 常量 + GET /sessions/{id} 单查端点 + get_agent_session（D-002@v1）
- [ ] T7 · backend reopen 状态转换 ended/failed→reconnecting、新 lease、rotate claim_token、发 daemon:session_resume（D-002@v1, D-004@v1）
- [ ] T8 · daemon protocol.ts SESSION_RESUME + _routeSessionControl 分支调 restoreAndReconnect + markReconnected（D-002@v1）

## Wave 2 — 问题②续聊前端（用户可见体验）
- [ ] T9 · frontend reopenSession + getAgentSession API（D-002@v1）
- [ ] T10 · frontend InteractiveSessionPanel attach 模式（SSE + 预填 turn + 轮询到 active 启用输入）（D-002@v1）
- [ ] T11 · frontend 续聊按钮（可用性判断 D-004@v1）+ SessionListSection 接线（D-002@v1）

## 跨 Wave
- [ ] T12 · 模块文档同步（backend/frontend/sillyhub-daemon 变更索引）+ 测试补齐（D-001~D-005@v1）
