---
id: task-10
title: "全量测试验证"
priority: P0
estimated_hours: 0.5
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09]
blocks: []
allowed_paths: []
---

# task-10: 全量测试验证

## 修改文件（必填）
- 无文件修改，纯验证任务

## 实现要求

1. 运行全量 pytest，确保 591 测试全部通过（当前基线：591 tests collected）
2. 对照 design.md 和 plan.md 的全局验收标准逐一检查
3. 记录测试结果和覆盖率
4. 如有失败，分析原因并记录到结果中

## 接口定义

### 验证命令

```bash
# 进入 backend 目录运行
cd /Users/qinyi/SillyHub/backend

# 全量测试
python -m pytest --tb=short -q

# 带覆盖率报告
python -m pytest --cov=app --cov-report=term-missing --tb=short -q

# 仅 workflow 模块测试
python -m pytest app/modules/workflow/tests/ -v

# datetime.utcnow 残留检查
grep -rn "datetime\.utcnow\|utcnow()" app/ --include="*.py"
```

### 结果记录格式

```
## 测试结果

- 执行时间: YYYY-MM-DD HH:MM
- 测试总数: N
- 通过: N
- 失败: N
- 错误: N
- 跳过: N

### 失败列表（如有）

| 测试名 | 文件 | 错误类型 | 原因分析 |
|--------|------|----------|----------|
| ... | ... | ... | ... |

## 覆盖率摘要

- 总覆盖率: XX%
- workflow 模块覆盖率: XX%
- audit_hooks 覆盖率: XX%
```

### 验收检查清单

按以下顺序逐项执行，每项记录通过/失败：

| # | 检查项 | 验证方法 | 通过标准 |
|---|--------|----------|----------|
| 1 | 全量 pytest | `python -m pytest --tb=short -q` | 591 tests passed, 0 failed |
| 2 | workflow 测试 | `python -m pytest app/modules/workflow/tests/ -v` | 所有测试通过 |
| 3 | spec_guardian 测试 | `python -m pytest app/modules/workflow/tests/test_spec_guardian.py -v` | G4/G5/G7 相关测试通过 |
| 4 | audit_hooks 测试 | `python -m pytest app/modules/workflow/tests/test_audit_hooks.py -v` | 所有测试通过 |
| 5 | datetime.utcnow 残留 | `grep -rn "utcnow" app/ --include="*.py"` | 零匹配 |
| 6 | 现有 API 行为 | 检查 router 测试无新增 4xx/5xx | 无回归 |

## 边界处理

1. **测试环境与生产环境差异**: 项目使用 SQLite 内存数据库做测试，生产用 PostgreSQL。某些 PostgreSQL 特有功能（如 RETURNING、JSON 操作符）在 SQLite 上行为不同。如果出现仅因数据库差异导致的失败，需明确标注。
2. **Flaky test（时序相关失败）**: 涉及时间字段的测试可能因 `datetime.now()` 精度差异偶尔失败。如遇到，记录并重跑一次确认。
3. **测试超时处理**: 默认 pytest 无超时。如果某个测试挂起超过 60 秒，手动 Ctrl+C 中断并记录。可以安装 `pytest-timeout` 并添加 `--timeout=30` 参数。
4. **Migration 相关测试独立性**: Alembic migration 测试可能依赖数据库状态。确保每个测试有独立的 fixture/setup，不依赖执行顺序。
5. **区分新旧失败**: 对比本次变更前的测试基线（591 collected）。如果出现失败，检查是本次 task-01~09 的改动导致的还是原有问题。通过 `git stash` 或 `git diff` 定位引入失败的提交。
6. **asyncio 测试兼容**: 项目配置 `asyncio_mode = "auto"`，所有 async 测试函数自动被 pytest-asyncio 处理。确保没有遗漏 `@pytest.mark.asyncio` 导致同步运行的假通过。
7. **外键约束问题**: SQLite 默认不启用外键约束。如果测试依赖外键（如 AuditLog 引用 Change），需确认测试是否正确处理了这个差异。

## 非目标

- 不修改任何代码文件
- 不修复发现的 bug（仅记录，另行创建 task 处理）
- 不做性能测试
- 不做手动端到端测试
- 不做前端验证
- 不更新文档

## 参考

- plan.md 全局验收标准（8 项 checklist）
- design.md 自审章节（6 项一致性检查）
- pytest 配置: `backend/pyproject.toml` → `[tool.pytest.ini_options]`
- 测试目录结构:
  - `backend/tests/` — 顶层集成测试（test_config.py, test_health.py）
  - `backend/app/modules/*/tests/` — 各模块单元测试（共 18 个模块）
- 当前测试基线: 591 tests collected

## TDD 步骤

本任务为验证任务，不涉及 TDD 流程，按以下步骤执行：

1. **运行全量测试**: `cd /Users/qinyi/SillyHub/backend && python -m pytest --tb=short -q` 记录总数和结果
2. **运行 workflow 专项测试**: `python -m pytest app/modules/workflow/tests/ -v` 检查所有 workflow 测试
3. **检查 datetime.utcnow 残留**: `grep -rn "utcnow" app/ --include="*.py"` 确认零残留
4. **运行覆盖率报告（可选）**: `python -m pytest --cov=app --cov-report=term-missing --tb=short -q`
5. **记录结果**: 按上述结果记录格式输出完整验证报告

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | `test_change_transition_draft_to_proposed` 通过 | 测试通过，无 AssertionError |
| AC-02 | 44+ 个 workflow 测试全部通过 | `app/modules/workflow/tests/` 下 0 failed |
| AC-03 | 新增 spec_guardian 测试通过 | test_spec_guardian.py 中 G4/G5/G7 相关测试通过 |
| AC-04 | audit hook 测试通过 | test_audit_hooks.py 所有测试通过 |
| AC-05 | `datetime.utcnow` 零残留 | `grep -rn "utcnow" app/ --include="*.py"` 无匹配 |
| AC-06 | 全量 pytest 591 tests | 全部通过，0 failed, 0 error |
| AC-07 | 不改变现有 API 行为 | 无新增 4xx/5xx 响应的测试失败 |
