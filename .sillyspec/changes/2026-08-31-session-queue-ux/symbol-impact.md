# 符号影响面报告

> tasks.md 内容指纹（生成时）: 126665836e1af5da——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。

- task-01: 无签名级变更（仅新增 Alembic 迁移文件 20260831130000，不改任何 Python 符号；down_revision=20260831120000）。
- task-02: 模型字段级变更——AgentSessionQueuedMessage 新增 position: int 属性（SQLModel table 类，非函数签名；ORM 层新增列，既有构造点（session/service.py:3272 入队）不传 position 走 default=0 后由本任务改为行锁内显式 MAX+1）；list_queued_messages（service.py:4193）与 dispatch_queued_messages 队首查询（:4318）排序表达式改 ORDER BY position, created_at——两处均为方法内部实现变更，签名不变；调用点（router.py list 端点 / retry / run 终态钩子 dispatch_next_queued_message）不在本任务范围、零适配。
- task-03: 方法内部语义变更——dispatch_queued_messages（service.py:4292）改循环 + 非 active 分支收敛（终态集合 {ended,failed}），签名不变；调用点 3 处（retry :4280、daemon/service.py:820 门面、run_sync 终态钩子经 dispatch_next_queued_message :6212）语义均向后兼容（单条场景行为等价或更完整）；新增私有符号 _fire_background_task（SessionService 新 helper，无外部调用点）+ confirm_session_reconnected（:4946）commit 后追加 fire 调用（签名不变）；受影响测试 test_session_queue.py / test_session_recovery.py / test_session_readiness.py / test_session_reopen.py / test_session_suspend.py（hook 无 pending 自查自弃，预期零适配，红了归 task-03/05 裁量）。
- task-04: 签名级变更集中点——①SessionService 新增 3 公有方法 reorder_queued_messages(session_id, entry_ids, user_id) / update_queued_message(session_id, entry_id, prompt, user_id) / dispatch_queued_message_now(session_id, entry_id, user_id)，无既有调用点（新端点专属）；②DaemonService 门面加 3 同名一行委托（新符号）；③schema.py 新增 QueueReorderRequest/QueueEntryUpdateRequest/QueueDispatchNowResponse 三 DTO（新符号）；④SessionQueueEntry（router.py:2082）+_queue_entry_dto（:2095）加 position 字段——DTO 字段级扩展，既有消费方（前端 use-message-queue load 映射）宽松兼容；⑤新增异常类 DaemonSessionQueueOrderMismatch + 编辑不支持类（新符号，AppError 子类）；⑥interrupt_session（:3918）内部发送段抽 _send_interrupt_control 私有 helper——interrupt_session 签名与外部行为不变，调用点（interrupt 端点）零适配。
- task-05: 无签名级变更（纯测试文件；新增 test_session_queue_actions.py + 既有 test_session_queue.py / test_session_user_preamble.py 用例适配）。
- task-06: 前端类型/接口级变更——①SessionEventKind 联合（daemon.ts:1162）加 "queue_changed"（类型扩展，switch 穷尽性由新 case 满足）；②SessionStreamHandlers 接口加可选 onQueueChanged?（可选成员，既有 handler 对象零破坏）；③新增 reorderSessionQueue/updateSessionQueueEntry/dispatchNowSessionQueueEntry 三函数（新符号，消费方 task-07/10）；④SessionQueueEntry 前端类型（hook 侧 interface）不动（position 由 API 返回层透传，前端类型可选补充归本任务：fetchSessionQueue 返回项加 position?: number——接口成员可选扩展零破坏）；⑤gen:types 产物 api-types.ts/openapi.json 随 task-04 schema 变化再生成。
- task-07: hook 返回接口扩展——UseMessageQueueReturn 加 reorderEntry/editEntry/dispatchNowEntry 三成员（新成员，既有解构点 session-panel 两个模式按需取用零破坏）；实现内部复用 load/removeEntry 模式，无既有符号签名变化。
- task-08: 组件 props 接口扩展——MessageQueueBarProps 加 onReorder?/onEdit?/onDispatchNow? 三可选回调（可选，session-panel 两个既有挂载点 :3587/:5417 在 task-09 接线前编译零破坏，未传时按钮不渲染）；QueueEntry 类型复用 hook 侧（不动）；既有 onRemove/onRetry props 保留。
- task-09: 接线层——session-panel 两个模式解构 useMessageQueue 新三方法 + MessageQueueBar 传三回调 + streamSession handlers 加 onQueueChanged；均为既有组件内部调用点变更，不改任何导出符号签名。
- task-10: 无签名级变更（纯测试文件：message-queue-bar.test.tsx / use-message-queue.test.ts / daemon.test.ts / session-panel-dialog-attachments.test.tsx 适配+新增）。
- task-11: 新组件符号 CopyButton（新文件 copy-button.tsx，props: text|getText/aria-label/className）；挂载点变更——TextSegmentView（turn-segment-views.tsx:388）与 turn-timeline 用户气泡（:427-449）内部加挂载，组件签名不变；ThinkingRowView 展开正文（:443-447）同；三组件均 memo，CopyButton 内部状态不破坏 memo 边界。
- task-12: 无签名级变更（纯测试文件：copy-button.test.tsx 新增 + turn-segment-views.test.tsx / turn-timeline-session-input-bar.test.tsx 适配）。
- task-13: 无签名级变更（模块文档 changelog 条目 + gen:types 产物核对 + 本地 DB 迁移应用，运行时操作）。
