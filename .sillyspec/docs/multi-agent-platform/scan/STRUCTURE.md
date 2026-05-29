---
author: qinyi
created_at: 2026-05-29T17:40:00
---

# STRUCTURE — multi-agent-platform (monorepo)

## 目录树

```text
.
├── backend/                    FastAPI API 服务器
│   ├── app/
│   │   ├── main.py             应用工厂 create_app()
│   │   ├── core/               横切关注点（config, db, auth, redis, errors, logging, telemetry）
│   │   ├── models/             共享基类（BaseModel）
│   │   └── modules/            19 个业务模块
│   ├── migrations/             Alembic 迁移（22 个版本）
│   ├── tests/                  集成测试
│   ├── Dockerfile              Python 3.12 多阶段构建
│   └── pyproject.toml
├── frontend/                   Next.js Web 应用
│   ├── src/
│   │   ├── app/                App Router 页面（22 个路由）
│   │   ├── components/         共享组件（5 业务 + 3 UI 基础）
│   │   ├── lib/                API 层 + 类型（21 个模块）
│   │   ├── stores/             Zustand store（session）
│   │   └── test/               测试配置
│   ├── Dockerfile              Node 20 多阶段构建
│   └── package.json
├── deploy/                     部署配置
│   ├── docker-compose.yml      全栈部署（pg + redis + backend + frontend）
│   ├── docker-compose.dev.yml  开发模式（仅 pg + redis）
│   └── .env.example
├── prototype/                  12 个 HTML 原型 + common.css
├── docs/                       设计文档 + 参考资料
├── spikes/                     3 个技术验证
│   ├── 01-git-isolation/
│   ├── 02-workspace-scan/
│   └── 03-claude-code/
├── .github/workflows/          GitHub Actions CI
├── .sillyspec/                 SillySpec 规范驱动框架
│   ├── .runtime/               运行时状态
│   ├── changes/                8 个活跃变更
│   ├── docs/                   扫描文档（3 个子项目）
│   ├── knowledge/              知识库
│   ├── projects/               子项目配置（3 个）
│   ├── quicklog/               快速日志
│   └── shared/                 共享规范
└── Makefile                    统一命令入口（20 个 target）
```

## 模块说明

### Backend 模块（19 个）

| 模块 | 说明 |
|------|------|
| `workspace` | 工作区 CRUD、扫描状态、软删除/复活 |
| `change` / `change_writer` | 变更管理、文档生成 |
| `scan_docs` | 扫描文档索引与解析 |
| `task` | 任务看板管理 |
| `agent` | Agent 运行管理（claude_code 适配器 + Redis pub/sub） |
| `worktree` | Git worktree CRUD + 租约管理 |
| `git_gateway` | Git 操作网关 + 审计日志 |
| `git_identity` | Git 身份管理 + GitHub PAT 验证 |
| `tool_gateway` | 工具操作网关 + 审计日志 |
| `auth` | 认证（JWT）+ RBAC |
| `health` | 健康检查（pg + redis） |
| `release` | 发布管理 + 审批 |
| `incident` | 事件追踪 + 复盘 |
| `workflow` | 工作流/审批流程 |
| `settings` | 平台设置 |
| `knowledge` | 知识库 |
| `runtime` | 运行时状态读取 |
| `archive` | 归档操作 |
| `spec_profile` / `spec_workspace` | Spec 管理 |

### Frontend 模块

- `src/lib/` (21 个): API client 层，每个模块对应一个后端业务域
- `src/components/` (8 个): 5 个业务组件 + 3 个 UI 基础组件
- `src/stores/` (1 个): Zustand session store
