---
author: qinyi
created_at: 2026-05-29T17:40:00
---

# STRUCTURE — backend

## 目录树

```text
backend/
├── app/
│   ├── main.py                 应用工厂 create_app() + lifespan
│   ├── conftest.py             测试 fixture
│   ├── core/                   横切关注点
│   │   ├── config.py           pydantic-settings 配置
│   │   ├── db.py               AsyncSession 引擎 + session factory
│   │   ├── auth_deps.py        认证/授权依赖注入
│   │   ├── security.py         JWT + 密码工具
│   │   ├── crypto.py           加密工具
│   │   ├── errors.py           AppError 异常层次 + 全局处理器
│   │   ├── logging.py          structlog 配置
│   │   ├── redis.py            Redis 异步单例
│   │   └── telemetry.py        OTEL stub
│   ├── models/
│   │   └── base.py             BaseModel(SQLModel) 基类
│   └── modules/                19 个业务模块
│       ├── agent/              Agent 运行（claude_code 适配器 + pub/sub）
│       │   ├── adapters/claude_code.py
│       │   ├── context_builder.py
│       │   ├── models.py
│       │   ├── router.py
│       │   └── service.py
│       ├── archive/
│       ├── auth/               JWT 认证 + RBAC
│       │   ├── rbac.py
│       │   ├── models.py
│       │   ├── router.py
│       │   └── service.py
│       ├── change/             变更管理
│       ├── change_writer/      变更文档写入
│       ├── git_gateway/        Git 操作网关
│       ├── git_identity/       Git 身份管理
│       │   ├── providers/base.py, github.py
│       │   ├── models.py
│       │   ├── router.py
│       │   └── service.py
│       ├── health/             健康检查
│       ├── incident/           事件追踪
│       ├── knowledge/          知识库
│       ├── release/            发布管理
│       ├── runtime/            运行时状态
│       ├── scan_docs/          扫描文档
│       ├── settings/           平台设置
│       ├── spec_profile/       Spec profile
│       ├── spec_workspace/     Spec workspace
│       ├── task/               任务管理
│       ├── tool_gateway/       工具操作网关
│       ├── workflow/           工作流/审批
│       ├── workspace/          工作区 CRUD
│       └── worktree/           Git worktree + 租约
├── migrations/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/               22 个迁移文件（20260525-20260613）
├── tests/
├── conftest.py
├── pyproject.toml
├── Dockerfile
├── alembic.ini
└── ruff.toml
```

## 模块说明

每个业务模块遵循 `model.py` + `schema.py` + `service.py` + `router.py` 的 feature-slice 结构，部分模块包含额外子目录（如 `agent/adapters/`、`git_identity/providers/`）。
