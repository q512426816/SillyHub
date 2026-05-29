---
author: qinyi
created_at: 2026-05-27 09:44:37
---

# PROJECT

## 项目信息

- 名称：multi-agent-platform。
- 目标：围绕 SillySpec 文档资产构建多 agent 协作平台。
- 形态：FastAPI 后端 + Next.js 前端 + Docker compose 部署。

## 当前能力边界

- 可扫描工作区下 `.sillyspec` skeleton。
- 可解析 `.sillyspec/projects`、`.sillyspec/docs`、`.sillyspec/changes`、`.sillyspec/.runtime`。
- 可管理组件、变更、任务、工作流、agent 执行、工具/Git 审计、发布与事故。

## 关键产品判断

- 如果平台目标是“管理任何代码项目”，则 SillySpec 应该是平台内置能力和内部工作层，而不是被管理项目的前置格式要求。
- 被管理项目可以没有 `.sillyspec`；平台应能创建、映射、生成或托管对应 SillySpec 工作区。
- 只有当用户明确选择“把 sillyspec 写回目标仓库”时，才应要求或生成目标项目内的 `.sillyspec` 目录。
