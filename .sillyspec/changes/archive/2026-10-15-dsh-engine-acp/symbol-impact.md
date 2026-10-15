# 符号影响面报告

> tasks.md 内容指纹（生成时）: 2724b249c1c5fef5——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 数据级新增，无签名级变更——AGENT_DEFS 数组追加 dsh 条目（AgentProviderSpec 既有形状，bin/envPath/versionPattern/minVersion/protocol 五字段无新增键）；MIN_VERSIONS（Record<string, SemVerTuple>）追加 dsh 键。消费方按 provider 键查找（detect_all/_resolve_bin_path/checkMinVersion），键空间扩展向后兼容，调用点零改动。
- task-02: 新文件新符号——dsh-acp-events.ts 导出 normalizeAcpUpdate(update) → AgentEvent[]（新增导出函数，无既有符号改动；消费点为 task-03 驱动，在任务范围内）。
- task-03: 新文件新符号——dsh-acp-driver.ts 导出 DshAcpDriver 类（implements InteractiveDriver 既有接口，start/consume/interrupt 必选 + 可选 getThinkingLevels/setThinkingLevel，接口本身零改动）与 createDshAcpDriver 工厂；消费点为 task-04 providers.ts createDriver（任务范围内）。InteractiveDriver 接口无签名变更。
- task-04: 注册表条目新增 + 新文件符号——INTERACTIVE_PROVIDERS 追加 dsh 键（ProviderAdapter 既有十项形状，satisfies 编译期校验）；PROVIDER_CAPS 追加 dsh 键（16 键既有形状）；dsh-settings.ts 导出 writeDshHome（新增导出函数，消费点 fileSettings 声明，任务范围内）。ProviderAdapter/ProviderCaps 接口零改动；既有 claude/codex/cursor/pi 条目零改动。
- task-05: 类型字面量扩展——InteractiveProviderLiteral 从 Literal["claude","codex","cursor","pi"] 加 "dsh"（schema.py:129）；生成物 api-types.ts×2/openapi.json 随 openapi 再生成。消费方为 FastAPI 校验与前端表单枚举，字面量扩集合向后兼容（ Narrowing 方向），调用点零改动。
- task-06: 分支判定逻辑变更，无签名级变更——messages.py:791-797 与 shadow.py:266-273 附件门控的判定表达式从 provider != "claude" 改为 get_provider_caps(provider)["attachments"]（函数签名/DTO/返回结构零改动；get_provider_caps 为既有导入）。
- task-07: 常量数组追加，无签名级变更——SESSION_ENGINE_OPTIONS 追加 dsh 选项项（既有选项对象形状 label/value/图标字段）；消费点为同一文件下拉渲染，零调用点改动。
- task-08: 新测试文件，无签名级变更——dsh-acp-smoke.test.ts 仅测试代码（describe.skipIf 守护），不导出生产符号。
