# 符号影响面报告

> tasks.md 内容指纹（生成时）: 195109a4988e26b4——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。

- task-01: 无签名级变更（纯实测+留档，零源码改动）
- task-02: 无签名级变更（纯实测+留档，零源码改动）
- task-03: 无签名级变更（纯实测+留档，零源码改动）
- task-04: 签名级无变更——isMainAgentSession 谓词函数签名（ctx 入参/boolean 返回）不变，仅函数体内判定逻辑替换（provider!=='claude' 硬拒 → getProviderCaps(provider).mcp）；providers.ts 若需导出 caps 查询 helper 属新增导出（新增面，无既有调用点受影响）；mcp-config.test.ts 断言矩阵扩展属测试内变更
- task-05: 接口扩展——PiStartOptions（sillyhub-daemon/src/interactive/pi-rpc-driver.ts:412-445）新增可选字段 mcpServers（向后兼容：可选字段，既有构造点不传即现状行为）；pi-settings.ts 新增 writePiMcpConfig 导出函数（新增面）；pi-rpc-driver 内部 spawn 参数组装函数若需透传 mcpServers 相关参数属内部私有签名扩展（调用点均在同文件/同通道内，任务范围内）；SPIKE-00 若裁定截断则本行降级为「无签名级变更（零 diff）」
- task-06: 接口扩展——codex-settings writeCodexDir 的 opts 入参类型新增可选 mcpServers 字段（向后兼容可选）；codex-app-server-driver start 链路内部组装函数透传（同文件私有调用点，任务范围内）；SPIKE-01 若裁定截断则本行降级为「无签名级变更（零 diff）」
- task-07: 可行分支为 cursor-driver 内部实现扩展（CursorDriverStartOptions 已继承契约 mcpServers 字段，签名无变化）；不可行分支仅注释改动——两分支均无签名级变更
- task-08: 无签名级变更——providers.ts PROVIDER_CAPS 表值翻转（true/false 字面量）+ 注释改写，表结构与键集不变；gen-provider-caps.mjs 产物结构不变；下游 getProviderCaps/对齐测试接口零变化
- task-09: 无签名级变更（端到端实测+留档，零源码改动）
