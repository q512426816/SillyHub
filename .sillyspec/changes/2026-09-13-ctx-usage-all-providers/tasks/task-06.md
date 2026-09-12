---
id: task-06
title: 'ctx_usage caps key three-end pipeline'
title_zh: 'ProviderCaps 第 11 键 ctx_usage 三端贯通 + 守护同步'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 01:12:24
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/scripts/gen-provider-caps.mjs
  - frontend/src/lib/provider-caps.ts
  - backend/app/modules/agent/provider_caps.py
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
  - sillyhub-daemon/tests/provider-adapter-registry.test.ts
  - frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx
target_files:
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/scripts/gen-provider-caps.mjs
  - frontend/src/lib/provider-caps.ts
  - backend/app/modules/agent/provider_caps.py
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
  - sillyhub-daemon/tests/provider-adapter-registry.test.ts
  - frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx
provides:
  - contract: ProviderCaps
    fields: [ctx_usage]
goal: >
  ProviderCaps 新增第 11 键 ctx_usage: boolean（interactive 会话是否上报 ctx_tokens），
  经 gen-provider-caps.mjs 从 daemon 单源生成 frontend / backend 两份 @generated 产物三端
  贯通，并同步双守护测试与连带 10 键断言——新引擎漏声明即编译红 / 测试红（FR-04）。
implementation:
  - 'providers.ts 三处——① ProviderCaps 接口（:58-90）加 ctx_usage: boolean，注释注明第 11 键 + 取值依据锚点（Wave 2 task-02/03/04 四引擎派生回填后全 true），接口头注释「10 键：9 个 boolean + dialog string 枚举」同步 11 键；② PROVIDER_CAPS 四引擎（claude / codex / pi / cursor）各加 ctx_usage: true；③ getProviderCaps 未知回退字面量（:264-281）加 ctx_usage: false'
  - 'gen-provider-caps.mjs——CAPS_KEYS（:59-70）加 "ctx_usage"（boolean 值解析器原生支持，R-04 无需扩展）；renderFrontend 模板三处：① 硬编码的 ProviderCaps 接口体（:218-246）加 ctx_usage 键（漏加则生成的前端表 excess property 编译红）② getProviderCaps 回退字面量加 ctx_usage: false ③ docblock「10 键：9 个 boolean + dialog string 枚举」文案同步 11 键；renderBackend docblock 同款「10 键」文案一并同步（backend 回退程序化派生自 _CAPS_KEYS，无需改代码）'
  - 跑生成刷新两端产物——node sillyhub-daemon/scripts/gen-provider-caps.mjs，刷新 frontend/src/lib/provider-caps.ts 与 backend/app/modules/agent/provider_caps.py 两份 @generated 产物（frontend pnpm gen:types 链尾亦会自动执行）
  - test_provider_caps_alignment.py——EXPECTED_CAPS_KEYS（:40）加 ctx_usage，注释「= 10 键」同步 11 键；两处 len == 10 硬断言（:148 / :195）改 11；docstring 过时计数字样（「恰为契约 9 键」等）顺手对齐
  - provider-registry.test.ts 用例 4——tenKeys 数组（:132-143）加 'ctx_usage'，按 nineKeys→tenKeys 先例更名 elevenKeys；it() 描述「10 契约键齐全」改 11；注释补第 11 键来源（本变更 FR-04）
  - 'pre-session-picker.test.tsx 两处全对象 toEqual 加 ctx_usage——:624-635 cursor 加 ctx_usage: true；:640-651 unknown-engine 回退加 ctx_usage: false；:618 it() 标题「十键」改「十一键」；断言内注释补 ctx_usage 来源（plan-review P1 连带测试，11 键产物后必红）'
  - provider-adapter-registry.test.ts 三处过时「caps 10 键」注释顺手同步 11 键（:20-21 头注释 ④ 段 / :59 nineKeys→tenKeys 先例注释 / :217-218 用例 4 内注释；纯注释不改断言逻辑，tenKeys canary 名随 provider-registry 更名 elevenKeys 一并对齐）
  - 生成幂等自检——脚本两连跑，第二遍前后两份 @generated 产物逐字节不变（守护⑤既有语义）
acceptance:
  - 三端产物逐值一致：daemon PROVIDER_CAPS ↔ frontend provider-caps.ts ↔ backend provider_caps.py 均含 ctx_usage，四引擎全 true、未知回退 false；既有 10 键取值与键序零变化
  - 双守护测试绿（alignment 四用例 + provider-registry / provider-adapter-registry 套件）；pre-session-picker 套件绿；daemon typecheck 绿
  - 生成幂等：gen-provider-caps.mjs 两连跑，frontend / backend 两份产物第二遍前后逐字节一致
verify:
  - cd sillyhub-daemon && pnpm test -- provider-registry
  - cd sillyhub-daemon && pnpm test -- provider-adapter-registry
  - cd sillyhub-daemon && pnpm typecheck
  - cd backend && uv run pytest app/modules/agent/tests/test_provider_caps_alignment.py -q
  - cd frontend && pnpm test -- pre-session-picker
  - cd frontend && pnpm typecheck
constraints:
  - 不改既有 10 键任何取值与键序；@generated 产物（provider-caps.ts / provider_caps.py）只经脚本生成不手写；各硬编码同步点漏改须保持「响亮失败」（编译红 / 断言红），不做静默兼容
  - gen 脚本保持零 npm 依赖纯 node 直跑（Windows / Linux / macOS 兼容，node sillyhub-daemon/scripts/gen-provider-caps.mjs）
  - 本卡不做前端 CtxUsageBar 门控消费（属 task-07）；不动 INTERACTIVE_PROVIDERS 聚合契约其他字段；不涉 REST DTO（无 pnpm gen:types 必要性，provider-caps 链独立于 OpenAPI）
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
