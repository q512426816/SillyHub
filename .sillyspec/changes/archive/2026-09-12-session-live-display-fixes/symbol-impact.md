# 符号影响面报告

> tasks.md 内容指纹（生成时）: 0e7ffb2fe72379b7——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更：revokePartialSegments 仅重写函数体（参数表 (segments, segmentId, variant, removedIds) 与返回契约 TurnSegment[] | null 不变），调用方 applyLogToSegments override 分支零改动；treeContainsContainerWithId 仍被本文件其他路径使用不删。
- task-02: 轻量签名变更（模块内私有函数）：dropPrefixPartialReply 返回值从 TurnSegment[] 扩为 { segments, removedCount }（或等价信号）以支撑 F7 cell 失效判定；调用方仅 applyLogToSegments reply 分支 1 处，同文件同 task 内闭环，无跨模块调用点。
- task-03: 无签名级变更：enrichDisplayTurns.enrichOne 内部字段取值优先级调整（turnStartedAt 活跃态取快照），函数签名与返回形状不变；消费方 session-panel-page useMemo 零改动。
- task-04: 无签名级变更：extractCode / classifyModelError 内部正则分支与文案覆写，导出签名与 ModelError 形状（type/code/message/hint/retryable/raw）不变；backend auto-recovery 消费 type/raw 零影响。
- task-05: 无签名级变更：_inject_into_session 内部条件收口（silent_config_switch 复用），方法签名与 SessionDispatchResult 返回不变；queue 派发经共享核心自动获益。
- task-06: 无签名级变更：maybe_auto_recover_failed_turn 内部 chain-limit 分支增量写 error_detail dict 键（hint 覆写 + auto_resume_stopped 新键），函数签名不变；error_detail 为 JSON 列非强类型 DTO，前端 run-error-item 按 .get 容错消费新键零改动。
- task-07: 无签名级变更（验证任务）：只跑相关面测试与 lint，不改代码。
- task-08: 无签名级变更（部署任务）：打包/部署/生产实测，不改仓内代码。
