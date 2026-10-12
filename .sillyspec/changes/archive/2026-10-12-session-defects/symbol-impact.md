# 符号影响面报告

> tasks.md 内容指纹（生成时）: f8b41b162663818c——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 有签名级变更——①sillyhub-daemon/src/types.ts wire 消息接口新增可选字段 timestamp（向后兼容，producer=event-wire 全部构造点 → consumer=backend submit_steps.py 单点读取，仓内无其他消费者）；②AgentRunLog 构造不变（timestamp 列已存在，仅取值来源变化）。受影响调用点均在本任务白名单内。
- task-02: 无对外签名级变更——message-coalescer.ts 为新增纯函数模块（NEW），event-wire.ts 内部接线；backend submit_steps.py 段残留删除走既有 segment_id 机制（DELETE by segment_id，无签名变化）。
- task-03: 无对外签名级变更——agent_task_store.py 的 upsert/sweep 内部判定逻辑修改，函数签名不变（sweep_confirmed_dead_tasks/notify_agent_task_status 调用方 router.py 不受影响）；复现测试新增。
- task-04: 无签名级变更——create.py/inject.py 内部对 session.config_snapshot dict 的键补齐（model/provider_name/profile_name），SessionRead schema 已含 config_snapshot 字段（export.py:466 已消费），无新字段透传。
- task-05: 无签名级变更——daemon 打断路径补发 tool_call 日志行（event-wire/turn-control 内部时序），wire 消息形状不变。
- task-06: 无签名级变更——export.py/_fetch_export_tasks 返回类型不变（list[AgentSessionTask]，仅行集过滤）；session_insights.py list_session_tasks 响应模型 AgentSessionTaskRead 不变（仅行集去重）；新增可选共享 helper（NEW task_snapshot_dedupe.py）。
- task-07: 有签名级变更——①sillyhub-daemon/src/model-error/types.ts ModelErrorType 联合类型新增 'context_overflow'（TypeScript 穷举消费点：frontend run-error-item.tsx MODEL_ERROR_META Record 键补齐、daemon ERROR_INFO Record 键补齐，两处均在本任务白名单）；②backend/app/modules/daemon/model_error.py:15 ModelErrorType StrEnum 新增成员 + schema.py Literal 同步（pydantic 校验面：close_interactive_run 请求体 error 字段——backend 先发+宽松校验预案 per design R-05）；③frontend/src/lib/api-types.ts 由 pnpm gen:types 重新生成（禁止手写）。
- task-08: 无对外签名级变更——auto_resume.py maybe_auto_recover_failed_turn 内部新增分支（钩子签名不变，调用方 close_run_steps.py:497 区不受影响）；新增模块级常量 CONTEXT_OVERFLOW_CHAIN_LIMIT。
- task-09: 无签名级变更（视调查结论）——helpers.py:99 _apply_session_terminal_status 返回值语义修正（同签名），调用方 close_run_steps.py:463 区不受影响；若调查结论要求落点调整，允许 close_run_steps.py 内同语义改动（design 自审存疑②预授权）。
- task-10: 有签名级变更——①sillyhub-daemon/src/policy/path-utils.ts normalizePath/resolveRealPath/isPathUnderAnyRoot 新增可选 anchor 参数（默认 undefined=process.cwd() 现行为，全部既有调用点零变化）；②filesystem-policy.ts canWrite/canCreate/canDelete/canRename 新增可选 anchor 透传参数（调用方 write-guard.ts 四分支在本任务白名单内逐一更新；仓内其他 PolicyEngine 调用点 grep 确认：task-runner.ts:1302 batch 审批路径不传 anchor 走默认，零回归）。
- task-11: 无签名级变更——纯文档新增（docs/sillyspec/ 两个 NEW 文件）。
- task-12: 无签名级变更——验收收口（测试+lint+清单对账），无源码改动。
