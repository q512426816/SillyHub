---
id: task-01
title: 'caps 第 13 键 thinking_level 三端贯通+codex thinking 翻值（八步样板）'
title_zh: 'caps 第 13 键 thinking_level 三端贯通+codex thinking 翻值（八步样板）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 00:48:35
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/scripts/gen-provider-caps.mjs
  - frontend/src/lib/provider-caps.ts
  - backend/app/modules/agent/provider_caps.py
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
  - frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx
  - sillyhub-daemon/tests/provider-adapter-registry.test.ts
target_files:
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/scripts/gen-provider-caps.mjs
  - frontend/src/lib/provider-caps.ts
  - backend/app/modules/agent/provider_caps.py
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
  - frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx
  - sillyhub-daemon/tests/provider-adapter-registry.test.ts
provides:
  - contract: ProviderCaps
    fields: [thinking_level]
goal: >
  ProviderCaps 新增第 13 键 thinking_level: boolean（claude/pi/codex=true、cursor=false、
  未知回退 false），照 compact 第 12 键八步样板（2026-09-14-session-ctx-compact task-01）
  从 daemon 单源经 gen-provider-caps.mjs 贯通 frontend/backend 两份 @generated 产物并同步
  双守护与连带断言；同时把 codex 既有 thinking 键翻 true——纯声明对齐（driver 已映射
  reasoning→thinking 事件而 caps 表值过时，Grill P0-3），为 FR-02~06 提供 caps 门控真数据源。
implementation:
  - 'providers.ts 三处——① ProviderCaps 接口加 thinking_level: boolean（第 13 键，注释注明取值依据：claude applyFlagSettings/pi set_thinking_level/codex thread/settings/update 三通道实证、cursor 无通道），接口头注释键计数同步 13；② PROVIDER_CAPS 表 claude/pi/codex 各加 thinking_level: true、cursor 加 thinking_level: false；③ getProviderCaps 未知回退字面量加 thinking_level: false'
  - 'codex thinking 翻 true（Grill P0-3 纯声明对齐）——PROVIDER_CAPS.codex.thinking 由 false 翻 true，docblock 补依据三件：sillyhub-daemon/src/interactive/codex-app-server-driver.ts:671-682 已把 reasoning item（text+metadata.thinking=true）映射成 thinking 事件、sillyhub-daemon/src/adapters/json-rpc.ts:626-651 注释明说 codex reasoning 与 claude thinking 同契约、前端渲染由事件流无条件驱动零 caps 消费方——「翻值非解锁渲染而是纠正声明、无行为变化」注释必写；sillyhub-daemon/src/interactive/providers.ts:159-160 一带过时「codex flat 契约无 thinking」docblock 同步改写'
  - 'gen-provider-caps.mjs——CAPS_KEYS（:71 compact 后）加 "thinking_level"（boolean 解析器原生支持）；renderFrontend 模板三处：硬编码接口体（:261 compact 键一带）加 thinking_level 键（漏加则生成的前端表 excess property 编译红）、getProviderCaps 回退字面量（:296 compact 一带）加 thinking_level: false、docblock 键计数文案同步 13；renderBackend docblock 键计数同步（backend 回退程序化派生 _CAPS_KEYS 无需改代码）'
  - '跑生成刷新两端产物——node sillyhub-daemon/scripts/gen-provider-caps.mjs，刷新 frontend/src/lib/provider-caps.ts 与 backend/app/modules/agent/provider_caps.py 两份 @generated'
  - 'test_provider_caps_alignment.py——EXPECTED_CAPS_KEYS 加 thinking_level；两处 len == 12 硬断言改 13；docstring 过时计数字样顺手对齐'
  - 'provider-registry.test.ts——twelveKeys 数组（:156 一带）加 "thinking_level"，照 tenKeys→elevenKeys→twelveKeys 先例更名 thirteenKeys；it() 描述键计数同步 13；注释补第 13 键来源（本变更 FR-01）'
  - 'pre-session-picker.test.tsx 两处全对象 toEqual 补键——cursor 态（:635/:653 一带全对象断言）与 unknown-engine 回退态各加 thinking_level: false；it() 标题键计数同步；断言内注释补来源（12→13 键产物后必红的连带测试）'
  - 'provider-adapter-registry.test.ts——过时键计数注释同步 13（头注释 / twelveKeys 先例注释 / 用例 4 内注释；纯注释不改断言逻辑，canary 数组名随 provider-registry 更名 thirteenKeys 一并对齐）'
  - '生成幂等自检——脚本两连跑，第二遍前后两份 @generated 产物逐字节不变（守护既有语义）'
acceptance:
  - 三端产物逐值一致：daemon PROVIDER_CAPS ↔ frontend provider-caps.ts ↔ backend provider_caps.py 均含 thinking_level，claude/pi/codex=true、cursor=false、未知回退 false；codex thinking=true 翻值三端同步；既有 12 键取值与键序零变化
  - 双守护测试绿（alignment + provider-registry / provider-adapter-registry 套件）+ pre-session-picker 套件绿 + 两端 typecheck 绿
  - 生成幂等：gen-provider-caps.mjs 两连跑，两份 @generated 产物第二遍前后逐字节一致；codex 翻值处 docblock 含 :671-682+sillyhub-daemon/src/adapters/json-rpc.ts:626 依据与「纯声明对齐无行为变化」注释
verify:
  - node sillyhub-daemon/scripts/gen-provider-caps.mjs
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/provider-registry.test.ts tests/provider-adapter-registry.test.ts
  - cd backend && uv run pytest app/modules/agent/tests/test_provider_caps_alignment.py -q
  - pnpm -C frontend exec vitest run src/components/sessions/__tests__/pre-session-picker.test.tsx
  - pnpm -C sillyhub-daemon exec tsc --noEmit
  - pnpm -C frontend exec tsc --noEmit
constraints:
  - 不改既有 12 键任何取值与键序（唯一例外=codex thinking 翻 true，即本卡目标之一）；@generated 产物（provider-caps.ts / provider_caps.py）只经脚本生成不手写；八步样板任一同步点漏同步须保持「响亮失败」（编译红/断言红），不做静默兼容
  - codex 翻值为纯声明对齐：不改 driver/前端渲染任何行为代码（渲染已由事件流无条件驱动工作，零 caps 消费方）
  - gen 脚本保持零 npm 依赖纯 node 直跑（Windows / Linux / macOS 兼容）
  - 本卡只做契约贯通不做消费（backend caps 校验属 task-05、daemon 守卫属 task-03、前端门控属 task-06）；provider-caps 链独立于 OpenAPI 无 gen:types 必要性
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
