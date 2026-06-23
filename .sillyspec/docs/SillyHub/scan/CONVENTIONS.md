---
source_commit: ba87eec
updated_at: 2026-06-23T16:32:07Z
created_at: 2026-06-24T00:32:07
author: qinyi
generator: sillyspec-scan
---

# SillyHub 代码约定

> SillyHub 产品根（path = `.`，仓库根），聚合三个子项目：backend（FastAPI + Python 3.12）、
> frontend（Next.js 14 + Antd 6 + eslint 8）、sillyhub-daemon（Node ≥ 20 ESM）。
> 本文件由 SillySpec scan 子代理基于 `.claude/CLAUDE.md`、`.claude/settings.json`、各子项目配置与
> `AGENTS.md` 扫描生成，描述跨组件 / 项目级的工程约定，作为后续变更与代码生成的输入参考。

## 框架隐形规则

1. **文档驱动开发是硬性规则，不可跳过**（`.claude/CLAUDE.md` 硬性规则 1-2）：禁止无文档改代码、禁止先写代码再补文档。每次改动代码前必须说明所依据的文档路径，完成后对照文档验收，并检查是否涉及已存在的测试用例（TDD）。
2. **执行顺序固定**（`.claude/CLAUDE.md` 执行顺序）：`文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收 → 更新文档`。backend pytest 配置 `testpaths = ["tests","app"]`、`python_files = ["test_*.py"]`、`asyncio_mode = "auto"`。
3. **流程分两条**（硬性规则 3-4）：新功能 / 大改动走完整链路 `sillyspec run brainstorm → plan → execute → verify`；小修复 / 小调整走 `sillyspec run quick`。不要为新功能跳过 brainstorm 直接 execute。
4. **中文优先**（硬性规则 10）：UI 和文档尽量使用中文展示，仅特殊专业术语保留原文。commit message subject 也以中文为主。
5. **数据可清空**（硬性规则 7）：项目未正式上线，无需考虑版本迭代兼容，schema / migration 可直接重置。
6. **提交流程被 hook 拦截时禁止跳过**（硬性规则 9）：必须解决问题再提交，不得用 `--no-verify` 绕过。
7. **回答风格**（硬性规则 8）：禁止阿谀奉承式回复（如"你说得对"）。
8. **调用已有方法前先 grep 确认存在，不许编造**（`AGENTS.md` §SillySpec 规范段，呼应 memory「后端改完必实测 API」教训）。

## 代码风格

### backend（Python 3.12，`backend/pyproject.toml`）

- **工具链**：ruff（format + lint）+ mypy。依赖 `ruff>=0.6`、`mypy>=1.11`。
- **ruff**：`line-length = 100`、`target-version = "py312"`、`[tool.ruff.format] quote-style = "double"`。
- **ruff lint** `select = ["E","F","I","B","UP","N","SIM","RUF","BLE"]`；显式 ignore 一批：
  - `E501`（行长交给 formatter）
  - `N818`（异常按事件命名而非 Error 后缀）
  - `RUF001/002/003`（中文注释 / 字符串里的全角标号不报）
  - `BLE001`（async 路径常裸 catch）
  - `SIM105/SIM117`、`B008`（FastAPI Query 默认值）、`RUF012`（Pydantic 可变类属性）、`RUF006`（fire-and-forget）、`RUF005`、`UP037`。
- **per-file-ignores**：`tests/*` 与 `**/tests/*` 放宽 `N802/N803/N806/E402/B017`；`migrations/versions/*` 放宽 `UP035`。
- **mypy**：`python_version = "3.12"`，**非 strict**，启用 `warn_unused_ignores`/`warn_redundant_casts`/`ignore_missing_imports`，加载 `pydantic.mypy` 插件；大量 error_code 被 disable（attr-defined/union-attr/assignment/arg-type/valid-type/operator/call-overload/call-arg/unused-ignore 等）。即类型只做轻量守护，不追求 zero-error。
- **运行命令**：`uv run ruff format`、`uv run ruff check --fix`、`uv run mypy app`（注意 CI hook 只检查 `app`，不含 `tests`）。
- **模块组织（vertical slice）**：每个业务模块一个 `app/modules/<feature>/` 目录。典型结构含 `router.py` + `schema.py` + `model.py`（注意单数 `model.py`，部分模块还有 `services/` 子目录放拆分出的 service）。当前模块：admin/agent/archive/auth/change/change_writer/daemon/git_gateway/git_identity/health/incident/knowledge/ppm/release/runtime/scan_docs/settings/spec_profile/spec_workspace/task/tool_gateway/workflow/workspace。
- **API 契约约定**（取自 `app/modules/admin/router.py` 模式）：每个模块用 `APIRouter(prefix="/<feature>", tags=["<feature>"])`，路由显式声明 `response_model=<SchemaRead>` 或列表响应 schema，路径参数 / 查询参数用 `Path` / `Query`，依赖注入用 `Depends(...)`，状态码用 `fastapi.status`。即：**每个端点都要有显式 response_model**，不裸返回 dict。

### frontend（Next.js 14，`frontend/package.json` + `.eslintrc.json`）

- **lint**：`next lint`（`.eslintrc.json` extends `next/core-web-vitals`）。
- **eslint 规则**：`no-unused-vars` 设为 `warn`，`argsIgnorePattern`/`varsIgnorePattern = "^_"`（下划线前缀变量 / 参数允许未使用）。
- **typecheck**：`tsc --noEmit`；**测试**：`vitest run`（watch：`vitest`）；E2E 用 Playwright `^1.60.0`。
- **路径别名**：`tsconfig.json` 配置 `paths`，源码以 `@/` 引用。
- **目录约定**：共享 UI 组件放 `src/components/`，shadcn 组件放 `src/components/ui/`；API 调用统一走 `src/lib/api.ts`；全局状态用 Zustand（`src/stores/`），服务端状态用 TanStack Query。
- **包管理 / 引擎**：`packageManager: pnpm@9.6.0`，`engines.node >= 20.0.0`，eslint `8.57.0` + eslint-config-next `14.2.5`。

### sillyhub-daemon（Node ≥ 20，ESM，`sillyhub-daemon/package.json`）

- `"type": "module"`（纯 ESM）；**无独立 `lint` script，无 eslint 配置文件**——类型与正确性靠 `tsc --noEmit` typecheck 守护，测试 `vitest run --passWithNoTests`。
- `packageManager: pnpm@9.6.0`，`engines.node >= 20`。
- `pnpm.overrides` 将 claude-agent-sdk 各平台二进制统一重定向到 `@anthropic-ai/claude-agent-sdk@0.3.181`。
- **HTTP 通信用 Node 20 原生 `fetch`**（零 HTTP 库依赖，设计 G-05，对齐 Python httpx `trust_env=False`）。

## 提交规范

### 双层 hook 拦截（关键陷阱区）

- **第一层：claude `PreToolUse` hook**（`.claude/settings.json`）：matcher `Bash`，当命令匹配 `Bash(git commit*)` 或 `Bash(git push*)` 时触发 `node .claude/hooks/pre-commit-ci-check.cjs`（timeout 300s）。该脚本实际执行：
  - `backend: ruff check` → `uv run ruff check .`
  - `backend: ruff format` → `uv run ruff format --check .`
  - `backend: mypy` → `uv run mypy app`
  - （plus frontend 相关检查）
- **第二层：git 层 ruff 拦截**（来源不明但确实生效，见 memory `commit-backend-ruff-hook`）：`.git/hooks/` 下**只有 `.sample` 样板，无生效的 `pre-commit`**，`core.hooksPath` 指向默认 `.git/hooks`，仓库内也查不到 `.pre-commit-config.yaml`（仅 `backend/.pre-commit-config.yaml`，但根 git 未安装 pre-commit 工具）。尽管如此，根 `git commit` 仍会被一个 "Local CI checks" hook 跑 backend `ruff format` 拦截（报 `Local CI checks failed: backend: ruff format`），来源疑似全局或工具注入。

### 已知陷阱（来自项目 memory，必读）

- **复合命令绕过 claude 层**：claude 层按命令**前缀**匹配 `Bash(git commit*)`，因此 `git add ... && git commit ...` 这类复合命令以 `git add` 开头会绕过 claude 的 mypy / frontend 全量检查，仅剩 git 层 ruff。要跑全量检查须**单独执行** `git commit`。
- **正常提交被 ruff format 拦**：宿主机无系统级 ruff，提交前须用 `backend/.venv/bin/ruff format <staged py>` 先格式化，再重新 `git add` 受影响文件再 commit（format 是幂等的，可对 staged py 一次性全跑）。纯 TS / frontend 提交不触发 git 层 ruff hook。
- **cherry-pick / worktree 绕过 hook**：`git -C <worktree> commit` + cherry-pick 不触发 hook，可能让未格式化代码进入 main，首次正常 commit 才暴露。

### commit message 风格（取自最近 git log，`source_commit = ba87eec`）

- **Conventional Commits**：`<type>(<scope>): <subject>`。
- **常用 type**：`fix` / `feat` / `refactor` / `style` / `chore` / `docs`。
- **scope 多为子域**：`ppm` / `daemon` / `agent-run` / `auth` / `spec-transport` / `frontend` / `spec`。
- **subject 中文为主**，可含破折号 / 逗号补充细节（如 `fix(daemon): /sessions/{id}/end 端点 daemon 身份改用 runtime 归属校验修复 notifySessionEnd 404`）。
- 工具升级类用 `chore: ...（...同步）` 括注影响范围。

## 目录约定

| 路径 | 说明 |
|---|---|
| `.claude/CLAUDE.md` | 项目级硬性规则与执行顺序（本扫描文档的主要来源） |
| `.claude/settings.json` | claude `PreToolUse` hook 配置（commit / push CI gate） |
| `.claude/hooks/pre-commit-ci-check.cjs` | claude 层 CI 检查脚本（ruff + mypy + frontend） |
| `AGENTS.md` | 含 SillySpec 规范驱动开发章节（禁止编造方法等） |
| `.sillyspec/changes/<change>/` | SillySpec 变更工作区（proposal / design / plan / tasks / progress） |
| `.sillyspec/docs/<project>/scan/` | 扫描文档（本文件所在位置） |
| `docs/` | 项目级设计文档（agent-loop、change-center、execution-plan、qa/、sillyhub_refs/ 等） |
| `backend/` | FastAPI 应用（`app/modules/` vertical slice + `tests/` + `migrations/versions/` + `pyproject.toml` + `.pre-commit-config.yaml`） |
| `frontend/` | Next.js 14 应用（`src/components/`、`src/lib/api.ts`、`src/stores/`） |
| `sillyhub-daemon/` | Node ESM daemon（原生 fetch 通信） |

## API 契约与跨组件约定

- **后端端点契约**：每个 `@router.{method}` 必须声明 `response_model`，入参用 `Path`/`Query`/Pydantic body，鉴权 / 公共依赖用 `Depends(...)`，状态码用 `fastapi.status` 常量。
- **daemon → backend 通信**：daemon 侧用 Node 20 原生 `fetch`，后端侧 httpx `trust_env=False`（设计 G-05，两端都不读系统代理环境变量，避免误走代理）。
- **改后端必实测 API**（memory 教训）：后端代码改动后必须 `curl` 实测端点 + grep 确认 import 在当前文件，不要只靠 tsc / 静态检查；曾因未 import 的 `UTC` 符号致 API 500、看板空白。
- **Docker 后端不热重载**（memory 教训）：backend 容器挂载 `/host-projects` 而非 `/app`、无 `--reload`，跑镜像内代码；改后端源码后 Docker 不热重载，新端点需 rebuild 镜像才能生效。
