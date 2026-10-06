---
id: task-09
title: '前端消费面 + gen:types（api 层类型/归一化 + 配置条/档案表单过滤 includes + 移动端与全部 mock 字段 + openapi.json/api-types.ts 再生成提交）'
title_zh: '前端消费面 + gen:types（api 层类型/归一化 + 配置条/档案表单过滤 includes + 移动端与全部 mock 字段 + openapi.json/api-types.ts 再生成提交）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 14:31:42
priority: P0
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/lib/api/llm-providers.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/agent-profile-form.tsx
  - frontend/src/app/m/
  - frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx
  - frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
  - frontend/src/lib/api/__tests__/llm-providers.test.ts
target_files:
  - frontend/src/lib/api/llm-providers.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/agent-profile-form.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx
  - frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
  - frontend/src/lib/api/__tests__/llm-providers.test.ts
  - frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx
  - frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx
goal: >
  前端接口层与全部消费面完成 agent_kind → agent_kinds[] 切换（design 总体方案
  Wave2 第 7/8 条）：api 类型与归一化、配置条/档案表单过滤 === 改 includes、
  gen:types 再生成同批提交、移动端与全部测试 mock 字段补齐，收口 tsc 全绿（R-04）。
implementation:
  - 前置确认 task-02 已定型 LlmProviderCreate/Update/Read 的 agent_kinds（list[str] 至少 1 个）；在 frontend 目录跑 pnpm gen:types（脚本先跑 backend dump_openapi.py 刷新 backend/openapi.json，再生成 frontend/src/lib/api-types.ts；脚本对两产物有未提交改动守卫，工作区需干净），backend/openapi.json 与 frontend/src/lib/api-types.ts 同批提交不留中间态
  - frontend/src/lib/api/llm-providers.ts:64 LlmProviderRead.agent_kind 改 agent_kinds（string[]）；llm-providers.ts:96 LlmProviderCreate.agent_kind 改 agent_kinds（LlmProviderAgentKind[]）；LlmProviderUpdate 增可选 agent_kinds（不传=不动）；llm-providers.ts:150 LlmProviderFormValues.agent_kind 改 agent_kinds；formToCreate/formToUpdate（llm-providers.ts:439-479）产出 agent_kinds 并去重
  - frontend/src/components/sessions/session-config-bar.tsx:412 供应商过滤 p.agent_kind === effectiveEngine 改 p.agent_kinds.includes(effectiveEngine)（session-config-bar.tsx:402 注释同步）
  - frontend/src/components/agent-profile-form.tsx:770 供应商过滤 p.agent_kind === engineProvider 改 p.agent_kinds.includes(engineProvider)（agent-profile-form.tsx:346 与 :750 注释同步）
  - 移动端核查（design Wave2 第 7 条）：grep 复核 frontend/src/app/m/ 源码无供应商 agent_kind 本地过滤点（当前仅测试 mock 含该字段），核查结论记入本卡；若复核发现新过滤点一并 includes 化
  - design 文件清单 5 个 mock 文件补齐 agent_kinds 字段与断言机械改名（固件 agent_kind 单值改 agent_kinds 单元素数组、values/body 断言键改名）：frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx:34 及各断言、frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx:48、frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx:43、frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx:81、frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx:761
  - grep 复核新增（design.md:101 注记授权）：frontend/src/components/sessions/__tests__/session-config-bar.test.tsx:183-184、:423-426、:624、:697 固件；frontend/src/lib/api/__tests__/llm-providers.test.ts:71、:88、:129 mock 与 :167 formToCreate 断言；frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx:244；frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx:84 —— 逐一补 agent_kinds
acceptance:
  - LlmProviderRead/Create/Update/FormValues 均为 agent_kinds 数组形态，前端不再类型引用供应商行 agent_kind 字段
  - backend/openapi.json 与 frontend/src/lib/api-types.ts 含 agent_kinds 数组字段（gen:types 再生成产物）且同批提交
  - 配置条（session-config-bar.tsx:412）与档案表单（agent-profile-form.tsx:770）按 includes 过滤，多引擎行（claude+pi）在 claude 与 pi 两个引擎下均可见可选中
  - design 清单 5 文件 + grep 复核新增 4 文件的全部供应商 mock 已补 agent_kinds，tsc --noEmit 0 错
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && grep -rn "agent_kind" src --include="*.ts" --include="*.tsx" | grep -v "agent_kinds"（残留仅允许会话引擎值语境与注释，供应商行字段消费清零）
constraints:
  - 不改后端 Python 源码（backend/openapi.json 仅作为 gen:types 再生成产物提交），后端契约以 task-02 为准
  - 预设 frontend/src/config/llmProviderPresets.ts 无 agent_kind 字段，零改动
  - 测试文件仅做 mock 字段补齐与断言机械改名，行为用例新增/重写归 task-10
  - openapi.json 与 api-types.ts 同批提交、无过渡期中间态（design 兼容策略）；不做旧字段兼容读取
expects_from: ['task-02']
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
