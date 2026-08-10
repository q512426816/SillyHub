---
id: task-07
title: frontend api_format tests + wave1 real acceptance
title_zh: 前端 api_format 单测 + Wave1 真实验收门
author: qinyi
created_at: 2026-08-09 01:31:00
priority: P0
depends_on: [task-05, task-06]
blocks: []
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/components/llm-providers/__tests__/
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx
goal: >
  扩展前端单测覆盖 api_format：表单下拉切换字段显隐 + 预设补字段 + opencode_zen_openai 条目 + 列表徽标 + openai set-default 守护；并执行 Wave1 真实验收（对 opencode.ai 真实「获取模型列表」openai_chat 格式成功，测试 token 仅本次用不入库不入日志），确认 anthropic 供应商零回归。
implementation:
  - 扩展 __tests__/llm-provider-form.test.tsx：加用例——切「API 格式」下拉到 OpenAI Chat → 认证字段/角色映射表/默认兜底模型查询不到（条件隐藏）；切回 Anthropic → 重新出现；提交 values.api_format === "openai_chat"；新建态 fetch-models 请求体含 api_format；套用 opencode_zen_openai 预设后 apiFormat === "openai_chat"
  - 扩展 __tests__/llm-provider-list.test.tsx：加用例——api_format=openai_chat 的供应商行渲染 OpenAI 徽标，anthropic 行无该徽标；点 openai 供应商「启动」→ 触发守护提示且 setDefaultProvider mock 未被调；anthropic 供应商「启动」行为不变（现有用例保持绿）
  - 新建 __tests__/llmProviderPresets.test.ts（纯常量测，无需 render）：断言 LLM_PROVIDER_PRESETS 每条均含 api_format 字段；opencode_zen_openai 存在且 { api_format:"openai_chat", base_url:"https://opencode.ai/zen/v1/chat/completions" }；PRESETS_BY_CATEGORY 含该条目
  - Wave1 真实验收（人工 + 记录证据，不写进自动化测试）：用一次性测试 token，对 opencode.ai 跑新建态 fetch-models（base_url=https://opencode.ai/zen/v1/chat/completions + api_key + api_format=openai_chat），确认返回非空模型列表；把观察到的实际 model id 回填给 task-06 的 opencode_zen_openai.default_model
  - anthropic 零回归：跑全部现有 llm-provider-form / llm-provider-list 单测，确认无字段缺失 mock 报错（api_format 在 mock 固件里给 anthropic 默认值）
acceptance:
  - 表单 api_format 切换字段显隐 + 提交值 + 预设驱动用例全绿
  - 预设补字段 + opencode_zen_openai 条目 + 分类归属用例全绿
  - 列表 openai 徽标 + set-default 守护（mock 未调）+ anthropic 零回归用例全绿
  - Wave1 真实验收：opencode.ai fetch-models（openai_chat 格式）返回非空模型列表（记录 model id，回填 task-06 预设 default_model）
verify:
  - cd frontend && pnpm test src/components/llm-providers（全绿，含新增 + 现有用例）
  - 真实验收记录：opencode.ai 拉模型成功证据（截图/日志摘录，token 部分打码）；token 不出现在任何提交文件 / 日志 / 仓库
constraints:
  - 测试 token 永不硬编码进测试代码、不保存为供应商、不落日志（仅本次人工验收用，验收完即弃；NFR-02 / design §8 安全）
  - 仅改/加 __tests__/ 下测试文件（allowed_paths 限定）；发现 task-05/06 实现 bug 回退给对应任务修，不在本任务改实现代码
  - Wave1 验收门：本任务全绿 + 真实拉模型成功 = Wave1 可独立交付（design §5.2 / §4 双 Wave 可分阶段验收）
  - mock 固件（LlmProviderRead）补 api_format 默认 "anthropic"，避免类型缺失报错（规则 20 顺手补字段惯例）
provides:
  - 前端 api_format 单测覆盖（表单/预设/列表三处，FR-09~11）
  - Wave1 真实验收证据（opencode.ai openai_chat 拉模型成功，FR-01~04 端到端）
  - anthropic 零回归确认（NFR-02）
  - opencode_zen_openai.default_model 实测值回填（给 task-06）
expects_from:
  task-05:
    - contract: 表单 api_format 下拉 + openai 条件字段隐藏 + applyPreset 透传 + handleSubmit/handleFetch 透传 api_format 已实现
      needs: [api_format 下拉, openai 条件隐藏, applyPreset 消费 preset.api_format, 提交/拉模型透传 api_format]
  task-06:
    - contract: 全预设补 api_format + opencode_zen_openai 条目 + 列表 openai 徽标 + handleSetDefault openai 守护已实现
      needs: [全预设 api_format 字段, opencode_zen_openai 预设, openai 徽标, set-default Wave1 守护]
---

# task-07 实现笔记

Wave1 验收门（design §5.2）。本任务是 Wave1 最后一个任务，绿 = Wave1 独立可交付，解锁 Wave2 spike-litellm-routing → task-08。

真实验收的 token 处理铁律：design §1 已注明「用户提供的测试 token，仅本次测试用，不入库」。验收时走新建态 fetch-models（前端表单填 base_url + api_key + api_format=openai_chat，**不点保存**，只点「获取模型列表」），token 只在请求 body 临时出现，不落 DB / 不落日志 / 不进仓库。绝不可为了“自动化”把 token 写进测试固件——opencode.ai token 属敏感凭证。

default_model 回填：opencode.ai/zen/v1/models 实测返回的 model id（design §1 实测返回标准 OpenAI {data:[{id,owned_by}]}），取一个可用 id 填给 opencode_zen_openai.default_model，并同步套用到预设（openai 单模型不做 4 角色映射，N3）。

零回归检查重点：现有 llm-provider-list.test.tsx 与 llm-provider-form.test.tsx 的 mock 固件（INITIAL 等）需补 api_format: "anthropic"，否则 TS 类型缺失 / 行为断言漂移。
