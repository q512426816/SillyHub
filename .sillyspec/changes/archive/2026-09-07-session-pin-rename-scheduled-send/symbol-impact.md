# 符号影响面报告

> tasks.md 内容指纹（生成时）: 025be22f300ec54a——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。

- task-01: ORM 新增列 pinned_at 与新表 AgentSessionScheduledMessage——纯新增字段/类，不改既有签名；受影响调用点=task-02 排序与 Read 映射、task-03/04 CRUD 与 sweeper（均在任务范围内）。无既有方法签名变更。
- task-02: 新增方法 SessionService.pin_session/unpin_session/rename_session + 门面三委托 + router 三端点（新增路由，无签名变更）；修改 list_agent_sessions 内部 order_by 表达式（方法签名不变，返回形状不变）；AgentSessionRead 增可选字段 pinned_at（Pydantic 响应模型加字段，向后兼容，消费方=前端 api-types 再生成）。均在任务范围内。
- task-03: 新增方法 SessionService.list/create/cancel_scheduled_message + 门面三委托 + 三端点 + 两个新 schema 类（ScheduledMessageCreateRequest/ScheduledMessageRead）——全部纯新增，无既有签名变更。
- task-04: 新增模块函数 scheduled_send_sweep_once/scheduled_send_sweeper（新文件）；main.py lifespan 增局部任务变量与 create_task/cancel——lifespan 函数签名不变。消费 inject_session_as_service 既有签名（queue_when_busy/queue_sender_user_id/attachment_ids/agent_profile_id/llm_provider_id 已核存在，session/service.py:3274），无签名级变更。
- task-05: lib/daemon.ts 新增六个导出函数（纯新增）；api-types.ts/openapi.json 生成物再生成。无既有签名变更。
- task-06: 三个新测试文件——纯新增。无签名级变更。
- task-07: SessionRowProps/SessionListPanelProps 增可选 props（onPin/onUnpin/onRename、liveness 无关）——可选参数向后兼容，既有调用点（sessions-portal 等挂载点）不传即旧行为；sessions-portal.tsx 增三回调传参。签名变更为「接口加可选字段」，受影响调用点全在任务范围内。
- task-08: session-input-bar props 增可选 onSchedule（向后兼容）；session-panel 增内部 Modal/挂载（组件签名不变）；新组件 scheduled-messages-bar 与新 hook use-scheduled-messages（纯新增）。无破坏性签名变更。
- task-09: 测试文件新增/扩展——无签名级变更。
- task-10: 回归验证卡，无代码改动——无签名级变更。
