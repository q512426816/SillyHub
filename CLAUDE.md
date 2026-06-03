# SillyHub (multi-agent-platform)

AI 驱动的多 Agent 协作平台，基于 SillySpec 文档驱动开发。

## 技术栈

- **后端**: FastAPI + Python 3.12 + SQLModel + PostgreSQL + Redis
- **前端**: Next.js 14 + React 18 + TypeScript + Tailwind CSS
- **部署**: Docker Compose（配置在 `deploy/`）
- **Agent**: Claude Code CLI + SillySpec CLI

## 项目结构

```
backend/          # FastAPI 后端
  app/modules/    # 业务模块（agent, workspace, change, task 等）
  tests/          # 测试
frontend/         # Next.js 前端
  src/app/        # 页面路由
  src/lib/        # API 客户端和工具函数
  src/components/ # 组件
deploy/           # Docker Compose 部署配置
.sillyspec/       # SillySpec 文档（设计、模块文档、quicklog）
```

## 开发规则

详见 `.claude/CLAUDE.md`。
