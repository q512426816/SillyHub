# 符号影响面报告

> tasks.md 内容指纹（生成时）: dc5d90e328112d5a——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 数据列新增（AgentSessionLogORM 加 reported_machine_id/reported_machine_name，SQLModel Field additive，无方法/构造签名变更）；无既有调用点受影响（新列默认 NULL，读侧零改动）——在任务范围内。
- task-02: 载荷字段追加（hub-client.ts heartbeat 载荷 dict 追加 machine_id 键、heartbeat.py 接收端合并 metadata 键，均无函数/方法签名变更）；调用点=既有心跳链路（daemon.ts 心跳循环），在任务范围内。
- task-03: DTO additive（platform_sync/schema.py entry DTO 新增可选 machine 块——Pydantic 模型字段新增，旧 payload 兼容）；service.upsert_agent_log_entries 内部落列（无签名变更）；消费方=上报 JSON 客户端（CLI/daemon，extra=ignore 向后兼容），无仓内调用点需改——在任务范围内。
- task-04: ①create_session 签名追加可选参数（fork 三件套 origin/fork_of_session_id/fork_at_run_id 透传，additive 缺省不变）——调用点 backend/app/modules/daemon/router/session_crud.py:505（在 task-04 allowed_paths 内）；②fork.py 内部抽可复用段（fork_session 对外签名不变，调用点 session_crud.py:583 在范围内）；③新增 takeover_session/resolve_takeover_runtime/build_handoff_prompt 桩（新函数无既有调用点）；④schema.py 新增 TakeoverRequest/TakeoverResponse DTO（additive）——均在任务范围内。
- task-05: takeover.py 内部填充 handoff 分支与新纯函数 build_handoff_prompt（新函数无既有调用点；takeover_session 对外签名不变）；platform_sync/router.py 只读 import 复用（_send_agent_log_rpc 等，签名零变更）——无签名级变更，在任务范围内。
- task-06: ①函数删除（_activate_tool_report_session 及 facade _svc 壳）——调用点 backend/app/modules/daemon/session/service/inject.py:216 激活分支（本卡改写为 409）与 __init__.py facade（本卡内），均在 allowed_paths 内；②helpers.py 新增 reset_tool_report_session（新函数）；③schema.py 新增 ResetToolReportResponse（additive）——在任务范围内。
- task-07: 前端组件内部改造（session-panel-page.tsx 未激活分支渲染与发送路径，无导出签名变更）；api-types.ts/agent-logs.ts 类型 additive（gen:types 生成）；新建 frontend/src/lib/takeover.ts（新模块无既有调用点）——无签名级变更（对外接口均为新端点消费），在任务范围内。
