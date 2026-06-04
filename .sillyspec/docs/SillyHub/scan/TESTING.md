# SillyHub 测试文档

author: scan-agent
created_at: 2026-06-03T12:00:04

## 1. 后端测试

### 1.1 框架与工具

- **测试框架**：pytest 8+
- **异步支持**：pytest-asyncio（asyncio_mode=auto）
- **覆盖率**：pytest-cov（要求 >= 60%）
- **HTTP 测试**：httpx.AsyncClient + ASGITransport（模拟 FastAPI 请求）
- **内存数据库**：aiosqlite（替代 PostgreSQL，无外部依赖）
- **Mock**：标准 unittest.mock / pytest monkeypatch

### 1.2 测试配置

```ini
# pyproject.toml [tool.pytest.ini_options]
asyncio_mode = "auto"
addopts = "-ra"
testpaths = ["tests", "app"]      # 搜索顶层 tests/ 和各模块内 tests/
python_files = ["test_*.py"]
```

### 1.3 全局 Fixtures（conftest.py）

`backend/conftest.py` 提供以下核心 fixtures：

- **`_reset_settings_cache`**（autouse）：每个测试前后清除 Settings 缓存
- **`db_engine`**：创建内存 SQLite 引擎 + 自动建表（注册所有模块 model）
- **`db_session`**：提供 AsyncSession（绑定到测试引擎）
- **`client`**：httpx.AsyncClient 绑定到 FastAPI app + 测试 DB
- **`auth_admin_token`**：创建管理员用户并返回 access token
- **`auth_headers`**：`{"Authorization": "Bearer ..."}` 字典

### 1.4 测试隔离策略

- **不依赖外部服务**：所有测试使用内存 SQLite，无需 Postgres/Redis
- **环境变量预设**：`conftest.py` 在 import app 前注入安全默认值
- **Settings 缓存清理**：autouse fixture 确保每个测试获取干净的 Settings
- **DB session 隔离**：每个测试函数获得独立的 AsyncSession
- **App 依赖覆盖**：client fixture 通过 `dependency_overrides` 替换 `get_session`

### 1.5 测试组织

测试文件放置在各模块的 `tests/` 子目录中：

```
backend/app/modules/
├── agent/tests/         # 7 个测试文件
│   ├── test_adapter_isolation.py
│   ├── test_base.py
│   ├── test_context_builder.py
│   ├── test_diff_collector.py
│   ├── test_kill.py
│   ├── test_m2n_agent_run.py
│   └── test_router.py
├── workspace/tests/     # 9 个测试文件
│   ├── test_model.py
│   ├── test_parser.py
│   ├── test_router.py
│   ├── test_service.py
│   ├── test_scanner.py
│   ├── test_relation_router.py
│   ├── test_relation_service.py
│   ├── test_m2n_change.py
│   ├── test_m2n_task.py
│   └── test_topology.py
├── change/tests/        # 4 个测试文件
│   ├── test_dispatch.py
│   ├── test_parser.py
│   ├── test_router.py
│   └── test_transition_response.py
├── workflow/tests/       # 4 个测试文件
│   ├── test_fsm.py
│   ├── test_router.py
│   ├── test_audit_hooks.py
│   └── test_spec_guardian.py
├── worktree/tests/       # 2 个测试文件
├── auth/tests/           # 无测试文件（认证通过集成测试覆盖）
├── git_gateway/tests/    # 3 个测试文件
├── git_identity/tests/   # 2 个测试文件
├── scan_docs/tests/      # 3 个测试文件
├── spec_workspace/tests/ # 2 个测试文件
├── spec_profile/tests/   # 1 个测试文件
├── tool_gateway/tests/   # 3 个测试文件
├── task/tests/          # 2 个测试文件
├── incident/tests/       # 2 个测试文件
├── release/tests/        # 2 个测试文件
├── change_writer/tests/ # 2 个测试文件
├── archive/tests/        # 1 个测试文件
├── runtime/tests/       # 1 个测试文件
└── knowledge/tests/      # 2 个测试文件
```

### 1.6 运行命令

```bash
make backend-test    # pytest -q --cov=app --cov-fail-under=60
cd backend && uv run pytest -q          # 快速运行
cd backend && uv run pytest -v          # 详细输出
cd backend && uv run pytest -v -k "test_router"  # 过滤运行
```

## 2. 前端测试

### 2.1 框架与工具

- **测试框架**：Vitest 2.0
- **DOM 模拟**：jsdom
- **React 测试**：@testing-library/react + @testing-library/jest-dom
- **React 插件**：@vitejs/plugin-react

### 2.2 测试配置

Vitest 全局 setup 位于 `src/test/setup.ts`，引入 jest-dom 匹配器。

### 2.3 测试文件

```
frontend/src/lib/__tests__/
├── api.test.ts              # apiFetch 核心封装测试（5 个用例）
│   ├── 200 响应 JSON 解析
│   ├── 4xx 结构化错误
│   ├── 网络错误包装
│   └── x-request-id 请求头
├── agent.test.ts            # Agent API 测试
└── spec-workspaces.test.ts  # Spec 工作区 API 测试
```

### 2.4 运行命令

```bash
make frontend-test    # pnpm test (= vitest run)
pnpm test:watch       # vitest（watch 模式）
```

## 3. 测试策略总结

### 3.1 后端策略

- **层级**：HTTP 级集成测试为主（通过 client fixture 发送真实 HTTP 请求）
- **隔离**：每个测试使用独立内存数据库 + 独立 session
- **认证**：auth_admin_token fixture 提供预认证 token，auth_headers fixture 提供请求头
- **覆盖目标**：>= 60%（pytest-cov --cov-fail-under=60）
- **测试发现**：同时搜索顶层 `tests/` 和模块内 `tests/`

### 3.2 前端策略

- **层级**：API 客户端单元测试（mock fetch）
- **范围**：主要测试 `apiFetch` 核心封装、错误处理、token 注入
- **覆盖范围**：当前覆盖核心 API 层，页面组件暂无测试

### 3.3 测试命令汇总

```bash
make test        # 后端 + 前端全部测试
make backend-test
make frontend-test
```
