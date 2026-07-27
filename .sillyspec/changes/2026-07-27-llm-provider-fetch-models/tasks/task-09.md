---
id: task-09
title: "form 角色映射区：全局获取模型 + 一键设置 + 4 角色 model 改下拉"
title_zh: 角色映射区全局获取+一键设置+下拉
author: qinyi
created_at: 2026-07-27 09:47:54
priority: P0
depends_on: [task-08, task-11]
blocks: [task-14]
requirement_ids: [FR-04, FR-05]
decision_ids: [D-002, D-003]
allowed_paths:
  - frontend/src/components/llm-providers/llm-provider-form.tsx
expects_from:
  task-08:
    - contract: ModelInputWithFetch props
      needs: [value, onChange, fetchedModels, onFetch]
  task-11:
    - contract: fetchProviderModels return
      needs: [models]
goal: >
  角色映射区在 ROLE_ROWS 表格上方加全局「获取模型列表」+「一键设置」按钮（D-003/D-002），4 角色 model 单元格由手填 input 改用 ModelInputWithFetch 下拉，共享同一份 fetchedModels。
implementation:
  - ROLE_ROWS 表格上方加两个按钮：「获取模型列表」调 task-11 fetchProviderModels（新建态传 {base_url,api_key,auth_field}，编辑态传 {provider_id: initial.id}），结果存组件顶层 fetchedModels state 供 4 角色共用（D-003，一次请求）。
  - 「一键设置」取 sonnet||opus||fable||haiku 第一个 model 非空值，填全部 4 角色 model 单元格（D-002）。
  - 4 角色 model 单元格（现手填 input）改用 task-08 ModelInputWithFetch，传 value/onChange/fetchedModels/onFetch；display 列与 one_m 列保持原样。
  - 获取中 loading 由 ModelInputWithFetch 自身 spinner 承载；顶层加 isFetching 守卫防重复点击。
acceptance:
  - 点全局「获取模型列表」→ 4 角色下拉都有模型，按 owned_by 分组展示。
  - 点「一键设置」→ sonnet||opus||fable||haiku 第一非空模型填满 4 角色 model。
  - 新建态（base_url+key）与编辑态（provider_id）两种获取形态都通。
  - 不破坏 ROLE_ROWS / extra_env / default_fallback_model 等既有结构与提交 payload。
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - 全局只一个获取按钮（D-003，4 角色共用一次请求，禁按角色各放一个）。
  - 一键设置取 sonnet||opus||fable||haiku 第一非空（D-002），全空时禁用或提示。
  - 中文按钮文案；不改 ROLE_ROWS 定义、mapping 构建、envRows 结构。
---
