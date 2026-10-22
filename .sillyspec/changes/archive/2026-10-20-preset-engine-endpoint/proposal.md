---
author: flow-machine-draft
created_at: 2026-10-20T05:34:08.284Z
---
# 提案书（Proposal）— 2026-10-20-preset-engine-endpoint

## 动机

任务原话转写：动机与背景：新建供应商点「OpenCode Go」预设自动填 https://opencode.ai/zen/go（Anthropic 端点），用户再勾上 Codex 保存即成坏配置（/zen/go 无 responses 路径，codex 必 404——今日两账号三次实证）。智谱 GLM 预设同病（/api/anthropic 对 codex 错，正确为 /api/v1）。根因：预设是单端点常量，而 codex 与 claude 对同一家供应商需要不同协议端点；表单无引擎-端点联动，用户无从知道。正确端点均已实测：智谱 codex= https://open.bigmodel.cn/api/v1（官方 codex 文档），OpenCode codex= https://opencode.ai/inference/go/openai/v1（官方 docs/go，Responses 系模型 gpt-6-luna 等）。

成功标准：
- 智谱 GLM / OpenCode Go 两个预设声明 codex 专用端点覆盖（base_url+默认模型，模型均为实测可用）
- 表单勾选 Codex 时：选中带覆盖的预设 → base_url/默认模型联动切到 codex 端点，并自动取消 Claude 勾选（一条凭证一个端点的平台约束），notice 提示为 Claude 另建一条；取消 Codex → 回 claude 形态
- 未选中预设或预设无覆盖时勾选行为与现状零回归（自定义/其它预设不受影响）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 智谱 GLM / OpenCode Go 两个预设声明 codex 专用端点覆盖（base_url+默认模型，模型均为实测可用）
2. 表单勾选 Codex 时：选中带覆盖的预设 → base_url/默认模型联动切到 codex 端点，并自动取消 Claude 勾选（一条凭证一个端点的平台约束），notice 提示为 Claude 另建一条；取消 Codex → 回 claude 形态
3. 未选中预设或预设无覆盖时勾选行为与现状零回归（自定义/其它预设不受影响）

## 成功标准（可验证）

1. 智谱 GLM / OpenCode Go 两个预设声明 codex 专用端点覆盖（base_url+默认模型，模型均为实测可用）
2. 表单勾选 Codex 时：选中带覆盖的预设 → base_url/默认模型联动切到 codex 端点，并自动取消 Claude 勾选（一条凭证一个端点的平台约束），notice 提示为 Claude 另建一条；取消 Codex → 回 claude 形态
3. 未选中预设或预设无覆盖时勾选行为与现状零回归（自定义/其它预设不受影响）
