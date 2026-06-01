---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# 测试策略

> 最后更新：2026-05-31
> 范围：SillyHub monorepo 测试体系总览

## 1. 测试分层

```text
┌─────────────────────────────────┐
│         E2E 测试（手动）         │  前端 → 后端全链路
├─────────────────────────────────┤
│       集成测试 (pytest)         │  API 端到端 + DB
├─────────────────────────────────┤
│       单元测试 (pytest/vitest)  │  纯逻辑 + mock
├─────────────────────────────────┤
│     静态分析 (ruff/mypy/eslint) │  类型 + 风格
└─────────────────────────────────┘
```

## 2. 后端测试

### 2.1 测试框架

- **pytest** + pytest-asyncio（异步测试支持）
- **pytest-cov**（覆盖率报告，阈值 ≥ 60%）
- **httpx.AsyncClient**（FastAPI TestClient 替代）

### 2.2 测试类型

| 类型 | 位置 | 说明 |
|------|------|------|
| 单元测试 | `app/modules/*/tests/` | 紧贴业务代码，mock DB 和外部依赖 |
| 集成测试 | `tests/` | API 端到端，真实 DB 连接 |
| FSM 测试 | `app/modules/workflow/tests/test_fsm.py` | 工作流状态机转换验证 |
| 模型测试 | 各模块 `tests/test_model.py` | SQLModel 数据完整性 |

### 2.3 CI 环境

```yaml
# backend-ci.yml 关键配置
DATABASE_URL: postgresql+asyncpg://platform:platform@localhost:5432/platform_test
REDIS_URL: redis://localhost:6379/15
SECRET_KEY: ci-secret-must-be-at-least-16-chars
ENVIRONMENT: test
```

- 使用独立的 `platform_test` 数据库和 Redis DB 15
- SECRET_KEY 为 CI 专用固定值
- 超时 15 分钟

### 2.4 覆盖率

- `--cov=app --cov-fail-under=60`
- 当前阈值 60%，后续目标提升到 80%
- 覆盖率报告可在 CI 日志中查看

### 2.5 后端 lint 检查链

```bash
uv run ruff check .              # 代码风格 + 导入 + 常见错误
uv run ruff format --check .     # 格式检查
uv run mypy app                  # 类型检查
```

CI 中三个命令串行执行，任一失败则流水线失败。

## 3. 前端测试

### 3.1 测试框架

- **vitest**（单元测试 + 组件测试）
- **TypeScript 类型检查**（`pnpm typecheck`）

### 3.2 CI 检查链

```yaml
steps:
  - pnpm install --frozen-lockfile   # 锁定依赖
  - pnpm lint                         # ESLint 检查
  - pnpm typecheck                    # TypeScript 严格模式
  - pnpm test                         # vitest
  - pnpm build                        # Next.js 构建
```

构建（`pnpm build`）是最终兜底，确保编译无错误。

### 3.3 前端测试现状

- 当前测试覆盖以 lib 层工具函数为主（如 `api.test.ts`）
- 组件级测试待补充
- E2E 测试（Playwright）在 `CLAUDE_PLUGIN_PLAYWRIGHT_ENABLED=true` 配置中预留，但尚未集成

## 4. CI/CD 流水线

### 4.1 触发规则

| 流水线 | 触发路径 |
|--------|----------|
| backend-ci | `backend/**`、`.github/workflows/backend-ci.yml` |
| frontend-ci | `frontend/**`、`.github/workflows/frontend-ci.yml` |

- push 和 PR 均触发
- 支持 `workflow_dispatch` 手动触发
- 使用路径过滤避免无关变更触发 CI

### 4.2 执行环境

- **Runner**：ubuntu-latest
- **Python**：3.12（通过 uv 安装）
- **Node.js**：20（通过 pnpm）
- **超时**：15 分钟

### 4.3 无 E2E CI

当前 CI 不包含端到端测试。全链路验证依赖：

- 手动 E2E：`make up` 启动后浏览器访问 `localhost:3000`
- 健康检查：首页应显示"后端健康: ok"徽章
- Agent E2E：通过前端界面触发变更流程，验证 Claude Code 执行

## 5. 本地开发测试命令

```bash
# 完整测试
make test                          # 后端 pytest + 前端 vitest

# 分项测试
make backend-test                  # pytest -q --cov=app --cov-fail-under=60
make frontend-test                 # pnpm test

# lint 检查
make lint                          # 后端 ruff+mypy + 前端 eslint+typecheck
make backend-lint                  # ruff check + format check + mypy
make frontend-lint                 # pnpm lint
make frontend-typecheck            # pnpm typecheck

# 构建
make frontend-build                # pnpm build
make backend-migrate               # alembic upgrade head
```

## 6. 测试策略改进方向

### 6.1 短期目标

- 提升后端覆盖率到 75%，补充前端组件测试
- 增加 API 集成测试用例

### 6.2 中期目标

- 引入 Playwright E2E（CI 集成）
- 覆盖率阈值 80%，CI 并行化

### 6.3 长期目标

- 全栈 E2E、性能基准、安全扫描（依赖审计 + SAST）

## 7. 测试数据与环境

- 后端测试使用独立 `platform_test` 数据库，Redis DB 15 隔离
- 测试间通过 pytest fixture 管理 DB 清理
- 前端测试通过 vitest mock 隔离网络请求

## 8. Spike 验证

V0 通过 3 个 spike 验证关键技术风险（3/3 PASS，详见 `spikes/REPORT.md`）：

1. **01-git-isolation**：多用户 Git 凭据隔离
2. **02-workspace-scan**：SillySpec 目录解析（PyO3）
3. **03-claude-code**：Claude Code 子进程可控性
