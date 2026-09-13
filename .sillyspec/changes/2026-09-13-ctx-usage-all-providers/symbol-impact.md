# 符号影响面报告

> tasks.md 内容指纹（生成时）: 2b91273d9cc9d939——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增纯函数模块 usage-ctx.ts（ctxTokensFromNetInput / ctxTokensFromGrossInput），无既有符号修改，无签名级变更。消费方为 Wave 2 四卡（task-02/03/04/05，均在各自 allowed_paths 内新增 import），已通过 provides/expects_from 契约对齐。
- task-02: pi-events.ts buildUsageEvent 产物对象新增 ctx_tokens 键（AgentEventUsage 既有可选键，types.ts:95 已开放），函数签名与返回类型零变化；无签名级变更。受影响断言：pi-events.test.ts 3 处全对象 toEqual（:218/:226/:287/:471）在卡内 related_tests 声明。
- task-03: cursor-events.ts mapUsage 产物对象新增 ctx_tokens 键（同上既有可选键），签名零变化；无签名级变更。受影响断言：cursor-events.test.ts 5 处精确 toEqual（:140/:188/:238/:312/:371）在卡内 related_tests 声明。
- task-04: codex-app-server-driver.ts CodexHandle 新增私有状态字段 lastCallCtxTokens（interface 内部字段，非对外构造参数；初始化点 :785 与消费点 _usageDelta/_applyTurnUsageDelta 同文件）；_extractTokenUsage 解析扩展与 _usageDelta 返回对象加键均无签名变化；无签名级变更。既有断言为 toMatchObject 加键不破。
- task-05: claude-events.ts :946 求和表达式改调 helper，无签名级变更；差分路径零改动。golden 断言不动（行为零变化约束）。
- task-06: **接口定义变更**——ProviderCaps 新增第 11 键 ctx_usage（providers.ts:58-90）。受影响调用点：① INTERACTIVE_PROVIDERS satisfies（同文件 :424-524，四引擎条目同任务补齐）；② getProviderCaps 回退字面量（同文件 :264-281，同任务）；③ 三端生成产物 frontend/src/lib/provider-caps.ts + backend/app/modules/agent/provider_caps.py（@generated 重生成，同任务）；④ 守护断言 alignment EXPECTED_CAPS_KEYS+len 断言 / provider-registry tenKeys / pre-session-picker 两处 toEqual（同任务 allowed_paths 内）；⑤ 既有消费方按键取值（session-config-bar / page-helpers / runtime-session-helpers / backend session_lifecycle 等均为 getProviderCaps(x)["键"] 成员访问，不受键数影响，无需改动）。全部在任务范围内，无遗漏调用点。
- task-07: CtxUsageBarProps 新增可选 prop provider?: string | null（可选追加，既有调用点不传零影响）；调用点 session-panel-page.tsx:2709/:3501 同任务传参；无破坏性签名级变更。
- task-08: docs/agent-provider-onboarding.md 文档 + 真机验证，无代码符号，无签名级变更。
