---
id: task-06
title: '冒烟制度化——pi-settings/codex-settings 全词表表驱动映射用例 + 守护测试 provider-adapter-registry.test.ts（覆盖/smokeSuite 存在性/词表扫描/caps 一致/REGISTRY 等价/幂等重跑）'
title_zh: '冒烟制度化——pi-settings/codex-settings 全词表表驱动映射用例 + 守护测试 provider-adapter-registry.test.ts（覆盖/smokeSuite 存在性/词表扫描/caps 一致/REGISTRY 等价/幂等重跑）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 00:00:07
priority: P0
depends_on: ['task-01', 'task-02', 'task-04']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/tests/provider-adapter-registry.test.ts
  - sillyhub-daemon/tests/pi-settings.test.ts
  - sillyhub-daemon/tests/codex-settings.test.ts
target_files:
  - NEW:sillyhub-daemon/tests/provider-adapter-registry.test.ts
  - sillyhub-daemon/tests/pi-settings.test.ts
  - sillyhub-daemon/tests/codex-settings.test.ts
related_tests:
  - path: sillyhub-daemon/tests/pi-settings.test.ts
    reason: 本 task 在此文件追加全词表表驱动映射用例（文件级改动对象，路径已在 allowed_paths，既有 16 用例零改动）
  - path: sillyhub-daemon/tests/codex-settings.test.ts
    reason: 同款 per-form 表驱动用例的追加对象（路径已在 allowed_paths，既有 18 用例零改动）
expects_from:
  task-01:
    - contract: ProviderAdapter 聚合契约
      needs: [smokeSuite 文件名声明形态, fileSettings writer 或 none 形态, switchable 布尔, INTERACTIVE_PROVIDERS 键集合]
  task-02:
    - contract: credential-injector 惰性 memoized 派生
      needs: [getInjector 导出面与签名零改动]
  task-04:
    - contract: gen-provider-caps.mjs 生成脚本
      needs: [node 直跑执行方式, 双产物路径, 幂等重跑稳定]
goal: >
  把写盘器冒烟覆盖从「碰巧有」升格为制度——pi/codex 写盘器各加 api_format 全词表表驱动映射用例，
  并新建守护测试 provider-adapter-registry.test.ts（跨注册表对账/smokeSuite 存在性/词表扫描/
  caps 一致/生成脚本幂等五组），杜绝 ql-20260911-029 类「协议实现错」静默漏网（FR-05 / D-001@v1）。
implementation:
  - 前置对齐契约形态——读 task-01 后的 sillyhub-daemon/src/interactive/providers.ts（ProviderAdapter 新五字段 envInjector/fileSettings/perSessionDir/smokeSuite/switchable 与 INTERACTIVE_PROVIDERS 键集合，现 claude/codex/cursor/pi 四键）、task-02 后的 src/credential-injector.ts（REGISTRY 惰性 memoized 派生、getInjector 导出面零改动）、task-04 的 scripts/gen-provider-caps.mjs（node 直跑、双产物 frontend/src/lib/provider-caps.ts 与 backend/app/modules/agent/provider_caps.py）；对账事实源锚点——backend/app/modules/llm_provider/schema.py 第 22 行 agent_kind Literal「claude/pi/codex」与第 33 行 api_format Literal「anthropic/openai_chat」、src/agent-detector.ts 的 PROVIDER_SPECS 12 键全集（claude/codex/copilot/opencode/openclaw/hermes/gemini/pi/cursor/kimi/kiro/antigravity）
  - 新建守护测试 sillyhub-daemon/tests/provider-adapter-registry.test.ts 五组用例之一——跨注册表键集合对账（「聚合表覆盖引擎全集」按包含关系双向夹逼落地，三表键数天然不同——聚合表 4/detector 12/backend 词表 3，严格三表相等不可实现也不必要）：聚合表每键 ∈ PROVIDER_SPECS 键全集（interactive 引擎必须可探测），backend agent_kind 词表（读仓根 backend/app/modules/llm_provider/schema.py 源文本 regex 提取 Literal，跨仓读源对齐 backend 对齐测试反向读 providers.ts 的先例）⊆ 聚合表键（backend 可下发 kind 必有声明），任一侧新增引擎而聚合表未同步即红；同组锁 REGISTRY 惰性派生等价（task 标题职责）——getInjector 与 adapter.envInjector 逐键等价（实例声明→返回注入器、none 声明→按现行语义不注册），聚合表与派生注册表不漂移
  - 五组之二至五——② smokeSuite 存在性：fileSettings 为 writer 的条目（codex/pi）smokeSuite 非空且声明的测试文件在 sillyhub-daemon/tests/ 下 existsSync 为真；非 writer 条目若声明了文件名也必须存在（空串=未声明冒烟，跳过文件断言）③ 词表扫描：writer 条目的 smokeSuite 文件内容 readFileSync 静态扫描，api_format 词表全量字面量 'anthropic' 与 'openai_chat' 逐字面量 must-contain（词表常量在测试内声明并注释锚 schema.py 第 33 行，同 nineKeys canary 先例；保守规则词表全出现才过，R-05，规则写进测试注释可演进）④ caps 一致：逐引擎断言聚合表条目 caps.provider_switch 与同条目 switchable 同值（键集合断言已由 provider-registry.test.ts 的 10 键联动覆盖，不重复）⑤ 生成脚本幂等：execSync 连跑 scripts/gen-provider-caps.mjs 两遍（cwd 指向 sillyhub-daemon），第一遍后读双产物快照、第二遍后再读，断言逐字节相等（diff 为空）；脚本 exit 非 0 直接 fail（响亮失败守卫透传）
  - pi-settings.test.ts 追加全词表表驱动用例（it.each 一张映射表每行=词表一格，既有 16 用例零改动）——anthropic→models.json providers.sillyhub.api 等于 'anthropic-messages'（写入路径）；openai_chat→跳过零写入（pi × openai_chat 禁配，warn 'pi_dir_write_skipped_openai_chat'）；未知值（词表外哨兵串）→跳过零写入（warn 'pi_dir_write_skipped_unknown_api_format'，ql-20260911-029 教训宁可不写）；undefined 缺省→同 anthropic 路径 api 等于 'anthropic-messages'；表内 'anthropic'/'openai_chat' 字面量即守护测试③的扫描对象
  - codex-settings.test.ts 追加同款 per-form 表驱动用例（每行=词表一格，既有 18 用例零改动）——anthropic→config.toml 的 model_providers.sillyhub 表 wire_api 等于 'responses' 且 base_url=provider.base_url、auth OPENAI_API_KEY=provider.api_key；openai_chat→wire_api 'responses' 且 base_url=litellm_base_url、model=litellm_model_name、auth OPENAI_API_KEY=daemonApiKey（litellm 通道）；undefined 缺省→产物与 anthropic 行逐字节一致（resolveCodexForm 缺省走 anthropic 分支）；不设词表外行——codex 分派是 else 形态且 backend Literal 422 前置拦截词表外值（与 pi 显式 skip 语义不同，测试注释说明）
acceptance:
  - 守护测试五组全绿——①聚合表 4 键全部 ∈ detector 12 键、backend agent_kind 三词（claude/pi/codex）⊆ 聚合表键、getInjector 逐键等价；②codex/pi 的 smokeSuite 文件全部真实存在于 tests/ 下；③两个 smokeSuite 内容均含 'anthropic' 与 'openai_chat' 全量字面量；④caps.provider_switch 与 switchable 逐引擎同值；⑤gen-provider-caps.mjs 两连跑双产物逐字节 diff 为空
  - pi-settings 表驱动四行全绿（anthropic→anthropic-messages 写入 / openai_chat→禁配跳过 / 未知→跳过 / undefined→同 anthropic），既有 16 用例零改动零漂移
  - codex-settings 表驱动三行全绿（anthropic/openai_chat/undefined 的 wire_api='responses' 与 per-form 字段映射逐字段断言），既有 18 用例零改动零漂移
  - 本 task 不改任何实现源码（pi-settings.ts/codex-settings.ts/providers.ts 等零 diff），全部产出为测试新增
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/provider-adapter-registry.test.ts tests/pi-settings.test.ts tests/codex-settings.test.ts && pnpm typecheck
constraints:
  - 只加测试不改实现——发现实现与词表映射不符（真实缺口）先停下回报走修复流程，禁改断言迁就实现也禁改实现迁就测试（规则 9）
  - 守护测试读源对账不复制值断言（对齐测试先例）；扫描规则保守（R-05 词表全出现才过）；幂等用例 execSync 仅限 gen-provider-caps.mjs 不触其它脚本，脚本意外改坏产物时 fail 并提示 git checkout 还原
  - 六处硬编码收口/caps 生成/前端白名单实现归 task-03/04/05，本 task 只消费其产物形态；smokeSuite 具体取值以 task-01 落地为准，测试断存在性与词表内容、不锁具体文件名
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
