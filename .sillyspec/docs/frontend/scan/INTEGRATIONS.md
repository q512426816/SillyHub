---
author: qinyi
created_at: 2026-05-29T17:40:00
---

# INTEGRATIONS — frontend

## 后端 API

| 集成 | 用途 |
|------|------|
| `src/lib/api.ts` (`apiFetch<T>`) | 统一 API 客户端：自动 Bearer token、401 refresh 重试、ApiError |
| Backend REST API (`/api` 前缀) | 18+ 个业务域端点 |
| SSE (Agent 日志流) | `streamAgentRunLogs()` 实时接收 Agent 运行日志 |

### 环境变量

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | 后端 API 地址 |
| `NEXT_PUBLIC_COMMIT_SHA` | — | 前端版本标识 |

## 第三方库

| 库 | 版本 | 用途 | 状态 |
|------|------|------|------|
| zustand | ^4.5.0 | Session 状态管理 (persist) | 已使用 |
| @xyflow/react | ^12.10.2 | 组件拓扑图可视化 | 已使用 |
| zod | ^3.23.0 | 运行时验证 | 已安装，少量使用 |
| lucide-react | ^0.400.0 | 图标库 | 已安装，少量使用 |
| @tanstack/react-query | ^5.51.0 | 数据获取 | 已安装，**未使用** |
| class-variance-authority | ^0.7.0 | 组件变体样式 | 已使用（UI 组件） |
| clsx + tailwind-merge | ^2.1.1 / ^2.4.0 | CSS 类合并 | 已使用（`cn()` 工具） |
| tailwindcss-animate | ^1.0.7 | Tailwind 动画插件 | 已配置 |

## UI 体系

| 集成 | 用途 |
|------|------|
| Tailwind CSS 3.4.7 | Utility-first CSS 框架 |
| shadcn/ui 风格 | CSS 变量 + HSL 语义 token（`bg-card`, `text-muted-foreground`） |
| `components/ui/` | 基础组件（Badge, Button, Input） |

## 认证

| 集成 | 用途 |
|------|------|
| Zustand session store | 存储 user, accessToken, refreshToken |
| `apiFetch` 自动 refresh | 401 时自动 refresh token → 重试 |
| 客户端 auth guard | Dashboard layout 检查 `accessToken`，缺失重定向 `/login` |
