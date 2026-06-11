---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# Backend 测试策略

## 测试框架

- **pytest** >= 8 作为主框架
- **pytest-asyncio** >= 0.23，`asyncio_mode = "auto"`（无需 `@pytest.mark.asyncio` 装饰器）
- **pytest-cov** >= 5，覆盖率门槛 60%（`--cov-fail-under=60`）
- **anyio** >= 4 用于异步测试辅助
- **aiosqlite** >= 0.20 用于测试中的 SQLite 内存数据库

## 测试目录结构

```
backend/
├── tests/                          # 集成测试套件
│   ├── test_config.py              # 配置加载测试
│   ├── test_health.py              # 健康检查端点测试
│   └── modules/
│       ├── agent/                  # Agent 模块测试
│       │   ├── test_coordinator.py
│       │   ├── test_context_builder.py
│       │   ├── test_diff_collector.py
│       │   ├── test_scan_dispatch.py
│       │   ├── test_stage_dispatch.py
│       │   ├── test_spec_bundle_stage_dispatch.py
│       │   ├── test_work_dir_strategy.py
│       │   ├── test_kill.py
│       │   ├── test_post_scan_validator.py
│       │   ├── test_adapter_isolation.py
│       │   ├── test_m2n_agent_run.py
│       │   └── test_background_task_lifecycle.py
│       ├── change/                 # Change 模块测试
│       │   ├── test_dispatch.py
│       │   ├── test_dispatch_chain.py
│       │   ├── test_dispatch_stage_config.py
│       │   ├── test_e2e_stage_dispatch.py
│       │   ├── test_auto_dispatch.py
│       │   ├── test_router_transition.py
│       │   ├── test_transition_response.py
│       │   └── test_archive_gate.py
│       ├── change_writer/          # Change Writer 测试
│       │   └── test_router.py
│       ├── workspace/              # Workspace 测试
│       │   ├── test_scan_generate.py
│       │   ├── test_scan_generate_service.py
│       │   ├── test_scanner.py
│       │   ├── test_m2n_change.py
│       │   └── test_m2n_task.py
│       └── ...（其他模块测试）
└── app/modules/*/tests/            # 模块内单元测试
    ├── auth/tests/
    ├── daemon/tests/
    ├── git_gateway/tests/
    ├── git_identity/tests/
    ├── incident/tests/
    ├── release/tests/
    ├── spec_profile/tests/
    ├── tool_gateway/tests/
    ├── workflow/tests/
    └── worktree/tests/
```

## 测试运行命令

```bash
# 完整测试套件
uv run pytest -q --cov=app --cov-fail-under=60

# 仅集成测试
uv run pytest tests/ -q

# 仅模块单元测试
uv run pytest app/ -q

# 特定模块
uv run pytest tests/modules/agent/ -q
```

## 测试覆盖情况

### 覆盖较好的模块
- **agent** — 12 个测试文件，覆盖 coordinator、context_builder、diff_collector、dispatch、kill、adapter isolation、background task lifecycle 等
- **daemon** — 覆盖 ws_hub（连接/心跳/广播/慢连接驱逐/完整生命周期）、lease_service（claim/heartbeat/expire/cancel/validate/register）、wave5 集成测试
- **change** — 8 个测试文件，覆盖 dispatch chain、stage config、auto dispatch、router transition、archive gate
- **tool_gateway** — service 路径校验、shell 验证、策略（工具允许/命令阻止/域名检查/SSRF/限额）
- **workflow** — FSM 状态机、ChangeFSM、TaskFSM
- **spec_profile** — policy 冲突检测

### 测试较薄弱的模块
- **knowledge** — 无独立测试文件
- **runtime** — 无独立测试文件
- **scan_docs** — 无独立测试文件
- **settings** — 无独立测试文件

## 测试模式

### 1. 数据库测试
使用 aiosqlite 内存数据库替代 PostgreSQL，避免外部依赖。

### 2. Service 层单元测试
直接实例化 Service 类，注入 mock session：
```python
service = FeatureService(session)
result = await service.method(...)
```

### 3. Router 集成测试
通过 FastAPI TestClient 测试完整请求-响应流程。

### 4. 异步子进程测试
Agent adapter 测试使用 mock 的 asyncio 子进程调用。

## 代码质量工具

```bash
# Lint
uv run ruff check .

# Format 检查
uv run ruff format --check .

# 类型检查
uv run mypy app
```
