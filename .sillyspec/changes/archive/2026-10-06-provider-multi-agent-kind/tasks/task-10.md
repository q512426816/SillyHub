---
id: task-10
title: '前端测试（表单/列表/过滤口径/form-fetch-config mock）+ tsc + eslint'
title_zh: '前端测试（表单/列表/过滤口径/form-fetch-config mock）+ tsc + eslint'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 14:31:42
priority: P0
depends_on: ['task-09']
blocks: []
requirement_ids: [FR-04, FR-05]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
target_files:
  - frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
goal: >
  为 task-08/09 的引擎多选改造补齐前端测试并以编译/静态检查收口（design 总体
  方案 Wave3 第 11 条，R-04）：表单多选交互与 pi×openai 禁用前置、收缩空缺
  toast 断言、列表多徽标、配置条/档案表单过滤口径、form-fetch-config mock。
implementation:
  - frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx：多选交互用例——勾选 claude+pi 提交 values.agent_kinds 为两元素数组、编辑态多引擎回填、全不勾时提交禁用；openai 格式下 pi 复选 disabled 与提示；含 claude 的多选行使引擎自动压缩条件区渲染（includes 口径）；编辑默认行收缩引擎出「默认已空缺」提示断言（R-05）
  - frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx：pi × openai_chat 禁配前置——api_format 切 openai_chat 后 pi 复选禁用、pi 已勾自动摘除、提示文案断言（与后端 422 文案同口径）
  - frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx：agent_kinds 两引擎行渲染两个引擎徽标（claude+pi 并列可见）
  - frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx：mock DTO agent_kinds 化后编辑态 provider_id 与新建态 base_url+api_key 双形态用例保持全绿
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx：过滤口径——多引擎行（claude+pi）在 claude 与 pi 会话下拉均出现、codex 会话不出现（沿用该文件既有引擎过滤用例骨架改 includes 断言）
  - frontend/src/components/__tests__/agent-profile-form.test.tsx：档案表单供应商过滤口径——多引擎行对所含引擎可见、对未含引擎隐藏（includes 断言）
  - 收口门：仅跑上述相关测试文件（禁全量 vitest run）；pnpm exec tsc --noEmit 0 错；eslint 0 error（pnpm lint）
acceptance:
  - 6 个相关测试文件目标用例全绿（vitest run 指定文件 0 失败）
  - cd frontend && pnpm exec tsc --noEmit 0 错；cd frontend && pnpm lint 0 error
  - 覆盖 design Wave3 第 11 条清单：表单多选交互、组合禁用前置、收缩 toast、列表徽标、配置条/档案过滤口径、form-fetch-config mock
verify:
  - cd frontend && pnpm exec vitest run src/components/llm-providers/__tests__/llm-provider-form.test.tsx src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx src/components/llm-providers/__tests__/llm-provider-list.test.tsx src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx src/components/sessions/__tests__/session-config-bar.test.tsx src/components/__tests__/agent-profile-form.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 只改测试文件；发现实现缺陷回 task-08/task-09 修复后重跑，不在测试内绕过
  - verify 仅跑相关测试文件，禁跑全量测试套件
  - 不改后端与 daemon 仓；mock 固件形态与 task-09 的类型（agent_kinds 数组）一致
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
