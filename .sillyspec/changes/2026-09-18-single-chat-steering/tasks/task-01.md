---
id: task-01
title: 'PROVIDER_CAPS 新增 steering 第 14 键（daemon providers.ts 单源 + gen-provider-caps.mjs 三端刷新 + alignment 测试）'
title_zh: 'PROVIDER_CAPS 新增 steering 第 14 键（daemon providers.ts 单源 + gen-provider-caps.mjs 三端刷新 + alignment 测试）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 00:36:51
priority: P0
depends_on: []
blocks: ['task-05', 'task-06']
requirement_ids: [FR-02]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/scripts/gen-provider-caps.mjs
  - backend/app/modules/agent/provider_caps.py
  - frontend/src/lib/provider-caps.ts
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
  - frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx
target_files:
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/scripts/gen-provider-caps.mjs
  - backend/app/modules/agent/provider_caps.py
  - frontend/src/lib/provider-caps.ts
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
  - frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx
provides:
  - contract: provider_caps steering 键
    fields: [PROVIDER_CAPS steering 第 14 键, get_provider_caps 未知 provider 默认 false 语义, get_provider_caps steering 键取值（pi/claude/codex=true）, frontend provider-caps.ts steering 键（前端降级标注，消费方 task-08）]
related_tests:
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
  - frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx
goal: >
  在 daemon PROVIDER_CAPS 单源新增 steering 第 14 键（pi/claude/codex=true、
  cursor=false、未知 provider 默认 false），经 gen-provider-caps.mjs 刷新三端
  生成镜像并联动守护测试，为 backend 忙轮能力门控与前端降级标注提供能力
  数据源（FR-02）。
implementation:
  - '单源加键：sillyhub-daemon/src/interactive/providers.ts 的 ProviderCaps 接口（:65）加 steering: boolean；PROVIDER_CAPS 表（:264）四引擎条目补取值 pi/claude/codex=true、cursor=false；docblock 补第 14 键取值依据——pi 为 _sendInject steer 通道实证（sillyhub-daemon/src/interactive/pi-rpc-driver.ts:1859-1914）、claude 为 query({prompt: AsyncIterable}) 忙轮推流经 SDK 命令队列吸收（sillyhub-daemon/src/interactive/claude-sdk-driver.ts:402?，投递时机以 task-04 实测为准）、codex 为 app-server turn/steer 方法存在（参数以 task-02 实机探测为准）、cursor 无对应通道=false、未知 provider 默认 false'
  - '生成脚本契约同步：sillyhub-daemon/scripts/gen-provider-caps.mjs 的 CAPS_KEYS 常量（:58-72）追加 steering——守卫按清单校验「多出 caps 键」会响亮拦截漏同步（exit 1 不写产物）；同步脚本注释与两端模板 docblock 的键数描述（13→14）并按先例（compact/thinking_level 键接入，git 7c0ef8a4c）补 steering 条目注释'
  - '三端刷新：跑 node sillyhub-daemon/scripts/gen-provider-caps.mjs 重生成 backend/app/modules/agent/provider_caps.py 与 frontend/src/lib/provider-caps.ts（@generated 产物不手改；frontend pnpm gen:types 链尾已挂本脚本，无需另接）'
  - '守护测试联动：backend/app/modules/agent/tests/test_provider_caps_alignment.py 的 EXPECTED_CAPS_KEYS 补 steering，==13 断言与 docstring 键数改 14；sillyhub-daemon/tests/interactive/provider-registry.test.ts 的 thirteenKeys 键数组（:153）扩为 14 键；frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx 的 getProviderCaps 全对象 toEqual（:618 起，cursor 与未知引擎两处）补 steering 字段'
  - 'Wave 1 串行收口：若 task-02 探测结论=codex turn/steer 不可用或 task-04 实测=claude 仅轮边界吸收，本 task 回改对应引擎取值为 false 并重跑生成与守护测试（plan spike 前置表约定 caps 翻值回改三端产物归 task-01 收尾）'
acceptance:
  - 'PROVIDER_CAPS 四引擎均有 steering 键且取值 pi/claude/codex=true、cursor=false；getProviderCaps/get_provider_caps 未知 provider 回退 false 且 14 键齐全'
  - 'gen-provider-caps.mjs 守卫通过（恰四引擎 × 14 键，exit 0）且两份生成产物含 steering'
  - 'alignment 测试 4 用例全绿（键集合=14 契约键、provider 集合、逐键取值三端一致、未知 provider 默认拒绝）'
  - 'daemon provider-registry.test.ts 与 frontend pre-session-picker.test.tsx 键数/对象断言联动后通过；daemon 与 frontend tsc --noEmit 通过'
verify:
  - 'node sillyhub-daemon/scripts/gen-provider-caps.mjs（守卫过 + 产物刷新）'
  - 'cd backend && python -m pytest app/modules/agent/tests/test_provider_caps_alignment.py'
  - 'cd sillyhub-daemon && npx vitest run tests/interactive/provider-registry.test.ts'
  - 'cd frontend && pnpm exec vitest run src/components/sessions/__tests__/pre-session-picker.test.tsx'
  - 'cd sillyhub-daemon && npx tsc --noEmit && cd ../frontend && pnpm exec tsc --noEmit'
constraints:
  - '能力矩阵单源：daemon providers.ts PROVIDER_CAPS 为唯一维护源，backend provider_caps.py / frontend provider-caps.ts 均为 gen-provider-caps.mjs 生成产物，不手改生成物'
  - '不新建手维护常量、不加 driver 契约属性、不设 daemon 中心化门控任务（steering 键仅供 backend 门控与前端降级标注消费）'
  - '未知 provider 默认 false（既有默认拒绝语义）'
  - '禁止跑全量测试，仅跑本卡相关测试；代码兼容 Windows/Linux/macOS'
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
