---
id: task-10
title: 全量回归验证
priority: P0
estimated_hours: 1
depends_on: [task-09]
blocks: []
allowed_paths:
  - backend/
---

# task-10: 全量回归验证

## 修改文件（必填）

本任务为纯验证任务，不修改任何源代码文件。仅运行测试命令并检查结果。

涉及的可读路径：
- `backend/app/modules/tool_gateway/` — 读取 tool_gateway 全部源码确认实现完整性
- `backend/app/modules/tool_gateway/tests/` — 读取测试文件确认测试覆盖度
- `backend/app/modules/agent/model.py` — 确认 AgentRun.tool_policy_id FK 存在
- `backend/app/modules/workflow/model.py` — 确认 AuditLog 结构
- `backend/migrations/versions/` — 确认迁移文件存在

## 实现要求

### 目标

在 task-01 ~ task-09 全部实现完成后，执行全量回归验证，确保本次变更不会破坏已有功能。这是最终质量关卡。

### 具体步骤

1. **运行全量 pytest**
   ```bash
   cd /Users/qinyi/SillyHub/backend && uv run pytest --tb=short -q 2>&1
   ```
   - 全部测试必须通过（0 failed）
   - 基线数量：648+ tests passed（以变更前最后一次全量通过为准）

2. **运行 tool_gateway 模块测试**
   ```bash
   cd /Users/qinyi/SillyHub/backend && uv run pytest app/modules/tool_gateway/tests/ -v --tb=short 2>&1
   ```
   - 确认 tool_gateway 新旧测试全部通过
   - 新增测试 >= 20 个（task-09 要求）

3. **运行 ruff 代码风格检查**
   ```bash
   cd /Users/qinyi/SillyHub/backend && uv run ruff check app/modules/tool_gateway/ 2>&1
   ```
   - 0 errors

4. **运行 mypy 类型检查（可选，有则执行）**
   ```bash
   cd /Users/qinyi/SillyHub/backend && uv run mypy app/modules/tool_gateway/ 2>&1
   ```

5. **完整性清单检查** — 逐项确认以下文件/结构存在且内容正确：

   | 检查项 | 预期结果 |
   |--------|----------|
   | `app/modules/tool_gateway/tool_policy.py` | 文件存在，含 ToolPolicy 模型 + ToolPolicyService 类 |
   | `app/modules/tool_gateway/policy_schema.py` | 文件存在，含 ToolPolicyCreate/Update/Read schemas |
   | `app/modules/tool_gateway/policy_router.py` | 文件存在，含 CRUD 5 个端点 |
   | `app/modules/tool_gateway/service.py` | TOOL_TYPES 包含 7 种（含 run_tests, http_get），execute 含 policy check + 审计双写 |
   | `app/modules/tool_gateway/schema.py` | tool_type Literal 包含 7 种 |
   | `app/modules/tool_gateway/model.py` | ToolOperationLog.tool_type 长度 >= 50 |
   | `app/modules/agent/model.py` | AgentRun 含 tool_policy_id FK 字段 |
   | `app/main.py` | 注册了 policy_router |
   | `migrations/versions/` | 存在 add_tool_policies 迁移 + agent_runs 加 FK 迁移 |

6. **验收标准对照** — 对照 `requirements.md` 逐条确认：

   | FR | 验证方式 |
   |----|----------|
   | FR-01: ToolPolicy CRUD | 有对应测试覆盖 POST/GET/PATCH/DELETE |
   | FR-02: AgentRun 关联 ToolPolicy | 有测试覆盖关联 + 默认策略 fallback |
   | FR-03: 工具白名单 | 有测试覆盖允许/拒绝 |
   | FR-04: 路径限制 | 有测试覆盖路径逃逸拦截 |
   | FR-05: shell 命令黑名单 | 有测试覆盖全局黑名单 + 自定义黑名单 |
   | FR-06: 资源限制 | 有测试覆盖超时限制 + 输出截断 |
   | FR-07: run_tests 工具 | 有测试覆盖正常执行 + 超时 + 结果解析 |
   | FR-08: http_get 工具 | 有测试覆盖域名白名单 + SSRF 防护 |
   | FR-09: 审计双写 | 有测试覆盖 ToolOperationLog + AuditLog 同时写入 |

7. **输出回归报告** — 将验证结果以文本形式输出，包含：
   - pytest 全量结果（pass/fail/skip/error 数量）
   - tool_gateway 模块测试结果
   - ruff 检查结果
   - 完整性清单通过/未通过
   - 验收标准对照结果
   - 遗留问题（如有）

## 接口定义（代码类任务必填）

本任务为验证任务，无代码接口。执行流程伪代码：

```
def run_regression():
    # Step 1: 全量 pytest
    result = run("uv run pytest --tb=short -q")
    assert result.exit_code == 0
    assert parse_passed(result) >= 648

    # Step 2: tool_gateway 模块测试
    result = run("uv run pytest app/modules/tool_gateway/tests/ -v")
    assert result.exit_code == 0
    assert count_tests(result) >= 20  # 新增测试数

    # Step 3: ruff
    result = run("uv run ruff check app/modules/tool_gateway/")
    assert result.exit_code == 0

    # Step 4: 完整性清单
    for check in INTEGRITY_CHECKS:
        assert file_exists(check.path)
        assert content_contains(check.path, check.pattern)

    # Step 5: 验收标准对照
    for fr in REQUIREMENTS:
        assert has_test_coverage(fr)

    # Step 6: 输出报告
    print_report()
```

## 边界处理（必填）

1. **测试失败时的行为**：不跳过、不忽略。如果 pytest 有任何 failed，立即停止并报告失败详情（文件名、测试名、错误信息），由人类决定是否修复或接受。
2. **测试数量变化**：基线 648+ 是下限而非精确值。如果新增测试导致总数增加，这是正常的（预期增加 20+）。如果总数减少，说明有测试被删除或跳过，需要调查。
3. **ruff warning vs error**：ruff check 只关注 error（exit code != 0），warning 可以记录但不阻塞。
4. **迁移文件检查**：只检查文件存在和基本结构（含 `upgrade()` 和 `downgrade()` 函数），不实际运行迁移（测试环境使用内存 SQLite + create_all）。
5. **网络依赖**：http_get 的 SSRF 防护测试必须通过 mock 实现，不能依赖外部网络。验证时需确认测试中没有真实网络调用。
6. **并发/时序问题**：如果测试因并发或时序偶发失败（flaky），记录下来但允许重跑一次。第二次仍失败则视为真失败。

## 非目标（本任务不做的事）

- 不修改任何源代码或测试代码（发现问题时报告，不自行修复）
- 不运行数据库迁移（测试用内存 SQLite）
- 不做性能测试/压力测试
- 不做前端验证（本变更是纯后端）
- 不负责修复 task-01 ~ task-09 的实现缺陷（只报告）
- 不生成测试覆盖率报告（--cov），除非覆盖率明显降低才关注
- 不做 API 兼容性测试（不启动真实服务器）

## 参考

- pytest 全量运行命令：`cd backend && uv run pytest --tb=short -q`
- tool_gateway 模块测试：`cd backend && uv run pytest app/modules/tool_gateway/tests/ -v --tb=short`
- ruff 检查：`cd backend && uv run ruff check app/modules/tool_gateway/`
- 现有测试结构参考：`backend/app/modules/tool_gateway/tests/test_service.py`（单元测试）、`test_router.py`（HTTP 集成测试）
- conftest.py 使用内存 SQLite + httpx.AsyncClient，所有测试无外部依赖

## TDD 步骤

本任务是验证任务，TDD 不适用。但执行顺序为：

1. 确认 task-01 ~ task-09 已全部完成
2. 运行全量 pytest，记录结果
3. 运行 tool_gateway 模块专项测试，记录结果
4. 运行 ruff 代码风格检查，记录结果
5. 执行完整性清单逐项检查
6. 对照 requirements.md 逐条验证
7. 输出回归报告

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | 运行 `uv run pytest --tb=short -q` | 全部通过（0 failed），passed >= 648 |
| AC-02 | 运行 `uv run pytest app/modules/tool_gateway/tests/ -v --tb=short` | 全部通过，新增测试 >= 20 个（tool_gateway 测试目录下总测试数 >= 28，原有 18 个 + 新增 20 个） |
| AC-03 | 运行 `uv run ruff check app/modules/tool_gateway/` | 0 errors |
| AC-04 | 检查 `tool_policy.py` 文件存在且含 ToolPolicy 模型 + ToolPolicyService 类 | 文件存在，包含 `class ToolPolicy` 和 `class ToolPolicyService` |
| AC-05 | 检查 `policy_schema.py` 文件存在且含 Create/Update/Read schemas | 文件存在，包含 `ToolPolicyCreate`、`ToolPolicyUpdate`、`ToolPolicyRead` |
| AC-06 | 检查 `policy_router.py` 文件存在且含 5 个 CRUD 端点 | 文件存在，包含 POST/GET list/GET detail/PATCH/DELETE 路由函数 |
| AC-07 | 检查 `service.py` TOOL_TYPES 包含 7 种 | TOOL_TYPES 含 file_read, file_write, file_list, file_search, shell_exec, run_tests, http_get |
| AC-08 | 检查 `schema.py` tool_type Literal 包含 7 种 | Literal 含上述 7 种 tool_type |
| AC-09 | 检查 `model.py` ToolOperationLog.tool_type 长度 >= 50 | `String(50)` 或更大 |
| AC-10 | 检查 `agent/model.py` AgentRun 含 tool_policy_id FK | 字段存在且类型为 `Uuid` + ForeignKey 到 tool_policies |
| AC-11 | 检查 `main.py` 注册了 policy_router | 含 `from app.modules.tool_gateway.policy_router import ...` + `app.include_router(...)` |
| AC-12 | 检查迁移文件存在 | 至少存在一个 add_tool_policies 迁移和一个 agent_runs 加 FK 迁移 |
| AC-13 | 验证 FR-01~09 测试覆盖 | 每个 FR 编号需求至少有 1 个对应测试用例 |
| AC-14 | 全量 pytest 无新增 skip/error | skip 数量不超过基线，error 数量为 0 |
