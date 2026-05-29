---
author: qinyi
created_at: 2026-05-29T17:42:00
---

# PROJECT — multi-agent-platform (monorepo)

## 项目信息

- **名称**：multi-agent-platform
- **目标**：围绕 SillySpec 文档资产构建多 agent 协作平台
- **形态**：FastAPI 后端 + Next.js 前端 + Docker Compose 部署
- **仓库**：https://github.com/qinyi/multi-agent-platform
- **默认分支**：main
- **开发状态**：未正式上线

## 当前能力

- 可扫描工作区下 `.sillyspec` skeleton
- 可解析 `.sillyspec/projects`、`.sillyspec/docs`、`.sillyspec/changes`、`.sillyspec/.runtime`
- 可管理组件、变更、任务、工作流、agent 执行、工具/Git 审计、发布与事故
- Agent 适配器可调用 Claude Code CLI 执行任务
- Redis pub/sub 支持 Agent 日志实时流式传输
- JWT 认证 + RBAC 权限控制
- 完整的 CRUD API（19 个业务模块）

## 关键产品判断

- 如果平台目标是"管理任何代码项目"，则 SillySpec 应该是平台内置能力和内部工作层，而不是被管理项目的前置格式要求。
- 被管理项目可以没有 `.sillyspec`；平台应能创建、映射、生成或托管对应 SillySpec 工作区。

## 技术栈概览

| 维度 | 技术 |
|------|------|
| 后端 | Python 3.12 + FastAPI + SQLModel + PostgreSQL + Redis |
| 前端 | TypeScript + Next.js 14 + React 18 + Tailwind CSS |
| 部署 | Docker Compose (4 服务) |
| CI/CD | GitHub Actions (backend CI) |
| 规范框架 | SillySpec (文档驱动开发) |
