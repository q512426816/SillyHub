# 符号影响面报告

> tasks.md 内容指纹（生成时）: 654000bd395c029a——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 接口级扩展（可选字段新增，非破坏）：AgentEventUsage（sillyhub-daemon/src/types.ts:88）增可选字段 api_duration_ms?: number；agent-event-schema usage 对象 schema 增同名 optional 键；usageToEventUsage（claude-events.ts:1285）输出形状增键（白名单内追加）。三者均为可选字段追加，既有调用点（usageEqual :1318 不含新键、liftSessionUsage usage.ts:97 仅读 input/output）零影响，签名不变。
- task-02: 内部状态扩展：PartialBucket 接口（claude-events.ts 模块私有）加 callStartMs/turnApiDurationMs 两个内部字段；_bufferPartial/_flushBucket 内部逻辑增量，函数签名不变。pendingUsage 对象形状增 api_duration_ms 键（消费方白名单已由 task-01 放行）。无对外签名级变更。
- task-03: 内部状态扩展：codex driver turn 状态对象加 generatingSince/turnApiDurationMs；usage 事件构造处输出对象增 api_duration_ms 键（AgentEventUsage 已放行）。driver 对外接口（InteractiveDriverResult/onTurnMessage）签名不变，无签名级变更。
- task-04: 同 task-03 模式：pi driver 内部累计状态 + usage 事件输出对象增键；若走降级路径则零代码符号变更（仅测试断言既有行为）。对外签名不变，无签名级变更。
- task-05: 内部增量：submit_steps SubmitState 增 latest_api_duration_ms 字段（:57 区）与提取分支；submit_commit 写回点 :253 旁增一段（不改动既有行）；PublishIntent（publish.py:36）增可选字段 duration_api_ms: int | None = None（尾部追加，既有关键字传参零破坏）；service/__init__.py:444 intent 构造增传一个关键字参数。无既有签名删除/改形，均为向后兼容追加。
- task-06: 零签名级变更：session-sse.ts SessionStreamEnvelope.duration_api_ms 已存在（上变更，仅注释语义更新）；turn-speed.ts turnTokenSpeedText 签名不变（内部门控逻辑放宽）；session-panel-page/dialog onTokens 回调体内增一行字段写入。无签名级变更。
