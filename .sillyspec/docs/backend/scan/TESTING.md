---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Backend -- 测试策略

## 测试框架

| 工具 | 版本 | 用途 |
|------|------|------|
| pytest | >=8 | 测试运行器 |
| pytest-asyncio | >=0.23 | 异步测试支持 |
| pytest-cov | >=5 | 覆盖率收集 |
| aiosqlite | >=0.20 | SQLite 内存测试数据库 |
| httpx | >=0.27 | AsyncClient HTTP 测试 |
| anyio | >=4 | 多后端异步测试 |

## pytest 配置

定义在 `pyproject.toml`:

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
addopts = "-ra"
testpaths = ["tests", "app"]
python_files = ["test_*.py"]
```

- **异步模式**: `auto` -- 所有 `async def test_*` 自动作为协程运行
- **测试发现**: 两个根目录 `tests/`（集成测试）和 `app/`（模块内测试）
- **输出**: `-ra` 显示所有非通过的结果摘要

## 测试结构

### 顶层集成测试 (`tests/`)

```
tests/
├── __init__.py
├── test_config.py                          # Settings 解析规则（CORS CSV/JSON、密钥长度）
├── test_health.py                          # 健康检查端点（ok / degraded / version / request-id）
└── modules/
    ├── agent/
    │   ├── test_coordinator.py             # 执行协调器测试
    │   ├── test_stage_dispatch.py          # 阶段调度测试
    │   ├── test_spec_bundle_stage_dispatch.py  # Spec Bundle 调度
    │   ├── test_work_dir_strategy.py       # 工作目录策略
    │   └── test_context_builder.py         # 上下文构建器
    ├── change/
    │   ├── test_dispatch.py                # Agent dispatch
    │   ├── test_dispatch_chain.py          # 调度链
    │   ├── test_dispatch_stage_config.py   # 阶段配置
    │   ├── test_auto_dispatch.py           # 自动调度
    │   ├── test_e2e_stage_dispatch.py      # 端到端阶段调度
    │   └── test_router_transition.py       # 路由状态流转
    ├── change_writer/
    │   └── test_router.py                  # Change Writer 路由
    └── workspace/
        ├── test_scan_generate.py           # 扫描生成
        └── test_scan_generate_service.py   # 扫描生成服务
```

### 模块内测试 (`app/modules/*/tests/`)

每个模块的 `tests/` 子目录包含该模块的单元测试。

#### 模块测试覆盖情况

| 模块 | 有测试 | 测试文件（模块内 + 集成） |
|------|--------|--------------------------|
| workspace | Y | test_scanner, test_m2n_change, test_m2n_task (模块内) + test_scan_generate (集成) |
| agent | Y | test_base (模块内) + test_coordinator, test_stage_dispatch, test_context_builder 等 (集成) |
| change | Y | (集成) test_dispatch, test_dispatch_chain, test_e2e_stage_dispatch, test_router_transition |
| workflow | Y | test_spec_guardian |
| tool_gateway | Y | test_service, test_router |
| git_gateway | Y | test_dangerous |
| change_writer | Y | test_markdown_builder (模块内) + test_router (集成) |
| scan_docs | Y | 模块内测试 |
| spec_workspace | Y | test_validator |
| spec_profile | Y | test_policy |
| worktree | Y | 模块内测试 |
| task | Y | 模块内测试 |
| release | Y | test_router, test_service |
| incident | Y | test_router, test_service |
| knowledge | Y | 模块内测试 |
| runtime | Y | 模块内测试 |
| archive | Y | 模块内测试 |
| auth | **无** | -- |
| settings | **无** | -- |
| health | 部分 | 顶层 test_health.py 覆盖端点，模块内无测试 |

## 测试模式

### 1. 端点测试（HTTP 层）

使用 `httpx.AsyncClient` 配合 FastAPI TestClient 模式：

```python
async def test_health_all_ok(client: AsyncClient) -> None:
    resp = await client.get("/api/health")
    assert resp.status_code == 200
```

### 2. Service 层测试

直接实例化 Service 类，注入 mock/stub 依赖：

```python
class TestAgentService:
    def setup_method(self):
        self.session = MockSession()
        self.service = AgentService(self.session)
```

### 3. 外部依赖 Stub

使用 `monkeypatch` 替换外部依赖：

```python
@pytest.fixture()
def _stub_all_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _ok() -> str:
        return "ok"
    monkeypatch.setattr(health_module, "_check_db", _ok)
    monkeypatch.setattr(health_module, "_check_redis", _ok)
```

### 4. 文件系统解析测试

解析器接受 `Path` 输入，可指向测试数据目录：

```python
def test_parse_workspace(tmp_path):
    parser = WorkspaceParser()
    result = parser.parse(tmp_path)
```

## 测试数据库

- 测试环境使用 aiosqlite（SQLite 内存），不依赖真实 PostgreSQL
- 异步模式与生产环境一致（AsyncSession）
- `ENVIRONMENT=test` 由测试配置注入

## 运行命令

```bash
# 全部测试
pytest

# 指定模块
pytest backend/app/modules/agent/tests/
pytest backend/tests/modules/agent/

# 带覆盖率
pytest --cov=app

# 指定测试文件
pytest backend/tests/test_health.py

# 详细输出
pytest -v
```

## 覆盖范围评估

### 覆盖良好的领域

- **Agent 调度**: coordinator, stage_dispatch, context_builder, work_dir_strategy 均有测试
- **Change 工作流**: dispatch chain, auto_dispatch, e2e, router transition
- **Workspace**: scanner, m2n_change, m2n_task, scan_generate
- **Release / Incident**: router + service 双层测试
- **Tool Gateway**: service + router

### 缺失覆盖的领域

- **auth 模块**: 完全无测试 -- JWT 编解码、RBAC 权限检查、登录/刷新/登出流程、重放攻击检测
- **settings 模块**: 完全无测试 -- 用户 CRUD、平台配置更新
- **git_identity**: 仅模块内标记文件，无实际测试内容可见
