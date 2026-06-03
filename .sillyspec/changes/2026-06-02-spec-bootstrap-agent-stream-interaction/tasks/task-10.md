---
id: task-10
title: 运行目标测试、lint、typecheck 并修复回归
priority: P0
estimated_hours: 3
depends_on:
  - task-01
  - task-02
  - task-03
  - task-04
  - task-05
  - task-06
  - task-07
  - task-08
  - task-09
blocks: []
author: qinyi
created_at: 2026-06-02T13:00:00
allowed_paths:
  - backend/app/modules/spec_workspace/bootstrap.py
  - backend/app/modules/spec_workspace/router.py
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/spec_workspace/model.py
  - backend/app/modules/spec_workspace/schema.py
  - backend/app/modules/spec_workspace/validator.py
  - backend/app/modules/spec_workspace/tests/test_bootstrap.py
  - backend/app/modules/agent/router.py
  - backend/app/modules/agent/service.py
  - backend/app/modules/agent/model.py
  - backend/app/modules/agent/schema.py
  - backend/app/modules/agent/base.py
  - backend/app/modules/agent/adapters/claude_code.py
  - backend/app/modules/agent/context_builder.py
  - backend/app/modules/agent/coordinator.py
  - backend/app/modules/agent/coordinator_schema.py
  - backend/app/modules/agent/tests/test_router.py
  - backend/app/modules/agent/tests/test_service.py
  - backend/app/modules/agent/tests/test_coordinator.py
  - frontend/src/lib/agent.ts
  - frontend/src/lib/spec-workspaces.ts
  - frontend/src/lib/api.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
---

# task-10: 运行目标测试、lint、typecheck 并修复回归

## 修改文件

本任务原则上只修复回归，不新增功能文件。修改范围仅限于当前变更涉及模块的源文件和测试文件：

| 操作 | 文件路径 | 修复场景 |
|---|---|---|
| 可能修改 | `backend/app/modules/spec_workspace/bootstrap.py` | ruff/lint 或测试回归 |
| 可能修改 | `backend/app/modules/spec_workspace/router.py` | ruff/lint 或测试回归 |
| 可能修改 | `backend/app/modules/spec_workspace/tests/test_bootstrap.py` | 测试签名或 fixture 回归 |
| 可能修改 | `backend/app/modules/agent/router.py` | ruff/lint 或测试回归 |
| 可能修改 | `backend/app/modules/agent/service.py` | ruff/lint 或测试回归 |
| 可能修改 | `backend/app/modules/agent/adapters/claude_code.py` | ruff/lint 回归 |
| 可能修改 | `backend/app/modules/agent/tests/test_router.py` | 测试签名或 fixture 回归 |
| 可能修改 | `frontend/src/lib/agent.ts` | typecheck 回归 |
| 可能修改 | `frontend/src/lib/spec-workspaces.ts` | typecheck 回归 |
| 可能修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | typecheck 回归 |
| 可能修改 | `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` | typecheck 回归 |

## 实现要求

### 1. 运行后端目标测试

```bash
cd backend
python -m pytest app/modules/spec_workspace/tests/ app/modules/agent/tests/ -ra -v
```

- 如果测试失败，分析失败原因：
  - 签名变更（如 `bootstrap()` 返回值变化、`service` 方法参数变化）
  - fixture 缺失或 fixture scope 不兼容
  - mock 目标路径变更（如 `adapter` 重构后 mock 路径失效）
  - 新增必填字段未在测试中提供
  - 异步 `fixture` / `session` 生命周期问题
- 修复策略：只修改测试代码以适配实现变更，不回退实现逻辑

### 2. 运行后端 lint (ruff)

```bash
cd backend
ruff check app/modules/spec_workspace/ app/modules/agent/ --fix
```

- 如果 `ruff` 报错，修复代码以通过检查
- 常见问题：未使用的 `import`、行长度、命名规范、`bare except`
- 不要全局修改 `ruff ignore` 配置来绕过

### 3. 运行前端 typecheck

```bash
cd frontend
pnpm typecheck
```

- 如果 `tsc --noEmit` 报错，分析类型不匹配原因：
  - `BootstrapResult` 类型变更后消费方未更新（`page.tsx` 引用旧字段）
  - `AgentRunLogEntry.channel` 类型缩窄导致赋值不兼容
  - 新增 `import` 但源模块未导出
  - `React` 组件 `props` 类型不匹配
- 修复策略：优先修改消费方代码适配新类型，保持 `API` 层契约不变

### 4. 运行前端 lint

```bash
cd frontend
pnpm lint
```

- 如果 `next lint` 报错，修复 `ESLint` 问题
- 常见问题：未使用的变量、缺少依赖数组项、`React hooks` 规则

### 5. 逐项确认后记录结果

- 每个命令的执行结果（通过/失败）和修复内容
- 如果某个检查本身环境不可用（如数据库未启动导致测试 `fixture` 失败），记录跳过原因，但 lint/typecheck 必须通过

## 接口定义

本任务不新增接口。修复行为限于以下模式：

### 测试修复伪代码

```
FOR each failing test:
  READ test file and source file
  ANALYZE failure:
    - diff expected vs actual
    - check if source signature changed
    - check if mock target path changed
    - check if model fields changed
  FIX:
    - update mock target if adapter/service path changed
    - update test assertions if return schema changed
    - add missing required fields to test fixtures
  RE-RUN single test to verify fix
```

### Lint/Typecheck 修复伪代码

```
RUN ruff check / tsc --noEmit / next lint
IF errors found:
  FOR each error:
    READ affected file
    ANALYZE:
      - unused import? → remove
      - type mismatch? → update consumer code
      - missing field? → add or update
      - naming violation? → rename
    FIX and re-check
```

## 边界处理

- **测试 fixture 依赖数据库**：后端集成测试可能依赖 `db_session` fixture（基于 `aiosqlite` 内存库）。如果 `fixture` 本身无法初始化（如 `SQLModel` 表变更后未 `create_all`），在 fixture 或 `conftest.py` 中补充建表逻辑，不要跳过测试。
- **ruff --fix 可能引入破坏**：`ruff --fix` 自动修复后必须重新运行测试确认无回归。如果 `--fix` 删除了看似无用但被动态引用的 `import`，手动加回。
- **typecheck 错误级联**：一个类型变更（如 `BootstrapResult` 删掉旧字段）可能导致多个消费方文件报错。按模块逐个修复，每修一个文件重新跑 `typecheck` 确认减少错误数。
- **不修改业务逻辑**：本任务只修复测试、lint、typecheck 回归。如果发现实现代码有明确 bug（如 `None` 访问、逻辑错误），记录问题但不修，标记为阻塞项交回主流程。
- **前端 typecheck 与后端无关**：前端 `tsc --noEmit` 不依赖后端运行。不要因后端未启动而跳过前端检查。
- **环境不可用时的处理**：如果 `Redis` 或 `PostgreSQL` 未启动导致部分集成测试无法运行，记录跳过的测试名称和原因。但 `spec_workspace` 和 `agent` 模块的单元测试使用内存 `SQLite`，不应依赖外部服务。
- **不新增 `ignore`/`exclude` 规则**：不修改 `ruff`、`tsconfig.json`、`.eslintrc` 的 `ignore`/`exclude` 配置来绕过检查失败。
- **不修改 `conftest.py` 的全局 fixture**：如果需要修改 `conftest.py`，仅限当前变更涉及模块的 fixture。不改动全局 `db`/`client` fixture 的核心逻辑。

## 非目标

- 不新增测试用例（测试覆盖率问题留给 task-03 和后续迭代）
- 不修改 `pyproject.toml`、`tsconfig.json`、`.eslintrc`、`ruff` 配置
- 不修改与本次变更无关的模块（如 `auth`、`workspace`、`change` 等），即使它们有 lint/typecheck 问题
- 不实现 design.md 中描述但尚未实现的功能
- 不修复非本次变更引入的历史 lint/typecheck 问题（除非阻塞本次检查通过）
- 不修改 `migrations/` 目录
- 不运行全量 `pytest`（只跑 `spec_workspace` 和 `agent` 目标模块）
- 不做性能测试、安全扫描或 `E2E` 测试
- 不修改 `.sillyspec/docs/` 文档（文档同步由 task-09 完成）

## 参考

- **design.md** 决策 1-4 和文件变更清单：定义了本次变更涉及的所有文件
- **plan.md** Wave 4 task-10 说明：运行目标测试、ruff、frontend typecheck
- **plan.md** 全局验收标准：
  - `/spec-bootstrap` 不再直接执行 `_run_sillyspec_init()` 或裸 `sillyspec` 子进程
  - 目标后端测试通过
  - Ruff 通过
  - Frontend typecheck 通过
- **pyproject.toml** `[tool.pytest.ini_options]` 和 `[tool.ruff]` 配置
- **frontend/package.json** `scripts.typecheck` 和 `scripts.lint`
- **task-01 ~ task-06**：前序任务的实现变更范围
- **测试运行命令**：
  - 后端目标测试：`cd backend && python -m pytest app/modules/spec_workspace/tests/ app/modules/agent/tests/ -ra -v`
  - 后端 lint：`cd backend && ruff check app/modules/spec_workspace/ app/modules/agent/`
  - 前端 typecheck：`cd frontend && pnpm typecheck`
  - 前端 lint：`cd frontend && pnpm lint`
- **模块文档**：
  - `.sillyspec/docs/backend/modules/agent.md`
  - `.sillyspec/docs/backend/modules/spec_workspace.md`
  - `.sillyspec/docs/frontend/scan/INTEGRATIONS.md`

## TDD 步骤

本任务是验证修复任务，TDD 流程适配如下：

1. **运行后端目标测试** → 记录失败用例 → 逐个分析原因 → 修复测试或源码 → 确认通过
2. **运行后端 ruff** → 记录报错 → 修复 → `ruff check` 确认通过
3. **运行前端 typecheck** → 记录类型错误 → 修复消费方代码 → `pnpm typecheck` 确认通过
4. **运行前端 lint** → 记录报错 → 修复 → `pnpm lint` 确认通过
5. **全量回归**：再次运行步骤 1-4 的全部命令，确认无遗漏

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 运行后端目标测试 | `python -m pytest app/modules/spec_workspace/tests/ app/modules/agent/tests/ -ra` 全部通过（0 failed），无 ERROR |
| AC-02 | 运行后端 ruff | `ruff check app/modules/spec_workspace/ app/modules/agent/` 输出为空（0 errors, 0 warnings） |
| AC-03 | 运行前端 typecheck | `pnpm typecheck` 退出码 0，无 TS 错误 |
| AC-04 | 运行前端 lint | `pnpm lint` 退出码 0，无 ESLint 错误 |
| AC-05 | 检查修复范围 | 修复内容仅限于 `allowed_paths` 列出的文件，未修改无关模块 |
| AC-06 | 检查无新增 ignore | 未修改 `pyproject.toml`、`tsconfig.json`、`.eslintrc` 的 ignore/exclude 配置 |
| AC-07 | 检查无业务逻辑变更 | 修复仅涉及类型标注、import、测试断言、mock 路径等，不改变运行时业务行为 |
| AC-08 | 二次回归确认 | 修复完成后重新运行 AC-01 ~ AC-04 全部命令，结果一致通过 |
