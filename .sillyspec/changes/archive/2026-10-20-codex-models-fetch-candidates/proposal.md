---
author: flow-machine-draft
created_at: 2026-10-20T04:50:02.475Z
---
# 提案书（Proposal）— 2026-10-20-codex-models-fetch-candidates

## 动机

任务原话转写：动机与背景：平台「获取模型列表」对新建的 codex 直连条目（智谱 GLM Codex base=https://open.bigmodel.cn/api/v1、OpenCode Go Codex base=https://opencode.ai/inference/go/openai/v1）恒报「该供应商不支持拉取模型列表」。实测根因：fetch_models 的 anthropic 分支候选只有 base+/v1/models 与剥 /anthropic|/compatibility|/api 后缀两形态，两家真实 models 路径均不在候选——智谱真实路径 /api/v1/models（base+/models，base 已含版本段）；OpenCode 真实路径 /inference/go/v1/models（需剥 /openai/v1）。两路径均实测 200。

成功标准：
- api_format=anthropic 且 base_url 以版本段结尾（如 /api/v1）的供应商，「获取模型列表」能拉到模型列表（候选含 base+/models）
- base_url 尾部含 /openai/v1 的 OpenCode 范式供应商能拉到（候选含剥 /openai/v1 后拼 /v1/models）
- 既有候选行为零回归（claude 条目 /api/anthropic 等既有命中路径不变）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. api_format=anthropic 且 base_url 以版本段结尾（如 /api/v1）的供应商，「获取模型列表」能拉到模型列表（候选含 base+/models）
2. base_url 尾部含 /openai/v1 的 OpenCode 范式供应商能拉到（候选含剥 /openai/v1 后拼 /v1/models）
3. 既有候选行为零回归（claude 条目 /api/anthropic 等既有命中路径不变）

## 成功标准（可验证）

1. api_format=anthropic 且 base_url 以版本段结尾（如 /api/v1）的供应商，「获取模型列表」能拉到模型列表（候选含 base+/models）
2. base_url 尾部含 /openai/v1 的 OpenCode 范式供应商能拉到（候选含剥 /openai/v1 后拼 /v1/models）
3. 既有候选行为零回归（claude 条目 /api/anthropic 等既有命中路径不变）
