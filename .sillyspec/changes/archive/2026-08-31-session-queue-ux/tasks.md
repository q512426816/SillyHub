---
author: qinyi
created_at: 2026-08-31 03:40:00
change: 2026-08-31-session-queue-ux
---

# 任务（Tasks）— 会话消息排队体验修复与增强

> 任务名唯一真相在本文件；plan.md Wave 段纯 ID 引用（Wave 划分含文件不相交铁律）。
> 设计依据 design.md（FR-01~07 / R-01~06 / D-001~010）。

- [x] task-01: 迁移三步走——agent_session_queued_messages 加 position 列（nullable → CTE ROW_NUMBER(created_at,id) 回填 → NOT NULL），down_revision=20260831120000
- [x] task-02: AgentSessionQueuedMessage.position 模型字段 + 入队路径行锁内 MAX+1 + list/dispatch 排序键改 ORDER BY position, created_at（agent/model.py + session/service.py 入队/查询段）
- [x] task-03: dispatch_queued_messages 循环化（连续失败 ≥2 停；非终态非 active 保持 pending；终态 {ended,failed} 才批量 fail）+ SessionService 新增 _fire_background_task helper + confirm_session_reconnected active commit 点后 fire 派发钩子
- [x] task-04: 三端点 + DTO + 事件——PATCH /queue/reorder（先注册；ids 全集校验 422 QUEUE_ORDER_MISMATCH）+ PATCH /queue/{entry_id}（1..8000；TASK_WAKEUP 前缀 409；failed 重置 pending+清 error+尝试派发）+ POST /queue/{entry_id}/dispatch-now（置队首+忙时 _send_interrupt_control 抽取复用/空闲直发；非 active 409；响应 {interrupted}）+ queue_changed 补发（reordered/edited/dispatch_now）+ 门面委托 + SessionQueueEntry.position
- [x] task-05: backend 测试——新 test_session_queue_actions.py（MAX+1/reorder 全量与 MISMATCH/edit 三态/409/dispatch-now 空闲与忙时 mock hub/循环化连续失败上限与瞬态续派/非 active 保持 pending/confirm 恢复钩子）+ 既有排队用例适配
- [x] task-06: lib/daemon.ts——streamSession switch 加 queue_changed case → onQueueChanged?.()（不入 run_id 白名单）+ reorderSessionQueue/updateSessionQueueEntry/dispatchNowSessionQueueEntry 三 client + SessionQueueEntry 类型补 position + pnpm gen:types 产物
- [x] task-07: useMessageQueue——reorderEntry/editEntry/dispatchNowEntry（load 刷新模式，对齐 removeEntry）
- [x] task-08: MessageQueueBar 重构——拖拽手柄原生 DnD（dragstart/dragover 高亮/drop/dragend + 松手全量 onReorder）+ ⚡立即发送按钮 onDispatchNow（pending+failed）+ ✎编辑浮层 onEdit（textarea 取消/保存；failed 转等待中提示；TASK_WAKEUP 前缀条目隐藏 ✎）+ 既有 ↻ ✕ 保留
- [x] task-09: session-panel 接线——SSE onQueueChanged → refresh() + onReorder/onEdit/onDispatchNow 回调 + 队列 API 错误静默
- [x] task-10: frontend 队列测试——既有 __tests__/message-queue-bar.test.tsx（约 10 用例）适配重构 + 新增（拖拽换位全量上传 dataTransfer mock/编辑浮层三态/⚡ 调用/TASK_WAKEUP 隐藏 ✎）+ 既有 hooks/__tests__/use-message-queue.test.ts（约 9 用例）适配三新方法 + daemon.test queue_changed 分发 + session-panel 接线用例
- [x] task-11: CopyButton 组件（纯文本复制 + "✓ 已复制"1.2s 反馈 + clipboard 降级 console.warn）+ 三处挂载：TextSegmentView/ThinkingRowView 展开正文（segment.text）/turn-timeline 用户气泡（parseAttachmentMarkers 剥离标记，空文本不渲染按钮）
- [x] task-12: 复制测试——CopyButton 单测（成功/降级/反馈）+ 三挂载点渲染断言（含用户气泡剥离附件标记）
- [x] task-13: 模块文档同步（backend.changelog/frontend.changelog）+ gen:types/openapi.json 提交核对 + 本地 Docker Postgres 迁移应用
