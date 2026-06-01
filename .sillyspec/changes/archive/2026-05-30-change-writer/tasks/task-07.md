---
id: task-07
title: 全套回归测试 — 确认新增测试 ≥ 15，全套 540+ 测试无回归
priority: P0
estimated_hours: 0.5
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06]
blocks: []
allowed_paths:
  - backend/
author: qinyi
created_at: 2026-05-30 16:00:00
---

# Task-07: 全套回归测试 — 确认新增测试 ≥ 15，全套 540+ 测试无回归

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/change_writer/tests/` | 验证 | 统计新增测试数量 |
| `backend/` (全量) | 验证 | 运行 `pytest` 确认无回归 |

**注意**: 本任务为纯验证任务，原则上不修改任何源代码。仅在测试本身有 bug 时修复测试文件。

## 实现要求

### 1. 统计 change_writer 模块新增测试数量

执行以下命令统计 change_writer 模块下所有测试：

```bash
cd backend && python -m pytest app/modules/change_writer/tests/ --co -q 2>/dev/null | tail -1
```

或使用 grep 统计：

```bash
cd backend && grep -rn "async def test_\|def test_" app/modules/change_writer/tests/ --include="*.py" | wc -l
```

**基线数据**（task-01~06 执行前）:
- change_writer 模块已有 14 个测试
- 其中 test_markdown_builder.py: 7 个，test_router.py: 7 个

**预期**（task-01~06 执行后）:
- test_markdown_builder.py 新增测试（task-01）: `build_tasks_md`、`build_verification_md`、增强 `build_master_md` 的测试
- test_router.py 新增测试（task-02）: batch-generate 相关测试
- test_service.py（新增文件，task-04/06）: `git_commit_and_push` 和 `create_pull_request` 的 mock 测试
- 新增测试总数 >= 15

### 2. 运行全量 pytest

```bash
cd backend && python -m pytest --tb=short -q 2>&1
```

**预期结果**:
- 总测试数 >= 540（基线 591，新增 >= 15 → 总数 >= 606，但 540 是最低门槛）
- failures = 0
- errors = 0

### 3. 失败分析流程

如有测试失败，按以下优先级分析：

1. **import 失败**: 检查 `__init__.py` 是否遗漏导出，或新增模块是否注册到 `app/modules/` 路径
2. **fixture 缺失**: 检查 `conftest.py` 中是否缺少新增 fixture（如 `client`、`db_session`、`mock_repo_dir`）
3. **mock 不匹配**: 检查 mock 对象的属性/方法签名是否与实际代码一致（常见于 task-04/06 中 mock GitGatewayService 和 httpx）
4. **测试数据不一致**: 检查 `_setup_prerequisites` 辅助函数是否与 task-01~06 中新增的字段/模型对齐
5. **异步测试遗漏 `@pytest.mark.asyncio`**: 确认 `async def test_*` 函数能被 pytest 正确识别（项目 conftest.py 应已全局配置 asyncio_mode）

### 4. 修复规则

- **只修测试，不改实现**: 如果测试失败是因为实现代码的 bug，记录问题但不修改实现文件，回到对应 task 修复
- **允许修改的文件**: 仅限 `backend/app/modules/change_writer/tests/` 下的文件和 `backend/conftest.py`
- **禁止修改的文件**: `service.py`、`router.py`、`schema.py`、`markdown_builder.py` 及其他非测试文件

## 边界处理

1. **change_writer 新增测试不足 15 个**: 说明 task-01~06 中部分测试未按要求编写。需要回到对应 task 的验收标准检查，列出缺失的测试并补充。验收标准中明确要求新增 >= 15，这是硬性指标。

2. **全量测试中有非 change_writer 模块失败**: 可能是 task-01~06 的改动影响了其他模块（如 conftest.py 中的 fixture 修改）。需要逐个分析失败原因，如果是 conftest 修改引起的，在本 task 中修复 conftest.py。

3. **test_service.py 不存在**: task-04 和 task-06 要求新建此文件。如果缺失，说明依赖 task 未完成，本 task 应阻塞并报告。

4. **测试运行环境问题（如环境变量缺失、数据库连接失败）**: 检查 `conftest.py` 中是否正确配置了 test database 和 mock 环境。项目的 pytest 配置应使用 SQLite 内存数据库，不依赖外部服务。

5. **新增测试导致其他模块测试失败（回归）**: 重点检查 conftest.py 中的 fixture 是否被新代码污染。例如 `client` fixture 的状态是否在测试间正确重置、`db_session` 的 rollback 是否生效。

6. **asyncio 测试配置问题**: 项目使用 `pytest-asyncio`，确认 `conftest.py` 或 `pyproject.toml` 中配置了 `asyncio_mode = "auto"`，否则所有 `async def test_*` 都会被 skip。如果被 skip，需要在 `conftest.py` 或 `pytest.ini` 中添加配置。

7. **import 路径不一致**: 新增的 `test_service.py` 中的 import 路径必须与实际模块路径一致。例如 `from app.modules.change_writer.service import ChangeWriterService`，而不是 `from backend.app.modules...`。

## 非目标

- 不新增功能代码（service/router/schema/markdown_builder 不动）
- 不修改其他模块的测试（git_gateway、git_identity、worktree 等）
- 不修改 CI/CD 配置
- 不做性能测试或压力测试
- 不处理已知但与本次变更无关的既有失败（如果有）
- 不生成测试覆盖率报告

## 参考

- design.md: "文件变更清单" — 列出了所有应存在的测试文件
- design.md: "风险登记" — 可能导致测试失败的已知风险
- plan.md: Wave 4 — task-07 的上下文
- tasks.md: task-04 和 task-06 要求新建 `test_service.py`
- tasks.md: task-01 要求增强 `test_markdown_builder.py`
- tasks.md: task-02 要求在 `test_router.py` 新增 batch-generate 测试
- task-02.md: 验收标准第 5 项 "全套 pytest 通过，无新增失败"

## TDD 步骤

本任务是验证任务，不是开发任务，因此不遵循标准 TDD 流程。替代执行步骤：

1. **前置检查**: 确认 task-01~06 全部标记为完成。如果任何前置 task 未完成，本 task 阻塞。
2. **文件存在性检查**: 确认以下文件存在：
   - `backend/app/modules/change_writer/tests/test_markdown_builder.py`
   - `backend/app/modules/change_writer/tests/test_router.py`
   - `backend/app/modules/change_writer/tests/test_service.py`
3. **统计新增测试**: 运行 `pytest --co -q` 统计 change_writer 模块测试数量，确认新增 >= 15。
4. **运行全量测试**: 执行 `cd backend && python -m pytest --tb=short -q`，记录总数和失败数。
5. **失败处理**: 如有失败，按"失败分析流程"排查，在测试文件中修复。修复后重新运行全量。
6. **记录结果**: 将最终测试总数、通过数、失败数记录到 progress.json 或任务报告中。

## 验收标准

| 序号 | 验收项 | 预期结果 | 验证方式 |
|---|---|---|---|
| 1 | change_writer 测试文件完整性 | `test_markdown_builder.py`、`test_router.py`、`test_service.py` 三个文件均存在 | `ls backend/app/modules/change_writer/tests/test_*.py` |
| 2 | change_writer 新增测试数量 | 新增测试 >= 15 个（总测试数 >= 29，基线 14 + 新增 >= 15） | `cd backend && grep -rn "def test_\|async def test_" app/modules/change_writer/tests/ --include="*.py" \| wc -l` 结果 >= 29 |
| 3 | test_service.py 存在且有测试 | 文件存在且包含 >= 1 个 test 函数 | `grep -c "def test_\|async def test_" backend/app/modules/change_writer/tests/test_service.py` |
| 4 | 全量 pytest 无失败 | `failures = 0`，`errors = 0` | `cd backend && python -m pytest --tb=short -q` 输出 "failed=0" 或无 FAILURES 段 |
| 5 | 全量测试数 >= 540 | 总 collected tests >= 540 | `cd backend && python -m pytest --co -q 2>/dev/null \| tail -1` 显示 >= 540 |
| 6 | 非 change_writer 模块无回归 | 除 change_writer 外，所有既有测试仍通过 | 对比 task-01~06 前后的 pytest 结果，确认无新增失败 |
| 7 | 实现代码未修改 | service.py、router.py、schema.py、markdown_builder.py 无新变更 | `git diff HEAD -- backend/app/modules/change_writer/*.py` 无输出（排除 task-01~06 的已有变更） |
