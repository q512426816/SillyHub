# 符号影响面报告

> tasks.md 内容指纹（生成时）: 946b23b645f96d9f——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 符号搬家级变更——applyProviderFileSettings / ProviderFileSettingsInput / isCodexFormSufficient / isPiFormSufficient / nonEmptyStr 从 task-runner.ts 迁出至 provider-file-settings.ts（签名逐字不变，仅 import 路径变更）。受影响调用点：daemon.ts:125（import + :7713/:8266 调用）、task-runner.ts 内部 batch 接线（~:702）、tests/daemon-provider-file-dispatch.test.ts:63（混合 import 需拆）、tests/provider-injection-smoke.integ.test.ts:44。全部在本 task allowed_paths 内，无范围外调用点。
- task-02: 纯新增导出（applyProviderFileSettingsForReload / ProviderFileSettingsReloadInput / mirrorCodexHostAuth / migrateCodexThreadFromHost），不改任何既有签名——新增符号无既有调用点。无签名级变更（新增侧）。
- task-03: 接口定义变更——SessionManagerDeps（types.ts:477）增**可选**字段 daemonApiKey?: string | null。受影响调用点：cli.ts:807 生产构造（在范围，本 task 注入新字段）；测试中 SessionManager 构造（tests/interactive/* 多处）——可选字段零破坏，无需改动、不在 allowed_paths 属声明性豁免（TS 可选属性不强制传参）。reloadWithProvider 删守卫与 _reloadSessionNow 内部插块为行为级变更，方法签名不变。
- task-04: persistence.ts restore 路径内部变更（消费 task-02 新符号 + task-03 可选字段），不改导出签名。无签名级变更。
- task-05: provider-caps.ts 纯新增导出 PROVIDER_SWITCH_ENGINES；两组件 props 接口不变（engine/provider 现有 prop），仅内部判定与文案变更。无签名级变更。
- task-06: 测试文件改写（新增 1 + 改 6），被测符号消费方，无生产签名变更。无签名级变更。
- task-07: 测试文件改写（改 2），同上。无签名级变更。
