---
id: task-05
title: '注册与模型路由——zcode-settings.ts per-session 配置面写入器（provider_config.json 个人 Provider：api.type 判 anthropic-messages/openai-chat-completions + baseUrl + apiKey + 模型清单；ZCODE_DATA_BASE_DIR 注入）+ providers.ts PROVIDER_CAPS/INTERACTIVE_PROVIDERS 注册（family=''ndjson''、fileSettings.dirName 与 perSessionDir 联合加宽、smokeSuite、switchable）+ gen-provider-caps.mjs 三端镜像刷新 （D-002/D-003 → FR-05/06）'
title_zh: '注册与模型路由——zcode-settings.ts per-session 配置面写入器（provider_config.json 个人 Provider：api.type 判 anthropic-messages/openai-chat-completions + baseUrl + apiKey + 模型清单；ZCODE_DATA_BASE_DIR 注入）+ providers.ts PROVIDER_CAPS/INTERACTIVE_PROVIDERS 注册（family=''ndjson''、fileSettings.dirName 与 perSessionDir 联合加宽、smokeSuite、switchable）+ gen-provider-caps.mjs 三端镜像刷新 （D-002/D-003 → FR-05/06）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 13:50:04
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-05, FR-06]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/zcode-settings.ts
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/tests/zcode-settings.test.ts
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx
  - backend/app/modules/agent/provider_caps.py
  - frontend/src/lib/provider-caps.ts
target_files:
  - NEW:sillyhub-daemon/src/zcode-settings.ts
  - sillyhub-daemon/src/interactive/providers.ts
  - NEW:sillyhub-daemon/tests/zcode-settings.test.ts
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
  - backend/app/modules/agent/provider_caps.py
  - frontend/src/lib/provider-caps.ts
provides:
  - INTERACTIVE_PROVIDERS['zcode'] ProviderAdapter（createDriver/fileSettings/perSessionDir/smokeSuite/switchable）+ PROVIDER_CAPS['zcode'] 十六键 + 三端 caps 镜像
expects_from:
  - task-04: ZcodeAppServerDriver（createDriver 工厂引用）
goal: >
  zcode 引擎注册与模型路由：per-session 配置面写入器（provider_config.json 个人 Provider）
  + providers.ts 注册条目（类型联合加宽）+ caps 三端镜像刷新。
implementation:
  - NEW:sillyhub-daemon/src/zcode-settings.ts：writeZcodeProviderConfig(perSessionDir, providerConfig) 生成 <dir>/.zcode/v2/provider_config.json（schemaVersion=1、providerOrder 单条、providerConfigRules 单条：providerId 固定 'sillyhub'、api.type 按 base_url 形态判 anthropic-messages/openai-chat-completions、api.baseUrl、access.type='api-key'、access.apiKey、personalModelIds/modelOrder=[model]）；无 providerConfig 时跳过写入（不覆盖机器默认）
  - providers.ts：fileSettings.dirName 联合 'codex'|'pi' 加 'zcode'（providers.ts:590）；perSessionDir 联合 'codex'|'pi'|{kind:'none'} 加 'zcode'（providers.ts:625）——dsh 变更同改可并；INTERACTIVE_PROVIDERS 加 zcode 条目（family='ndjson'、createDriver=()=>new ZcodeAppServerDriver、fileSettings 指向写入器、perSessionDir='zcode'、smokeSuite 含配置生效断言、switchable=true）
  - PROVIDER_CAPS 加 zcode 十六键（按 design 接口定义定值：dialog='native'、steering=false、sessionFork='none'、mcp/multimodal/attachments/subagent/edit_patch=false，其余 true）
  - 跑 scripts/gen-provider-caps.mjs 刷新 backend/app/modules/agent/provider_caps.py + frontend/src/lib/provider-caps.ts
  - 单测：写入器 schema 钉板（anthropic/openai 两形态）+ 热切换重写 + 注册表守护（caps 与 adapter switchable 同值）
  - 连带守护断言更新：①sillyhub-daemon/tests/interactive/provider-registry.test.ts 注册表精确键集 + 编译层 canary + family 同源比对加批量层缺席例外口径；②backend caps EXPECTED_PROVIDERS 加 zcode ③frontend pre-session-picker 钉子测试补 zcode 十六键全对象钉板（断言面闸门同提交要求，execute 期发现）
acceptance:
  - provider_config.json 生成物结构与本机实测实例 schema 逐字段一致（含 schemaVersion=1）
  - gen-provider-caps 后三端 caps 含 zcode 十六键且既有四引擎条目零变化
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/zcode-settings.test.ts tests/interactive/provider-registry.test.ts
  - node scripts/gen-provider-caps.mjs && git diff --stat backend/app/modules/agent/provider_caps.py frontend/src/lib/provider-caps.ts
constraints:
  - apiKey 明文落 per-session 文件（D-003 定式，目录随清理管线）；zcode 会话库机器共享不清理（D-002）
  - 密钥不走 envInjector（与 dsh apiKeyEnv 形态不同）
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
