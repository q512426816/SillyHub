# 符号影响面报告

> tasks.md 内容指纹（生成时）: a0e2dfd5867369b3——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——sillyhub-daemon/src/interactive/pi-rpc-driver.ts 内部 consume 闭包新增局部变量 turnFinalText 与既有 reportTurnResult 调用点的字面量入参扩展（InteractiveDriverResult 可选 result 字段已在类型联合内，pi driver 既有 error 轮已写 result，无接口形状改动）。下游消费者 daemon.onTurnResult 为 duck-type 读取（sillyhub-daemon/src/daemon.ts:3704-3707），零调用点改动。
- task-02: 方法签名变更（可选参数增量）——HubClient.workerDone 增加 `opts?: { sessionId?: string }` 第 4 参。既有调用点：sillyhub-daemon/src/mcp-server.ts worker_done 工具 handler（3 参调用，可选参零破坏，已核 sillyhub-daemon/src/mcp-server.ts worker_done 工具注册处（唯一调用方））；无其他调用（grep workerDone 全仓仅 sillyhub-daemon/src/mcp-server.ts 与本变更新增）。在任务范围内。
- task-03: 接口签名变更（可选成员增量）——sillyhub-daemon/src/daemon.ts 内部 ClientLike 接口（sillyhub-daemon/src/daemon.ts:781）新增可选 workerDone? 成员声明，唯一实现 HubClient 已具备该方法（task-02 同步）；调用点为 daemon.onTurnResult 新增分支（本任务内新增，无既有调用点受影响）。SessionState.stage/provider 仅读取无改写。
- task-04: DTO 值域变更（无签名形状变化）——LlmProviderCreate.agent_kind Literal 扩员 +pi；auth_field 三处从 Literal 改 str+Field(pattern)（字段名/类型不变，仅校验收紧为形状规则）。受影响调用点：llm_provider/service.py create/update（字段透传，无字面量假设）、前端 frontend/src/components/llm-providers/llm-provider-form.tsx（task-07 同步扩值）、api-types 生成物（task-08 再生成）。均在任务范围内；plan-review 实证 backend 既有测试无枚举拒绝型断言。
- task-05: 新增符号（类+注册）——PiCredentialInjector 类 + REGISTRY['pi'] 条目；实现既有 CredentialInjector 接口（接口零改动）。受影响调用点：sillyhub-daemon/src/spawn-env.ts 第 0 层 getInjector('pi') 由 undefined 变为命中（行为增量，无调用方代码改动）；tests/credential-injector.test.ts 注册表断言（related_tests 已声明）。
- task-06: 无签名级变更——get_daemon_status 为 MCP tool 函数（返回 dict），响应键纯增量（default_agent/effective_agent/daemons[].providers）；无 DTO/方法签名改动。受影响调用点：mcp_gateway/tests/test_tools_new.py 既有 5 用例按键取值式断言（纯增量键零破坏，新断言本任务补）。
- task-07: 无签名级变更——组件内部 state（agentKind 由固定值改可变）与表单渲染逻辑；LlmProviderAgentKind/LlmProviderAuthField 类型经 task-08 再生成后扩员（消费方为本表单提交 payload 组装，无第三方调用点）。
- task-08: 生成物更新（无手写签名变更）——backend/openapi.json + frontend/src/lib/api-types.ts + sillyhub-daemon/src/api-types.ts 按 gen:types 脚本整体再生成；类型层为 Literal 扩员/pattern 注释增量，既有字段形状零变化。
- task-09: 无签名级变更——纯验证任务（跑定向测试与类型门禁，无代码产出）。
