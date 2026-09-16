# 符号影响面报告

> tasks.md 内容指纹（生成时）: 7a6eac6bd74e2352——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 签名级变更：get_agent_session_logs 增可选关键字参数 before_id（缺省 None）。受影响调用点：session_insights.py:424 唯一调用方（task-02 范围内同步透传）+ tests/test_group_logs_pagination.py（task-03 范围）。既有调用不传新参行为零变化——在任务范围内。
- task-02: 签名级变更：日志端点函数签名增 before_id Query 参数（可选）。受影响调用点：FastAPI 自动装配（无手写调用方）；OpenAPI 契约面（task-04 重导出）。在任务范围内。
- task-03: 无签名级变更（纯测试新增：150 行批复合游标/缺省回归/422 三用例）。
- task-04: 无签名级变更（openapi.json 重导出 + api-types.ts 再生成，均为生成物）。
- task-05: 签名级变更：getAgentSessionLogs opts 接口增可选 beforeId 字段。受影响调用点：session-panel-page.tsx :684/:1064/:1364（task-06 范围内主消费点改造；:1364 q 搜索不传不受影响）。在任务范围内。
- task-06: 无签名级变更（组件内部 ref/游标逻辑改造，不改组件 props 与导出签名；historyCursorIdRef 为新增内部 ref）。
- task-07: 无签名级变更（测试新增与 mock 校准）。
- task-08: 无签名级变更（验收对账与文档增量，不改代码）。
- task-09: 签名级变更：DaemonService.get_agent_session_logs 与 SessionService.get_agent_session_logs 两层门面各增可选参数 before_id 并转发。受影响调用点：router session_insights.py（task-02 已带 before_id= 调用）与 read_model 实现（task-01 已接收）——本任务即打通两跳，在任务范围内。
