---
id: task-05
title: form api_format dropdown + conditional fields
title_zh: 表单加 API 格式下拉与 openai 条件字段隐藏
author: qinyi
created_at: 2026-08-09 01:31:00
priority: P0
depends_on: [task-04]
blocks: [task-07]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/components/llm-providers/llm-provider-form.tsx
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx
goal: >
  llm-provider-form.tsx 加「API 格式」下拉（Anthropic / OpenAI Chat）；选 openai_chat 时隐藏「认证字段」「模型角色映射表」「默认兜底模型」（openai 单模型，D-006）；base_url 框提示可贴完整 .../v1/chat/completions；onSubmit 与 fetch-models 新建态透传 api_format。
implementation:
  - 加 apiFormat state（useState<"anthropic"|"openai_chat">，默认 "anthropic"；编辑态从 initial?.api_format 读，缺省 "anthropic"），消费 task-04 给 LlmProviderRead/FormValues 补的 api_format 字段
  - 在「Agent 种类」下拉旁或 base_url 上方加「API 格式」下拉（两个 option：Anthropic / OpenAI Chat）；onChange setApiFormat
  - apiFormat === "openai_chat" 时条件隐藏：高级选项里的「认证字段」下拉（AUTH_FIELD_OPTIONS 整块）+「模型角色映射」表（ROLE_ROWS + 获取模型列表/一键设置按钮区）+「默认兜底模型」输入框（D-006/N3：openai 单模型不做角色映射）；保留 base_url / api_key / notes / website_url / settings_config / extra_env
  - base_url 输入框（:678 附近）占位符与 hintCls 提示补 openai 完整 URL 示例，明示可贴 https://opencode.ai/zen/v1/chat/completions 这类完整端点
  - handleSubmit（:242）values 带 api_format: apiFormat；同时把 api_format 并入 LlmProviderFormValues（task-04 已在类型层加，表单这里赋值）
  - handleFetch（:264）新建态分支 req 补 api_format: apiFormat（编辑态后端从行读，前端只传 provider_id 不变）
  - applyPreset（:481）套用预设时 setApiFormat(preset.api_format)，使 task-06 的 openai 预设能驱动表单切到 openai 形态
  - resetToCustom（:515）重置时 setApiFormat("anthropic") 回默认
acceptance:
  - 表单渲染「API 格式」下拉，含 Anthropic 与 OpenAI Chat 两个选项
  - 选 OpenAI Chat 时「认证字段」「模型角色映射表」「默认兜底模型」三块不渲染（DOM 查询不到）；切回 Anthropic 重新出现
  - base_url 框占位/提示含完整 .../v1/chat/completions 示例
  - onSubmit 收到的 values.api_format 随下拉值（anthropic / openai_chat）
  - 新建态 handleFetch 的请求体含 api_format；编辑态仍只传 provider_id
  - applyPreset 套用 openai 预设后 apiFormat === "openai_chat"
verify:
  - cd frontend && pnpm test src/components/llm-providers/__tests__/llm-provider-form.test.tsx（task-07 维护的 api_format 切换用例通过）
  - 人工切下拉核验字段显隐（零回归：anthropic 默认态字段齐全）
constraints:
  - 仅改 llm-provider-form.tsx；api_format 类型来自 task-04（lib/api/llm-providers.ts），本任务不动 api/ 类型层
  - 不放开 agent_kind 下拉（仍固定 claude，D-006/N2）
  - openai 隐藏 ≠ 提交脏数据：openai 时 model_role_mappings 仍提交 4 行空结构（cleanRoleMappings 归一为 null），后端忽略；不在表单层删 ROLE_ROWS 逻辑
  - openai 不做角色映射（N3/D-006），仅 UI 隐藏，后端 schema 仍接受该字段
provides:
  - 表单产出 api_format 字段（消费 task-04 类型，驱动 task-06 openai 预设）
  - openai 格式条件字段隐藏（D-006@v1）
  - applyPreset 透传 preset.api_format（task-06 预设 → 表单 state 单一通道）
expects_from:
  task-04:
    - contract: LlmProviderCreate/LlmProviderUpdate/LlmProviderRead/LlmProviderFormValues + FetchProviderModelsRequest 新建态分支含 api_format: "anthropic"|"openai_chat"（default "anthropic"）
      needs: [api_format 类型字段]
---

# task-05 实现笔记

覆盖 design §5.2 前端表单 / FR-09 / D-006@v1（openai 不做角色映射、agent_kind 不放开）。

字段隐藏采用条件渲染（`{apiFormat === "anthropic" && (...)}`），不要用 disabled/hidden——openai 形态下这些字段无意义，渲染了反而误导用户填无用值。注意「获取模型列表」按钮依附于角色映射区块，openai 时整块隐藏；openai 的拉模型交互留给后续（Wave1 openai 供应商仍可通过新建态 base_url+api_key+api_format 在 task-07 真实验证拉到模型列表，按钮隐藏不影响后端 fetch-models 端点能力）。

api_format 下拉放在 base_url 上方更顺（格式决定 URL 形态提示），与「Agent 种类」并排也可； whatever 选位，保证 task-07 单测能 query 到。
