---
id: task-04
title: 'caps 三端 pi 键+EXPECTED_PROVIDERS+providers.ts 条目+cli.ts 装配行+detector minVersion'
title_zh: 'caps 三端 pi 键+EXPECTED_PROVIDERS+providers.ts 条目+cli.ts 装配行+detector minVersion'
author: 'qinyi'
created_at: 2026-09-04 11:38:51
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04, FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/src/agent-detector.ts
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
  - backend/app/modules/agent/provider_caps.py
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - frontend/src/lib/provider-caps.ts
goal: >
  PI 注册全链：providers.ts 条目+三端 caps pi 键+cli.ts 装配行+detector minVersion+
  两处守护测试补 pi（FR-04/FR-03 / D-002@v1）。
implementation:
  - providers.ts：INTERACTIVE_PROVIDERS 加 pi {family:'pi_json', displayName:'PI', createDriver:()=>new PiRpcDriver(), caps:capsOf('pi')}（惰性 import 或直接引用，与 claude/codex 条目同款）；PROVIDER_CAPS 加 pi 键——初值 resume/multimodal/thinking/model_select=true；mcp/edit_patch/permission_dialog/subagent=false（subagent 初始 false 遵守 §6.2 纪律，task-06 实证后翻）
  - 三端镜像同步：provider_caps.py / provider-caps.ts 同值；test_provider_caps_alignment.py EXPECTED_PROVIDERS（:51 硬编码 {claude,codex}）补 pi
  - cli.ts :754 drivers 装配加 pi: new PiRpcDriver()（_getDriver 走 deps.drivers 注入）
  - agent-detector.ts PROVIDER_SPECS.pi 补 minVersion '0.81.0'
  - provider-registry.test.ts 用例 1/3/5 补 pi（键集合断言 toEqual/family∈协议反查/实例化）
acceptance:
  - 三端 caps 一致（对齐测试 4+ 用例全绿，EXPECTED_PROVIDERS 含 pi）
  - registry 测试全绿（pi 实例化/family=pi_json 与 PROVIDER_TO_PROTOCOL 反查一致）
  - InteractiveProvider 联合自动含 pi（编译层，无类型字面量改动）
  - detector minVersion 生效（低于 0.81 探测警告——单测或类型层验证）
verify:
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/agent/tests/test_provider_caps_alignment.py -q
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/provider-registry.test.ts
  - cd sillyhub-daemon && pnpm run typecheck
constraints:
  - caps 初值严格按 design §5.3（subagent=false 起）；翻值只归 task-06
  - 不动 daemon.ts/SessionManager/backend session service/前端组件（四承诺区+门控已有）
  - daemon providers.ts 是唯一维护源，注释锚定取值依据
expects_from:
  - 上游：ProviderCaps/INTERACTIVE_PROVIDERS 结构（agent-provider-abstraction 已合入）
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
