---
id: task-14
title: "前端测试：ModelInputWithFetch（拉取中/下拉选/无 onFetch）；配置 JSON 面板（5 开关 toggle 改 JSON / 格式化 / 应用预设 / JSON 非法不崩）；一键设置。（覆盖：AC-01~AC-04 前端侧）— 依赖 task-08/09/10/11"
title_zh: 前端测试（组件+配置面板+一键设置）
priority: P0
created_at: 2026-07-27 09:47:54
author: qinyi
depends_on: [task-08, task-09, task-10, task-11]
blocks: []
requirement_ids: [FR-04, FR-05, FR-07, FR-08]
decision_ids: []
allowed_paths:
  - frontend/src/__tests__/
goal: >
  前端覆盖 ModelInputWithFetch 三态（拉取中 / 下拉选 / 无 onFetch）+ 配置 JSON 面板（5 开关 toggle 改 JSON / 格式化 / 应用通用配置预设 / JSON 非法不崩）+ 一键设置填全部 4 角色。
implementation: >
  在 frontend/src/__tests__/ 下新建 llm-provider 相关测试（vitest + testing-library + jsdom，仿既有 components/llm-providers/__tests__/llm-provider-form.test.tsx 与 lib/api/__tests__/llm-providers.test.ts 范式）。
  ① ModelInputWithFetch 三态：isLoading=true → Loader2 spinner 可见且获取按钮 disabled；fetchedModels 非空 → DropdownMenu 按 owned_by 分组（含「其他」兜底分组），点 DropdownMenuItem 触发 onChange(model.id)；
  无 onFetch 且无数据 → 退化为纯 Input，无获取按钮渲染。② 配置 JSON 面板（render LlmProviderForm 展开「配置 JSON」details）：5 开关 toggle 增删 settings_config 对应键（D-008：隐藏署名=attribution:{commit:"",pr:""} / Teammates=env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS="1" /
  Tool Search=env.ENABLE_TOOL_SEARCH="true" / 最大强度思考=env.CLAUDE_CODE_EFFORT_LEVEL="max" / 禁用自动升级=env.DISABLE_AUTOUPDATER="1"；env 子对象空则 delete env 键）；
  「格式化」按钮把压缩 JSON 转两空格缩进；「应用通用配置」浅合并预设片段（env+enabledPlugins）进 settings_config；textarea 输入非法 JSON → 不抛错（提交时 settings_config 落 null，组件仍可渲染/提交）。
  ③ 一键设置：预填 sonnet model 非空 → 点「一键设置」→ onSubmit values 的 4 角色 model 全等于该第一非空值（D-002）。fetch 全程 mock（仿既有 mockFetch harness + fetchProviderModels 返回 {models:[{id,owned_by}]}），不打真实网络。
acceptance: >
  ModelInputWithFetch 三态断言全通过（spinner / 按 owned_by 分组下拉选中触发 onChange / 纯 Input 退化）；5 开关 toggle 正确增删 settings_config 键（env 空则 delete env）；
  格式化按钮生效；应用通用配置浅合并预设；JSON 非法输入不崩（不抛错、组件仍渲染、settings_config 落 null）；一键设置填满 4 角色 model（D-002 第一非空）；vitest 全绿。
verify: >
  cd frontend && pnpm test；cd frontend && pnpm typecheck。
constraints: >
  vitest + testing-library + jsdom；注意 next/dynamic 等 SSR null mock 范式（若被测组件引 markdown-text 等动态导入，测试顶部 vi.mock 纯文本渲染，见 memory frontend-markdown-text-jsdom-null；
  既有 llm-provider-form.test.tsx 注明该表单无 next/dynamic，新增测试若引入动态组件再补 mock）；mock fetch 不打真实网络（仿既有 mockFetch harness）；不为通过改测试逻辑（CLAUDE.md 规则 9）；typecheck 先过；中文 UI 断言不绑死英文文案。
---
