# 符号影响面报告

> tasks.md 内容指纹（生成时）: ac998d663c5e9c24——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 接口定义变更×2——①ProviderDescriptor 扩展为 ProviderAdapter（providers.ts:263，新增 envInjector/fileSettings/perSessionDir/smokeSuite/switchable 五成员，interface extends 向后兼容——现有 ProviderDescriptor 消费点（providers.ts 内部 + cli.ts drivers 构造按 descriptor.createDriver）不受破坏，新成员由聚合表条目字面量满足）；②ProviderCaps 接口加 provider_switch: boolean（:158 一带，前端镜像接口同键由 task-04/05 生成产物同步，backend py 无类型）。调用点影响：INTERACTIVE_PROVIDERS 条目需补五字段（本 task）；provider-registry.test.ts nineKeys 联动（本 task allowed_paths）。均在范围。
- task-02: 行为级派生改造，签名零变更——REGISTRY（credential-injector.ts:265 模块级 const → 惰性 memoized getter）导出面 getInjector 签名不变；applyProviderFileSettings/ForReload（provider-file-settings.ts）分派来源换 writer，导出签名与失败语义不变。无签名级变更（消费点 spawn-env/task-runner/daemon/session-manager/persistence 零改动）。
- task-03: 行为级收口，签名零变更——daemon.ts/persistence.ts/session-manager.ts 六处判断表达式换元数据读取，方法签名与导出零变化。无签名级变更。
- task-04: 新增脚本 + 产物文件重生成 + 测试常量更新——gen-provider-caps.mjs 为新增可执行（无既有调用点）；provider_caps.py 重生成保持模块级 dict/函数形状（backend 消费点 attachments/session_lifecycle/ppm_activation 按键取值 additive 安全）；test_provider_caps_alignment.py 常量 9→10 键。无签名级变更（生成产物保持现导出形状）。
- task-05: 产物文件改形——provider-caps.ts 由手写改生成（@generated 头 + provider_switch 键 + PROVIDER_SWITCH_ENGINES 派生导出保持同名同值），消费点 import 零改动。无签名级变更（导出面只增 provider_switch 键与既有白名单同值）。
- task-06: 测试新增/扩展，无生产签名变更。无签名级变更。
- task-07: 纯验证任务（providers.ts 仅作演示操作对象且必须还原，diff 空验收）。无签名级变更。
