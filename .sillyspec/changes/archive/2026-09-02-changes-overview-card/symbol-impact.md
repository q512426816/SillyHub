# 符号影响面报告

> tasks.md 内容指纹（生成时）: 81dc755862065e7a——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 模型/DTO 均为**可选字段追加**（DaemonInstance.sillyspec_status 列、心跳请求模型 sillyspec_status 键、DaemonMachineReadWithPending.sillyspec_status 嵌套）——无破坏性签名级变更；受影响调用点：Pydantic 旧载荷无键照常通过（default=None），旧 daemon 心跳零影响。
- task-02: **签名级变更 1 处**——hub-client heartbeat() 追加可选末位参 sillyspecStatus（undefined=键不出现）；受影响调用点：daemon.ts _sendHeartbeatOnce（本 task 内接线）+ 既有 daemon-heartbeat-sillyspec.test.ts L342-343 调用参数 length 断言（**在 task-04 范围内更新**，plan 已排）；HeartbeatBody 加键为加法。
- task-03: 心跳 handler 落库与 _build_machine_read 组装为内部逻辑接线——无签名级变更；机器视图响应嵌套为加法（消费方 task-05 类型再生成吸收）。
- task-04: 无签名级变更（纯测试新增/既有断言同步——daemon-heartbeat-sillyspec.test.ts 深比较与 length 断言更新、config.test.ts 键表断言）。
- task-05: 无签名级变更——api-types.ts/openapi.json 为生成产物替换；lib/daemon.ts DaemonMachineRead 接口可选字段追加（加法）。
- task-06: 无签名级变更——新增导出符号 ChangesOverviewCard（新组件，无既有签名改动）。
- task-07: 无签名级变更——page.tsx 挂载调用 + page.test.tsx mock 断言扩展。
- task-08: 无签名级变更（仅产出 integration-evidence.md 证据文件）。
