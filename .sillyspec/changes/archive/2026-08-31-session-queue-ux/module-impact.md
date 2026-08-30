---
author: qinyi
created_at: 2026-08-31 04:30:00
change: 2026-08-31-session-queue-ux
---

# 模块影响分析（Module Impact）— 会话消息排队体验修复与增强

| 模块 | 文档 | 影响 | 操作 | 状态 |
|---|---|---|---|---|
| backend | modules/backend.changelog.md | agent_session_queued_messages 加 position 列（迁移 20260831130000 三步走回填）；dispatch 循环化（连续失败≥2 停/非终态非 active 保持 pending/终态 {ended,failed} 才批量 fail）；confirm_session_reconnected 恢复钩子 + SessionService._fire_background_task；三新端点（PATCH queue/reorder、PATCH queue/{id}、POST queue/{id}/dispatch-now）+ DTO + queue_changed 补发 | 归档期补记变更索引条目（task-13 收尾先落 changelog，归档对账） | pending |
| frontend | modules/frontend.changelog.md | streamSession 加 queue_changed 分发；useMessageQueue 三新方法；MessageQueueBar 拖拽/⚡/✎ 重构；session-panel SSE 与回调接线；CopyButton 组件三处挂载（turn-timeline 用户气泡/TextSegmentView/ThinkingRowView） | 归档期补记变更索引条目（task-13 收尾先落 changelog，归档对账） | pending |
| sillyhub-daemon | modules/sillyhub-daemon.md | **零改动**（NG-06：interrupt/派发链路全复用；置队首+打断→终态钩子接力是既有机制） | 无 | skipped |
| ci | modules/ci.md | 无变化（测试命令/gen:types 流程既有；不新增闸门） | 无 | skipped |
| docs | modules/docs.md | 无变化 | 无 | skipped |
| deploy | modules/deploy.md | 无变化（迁移随既有 alembic 部署链路；task-13 本地 Docker Postgres 应用验证） | 无 | skipped |
| sillyspec | modules/sillyspec.md | 无变化（本变更产物即流程自身文档） | 无 | skipped |
| _module-map.yaml | — | 无变化（未增删模块） | 无 | skipped |
