---
author: qinyi
created_at: 2026-05-29T17:42:00
---

# TESTING — backend

## 测试结构

- **框架**：pytest 8+ (asyncio_mode=auto)
- **覆盖率**：pytest-cov 5+，CI 门槛 60%
- **测试文件**：42 个（9,026 行）
- **数据库**：aiosqlite 内存数据库（测试隔离）

### Fixture 依赖链

```
db_engine → db_session → auth_admin_token → auth_headers
db_engine → client (HTTP 测试客户端)
```

### conftest.py Fixture 列表

| Fixture | 类型 | 说明 |
|---------|------|------|
| `_reset_settings_cache` | Iterator[None] | 重置 Settings lru_cache |
| `db_engine` | AsyncIterator | 异步数据库引擎（内存 SQLite） |
| `db_session` | AsyncIterator[AsyncSession] | 异步数据库会话 |
| `client` | AsyncIterator[AsyncClient] | HTTP 测试客户端 |
| `auth_admin_token` | str | 管理员 JWT |
| `auth_headers` | dict[str, str] | 认证请求头 |

## 模块测试覆盖

| 模块 | 测试文件 | 行数 |
|------|----------|------|
| agent | test_base, test_context_builder, test_router | 1,658 |
| workspace | test_model, test_parser, test_relation_router, test_router, test_scanner, test_service | 1,496 |
| tool_gateway | test_router, test_service | 513 |
| worktree | test_exec_env, test_router | 474 |
| workflow | test_fsm, test_router, test_spec_guardian | 527 |
| scan_docs | test_parser, test_router, test_service | 486 |
| release | test_router, test_service | 564 |
| git_gateway | test_router, test_service | 388 |
| change | test_parser, test_router | 416 |
| change_writer | test_markdown_builder, test_router | 342 |
| incident | test_router, test_service | 406 |
| task | test_parser, test_router | 360 |
| spec_workspace | test_bootstrap, test_validator | 420 |
| knowledge | test_parser, test_router | 256 |
| git_identity | test_crypto, test_router | 281 |
| archive | test_service | 129 |
| runtime | test_router | 135 |
| spec_profile | test_policy | 63 |
| 顶层 | test_config, test_health | 112 |

## 验证命令

```bash
make backend-test          # pytest --cov
make backend-lint          # ruff check + format --check + mypy
make backend-format        # ruff format + ruff check --fix
```
