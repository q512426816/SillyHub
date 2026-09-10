---
id: task-05
title: 'add-daemon-pi-credential-injector-and-registry-entry'
title_zh: 'daemon 新增 PiCredentialInjector + REGISTRY 注册（api_key→env[auth_field 缺省 ANTHROPIC_API_KEY]、extra_env 透传空串跳过、其余字段不映射）'
author: 'qinyi'
created_at: 2026-09-10 21:30:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/credential-injector.ts
  - sillyhub-daemon/tests/credential-injector.test.ts
  - sillyhub-daemon/tests/credential-injector-pi.test.ts
target_files:
  - sillyhub-daemon/src/credential-injector.ts
  - sillyhub-daemon/tests/credential-injector.test.ts
  - NEW:sillyhub-daemon/tests/credential-injector-pi.test.ts
related_tests:
  - sillyhub-daemon/tests/credential-injector.test.ts
goal: >
  打通 pi 执行器凭证注入最后一环（FR-03/D-002@v1）：新增 PiCredentialInjector 并登记
  REGISTRY，spawn-env 第 0 层（spawn-env.ts:205-211）不再跳过 pi，worker 用独立 key。
implementation:
  - 'credential-injector.ts 新增 PiCredentialInjector implements CredentialInjector（agentKind="pi"）；REGISTRY（:217-219）增 pi 条目，spawn-env 第 0 层零改动即命中；类头注释写明 v1 边界与依据：pi 实测凭证走 provider 专属 env、不读任何 BASE_URL env、model 经 --model 旗标不走 env（design §5.2/§3）'
  - 'toEnv 映射：api_key 非空 → env[config.auth_field ?? "ANTHROPIC_API_KEY"]；extra_env 透传（空串值跳过，复用 assignSkippingEmptyStrings，未导出则同款内联）；litellm_proxy/base_url/model/model_role_mappings/default_fallback_model 一律不映射'
  - '更新 tests/credential-injector.test.ts：注册表用例把 pi 移出「未知 agentKind 返回 undefined」断言（保留 codex/gemini/unknown-xyz）'
  - '新增 tests/credential-injector-pi.test.ts：auth_field 缺省/显式、api_key 空串跳过、extra_env 空串值跳过、其余字段不产键、REGISTRY 注册与单例'
acceptance:
  - 'getInjector("pi") 返回 PiCredentialInjector 单例；codex/gemini/unknown-xyz 仍 undefined'
  - 'toEnv({agent_kind: "pi", api_key: "sk-x", auth_field: "ZAI_API_KEY"}) 得 {"ZAI_API_KEY": "sk-x"}；缺 auth_field 时键为 ANTHROPIC_API_KEY'
  - 'config 含 litellm_proxy/base_url/model/model_role_mappings/default_fallback_model 时不产任何对应 env 键；api_key 缺省/空串不写认证键'
verify:
  - 'cd sillyhub-daemon && pnpm exec vitest run tests/credential-injector.test.ts tests/credential-injector-pi.test.ts'
constraints:
  - '未配 pi 凭证时 spawn env 与现状逐字一致：getInjector 命中但 config 缺 api_key 时不写任何 env 键'
  - '不打印 config/api_key（R-02 不泄漏铁律；toEnv 纯函数语义保持）'
  - '不动 CredentialInjector 接口与 ClaudeCredentialInjector（D-006：接口不得加 provider 专属字段）'
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
