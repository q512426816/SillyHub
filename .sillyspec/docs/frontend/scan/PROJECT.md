---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Frontend - 项目概述

## 项目名称

multi-agent-platform-web（SillyHub 前端）

## 项目定位

AI 驱动的多 Agent 协作平台的 Web 前端，提供 SillySpec 文档驱动开发的全生命周期可视化管理界面。用户通过该前端管理项目工作区（Workspace）、变更（Change）、任务（Task）、Agent 运行、发布流水线、审批、审计等核心业务。

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 14.2.5 |
| UI 库 | React | 18.3.1 |
| 语言 | TypeScript | 5.5.4 |
| 样式 | Tailwind CSS + shadcn/ui 风格组件 | 3.4.7 |
| 状态管理 | Zustand (persist middleware) | 4.5.x |
| 数据请求 | 原生 fetch（通过 apiFetch 封装） | -- |
| 流程图 | @xyflow/react | 12.10.x |
| Markdown | @uiw/react-markdown-preview | 5.2.x |
| 表单校验 | zod | 3.23.x |
| CSS 工具 | class-variance-authority + tailwind-merge | -- |
| 图标 | lucide-react | 0.400.x |
| 包管理 | pnpm | 9.6.0 |
| Node.js | >= 20 | -- |
| 测试 | Vitest + @testing-library/react + jsdom | 2.x |
| Lint | ESLint + eslint-config-next | 8.57.0 |

## 核心功能模块

1. **认证与会话管理** -- JWT 登录/登出、Token 自动刷新、Session 持久化
2. **Workspace 管理** -- 创建、扫描、重新解析、关系管理、拓扑图可视化
3. **Spec Workspace** -- 规范策略管理、Bootstrap 初始化、同步、冲突解决
4. **变更中心** -- 变更列表/详情、SillySpec 工作流阶段流转、文档完整性矩阵
5. **任务管理** -- Task 看板、任务详情、重新解析
6. **Agent 控制台** -- Agent 运行列表、SSE 实时日志流、Tool Call 追踪、Pending Input 交互
7. **审批中心** -- 待审批列表、批准/驳回、历史记录
8. **发布管理** -- Release 创建、审批、部署、回滚
9. **知识库** -- Knowledge/Quicklog 文档浏览
10. **审计日志** -- 操作日志查询
11. **事件管理** -- Incident 创建、状态流转、Postmortem
12. **Git 身份管理** -- SSH/Token 凭证管理、仓库访问检查
13. **系统设置** -- 平台配置、用户管理
14. **运行时监控** -- 阶段进度、Artifacts 浏览
15. **健康检查** -- 后端 DB/Redis 状态实时监控

## 部署模式

- **开发环境**: `next dev` 启动，通过 `next.config.mjs` 中的 rewrite 将 `/api/*` 代理到后端
- **Docker 部署**: 支持 `standalone` 输出模式（`NEXT_BUILD_STANDALONE=1`），通过 Docker Compose 部署
- **API 代理**: 浏览器请求通过 Next.js rewrite 转发到后端，SSE 连接支持直连后端绕过代理缓冲

## 项目状态

当前处于 V1 骨架阶段，核心功能模块已具备基本的 CRUD 和展示能力，部分页面仍在持续迭代中。

## 关键指标

| 指标 | 数值 |
|------|------|
| TS/TSX 文件 | 58 |
| 页面路由 | 20 |
| 业务组件 | 6 |
| 基础 UI 组件 | 3 |
| Lib API 客户端 | 25 |
| Store | 1 |
| Route Handler | 1 |
| 测试文件 | 3 |
