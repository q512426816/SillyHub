# 符号影响面报告

> tasks.md 内容指纹（生成时）: eff5585e5d2b31e0——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 接口变更：AgentEventType 联合扩 8 型 + AgentEvent 增 11 个一等可选字段（types.ts，全部可选/新增成员——存量 5 型用法零破坏）。受影响调用点：adapters/*（仅类型消费，不改实现）、后续 task-03/04/06/07/09/10。在任务范围内。
- task-02: 新增接口：ProviderCaps 类型 + PROVIDER_CAPS（providers.ts）、get_provider_caps（provider_caps.py）、getProviderCaps（provider-caps.ts）。无存量签名变更；受影响调用点=task-05/11 消费。在任务范围内。
- task-03: 新增类：ClaudeEventNormalizer（claude-events.ts，构造注入 onPartialFlush/flushIntervalMs）+ normalizeOverrideSignal 方法。无存量签名变更（逻辑移植自 backend _extract_sdk_messages 与 session-manager flush 链，源实现不动）。在任务范围内。
- task-04: 方法签名变更：codex-app-server-driver toFlatMessage 形状演进为 toAgentEvent 产出（内部方法，调用点仅 driver consume 循环）。在任务范围内。
- task-05: 接口变更：InteractiveProvider 联合类型改由 INTERACTIVE_PROVIDERS 推导（driver.ts re-export，调用点类型兼容）；ProviderDescriptor 新增；SessionManager._getDriver 内部实现改读注册表（签名不变）；types.ts CreateSessionInput/SessionManagerDeps.drivers 类型随 registry 演进。在任务范围内。
- task-06: 接口变更：InteractiveDriver.onTurnMessage 回调入参改 TurnMessageEnvelope{events, raw?}（driver.ts）——受影响调用点：session-manager._onMessage（task-08 改）、claude-sdk-driver.consume（本 task 改）；InteractiveDriverResult 增可选 usage/session_id（宽松字段，存量兼容）。在任务范围内。
- task-07: 新增方法：_persist_agent_event（run_sync/service.py，私有）；submit_messages 主循环加分支（签名不变）。publish payload 增可选 agent_event 字段（SSE 消费方 .get() 容错，前端旧版无感）。在任务范围内。注：override 撤回复用既有 _revoke_committed_partials（模块卡已知问题：override 链生产未生效，完整行落库自撤）。
- task-08: 方法签名变更：SessionManager._onMessage 内部重写为事件分发（私有方法，对外签名不变）；移除 _emitOverrideSignals 调用路径（链路已知失效，backend 已自撤）。cli.ts 752-771 SDKMessage 类型接线改 AgentEvent。在任务范围内。
- task-09: 接口变更：hub-client.submitMessages 入参类型扩展 agent_event 形态（运行时载荷 list[dict] 不变，backend schema 零变化）。daemon.ts onTurnMessage 接线处内部改造。在任务范围内。
- task-10: 新增函数：fromAgentEvent（normalize.ts）+ 行对象可选 agent_event 字段（入口识别）。旧文本解析函数零改动。在任务范围内。
- task-11: 无签名级变更：门控布尔判定改查 caps 表（session-panel.tsx / daemon/session/service.py 调用点级替换，函数签名不动）。
- task-12: 无签名级变更：纯测试任务（golden fixture + 断言），不改生产代码。
- task-13: 无签名级变更：纯测试任务（双路径等价断言），不改生产代码。
- task-14: 无签名级变更：纯文档任务。
