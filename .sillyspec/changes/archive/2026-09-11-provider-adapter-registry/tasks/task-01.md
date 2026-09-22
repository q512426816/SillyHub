---
id: task-01
title: 'ProviderAdapter 聚合契约——ProviderDescriptor 扩展四字段（envInjector 懒工厂/fileSettings writer 接口/perSessionDir/smokeSuite/switchable）+ 聚合表 satisfies Record<string, ProviderAdapter> 字段完备强制 + caps 加 provider_switch 键（联动 provider-registry.test.ts nineKeys 9→10）'
title_zh: 'ProviderAdapter 聚合契约——ProviderDescriptor 扩展四字段（envInjector 懒工厂/fileSettings writer 接口/perSessionDir/smokeSuite/switchable）+ 聚合表 satisfies Record<string, ProviderAdapter> 字段完备强制 + caps 加 provider_switch 键（联动 provider-registry.test.ts nineKeys 9→10）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 00:00:07
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-003@v2]
allowed_paths:
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  providers.ts 原地扩展 ProviderDescriptor 为 ProviderAdapter 聚合契约（D-003@v2——不另立契约文件，改动面最小），
  新增 envInjector 懒工厂 / fileSettings 写盘器 / perSessionDir / smokeSuite / switchable 字段
  （ProviderFileSettingsWriter 五要素接口同文件定义），聚合表升级 satisfies Record<string, ProviderAdapter>
  字段完备编译强制，PROVIDER_CAPS 加 provider_switch 第 10 键并联动 provider-registry.test.ts nineKeys 9→10
  ——新引擎接入从七八处散落登记收口为聚合表一份声明（缺字段编译红），为 task-02 派生改造 / task-03 硬编码收口 /
  task-04 caps 生成 / task-06 冒烟守护提供统一数据源（FR-01）。
implementation:
  - 'providers.ts 类型扩展（design Wave1 步 1 + 接口定义段）——同文件 export interface ProviderFileSettingsWriter 五要素：dirName（''codex'' 或 ''pi''，per-session 目录段名）、envKey（注入 env 键名，CODEX_HOME / PI_CODING_AGENT_DIR）、isSufficient（门槛判定，与写盘器同判据，provider 缺必需字段返 false 由调用方 warn 跳过）、write（入参归一 dir+provider+daemonApiKey 三件，codex 消费 daemonApiKey、pi 不消费）、skipsOfficialEndpoint（官方端点跳过判定，pi 的 base_url 空返 true 静默走 env 层、codex 恒 false）'
  - 'export interface ProviderAdapter extends ProviderDescriptor——envInjector 懒工厂（() => CredentialInjector 或显式 none+reason 形态；函数形态是 import 环解法的一半，providers.ts 与 credential-injector.ts 互相仅在函数体内访问）；fileSettings（ProviderFileSettingsWriter 或显式 none+reason——claude 的 settings.json 链路在 daemon.ts）；perSessionDir（''codex'' 或 ''pi'' 或显式 none）；smokeSuite（string，冒烟测试文件名）；switchable（boolean，与 caps.provider_switch 同值由单测锁定）；CredentialInjector / ProviderConfig 均 import type 引入不构成运行时环'
  - 'INTERACTIVE_PROVIDERS 四条目填新字段并升级 satisfies Record<string, ProviderAdapter>（沿用 :358 现行 satisfies 形态，条目缺任一必填字段即 TS2741）——claude：envInjector 懒工厂 new ClaudeCredentialInjector()、fileSettings 显式 none+reason（settings.json 链路在 daemon.ts applyClaudeSettings）、perSessionDir 显式 none、smokeSuite=''tests/credential-injector.test.ts''（env 层注入锚点）、switchable=true'
  - 'codex 条目——envInjector 显式 none+reason（0.147.0 二进制无 env 注入面、凭证走文件层——原 REGISTRY 注释升格为声明式元数据）、fileSettings 为 codex writer 薄适配字面量（wrap writeCodexHome 与 isCodexFormSufficient，dirName=''codex''、envKey=''CODEX_HOME''、skipsOfficialEndpoint 恒 false）、perSessionDir=''codex''、smokeSuite=''tests/provider-injection-smoke.integ.test.ts''、switchable=true；pi 条目——envInjector 懒工厂 new PiCredentialInjector()、fileSettings 为 pi writer 薄适配字面量（wrap writePiDir 与 isPiFormSufficient，dirName=''pi''、envKey=''PI_CODING_AGENT_DIR''、skipsOfficialEndpoint 为 base_url 空返 true）、perSessionDir=''pi''、smokeSuite 同 integ 冒烟文件、switchable=true；cursor 条目——envInjector / fileSettings / perSessionDir 全显式 none、smokeSuite=''tests/interactive/cursor-driver.test.ts''（driver 层锚点）、switchable=false'
  - 'import 环纪律（写进注释）——providers.ts 对 credential-injector.ts（注入器类值导入）、provider-file-settings.ts（isCodexFormSufficient / isPiFormSufficient）、codex-settings.ts（writeCodexHome）、pi-settings.ts（writePiDir）的引用一律只出现在函数体内（懒工厂与 writer 方法体），模块初始化零跨表求值（ESM 零 TDZ）；task-02 的反向派生遵守同纪律'
  - 'PROVIDER_CAPS 加 provider_switch 第 10 键——ProviderCaps 接口加 provider_switch 布尔键（语义=支持会话级供应商切换）；四条目取值 claude / codex / pi=true、cursor=false（与 switchable 同值，取值依据 frontend PROVIDER_SWITCH_ENGINES 现行白名单）；getProviderCaps 未知 provider 默认拒绝对象补 provider_switch=false；文件头 docblock 与取值注释同步为 10 键'
  - 'tests/interactive/provider-registry.test.ts 联动（:124/:128/:142）——键集合数组加 ''provider_switch''（保持字母序）、nineKeys 更名 tenKeys、用例标题与注释 9→10 同步；扩 additive 断言各条目 d.switchable 与 d.caps.provider_switch 同值（caps 与 adapter 单源一致前置锁定）；「其余八键恒 boolean」注释改九键（dialog 特判不变）'
acceptance:
  - 'cd sillyhub-daemon && pnpm typecheck 绿——聚合表任一条目缺新必填字段即 TS2741 编译红（satisfies 字段完备强制生效）；「临时抽走一份声明 → tsc 红」防遗漏完整演示验证按 plan 全局验收归 task-07，本卡不执行'
  - 'provider-registry.test.ts 全绿——10 键集合断言 + switchable 与 caps.provider_switch 一致断言 + 既有用例 1/2/3/5/6 零漂移'
  - 'providers.ts 导出面纯 additive——ProviderCaps / PROVIDER_CAPS / getProviderCaps / INTERACTIVE_PROVIDERS / InteractiveProvider 均不删不改签名，既有消费方（driver.ts / types.ts / session-manager.ts / 三端 caps 镜像链）零感知；caps 新键为 additive，三端同步生成归 task-04'
  - 'INTERACTIVE_PROVIDERS 运行时键集合仍恰为 claude / codex / cursor / pi（gemini 不接入，非目标——未来接入时 satisfies 立即编译红即防遗漏机制本身）'
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/provider-registry.test.ts
constraints:
  - '只改 allowed_paths 两文件——codex-settings.ts / pi-settings.ts / credential-injector.ts / provider-file-settings.ts / daemon.ts 一律不动（写盘器本体不动，REGISTRY 惰性化与两处分派 writer 化归 task-02，硬编码收口归 task-03）'
  - '本卡不做派生改造——聚合表填值后既有 REGISTRY 字面量与 kind 字面量分派暂与聚合表并存（值等价），数据源切换归 task-02'
  - '既有测试唯一改动=nineKeys 9→10 联动与 switchable 一致 additive 断言，不改既有断言语义（CLAUDE.md 规则 9）'
  - 'smokeSuite 值=仓根相对路径且真实存在的测试文件；写盘器引擎的 api_format 全词表表驱动用例归 task-06 落 pi-settings / codex-settings 测试，claude / cursor 无写盘器故锚点取 env 层 / driver 层既有套件'
related_tests:
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
provides:
  - contract: ProviderAdapter 聚合契约
    fields: [ProviderAdapter, ProviderFileSettingsWriter, provider_switch, INTERACTIVE_PROVIDERS 键集合, smokeSuite 文件名声明形态, fileSettings writer 或 none 形态, switchable 布尔]
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
