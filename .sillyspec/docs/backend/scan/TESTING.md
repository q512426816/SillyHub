---
author: qinyi
created_at: 2026-06-03T10:00:00
---

# TESTING — backend

## 测试框架

- **框架**: pytest 8 + pytest-asyncio
- **配置**: `pyproject.toml` → `[tool.pytest.ini_options]`
- **异步模式**: `asyncio_mode = "auto"`
- **测试发现**: `python_files = ["test_*.py"]`，路径 `tests/` + `app/`

## 测试结构

### 顶层测试 (`tests/`)
- `test_config.py` — 配置加载测试
- `test_health.py` — 健康检查端点测试
- `tests/modules/` — 按模块组织的集成测试

### 模块内测试（18 个模块有测试）

| 模块 | 测试数 | 模块 | 测试数 |
|------|--------|------|--------|
| workspace | 11 | tool_gateway | 4 |
| agent | 9 | git_gateway | 4 |
| change | 5 | scan_docs | 4 |
| workflow | 5 | change_writer | 3 |
| git_identity | 3 | incident | 3 |
| knowledge | 3 | release | 3 |
| spec_workspace | 3 | task | 3 |
| worktree | 3 | runtime | 2 |
| archive | 2 | spec_profile | 2 |

### 无测试的模块
- `auth` — 无测试（安全关键路径！）
- `settings` — 无测试
- `health` — 无模块内测试（顶层有 `test_health.py`）

## 测试命令

```bash
pytest                              # 运行全部
pytest backend/app/modules/agent/tests/  # 指定模块
pytest --cov=app                    # 带覆盖率
```

## 覆盖范围

- **测试文件总数**: 182 个
- **模块覆盖率**: 18/21 (86%)
- **缺失**: auth、settings 模块无测试覆盖
