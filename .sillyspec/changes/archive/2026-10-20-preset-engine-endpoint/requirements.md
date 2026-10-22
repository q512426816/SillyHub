---
author: flow-machine-draft
created_at: 2026-10-20T05:34:08.284Z
---
# 需求规格（Requirements）— 2026-10-20-preset-engine-endpoint

## 功能需求

### FR-01: 智谱 GLM / OpenCode Go 两个预设声明 codex 专用端点覆盖（base_url+默认模型，模型均为实测可用）

- `LlmProviderPreset` 必须支持可选 `codex: { base_url: string; default_model?: string }` 覆盖字段；智谱 GLM 预设必须声明 codex 覆盖 `https://open.bigmodel.cn/api/v1`（默认模型 glm-5.3，智谱官方 codex 文档端点），OpenCode Go 预设必须声明 `https://opencode.ai/inference/go/openai/v1`（默认模型 gpt-6-luna，OpenCode 官方 docs/go Responses 端点+Responses 系模型）——两端口 2026-10-20 均实测 codex 跑通；其余预设不声明覆盖（不臆造，R-05）。

#### 场景：预设常量

- Given 前端预设常量表
- Then zhipu_glm.codex = { base_url: "https://open.bigmodel.cn/api/v1", default_model: "glm-5.3" }；opencode_go.codex = { base_url: "https://opencode.ai/inference/go/openai/v1", default_model: "gpt-6-luna" }；其余预设无 codex 字段

### FR-02: 表单勾选 Codex 时：选中带覆盖的预设 → base_url/默认模型联动切到 codex 端点，并自动取消 Claude 勾选（一条凭证一个端点的平台约束），notice 提示为 Claude 另建一条；取消 Codex → 回 claude 形态

- 勾选 Codex 且当前选中预设带 codex 覆盖时，表单必须联动：base_url 切到 codex 端点、模型行切到 codex 默认模型、settings_config env 块清空（ANTHROPIC_* env 是 claude 注入模板，对 codex 无意义）、自动取消 Claude 勾选并以 notice 说明「已切换到 Codex 专用端点，Claude 需另建一条」；取消 Codex 勾选（回到仅 Claude）时必须恢复预设的 claude 形态（base_url/默认模型/env）。applyPreset 时若当前已勾选引擎仅为 codex（无 claude）且预设带覆盖，必须直接应用 codex 形态。

#### 场景：勾 Codex 联动

- Given 新建表单已点「OpenCode Go」预设（claude 形态 /zen/go）
- When 勾选 Codex
- Then base_url 变为 https://opencode.ai/inference/go/openai/v1、模型行变 gpt-6-luna、env 清空、Claude 勾选自动取消、出现说明 notice

#### 场景：恢复 claude 形态（经对称勾回分支）

- Given codex 形态表单（勾选集合仅剩 Codex——Claude 已被互斥取消）
- When 用户勾回 Claude Code（对称互斥分支：自动取消 Codex 并恢复 claude 端点/模型/env）
- Then base_url 恢复预设 claude 端点、模型行恢复 claude 默认模型、env 恢复预设模板、Codex 勾选自动取消、出现恢复 notice
- 注：直接取消最后一个 Codex 勾选被既有「至少保留一个引擎」守卫拦（不产生空集），故 claude 形态恢复的可达路径是勾回 Claude 的对称分支（本场景）；仅剩 [codex, pi] 时取消 Codex 的恢复分支为规格留白（pi 与 claude 端点语义不同，恢复 claude 形态对 pi 无意义，评审 P3 留白接受）。

### FR-03: 未选中预设或预设无覆盖时勾选行为与现状零回归（自定义/其它预设不受影响）

- selectedPresetKey 为空（自定义）或选中预设无 codex 覆盖时，引擎勾选必须保持现状行为（不切端点、不改勾选、无新增 notice），已有 pi 联动（openai_chat 归一等）不受影响。

#### 场景：自定义零回归

- Given 「＋自定义」空表单（无预设选中）
- When 勾选/取消 Codex
- Then base_url/模型/env 零变化，勾选集合按现状更新

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts「zhipu_glm/opencode_go 声明 codex 覆盖且端点/模型正确；其余预设无覆盖」（新增）
FR-02: frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx「勾选 Codex 联动切换 codex 端点并取消 Claude 勾选；取消 Codex 恢复 claude 形态」（新增）
FR-03: frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx「自定义表单勾选 Codex 零联动（base_url/模型不变）」（新增）
