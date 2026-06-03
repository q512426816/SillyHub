---
author: qinyi
created_at: 2026-06-03T10:00:00
---

# STRUCTURE — backend

## 目录树

```
backend/
├── app/
│   ├── core/           # 基础设施：配置、数据库、Redis、错误、审计
│   ├── models/         # 共享模型
│   ├── modules/        # 业务模块（21个）
│   │   ├── agent/      # Agent 执行管理（21 files）
│   │   ├── workspace/  # 工作区管理（21 files）
│   │   ├── tool_gateway/  # 工具网关（12 files）
│   │   ├── change/     # 变更管理（12 files）
│   │   ├── workflow/   # 审批与审计（12 files）
│   │   ├── change_writer/ # Agent 代码写入（8 files）
│   │   ├── git_gateway/   # Git 操作（9 files）
│   │   ├── scan_docs/  # 文档扫描（10 files）
│   │   ├── spec_workspace/ # Spec 工作区（10 files）
│   │   ├── worktree/   # Worktree 隔离（10 files）
│   │   └── ...（其余 11 个模块）
│   └── main.py         # FastAPI 应用入口
├── tests/              # 集成测试
│   ├── test_config.py
│   ├── test_health.py
│   └── modules/
├── pyproject.toml      # 项目配置（依赖 + ruff + mypy + pytest）
└── Dockerfile          # 容器构建（含 Claude Code CLI + SillySpec CLI）
```

## 目录说明

| 目录 | 职责 |
|------|------|
| `app/core/` | 基础设施层：配置管理、数据库会话、Redis 客户端、错误定义、审计钩子、加密 |
| `app/modules/` | 业务模块层：每个模块独立目录，含 router/service/model/tests |
| `app/models/` | 共享模型定义 |
| `app/main.py` | FastAPI 应用入口，注册路由和生命周期事件 |
| `tests/` | 顶层集成测试和按模块组织的测试 |

## 模块列表

| 模块 | 文件数 | 测试文件数 | 职责 |
|------|--------|-----------|------|
| agent | 21 | 9 | AgentRun 生命周期、Claude Code CLI 适配、SSE 流 |
| workspace | 21 | 11 | 工作区 CRUD、路径映射、关联管理 |
| tool_gateway | 12 | 4 | 工具调用策略、权限控制、审计日志 |
| change | 12 | 5 | 变更主实体、文档管理、状态流转 |
| workflow | 12 | 5 | 审批流程、审核记录、审计日志 |
| change_writer | 8 | 3 | Agent 驱动的代码写入 |
| git_gateway | 9 | 4 | Git 操作（clone/pull/commit/push） |
| git_identity | 11 | 3 | Git 凭据管理、GitHub OAuth |
| scan_docs | 10 | 4 | 文档树扫描、文件内容读取 |
| spec_workspace | 10 | 3 | SillySpec 工作区初始化和 bootstrap |
| worktree | 10 | 3 | Git worktree 隔离管理 |
| task | 9 | 3 | 任务 CRUD、状态追踪 |
| incident | 8 | 3 | 事件和复盘管理 |
| knowledge | 8 | 3 | 知识库管理 |
| release | 8 | 3 | 发布和审批管理 |
| spec_profile | 7 | 2 | Spec 档案和冲突检测 |
| auth | 7 | 0 | JWT 认证、RBAC 权限 |
| runtime | 6 | 2 | 运行时状态管理 |
| archive | 5 | 2 | 变更归档 |
| settings | 4 | 0 | 平台设置 |
| health | 3 | 0 | 健康检查端点 |

**总计**: 219 个 Python 源文件，22 个 API Router，32 个数据表
