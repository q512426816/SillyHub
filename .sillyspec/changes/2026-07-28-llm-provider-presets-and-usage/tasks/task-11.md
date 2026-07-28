---
id: task-11
title: "前端测试：预设选择器（点 Kimi For Coding 填表单 / 点自定义重置 / 💰标记）+ usage-footer（成功多 tier / 翻红 / 保留上次值 / 不支持文案）+ list 自动查一次。覆盖 AC-01/05/06。依赖 task-05/07/08/09。"
title_zh: 前端测试（预设选择器+用量展示+列表自动查）
author: qinyi
created_at: 2026-07-28 10:37:44
priority: P0
depends_on: [task-05, task-07, task-08, task-09]
blocks: []
requirement_ids: [FR-01, FR-05, FR-06, FR-07]
decision_ids: [D-001@v1, D-005@v1, D-010@v1]
allowed_paths:
  - frontend/src/components/llm-providers/__tests__/usage-footer.test.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx
provides: []
expects_from: []
goal: >
  前端 vitest 覆盖预设选择器点选填表单/自定义重置/💰标记、usage-footer 四状态、
  列表进页面 useEffect 自动查一次。
implementation:
  - form（追加进 llm-provider-form.test.tsx）：点「Kimi For Coding」预设 → 断言 name/base_url/auth_field/default_fallback_model/website_url 填好且 api_key 仍空；点「＋自定义」→ 表单重置空。
  - form：断言预设网格仅 7 家带「💰」可查用量标记（DeepSeek/硅基/OpenRouter/Kimi/Kimi For Coding/智谱/MiniMax），百炼/Anthropic 官方无标记。
  - usage-footer（新建 test）：success=true + data 多 tier（5h窗/周窗）→ 逐条渲染 plan_name/used/remaining/unit + 进度条 + 重置时间。
  - usage-footer：is_valid=false 翻红 + invalid_message；瞬时失败 raise → 10 分钟内保留上次成功值；data 空 → 中性文案「该供应商暂不支持余额查询」（断言不含 cc-switch 字样）。
  - list（新建 test）：照 form-fetch-config 的 mockFetchOnce stub global fetch 或 vi.mock 模块，渲染列表 → useEffect 对支持用量供应商自动调 queryUsage 一次（不轮询），「查余额」按钮再触发一次。
acceptance:
  - 预设选择器三场景通过：点 Kimi For Coding 填表单 / 点自定义重置 / 💰仅 7 家。
  - usage-footer 四状态通过：成功多 tier / is_valid=false 翻红 / 保留上次值 / 不支持中性文案。
  - list 进页面自动查一次（mock queryUsage 被调一次），手动按钮再触发一次。
  - 新增测试全绿，既有 llm-providers 测试零回归。
verify:
  - cd frontend && pnpm test src/components/llm-providers
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - llm-providers 组件无 next/dynamic，无需 vi.mock markdown；若 execute 引入 dynamic 组件按 markdown-text 坑 vi.mock 纯文本渲染。
  - 遵循既有 vitest 风格（vi.fn mock onSubmit、screen.getByPlaceholderText/getByRole 断言），照 llm-provider-form.test.tsx 范式。
  - 文案断言不含 cc-switch 字样（D-010）；不支持文案固定「该供应商暂不支持余额查询」。
  - brownfield：既有 form/form-fetch-config 用例不动，仅追加预设选择器 describe block + 两个新 test 文件。
---
