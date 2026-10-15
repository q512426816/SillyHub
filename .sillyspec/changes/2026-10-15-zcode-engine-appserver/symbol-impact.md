# 符号影响面报告

> tasks.md 内容指纹（生成时）: 0b0980fd5af7ebe1——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: AgentProviderSpec 接口加可选字段 fallbackPaths?:string[]/execNode?:boolean（sillyhub-daemon/src/agent-detector.ts:52-64）——两字段可选，既有 12 探测项零调用点变化；探测实现内部（env→which 链）插 fallbackPaths 段为行为增量非签名变更；MIN_VERSIONS 记录加键纯数据增量。受影响调用点：无强制改动（可选字段）；在任务范围内。
- task-02: 新增文件 adapters/zcode-envelope.ts——全新符号（ZcodeEnvelope 类与编解码函数），无既有签名变更。
- task-03: 新增文件 interactive/zcode-events.ts——全新符号（normalizeZcodeNotification 等），无既有签名变更。
- task-04: 新增文件 interactive/zcode-app-server-driver.ts——全新符号（ZcodeAppServerDriver implements InteractiveDriver），实现既有接口契约（driver.ts:388-457）无接口本体变更。
- task-05: FileSettings.dirName 联合类型 'codex'|'pi' 加 'zcode'（providers.ts:590）与 perSessionDir 联合 'codex'|'pi'|{kind:'none'} 加 'zcode'（providers.ts:625）——类型加宽（新增联合分支），既有赋值零变化；PROVIDER_CAPS/INTERACTIVE_PROVIDERS 记录加键纯数据增量。受影响调用点：类型收窄处的 switch/穷尽检查（如有）由 TS 编译器把关，在任务范围内。
- task-06: InteractiveProviderLiteral 加 "zcode" 字面量（backend/app/modules/daemon/schema.py:129 附近）——Literal 联合加宽，既有校验零变化；openapi/api-types 为生成物。
- task-07: SESSION_ENGINE_OPTIONS 数组加条目——数据增量，无签名级变更。
- task-08: 新增冒烟测试文件——无签名级变更。
