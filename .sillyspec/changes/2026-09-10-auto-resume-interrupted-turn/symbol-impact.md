# 符号影响面报告

> tasks.md 内容指纹（生成时）: d68cd83b0eb73575——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 签名级变更：AgentSessionQueuedMessage/AgentRun 两 SQLModel 类各加可选列（origin: str|None、metadata_: dict|None，均默认 None soft-add）。无既有调用点需改（新列可空、构造点不传即旧行为）；受影响调用点=后续 task-02/03/05 在本变更范围内消费。
- task-02: 签名级变更：新符号 _maybe_enqueue_auto_resume(svc, session, interrupted_run_id)（新文件 auto_resume.py，无既有调用点）；recover_session_after_daemon_restart 内部接线调用（函数自身对外签名不变——daemon WS 契约零变化）。wrap_resume_prompt/RESUME_PROMPT_TEMPLATE 新导出。无范围外调用点。
- task-03: 签名级变更：inject 侧注入路径加可选参 auto_resume_of（缺省 None，既有调用点 queue 重放/即时 inject 零改动）；SessionRunRead DTO 加 metadata 字段（OpenAPI 消费方=前端 api-types 重生成，task-05 范围内）。queue dispatch 内部逻辑变更无签名面。
- task-04: 签名级变更：新 DTO SessionAutoResumeUpdateRequest + 新路由 PATCH /sessions/{id}/auto-resume（新端点无既有调用点）；service 层新方法 update_auto_resume_pref（owner 校验内部）。无范围外调用点。
- task-05: 签名级变更：手写 interface SessionRunRead（lib/daemon/sessions.ts:601）加 metadata?: Record<string,unknown>|null 字段（该 interface 的消费方=turn-timeline/page-helpers 类型引用，加可选字段零破坏）；新 API 客户端函数 updateSessionAutoResume。api-types 为生成物。
- task-06: 签名级变更：run-error-item props 加可选 hint 注入字段（缺省回退现行为，既有调用方零改动）；enrichDisplayTurns（page-helpers）产出对象加可选 autoResumeOf 字段（消费方 turn-timeline，task 范围内同步）。无范围外调用点。
- task-07: 无签名级变更（纯测试新增 + 模块文档更新；集成测试消费 task-01~06 已落符号）。
