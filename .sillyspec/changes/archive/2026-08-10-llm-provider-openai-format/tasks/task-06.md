---
id: task-06
title: presets openai entry + list badge + set-default wave1 guard
title_zh: 预设补 OpenAI 条目+列表徽标+设默认 Wave1 过渡守护
author: qinyi
created_at: 2026-08-09 01:31:00
priority: P1
depends_on: [task-04]
blocks: [task-07]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/config/llmProviderPresets.ts
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/components/llm-providers/llm-provider-list.tsx
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/components/llm-providers/
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx
goal: >
  llmProviderPresets.ts 新增 OpenCode Zen OpenAI 预设（api_format=openai_chat, base_url=https://opencode.ai/zen/v1/chat/completions）+ 现有全部预设补 api_format:"anthropic"；llm-provider-list.tsx 对 openai 格式行加徽标，并对 openai 供应商 set-default 加 Wave1 过渡守护提示（Wave2 task-12 移除）。
implementation:
  - LlmProviderPreset 接口加 api_format: "anthropic" | "openai_chat"（必填，预设显式声明格式，不留 undefined）
  - 现有 11 个预设（anthropic_official / kimi / kimi_for_coding / zhipu_glm / deepseek / siliconflow / openrouter / opencode_go / minimax / bailian / bailian_for_coding）全部补 api_format: "anthropic"
  - 新增 opencode_zen_openai 预设：key "opencode_zen_openai"、name "OpenCode Zen (OpenAI 格式)"、category "aggregator"、base_url "https://opencode.ai/zen/v1/chat/completions"、api_format "openai_chat"、auth_field "ANTHROPIC_AUTH_TOKEN"（openai 后端忽略，沿用枚举占位不破类型）、website_url "https://opencode.ai"、icon_color 取 cc-switch opencode 同色系；default_model 由 task-07 真实拉模型后填入实际 id（先留空或合理占位，不臆造）；settings_config_partial 不预填 ANTHROPIC_BASE_URL（openai 不直连上游，Wave2 走 LiteLLM 中转，预填 base 会误导）
  - llm-provider-list.tsx 列表行（:280 附近 Badge 区）：p.api_format === "openai_chat" 时渲染 OpenAI 徽标（如 <Badge variant="outline">OpenAI</Badge>），与现有 agent_kind / 💰 徽标并列
  - handleSetDefault（:113）：开头加判断 if (p.api_format === "openai_chat") { notify 提示「OpenAI 格式供应商的 Claude Code 支持即将上线，暂无法设为默认」; return; } —— 不调 setDefaultProvider，Wave1 过渡守护（D-007/R-04），Wave2 task-12 移除此分支
  - 列表行「启动」按钮可保持可点（点了弹守护提示），或在 openai 时禁用并 tooltip 说明；二选一，task-07 单测覆盖
acceptance:
  - LLM_PROVIDER_PRESETS 含 opencode_zen_openai 条目，其 api_format === "openai_chat"、base_url === "https://opencode.ai/zen/v1/chat/completions"
  - 全部预设（含新条目）均含 api_format 字段；现有 11 个为 "anthropic"
  - 列表 openai 格式行渲染 OpenAI 徽标；anthropic 行不渲染该徽标
  - openai 供应商点「启动」触发守护提示且未发起 setDefaultProvider 请求（mock 未被调）
  - anthropic 供应商「启动」「停止」「编辑」「删除」行为逐字不变（零回归）
verify:
  - cd frontend && pnpm test src/components/llm-providers/__tests__/llm-provider-list.test.tsx（task-07 维护的徽标 + 守护用例）
  - grep -n "opencode_zen_openai" frontend/src/config/llmProviderPresets.ts（命中 1 条预设定义）
  - grep -n "api_format" frontend/src/config/llmProviderPresets.ts（每条预设 1 处 = 全补齐）
constraints:
  - 守护提示是 Wave1→Wave2 过渡降级（D-007@v1 / R-04），文案明示「即将上线」；Wave2 task-12 移除 handleSetDefault 里的 openai 守护分支
  - openai 预设 settings_config_partial 不预填上游 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN（openai 经 LiteLLM 中转，直连上游 base 会与 Wave2 injector 冲突）
  - 不改 llm-provider-form.tsx（task-05 所有）；预设 api_format 经 task-05 applyPreset 消费，本任务只产出 preset.api_format 字段
  - auth_field 列与枚举不变（openai 后端忽略，预设沿用 "ANTHROPIC_AUTH_TOKEN" 占位以满足 TS 类型，不开新枚举）
  - default_model 不臆造：先留 undefined 或 task-07 实测后回填（R-05 不臆造模型名/URL 的延续）
provides:
  - opencode_zen_openai 预设（api_format openai_chat，FR-10）
  - 全预设 api_format 字段补齐（anthropic 显式标注）
  - 列表 openai 徽标 + set-default Wave1 过渡守护（FR-11 / D-007@v1）
expects_from:
  task-04:
    - contract: api_format: "anthropic"|"openai_chat" 类型可被 preset 接口与 list 行消费（LlmProviderRead.api_format）
      needs: [api_format 类型字段]
  task-05:
    - contract: applyPreset 透传 preset.api_format 到表单 apiFormat state（可选，预设驱动表单切格式）
      needs: [applyPreset 消费 preset.api_format]
---

# task-06 实现笔记

覆盖 design §5.2 前端预设/列表 / FR-10 / FR-11 / D-007@v1（Wave1 openai set-default 守护）。

注意区分两条 opencode 预设：已有 opencode_go（base https://opencode.ai/zen/go，anthropic 格式，settings_config 预填 ANTHROPIC_BASE_URL）与新增 opencode_zen_openai（base https://opencode.ai/zen/v1/chat/completions，openai 格式，不预填 ANTHROPIC_BASE_URL）。两者同供应商不同 API 格式端点，不要混。

Wave1 守护提示（handleSetDefault openai 分支）是临时降级：Wave1 后端能存 openai 供应商、能拉模型，但 set-default 会经 anthropic 注入器（api_format 被 Wave2 前的 injector 忽略）→ Claude Code 拿上游 OpenAI URL 当 Anthropic base → 连不上。故前端在 set-default 入口拦住，明示「即将上线」。Wave2 task-12 合入 injector openai 分支后，移除本守护。

allowed_paths 第三条（llm-providers/ 目录）仅用于必要时新增共享徽标/守护子组件；llm-provider-form.tsx 属 task-05，本任务不动。
