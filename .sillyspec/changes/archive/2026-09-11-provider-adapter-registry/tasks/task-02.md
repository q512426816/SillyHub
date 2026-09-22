---
id: task-02
title: '派生改造——credential-injector REGISTRY 惰性 memoized 派生 + provider-file-settings 两处分派（spawn 版 + ForReload 内部）按 writer 接口派发（导出面与失败语义不变）'
title_zh: '派生改造——credential-injector REGISTRY 惰性 memoized 派生 + provider-file-settings 两处分派（spawn 版 + ForReload 内部）按 writer 接口派发（导出面与失败语义不变）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 00:00:07
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-003@v2]
allowed_paths:
  - sillyhub-daemon/src/credential-injector.ts
  - sillyhub-daemon/src/provider-file-settings.ts
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  FR-02 派生改造——credential-injector.ts REGISTRY 改惰性 memoized 派生（getInjector 首调时从聚合表
  INTERACTIVE_PROVIDERS 构建 envInjector 实例表并缓存，import 环两侧均只在函数体内访问）+ provider-file-settings.ts
  两处分派（applyProviderFileSettings spawn 版 :112/:138 与 ForReload 内部 :252/:278）统一改按 adapter.fileSettings
  的 writer 接口派发；模块导出面、调用点签名与失败语义零改动，行为零漂移由 ForReload 21 + dispatch 22 +
  注入器既有测试锁定。
implementation:
  - 'credential-injector.ts REGISTRY 惰性 memoized 派生（design Wave1 步 3）——模块级 Object.freeze 字面量改为 getInjector 首次调用时遍历 INTERACTIVE_PROVIDERS 逐条执行 envInjector()：返回注入器实例的按 adapter.provider 进缓存表，显式 none 形态不进表（getInjector 查不到返 undefined——codex 无 env 注入器语义逐字保持）；memoized 后续调用直读缓存；注入器无状态（Grill 实证），首调时机构建与模块级单例等价，对调用方透明'
  - 'import 环注释——credential-injector.ts 引 INTERACTIVE_PROVIDERS（../interactive/providers.js）与 providers.ts 引注入器类互为环，两侧引用一律只在函数体内、模块作用域零求值零 TDZ；环纪律注释落在 REGISTRY 派生函数处（providers.ts 侧注释 task-01 已落）'
  - 'provider-file-settings.ts spawn 版 writer 化（design Wave1 步 4）——applyProviderFileSettings 的 codex / pi 两段 kind 字面量分派（:112/:138）改统一按 provider.agent_kind 查 INTERACTIVE_PROVIDERS 取 adapter.fileSettings 派发（聚合表引用同样只在函数体内）；非 writer（显式 none / 未知 kind / 缺条目）走原尾分支返 {}；writer 则官方端点跳过（skipsOfficialEndpoint）→ 门槛前置（isSufficient 不足 warn 跳过、零 mkdir 零 env）→ mkdir join(daemonStateDir(), writer.dirName, sessionKey) → writer.write（dir+provider+daemonApiKey）→ 返以 writer.envKey 为键的单键对象；日志标签与失败语义（IO 失败 error 后跳过 env 返 {} 绝不抛）逐字不变'
  - 'ForReload 内部 writer 化——applyProviderFileSettingsForReload 的 codex / pi 两段（:252/:278）同款换 writer 派发；priorEnv 兜底矩阵逻辑不变、仅分派来源换 writer：分支二（IO 失败）与分支三（门槛缺）返 priorFileEnv(writer.envKey)、pi 官方端点返 {}（R-06 切换语义）、分支一成功返 writer.envKey 单键；分支四 mirrorCodexHostAuth、null / undefined 口径与分支五零动作全部不动'
  - 'writer 实例来源对账——消费 task-01 落于 providers.ts 聚合表条目的薄适配对象字面量（wrap writeCodexHome / writePiDir + isCodexFormSufficient / isPiFormSufficient + envKey + dirName + skipsOfficialEndpoint）；本卡 provider-file-settings.ts 不复制不重定义 writer（providers.ts 为 task-01 冻结文件，不在本卡 allowed_paths），只换分派数据来源'
acceptance:
  - '导出面与签名零改动——getInjector / setDaemonApiKey / applyProviderFileSettings / applyProviderFileSettingsForReload / nonEmptyStr / isCodexFormSufficient / isPiFormSufficient 等现有导出逐字不变，调用方（daemon.ts / task-runner.ts / spawn-env / 既有测试）零感知'
  - 'tests/provider-file-settings-reload.test.ts 21 用例全绿零漂移（ForReload 分支一~五矩阵 + mirrorCodexHostAuth 三态 + migrateCodexThreadFromHost 三态逐字锁定）'
  - 'tests/daemon-provider-file-dispatch.test.ts 22 用例全绿零漂移（kind 分派 + per-session 目录布局 + batch / interactive 两接线）'
  - 'tests/credential-injector.test.ts + tests/credential-injector-pi.test.ts + tests/spawn-env.test.ts 全绿（getInjector 行为等价——惰性 memoized 对调用方透明，codex 与未知 kind 仍返 undefined）'
  - 'cd sillyhub-daemon && pnpm typecheck 绿（import 环两侧函数体内访问，零 TS7022 / TS2456 推理环回潮）'
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm exec vitest run tests/provider-file-settings-reload.test.ts tests/daemon-provider-file-dispatch.test.ts tests/credential-injector.test.ts tests/credential-injector-pi.test.ts tests/spawn-env.test.ts
constraints:
  - '失败语义冻结——spawn 版失败返 {} 绝不抛、ForReload priorEnv 兜底矩阵逐字保留、getInjector 未知 kind 返 undefined 不抛；本卡唯一行为差异面=分派数据来源由字面量换聚合表派生'
  - '不改 providers.ts / codex-settings.ts / pi-settings.ts / daemon.ts / session-manager.ts（契约与 writer 实例归 task-01 冻结，写盘器本体不动，硬编码收口归 task-03）'
  - '不加新测试不改既有测试（零漂移即验收；REGISTRY 派生等价与幂等守护测试归 task-06 provider-adapter-registry.test.ts）'
  - '模块级零求值——两文件模块作用域不执行聚合表遍历或注入器构造（memoized 缓存变量 + 派生逻辑全在函数体内）'
expects_from:
  - task-01: provider_adapter_contract（ProviderAdapter 新字段值 + ProviderFileSettingsWriter 五要素接口 + INTERACTIVE_PROVIDERS 聚合表 + provider_switch cap 键）
provides:
  - contract: credential-injector 惰性 memoized 派生
    fields: [getInjector 导出面与签名零改动]
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
