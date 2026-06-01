---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# SillyHub Backend — 测试策略

## 1. 测试框架

### 1.1 核心工具

| 工具 | 版本 | 用途 |
|------|------|------|
| pytest | >=8 | 测试运行器 |
| pytest-asyncio | >=0.23 | 异步测试支持 |
| pytest-cov | >=5 | 覆盖率统计 |
| httpx | >=0.27 | ASGI 测试客户端 |
| aiosqlite | >=0.20 | 内存 SQLite（测试用） |

### 1.2 配置

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"          # 自动识别 async test
addopts = "-ra"                # 显示所有测试结果
testpaths = ["tests", "app"]   # 双路径发现
python_files = ["test_*.py"]
```

- `asyncio_mode = "auto"`：所有 `async def test_*` 自动运行
- 双路径发现：顶层 `tests/` + 模块内 `tests/`

## 2. 测试基础设施

### 2.1 全局 Fixtures (conftest.py)

根级 `conftest.py` 提供核心测试基础设施：

```python
# 环境变量预设（必须在 app import 前设置）
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://...")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("SECRET_KEY", "test-secret-key")

# Settings 缓存清理
@pytest.fixture(autouse=True)
def _reset_settings_cache(): ...

# 内存 SQLite engine
@pytest.fixture()
async def db_engine(): ...

# 可用于事务的 session
@pytest.fixture()
async def db_session(db_engine): ...

# 完整 HTTP 客户端（ASGI transport）
@pytest.fixture()
async def client(db_session): ...

# 认证用户 + token
@pytest.fixture()
async def auth_headers(client): ...

# 测试 workspace
@pytest.fixture()
async def workspace(db_session): ...
```

### 2.2 数据库隔离策略

- **不依赖外部 Postgres**：使用内存 SQLite engine
- **每测试新建 engine**：确保完全隔离
- **模型显式导入**：`conftest.py` 中 import 所有模块 model 以注册 metadata
- **事务回滚**：每个 test 用独立 session，异常自动 rollback

### 2.3 模型注册清单

conftest.py 中显式导入的模块 model：

```python
app.modules.auth.model
app.modules.change.model
app.modules.git_identity.model
app.modules.scan_docs.model
app.modules.task.model
app.modules.worktree.model
app.modules.workspace.model
app.modules.workflow.model
app.modules.agent.model
app.modules.tool_gateway.tool_policy
app.modules.spec_workspace.model
```

## 3. 测试目录结构

### 3.1 模块内测试（主要）

```
app/modules/<name>/tests/
├── __init__.py
├── test_router.py          # HTTP 层测试
├── test_service.py         # Service 层测试
└── test_*.py               # 特定功能测试
```

### 3.2 顶层集成测试

```
tests/
├── __init__.py
├── test_config.py
├── test_health.py
└── modules/
    ├── agent/              # Agent 集成测试
    └── change/             # Change 集成测试
```

## 4. 测试统计

- **测试文件总数**：97 个
- **有独立 tests/ 的模块**：大部分模块
- **测试最多的模块**：
  - workspace：12 个测试文件（test_parser, test_model, test_service, test_scanner, test_router, test_relation_service, test_relation_router, test_topology, test_m2n_task, test_m2n_change 等）
  - agent：8 个测试文件（test_router, test_base, test_kill, test_diff_collector, test_context_builder, test_adapter_isolation, test_m2n_agent_run）
  - change：3 个测试文件（test_parser, test_dispatch, test_router）
  - workflow：4 个测试文件（test_router, test_fsm, test_audit_hooks, test_spec_guardian）
  - worktree：2 个测试文件（test_router, test_exec_env）
  - tool_gateway：3 个测试文件（test_router, test_service, test_policy）

## 5. 测试约定

### 5.1 命名规范

```python
async def test_create_workspace_success(db_session, client): ...
async def test_create_workspace_duplicate_slug(db_session, client): ...
async def test_get_workspace_not_found(db_session, client): ...
```

- `test_<操作>_<场景>` 命名模式
- 参数注入使用 fixture

### 5.2 HTTP 测试模式

```python
async def test_endpoint(client, auth_headers):
    resp = await client.post("/api/resource", json={...}, headers=auth_headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["code"] == "..."
```

### 5.3 Service 测试模式

```python
async def test_service_method(db_session):
    service = SomeService(db_session)
    result = await service.method(...)
    assert result is not None
```

### 5.4 Mock 策略

- **Git 操作**：通过 `GitRunner` 抽象层 mock
- **子进程**：通过 `ClaudeCodeAdapter` 的 CLI 调用抽象
- **文件系统**：部分测试使用临时目录
- **Redis**：测试环境通常跳过或 mock

## 6. 覆盖率

### 6.1 运行覆盖率

```bash
pytest --cov=app --cov-report=term-missing
```

### 6.2 覆盖率目标

- **核心模块**：auth, workspace, change, agent, workflow — 高优先级
- **安全相关**：security, crypto, auth_deps — 高优先级
- **辅助模块**：health, settings, runtime — 低优先级

## 7. 运行命令

### 7.1 全量测试

```bash
cd backend
uv run pytest
```

### 7.2 带覆盖率

```bash
uv run pytest --cov=app --cov-report=term-missing
```

### 7.3 单模块测试

```bash
uv run pytest app/modules/agent/tests/
uv run pytest app/modules/workspace/tests/
```

### 7.4 指定测试文件

```bash
uv run pytest app/modules/workflow/tests/test_fsm.py
```

### 7.5 显示输出

```bash
uv run pytest -s              # 显示 print/stdout
uv run pytest -v              # 详细模式
uv run pytest -ra             # 显示所有结果
```

### 7.6 仅失败

```bash
uv run pytest --lf            # 上次失败的测试
uv run pytest -x              # 首次失败即停止
```

## 8. Lint 与类型检查

```bash
# Lint
uv run ruff check app/

# 格式化
uv run ruff format app/

# 类型检查
uv run mypy app/
```

mypy 配置：`strict=false`, `warn_unused_ignores=true`, `ignore_missing_imports=true`

## 9. 测试注意事项

1. **Settings 缓存**：每个测试自动清理 `_reset_settings_cache`，确保环境变量覆盖生效
2. **SQLite 限制**：部分 PostgreSQL 特有功能（如 partial unique index）在测试中可能需要跳过
3. **异步上下文**：所有 DB 操作必须 await，注意 session 生命周期
4. **模型导入**：新增模块 model 时需要在 conftest.py 中添加 import
5. **Git 依赖**：GitRunner 相关测试可能需要系统安装 git
6. **Claude CLI**：Agent adapter 测试 mock 了 CLI 调用，无需安装 claude
