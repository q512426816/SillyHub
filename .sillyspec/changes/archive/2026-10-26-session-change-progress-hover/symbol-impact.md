# 符号影响面报告

> tasks.md 内容指纹（生成时）: 772edacf012aab89——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 签名级变更（DTO additive）：backend/app/modules/change/schema.py 新增 3 个 pydantic 类（StageProgressEntry/TaskProgressSummary/ThinFlowProgress）+ ChangeSummary 加 3 个 optional default None 字段（stage_progress/task_progress/thin_flow）。受影响调用点：ChangeSummary 消费方（enrich_summaries 填充/前端 api-types 生成）——optional additive 无既有调用点破坏；在任务范围内。
- task-02: 无签名级变更：service.py 新增私有函数 _extract_stage_progress + enrich_summaries 内部调用（既有公开签名不变）。
- task-03: 无签名级变更：service.py 新增私有函数 _aggregate_task_progress + enrich_summaries 内部调用（既有公开签名不变）。
- task-04: 无签名级变更：enrich_summaries 内读侧投影分支（无新公开符号、既有签名不变）。
- task-05: 签名级变更（载荷 DTO additive）：backend/app/modules/daemon/router/heartbeat.py 新增 DaemonHeartbeatThinFlow 类 + DaemonHeartbeatSillySpecStatus 加 thin_flows optional 字段（请求载荷 additive，旧 daemon 不发该键合法）。受影响调用点：heartbeat 消费链（runtime/service.py 就近新增写入分支）；在任务范围内。
- task-06: 无签名级变更：sillyspec-manager.ts 新增采集执行器方法与内部摘要槽（类公开接口不破坏既有方法）。
- task-07: 无签名级变更：hub-client.ts 组装处加 thin_flows 键（载荷构造内部，函数签名不变；daemon 侧手写 interface 过渡）。
- task-08: 新符号（新文件）：change-progress-row.tsx 新组件 ChangeProgressRow——纯新增，无既有符号改动。
- task-09: 新符号（新文件）：change-total-progress-ring.tsx 新组件 ChangeTotalProgressRing + 两个纯函数导出（选取/口径）——纯新增。
- task-10: 无签名级变更：session-change-files-hover.tsx renderItem/按钮行内部嵌组件与徽标双态（组件 props 接口 SessionChangeFilesHoverProps 不变）。
- task-11: 无签名级变更：api-types.ts/openapi.json 生成物再生成（类型面 additive，无手写签名改动）。
- task-12: 无签名级变更：新增原型 HTML 产物文件（无代码符号）。
