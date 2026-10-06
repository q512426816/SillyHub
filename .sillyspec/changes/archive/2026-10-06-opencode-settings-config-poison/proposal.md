---
author: flow-machine-draft
created_at: 2026-10-06T04:29:51.468Z
---
# 提案书（Proposal）— 2026-10-06-opencode-settings-config-poison

## 动机

任务原话转写：修复 opencode 会话模型报错根因：供应商行残留旧 settings_config.env（错误 BASE_URL 指向 /v1/chat/completions 全端点 + 无关 sk- key + mimo 模型串），注入器规则 7 最高优先级覆盖平台注入 → Claude Code 打错端点报「selected model 不存在」。清 NULL 后新会话 UI 端到端实测回复成功
成功标准：
- 服务器 OpenCode Go 供应商行 settings_config 已清 NULL（psql 回显核对）
- 平台 UI 真实新会话（OpenCode Go + deepseek-v4.1-flash）发送首句收到模型回复（第 1 轮已完成）
- 坑文档补记 settings_config 覆盖链教训（规则 7 优先级高于平台注入，编辑供应商数据时必须同步检查该字段）
- 无代码改动，无测试面（纯运维数据 + 文档）

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 服务器 OpenCode Go 供应商行 settings_config 已清 NULL（psql 回显核对）
2. 平台 UI 真实新会话（OpenCode Go + deepseek-v4.1-flash）发送首句收到模型回复（第 1 轮已完成）
3. 坑文档补记 settings_config 覆盖链教训（规则 7 优先级高于平台注入，编辑供应商数据时必须同步检查该字段）
4. 无代码改动，无测试面（纯运维数据 + 文档）

## 成功标准（可验证）

1. 服务器 OpenCode Go 供应商行 settings_config 已清 NULL（psql 回显核对）
2. 平台 UI 真实新会话（OpenCode Go + deepseek-v4.1-flash）发送首句收到模型回复（第 1 轮已完成）
3. 坑文档补记 settings_config 覆盖链教训（规则 7 优先级高于平台注入，编辑供应商数据时必须同步检查该字段）
4. 无代码改动，无测试面（纯运维数据 + 文档）
