---
id: task-09
title: '前端消费面——api 类型/FormValues/配置条模型下拉源/档案表单/ctx-usage-bar/列表卡片/session-panel/page-helpers/移动端 + gen:types + 四旧字段 grep 清零'
title_zh: '前端消费面——api 类型/FormValues/配置条模型下拉源/档案表单/ctx-usage-bar/列表卡片/session-panel/page-helpers/移动端 + gen:types + 四旧字段 grep 清零'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 21:36:44
priority: P0
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - backend/openapi.json
  - backend/app/modules/agent/schema.py
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/api/llm-providers.ts
  - frontend/src/components/llm-providers/llm-provider-list.tsx
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/sessions/ctx-usage-bar.tsx
  - frontend/src/components/agent-profile-form.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
  - frontend/src/app/m/workspaces/[id]/sessions/[sid]/page.tsx
target_files:
  # verify 对账修正（2026-10-07，真实 > 声明）：agent-profile-form.tsx 与移动端 [sid]/page.tsx
  # 零 diff 移出交付清单——两者经 session-config-bar/ctx-usage-bar 间接消费 models 契约，本体
  # 无需改（tsc 0 + 前端触面 237 绿背书）；移动端仅测试 mock 补齐（page.m-session-chat.test.tsx），
  # 与 review.json 结论一致。
  - backend/openapi.json
  - backend/app/modules/agent/schema.py
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/api/llm-providers.ts
  - frontend/src/components/llm-providers/llm-provider-list.tsx
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/sessions/ctx-usage-bar.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
goal: >
  前端消费面与类型面整体切换 models 列表（FR-01/FR-03 / Wave4-10/11，R-08）：gen:types
  重生成、llm-providers.ts 手写类型与 FormValues 收口、会话配置条与档案表单模型下拉源改
  供应商 models、ctx-usage-bar 与列表卡片/session-panel/page-helpers/移动端展示对齐、
  四旧字段前端消费 grep 清零。
implementation:
  - gen:types 前确认 node_modules 健康（pnpm exec tsc --version 可跑，CLAUDE.md 规则 21；半坏先 pnpm install --force）；后端启动生成 backend/openapi.json 与 frontend/src/lib/api-types.ts 并提交（后端 schema 已由 task-02 切换）
  - frontend/src/lib/api/llm-providers.ts：新增 ProviderModelEntry TS 类型（name/multimodal 三态/roles/one_m）；LlmProviderRead/Create/Update 删 model/model_role_mappings/default_fallback_model/multimodal 四字段加 models（:60-135 三接口）；LlmProviderFormValues 的 model_role_mappings 与 default_fallback_model（:150-161）改 models 条目列表；LlmProviderRoleMapping 类型随消费面退役（:27）
  - frontend/src/components/sessions/session-config-bar.tsx 模型下拉候选源（:417-427）：provider.model / default_fallback_model / model_role_mappings 拼候选改 provider.models 条目 name 列表（:40-41 注释同步）
  - frontend/src/components/agent-profile-form.tsx：grep 复核模型选择面——现为自由文本输入（:490），如无供应商下拉面则仅在卡内记录免改，有则同源切换
  - frontend/src/components/sessions/ctx-usage-bar.tsx：模型显示对齐条目（:88 roleMapping 或 fallbackModel 链改 models 派生；:120 default_fallback_model 来源注释同步）；1M 判定链随条目 one_m 语义核对（design Wave4-10）
  - frontend/src/components/llm-providers/llm-provider-list.tsx modelSummary（:52-56）：default_fallback_model 与 model_role_mappings 消费改 models 列表展示（主模型派生 + 各条目角色标签）
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx（:2640-2641 ctxFallbackModel 链）与 frontend/src/components/daemon/session-panel/page-helpers.tsx（:502 与 :541 两处 provider.model 链、:539-543 model_role_mappings 读取）：改 models 主模型派生与条目折算（与后端 derive_primary_model 同口径：sonnet 首条 ?? 列表首条；前端同源启发式提示条预览 :503 一并核对）
  - frontend/src/app/m/workspaces/[id]/sessions/[sid]/page.tsx 移动端会话模型选择：grep 复核触点（本体无直接旧字段读则记免改；测试文件触点归 task-10）
  - 全仓 grep 清零（R-08，Grill P1-4）：frontend/src 非测试文件内 default_fallback_model / model_role_mappings / 供应商级 multimodal 消费点清零（api-types 生成物除外——gen:types 后自然消失）
  - backend/app/modules/agent/schema.py 的 provider_config DTO 文档串更新（models 键 + 折算键说明，design 文件清单行）——若纯注释改动则随本卡 gen:types 重生成一并核对
acceptance:
  - pnpm gen:types 产出新 openapi.json 与 api-types.ts（ProviderModelEntry 与三 DTO.models 出现，四旧字段消失）并纳入提交
  - 会话配置条模型下拉候选 = 供应商 models 条目名列表；档案表单复核结论记录在卡（改或免改）
  - ctx-usage-bar / llm-provider-list / session-panel-page / page-helpers / 移动端展示与派生全部走 models，grep 四旧字段在 frontend/src 非测试源码零命中
  - cd frontend && pnpm exec tsc --noEmit 全绿（R-08 tsc 门；测试文件断言归 task-10 修）
verify:
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm exec tsc --noEmit
  - grep -rn "default_fallback_model\|model_role_mappings" frontend/src --include="*.tsx" --include="*.ts" | grep -v api-types | grep -v __tests__（期望零命中）
constraints:
  - MUST NOT 触碰 llmProviderPresets.ts 预设文件；MUST NOT 改 sillyhub-daemon 仓任何文件
  - gen:types 遇无关旧测试债（mock 缺字段类）按惯例顺手补修（CLAUDE.md 规则 21），不为躲报错改回手写类型
  - api-types.ts MUST 由 gen:types 生成（规则 21 禁手写）；llm-providers.ts 手写类型与生成类型并存现状照旧（该文件本就是手写 API 层）
  - 测试文件更新归 task-10（本卡 tsc 若因测试文件红，记录清单移交）；eslint 全量门归 task-10
  - 前端主模型派生口径 MUST 与后端一致（sonnet 首条 ?? 列表首条），在 page-helpers 等单一 helper 内实现不散写
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
