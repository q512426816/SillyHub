# 符号影响面报告

> tasks.md 内容指纹（生成时）: 2026-09-12-chat-turn-auto-recovery-tasks-v1
> 逐 task 结论：签名级变更列变更类型+受影响调用点+是否在任务范围；无签名级变更显式写明。

- task-01：**类型+内部符号级**。①`ModelError`（sillyhub-daemon/src/model-error/types.ts）+`resetAt: string | null`——类型宽增（可选字段），消费方 events.ts/daemon.ts/hub-client.ts 均为读取面零改（daemon.ts 序列化点在本任务内改）；②`classifyClaude`→`classifyBlob` 更名——模块内部私有函数（classifier.ts:151 定义/:247 唯一调用），无外部 import（grep 核实仅 2 处命中），零调用点影响；③`classifyModelError` 签名不变行为变（agent 参数语义弱化为日志归因）——调用方 stream-json.ts/events.ts 零改动。受影响调用点均在任务范围。
- task-02：**无签名级变更**。pi-rpc-driver.ts 轮循环内部状态变量（lastWasFinalText）+收敛分支，reportTurnResult 既有内部闭包，无对外签名变化。
- task-03：**DTO/模型列级**。①`ModelErrorDTO`+`reset_at`（soft-add，落库方 close_run_steps `_close_apply_terminal` model_dump 自动携带零改动）；②`AgentSessionScheduledMessage`+`origin` 列（ORM soft-add，写入方 task-04 新增、读取方 task-05/06）；③`ScheduledMessageRead`/`SessionQueueEntry(_queue_entry_dto)`+`origin`（响应 DTO soft-add，router/session_queue.py 序列化处补字段映射，前端 gen:types 消费）。受影响调用点均在任务范围。
- task-04：**函数级**。`_maybe_autoretry_auth_transient_turn`（close_run_steps.py:609）迁移并入 auto_resume.py 新函数 `maybe_auto_recover_failed_turn(svc, agent_run)`——签名变化（去 error 参，改读 run.error_detail）；唯一调用点 close_run_steps.py:450（本任务改）；既有测试 test_auth_transient_autoretry.py 6 处调用随迁更新（allowed_paths 内）。新导出 `RESUME_NUDGE_PROMPT`/`QUOTA_NUDGE_PROMPT`。受影响调用点均在任务范围。
- task-05：**签名级（双参增）**。①`inject_session_as_service`+`auto_resume_of: uuid.UUID | None = None`——调用点 5 处：mission_context.py:451/:560、change/service.py:3059、scheduled_send.py:136（唯一需传新参处，本任务改）、其余零传参默认 None 兼容；内部转发 `_inject_into_session`（既有同参 :391）；②`_handle_busy_turn`+`origin: str | None = None`——queue.py 内部调用点随 inject 链传递，既有零传参兼容；③`_dispatch_scheduled_entry` 行为增（origin 解析/G10/透传）签名不变。受影响调用点均在任务范围。
- task-06：**组件 props 级**。`run-error-item` props 增 pending auto_resume 条目集——调用方 turn-timeline.tsx（本任务改）+两挂载点（session-panel-page/dialog 本任务改）；scheduled-messages-bar 数据源改受控（props/query key 上提）。受影响调用点均在任务范围。
- task-07：无签名级变更（测试+文档）。
