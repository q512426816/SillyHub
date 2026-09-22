# 符号影响面报告

> tasks.md 内容指纹（生成时）: 75e7976e56c1bd50——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更：纯实测任务（cursor-agent 真实帧采样落 fixture + 结论记录），不改任何源码。
- task-02: 无签名级变更：纯实测任务（非 force 探针 + D-003@v2 回填 decisions.md），不改任何源码。
- task-03: 新增导出函数：normalizeCursorFrame(frame: unknown): AgentEvent[]（cursor-events.ts，全新文件）。无存量签名变更；消费方=task-04 driver。在任务范围内。
- task-04: 新增类：CursorDriver implements InteractiveDriver（cursor-driver.ts，全新文件）+ 新增接口 CursorDriverStartOptions extends InteractiveDriverStartOptions（+pathToAgentExecutable 字段）。实现既有接口契约（start/consume/interrupt 签名按 driver.ts L255-279 原样），无存量签名变更。在任务范围内。
- task-05: 无签名级变更：PROVIDER_CAPS / INTERACTIVE_PROVIDERS 加 cursor 键（Record 加成员，类型联合由 keyof 自动扩展——providers.ts satisfies 手法既有设计）；provider-registry.test.ts 断言值同步。在任务范围内。
- task-06: 无签名级变更：cli.ts drivers 装配对象加 cursor 成员（值注入，签名不变）；session-store-persistence.ts VALID_PROVIDERS Set 加成员。在任务范围内。
- task-07: 类型变更：backend InteractiveProviderLiteral = Literal["claude","codex","pi"] 加 "cursor"（schema.py L112——Literal 加成员属放宽校验，存量请求零破坏；消费方 SessionCreateRequest.provider → daemon CreateSessionInput.provider 透传链既有）；PROVIDER_CAPS dict 加键；EXPECTED_PROVIDERS 加成员。在任务范围内。
- task-08: 无签名级变更：frontend PROVIDER_CAPS 对象加 cursor 键 + 两处白名单 Set/数组加成员 + 测试用例追加。在任务范围内。
- task-09: 无签名级变更：纯验证任务（typecheck×2 + 相关测试执行）。
- task-10: 无签名级变更：真机冒烟（运行时验证 + smoke-result.md 记录），不改源码。
- task-11: 无签名级变更：纯文档任务（onboarding 手册 §5.4 追加）。
