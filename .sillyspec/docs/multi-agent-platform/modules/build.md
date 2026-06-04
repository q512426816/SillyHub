---
schema_version: 1
doc_type: module-card
module_id: build
author: qinyi
created_at: 2026-06-04T10:30:00+08:00
---

# build

## 定位
项目根级别的构建配置和通用配置文件。负责提供跨平台统一的开发命令入口、代码风格规范和版本控制忽略规则。不负责各子项目的具体构建配置（如 backend/pyproject.toml、frontend/package.json）。

## 契约摘要

### Makefile
- **dev 命令组**: `dev-up`, `dev-down`, `dev-logs`, `dev-reset` — 管理 Docker Compose 开发依赖（PostgreSQL + Redis）
- **backend 命令组**: `backend-install`, `backend-run`, `backend-test`, `backend-lint`, `backend-format`, `backend-migrate`
- **frontend 命令组**: `frontend-install`, `frontend-run`, `frontend-test`, `frontend-lint`, `frontend-typecheck`, `frontend-build`
- **联合命令**: `test`（前后端测试）, `lint`（前后端检查）
- **部署命令**: `up`, `down`, `logs` — 调用 `deploy/docker-compose.yml`

### .editorconfig
- 全局默认：UTF-8、LF 换行、尾随空格修剪、2 空格缩进
- Python 特例：4 空格缩进
- Makefile 特例：Tab 缩进
- Markdown 特例：不修剪尾随空格（允许硬换行）

### .gitignore
- **IDE/OS**: .idea/, .vscode/, .DS_Store, Thumbs.db
- **构建产物**: target/, build/, out/, .next/, .turbo/
- **Python**: __pycache__/, .venv/, .pytest_cache/, .mypy_cache/, .ruff_cache/, .coverage, htmlcov/
- **Node**: node_modules/, npm-debug.log*, pnpm-debug.log*
- **环境变量**: .env, .env.*（保留 .env.example）
- **SillySpec**: .sillyspec/.runtime/, .sillyspec/codebase/SCAN-RAW.md, .sillyspec/local.yaml
- **本地临时**: .loop-progress.md, prototype/, .playwright-mcp/

## 关键逻辑
```
Makefile 所有命令 cd backend/frontend 调用对应工具链
  - backend: uv run uvicorn/pytest/ruff/alembic
  - frontend: pnpm install/dev/test/lint/build
Docker 命令通过固定 compose 文件参数隔离：
  - dev 环境: deploy/docker-compose.dev.yml
  - 生产部署: deploy/docker-compose.yml
.editorconfig 由 IDE 自动加载，无需手动干预
```

## 注意事项
- Makefile 依赖 `uv`、`pnpm`、`docker compose` 命令，Windows 用户需通过 Git Bash 运行
- backend-migrate 实际调用 alembic upgrade head，不是完整迁移生成
- dev-reset 会删除 Docker volume（数据破坏性操作）
- .gitignore 排除 .sillyspec/.runtime/ 运行时状态，不排除 .sillyspec/changes/ 设计文档
- 修改 Makefile 命令需同步更新 help 文本

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
