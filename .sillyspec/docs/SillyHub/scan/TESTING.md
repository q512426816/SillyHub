---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# TESTING.md — SillyHub 测试策略和工具链

## 测试分层

```
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

## 后端测试

### 测试框架

- **pytest** + pytest-asyncio（异步测试，auto 模式）
- **pytest-cov**（覆盖率报告，阈值 >= 60%）
- **httpx.AsyncClient**（FastAPI TestClient 替代）
- **anyio**（异步测试工具）
- **aiosqlite**（SQLite 内存数据库，可选）

### 测试配置（pyproject.toml）

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
addopts = "-ra"
testpaths = ["tests", "app"]
python_files = ["test_*.py"]
```

- 同时发现顶层集成测试（`tests/`）和模块内单元测试（`app/`）
- 自动异步模式，无需 `@pytest.mark.asyncio` 装饰器

### 测试类型和位置

| 类型 | 位置 | 说明 |
|------|------|------|
| 集成测试 | `tests/` | 全局 conftest.py 提供 async DB + test client fixtures |
| 配置测试 | `tests/test_config.py` | Settings 配置验证 |
| 健康检查测试 | `tests/test_health.py` | /api/health 端点测试 |
| 模块测试 | `tests/modules/` | 各模块独立测试 |
| Agent 测试 | `tests/modules/agent/` | Agent 调度相关 |
| 变更测试 | `tests/modules/change/` | 变更管理 |
| 变更写入测试 | `tests/modules/change_writer/` | 文档生成 |
| 工作区测试 | `tests/modules/workspace/` | 工作区 CRUD |
| 模块内测试 | `app/modules/*/tests/` | 紧贴业务代码的单元测试 |

### conftest.py 全局 Fixtures

`backend/conftest.py` 提供：
- 异步数据库会话（测试 DB）
- httpx.AsyncClient（FastAPI 测试客户端）
- 认证 fixtures（测试用户、JWT token）
- 数据清理

### CI 测试环境

```yaml
DATABASE_URL: postgresql+asyncpg://platform:platform@localhost:5432/platform_test
REDIS_URL: redis://localhost:6379/15
SECRET_KEY: ci-secret-must-be-at-least-16-chars
ENVIRONMENT: test
```

- 使用独立的 `platform_test` 数据库
- Redis 使用 DB 15 隔离
- SECRET_KEY 为 CI 专用固定值
- 超时 15 分钟

### 覆盖率

- 命令：`pytest -q --cov=app --cov-fail-under=60`
- 当前阈值：60%
- CI 门禁：覆盖率低于 60% 流水线失败
- 后续目标提升到 80%

### 后端 Lint 检查链

```bash
uv run ruff check .              # 代码风格 + 导入 + 常见错误
uv run ruff format --check .     # 格式检查
uv run mypy app                  # 类型检查
```

CI 中三个命令串行执行，任一失败则流水线失败。

## 前端测试

### 测试框架

- **vitest** 2.0（单元测试 + 组件测试）
- **@testing-library/react**（组件测试工具）
- **@testing-library/jest-dom**（DOM 断言扩展）
- **jsdom**（浏览器环境模拟）
- **TypeScript 类型检查**（`pnpm typecheck`，strict 模式）

### 测试配置（vitest.config.ts）

```typescript
{
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
}
```

### 测试文件

| 位置 | 内容 |
|------|------|
| `src/test/setup.ts` | vitest 全局设置 |
| `src/lib/__tests__/api.test.ts` | API 客户端工具函数测试 |
| `src/lib/__tests__/agent.test.ts` | Agent API 客户端测试 |
| `src/lib/__tests__/spec-workspaces.test.ts` | SillySpec 工作区 API 测试 |

### CI 检查链

```bash
pnpm install --frozen-lockfile   # 锁定依赖
pnpm lint                         # ESLint 检查
pnpm typecheck                    # TypeScript 严格模式（tsc --noEmit）
pnpm test                         # vitest
pnpm build                        # Next.js 构建（最终兜底）
```

构建（`pnpm build`）是最终兜底，确保编译无错误。

### 前端测试现状

- 当前测试覆盖以 lib 层 API 客户端工具函数为主
- 组件级测试待补充
- E2E 测试（Playwright）在配置中预留（`CLAUDE_PLUGIN_PLAYWRIGHT_ENABLED=true`），但尚未集成到 CI

## CI/CD 流水线

### 触发规则

| 流水线 | 触发路径 | 触发事件 |
|--------|----------|----------|
| backend-ci | `backend/**` + workflow 文件 | push / PR / workflow_dispatch |
| frontend-ci | `frontend/**` + workflow 文件 | push / PR / workflow_dispatch |

- 使用路径过滤避免无关变更触发 CI
- 支持 `workflow_dispatch` 手动触发

### 执行环境

- **Runner**：ubuntu-latest
- **Python**：3.12（通过 uv 安装）
- **Node.js**：20（通过 pnpm）
- **超时**：15 分钟

### 无 E2E CI

当前 CI 不包含端到端测试。全链路验证依赖：

- 手动 E2E：`make up` 启动后浏览器访问 `localhost:3000`
- 健康检查：首页应显示后端健康状态
- Agent E2E：通过前端界面触发变更流程，验证 Claude Code 执行

## 本地开发测试命令

```bash
# 完整测试
make test                          # 后端 pytest + 前端 vitest

# 分项测试
make backend-test                  # pytest -q --cov=app --cov-fail-under=60
make frontend-test                 # pnpm test（vitest run）

# lint 检查
make lint                          # 后端 ruff+mypy + 前端 eslint+typecheck
make backend-lint                  # ruff check + format check + mypy
make frontend-lint                 # pnpm lint
make frontend-typecheck            # pnpm typecheck（tsc --noEmit）

# 格式化
make backend-format                # ruff format + ruff check --fix

# 构建
make frontend-build                # pnpm build
make backend-migrate               # alembic upgrade head
```

## 测试策略改进方向

### 短期目标

- 提升后端覆盖率到 75%
- 补充前端组件测试
- 增加 API 集成测试用例

### 中期目标

- 引入 Playwright E2E（CI 集成）
- 覆盖率阈值 80%
- CI 并行化

### 长期目标

- 全栈 E2E 自动化
- 性能基准测试
- 安全扫描（依赖审计 + SAST）

## 测试数据与环境

- 后端测试使用独立 `platform_test` 数据库，Redis DB 15 隔离
- 测试间通过 pytest fixture 管理 DB 清理
- 前端测试通过 vitest mock 隔离网络请求
- conftest.py 提供完整的基础设施 fixtures

## Spike 验证

V0 通过 3 个 spike 验证关键技术风险（3/3 PASS，详见 `spikes/REPORT.md`）：

1. **01-git-isolation**：单机多用户 Git 凭据 / 环境隔离
2. **02-workspace-scan**：SillySpec Native Layout 实际可解析、性能可接受
3. **03-claude-code**：Claude Code 子进程可受控、工具调用可拦截
