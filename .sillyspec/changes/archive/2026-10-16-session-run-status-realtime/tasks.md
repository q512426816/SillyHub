---
author: flow-machine-draft
created_at: 2026-10-16T01:42:05.704Z
---
# 任务注册表（Tasks）— 2026-10-16-session-run-status-realtime

- [x] task-01: 列表端点每会话注入 current_run_status（活跃 run 最新一条的状态：pending/running/pending_approval；无活跃 run 为 null），照 owner_name IN 批查先例零 N+1
- [x] task-02: 前端判定优先级：终态红/绿不变；run=pending_approval 优先显示琥珀在等你；run=pending/running 优先转圈；其后活性 working/blocked 兜底（本地会话）；再 reconnecting 转圈；idle+完成标记绿点；其余留白
- [x] task-03: 完成通知新增 run 完成触发源：current_run_status 从活跃变 null 且会话非终态且不在该会话上 → 标记完成（与活性转移、终态两来源共键）
- [x] task-04: schema 变更同步再生前端与 daemon 两处 api-types 并提交 openapi.json
- [x] task-05: 后端列表注入测试 + 前端判定测试全过，lint/tsc 零告警
