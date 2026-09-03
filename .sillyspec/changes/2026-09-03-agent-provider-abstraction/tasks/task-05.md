---
id: task-05
title: 'providers.ts 注册表与 InteractiveProvider 推导（_getDriver 改读注册表）'
title_zh: 'providers.ts 注册表与 InteractiveProvider 推导（_getDriver 改读注册表）'
author: 'qinyi'
created_at: 2026-09-03 23:55:50
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/src/interactive/driver.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
goal: >
  建 provider 注册表：ProviderDescriptor（provider/family/displayName/createDriver/caps/预留
  envKeys/contextFile），InteractiveProvider 联合类型从注册表推导，SessionManager._getDriver
  改读注册表——新增 provider 不再改类型系统（FR-05 / D-002@v1）。
implementation:
  - providers.ts（扩展 task-02 的文件）：ProviderDescriptor 接口 + INTERACTIVE_PROVIDERS 常量（claude/codex 两键，family 复用 adapters/index.ts 的 ProtocolType 联合；createDriver 惰性引用两 driver 工厂）；export type InteractiveProvider = keyof typeof INTERACTIVE_PROVIDERS
  - driver.ts：InteractiveProvider 联合类型定义处改为 re-export 自 providers.ts（调用点零改动）
  - types.ts：CreateSessionInput/SessionManagerDeps 中 provider 类型与 drivers 注册表形态随 registry 演进（drivers: Record<InteractiveProvider, ...>）
  - session-manager.ts：_getDriver（:1289）改读 INTERACTIVE_PROVIDERS[provider].createDriver；未注册 provider 仍抛 UnsupportedProviderError（错误语义不变）
  - tests/interactive/provider-registry.test.ts：注册表键集合=InteractiveProvider 联合；两 provider 可实例化；未注册键抛 UnsupportedProviderError；descriptor.caps 与 task-02 PROVIDER_CAPS 一致
acceptance:
  - 新增 provider 仅需注册表条目（类型自动扩展，不改 driver.ts/types.ts 类型字面量）
  - claude/codex 会话创建路径行为与现状一致（既有测试零回归）
  - caps 引用与 PROVIDER_CAPS 单源一致（测试断言）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/provider-registry.test.ts
  - cd sillyhub-daemon && pnpm run typecheck
constraints:
  - 纯重构不改行为：driver 选择、错误文案、锁语义不变
  - envKeys/contextFile 字段本变更不实现注入逻辑（仅类型预留，标注 TODO 后续 provider profile）
  - session-manager.ts 只动 _getDriver 及类型，其余改造归 task-08
expects_from:
  - task-01: AgentEvent 类型
  - task-02: ProviderCaps（PROVIDER_CAPS 单源）
provides:
  - contract: InteractiveProviderRegistry
    fields: [provider, family, displayName, createDriver, caps]
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
