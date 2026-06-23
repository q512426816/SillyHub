---
source_commit: ba87eec
updated_at: 2026-06-23T16:35:15Z
created_at: 2026-06-24T00:35:15
author: qinyi
generator: sillyspec-scan
---

# multi-agent-platform 代码约定

monorepo 根项目（path=`.`），含三个子项目：`backend/`（FastAPI + Python 3.12）、`frontend/`（Next.js 14 + Antd 6）、`sillyhub-daemon/`（Node ≥ 20 ESM）。本文件由 SillySpec scan 子代理基于 `.claude/CLAUDE.md`、`.sillyspec/.runtime/local.yaml` 及各子项目配置扫描生成，作为后续变更/生成的输入参考。所有命令均可在 `local.yaml` 的 `commands` 段查证。

## 框架隐形规则

源自 `.claude/CLAUDE.md`（项目硬性规则，不可跳过）：

1. **文档驱动开发是硬性规则**：禁止无文档改代码、禁止先写代码再补文档。每次改代码前必须说明所依据的文档路径，完成后对照文档验收。
2. **执行顺序固定 7 步**：`文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收 → 更新文档`。
3. **流程分两条**：新功能 / 大改动走完整链路 `sillyspec run brainstorm → plan → execute → verify`（调 sillyspec 相关技能）；小修复 / 小调整走 `sillyspec run quick`。不得为新功能跳过 brainstorm 直接 execute。
4. **测试策略 TDD**：写实现前先写测试用例（CLAUDE.md「执行顺序」），验收时还要看是否涉及已存在的测试用例。后端 pytest `testpaths = ["tests", "app"]`，`python_files = ["test_*.py"]`，`asyncio_mode = "auto"`。
5. **数据可清空**：项目未正式上线，无需考虑版本迭代兼容，schema/migration 可直接重置（CLAUDE.md 规则7）。
6. **提交流程被 hook 拦截时禁止跳过**：必须解决问题再提交，禁止用 `--no-verify` 绕过（CLAUDE.md 规则9）。
7. **中文优先**：UI 和文档尽量使用中文展示，除特殊专业术语（CLAUDE.md 规则10）。回答禁止阿谀奉承（如「你说得对」类话语，CLAUDE.md 规则8）。

## 代码风格

### backend（Python 3.12，`backend/pyproject.toml`）

- **工具链**：ruff（format + lint）+ mypy + pytest。依赖 `ruff>=0.6`、`mypy>=1.11`、`pre-commit>=4.6.0`（dependency-groups dev）。
- **ruff `[tool.ruff]`**：`line-length = 100`，`target-version = "py312"`。
- **ruff lint `select`**：`["E", "F", "I", "B", "UP", "N", "SIM", "RUF", "BLE"]`。
- **ruff lint `ignore`**：`E501`（行宽交给 formatter）、`N818`（异常按事件而非 Error 后缀命名）、`RUF001/002/003`（中文注释/字符串干扰）、`BLE001`（async 常裸 except）、`SIM105/SIM117`、`B008`（FastAPI Query 默认值用函数调用）、`RUF012`（Pydantic 可变类属性）、`RUF006`（fire-and-forget asyncio task）、`RUF005`、`UP037`。
- **per-file-ignores**：`"tests/*"` 与 `"**/tests/*"` 放宽 `N802/N803/N806/E402/B017`；`"migrations/versions/*"` 放宽 `UP035`（alembic 模板用 `typing.Sequence`）。
- **ruff format**：`quote-style = "double"`。
- **mypy**：`python_version = "3.12"`，非 strict；`warn_unused_ignores`/`warn_redundant_casts`/`ignore_missing_imports = true`；`plugins = ["pydantic.mypy"]`；`disable_error_code = ["attr-defined","union-attr","assignment","arg-type","valid-type","operator","call-overload","call-arg","unused-ignore"]`。
- **运行命令**（`local.yaml`）：`uv run ruff format`（format）、`uv run ruff check . && uv run ruff format --check . && uv run mypy app`（lint）、`uv run pytest -q --cov=app --cov-fail-under=60`（test，覆盖率门槛 60%）。
- **典型片段**（请求/响应契约）：FastAPI router 统一 `APIRouter()`，在 `app/main.py` 用 `app.include_router(<x>_router, prefix="/api")` 挂载；Pydantic `BaseModel` + `Field(...)` 定义 schema，异常按事件命名（受 N818 ignore 支持）。

### frontend（Next.js 14，`frontend/package.json` + `.eslintrc.json`）

- **lint**：`next lint`（`.eslintrc.json` extends `next/core-web-vitals`）。依赖固定 `eslint@8.57.0` + `eslint-config-next@14.2.5`。
- **规则**：`no-unused-vars: warn`，`argsIgnorePattern`/`varsIgnorePattern = "^_"`（下划线前缀变量/参数允许未使用）。
- **typecheck**：`tsc --noEmit`（script `typecheck`）。
- **test**：`vitest run`（devDep `vitest@^2.0.0`，配 `@testing-library/react@^16`、`@playwright/test@^1.60`）。
- **engines/packageManager**：`node >= 20.0.0`，`pnpm@9.6.0`。
- **build**：`next build`；dev：`next dev`。

### sillyhub-daemon（Node ≥ 20，ESM，`sillyhub-daemon/package.json`）

- **模块系统**：`"type": "module"`（顶层），bin `sillyhub-daemon: ./dist/cli.js`。
- **无独立 eslint**：`package.json` 未声明 `lint` script，无 `.eslintrc*` 配置文件；正确性靠 `tsc --noEmit`（script `typecheck`）守护，构建靠 `tsc`（script `build`）。
- **test**：`vitest run --passWithNoTests`（script `test`），watch：`vitest`（script `test:watch`）。
- **engines/packageManager**：`node >= 20.0.0`，`pnpm@9.6.0`。
- **pnpm overrides**：将 `@anthropic-ai/claude-agent-sdk` 各平台二进制（win32/linux × x64/arm64）统一重定向到 `npm:@anthropic-ai/claude-agent-sdk@0.3.181`，避免多平台可选依赖冲突。核心依赖：`@anthropic-ai/claude-agent-sdk@0.3.181`、`commander@^12`、`ws@^8.18`。

## 提交规范

### 双层 hook 拦截

1. **claude `PreToolUse`**（`.claude/settings.json`）：matcher `Bash`，`if: Bash(git commit*)` / `Bash(git push*)` 触发 `node .claude/hooks/pre-commit-ci-check.cjs`（跑全量 mypy + frontend 检查，timeout 300s）。
2. **git `pre-commit`**（`.git/hooks/pre-commit` → `backend/.pre-commit-config.yaml`）：执行 `uv run ruff format` + `uv run ruff check --fix`。

### commit message 风格（取自最近 git log）

Conventional Commits，`<type>(<scope>): <subject>`，subject 中文为主：
- type：`fix` / `feat` / `refactor` / `style` / `chore`。
- scope：子域，如 `agent-run` / `ppm` / `frontend` / `daemon` / `spec`。
- 示例：`fix(daemon): /sessions/{id}/end 端点 daemon 身份改用 runtime 归属校验修复 notifySessionEnd 404`、`feat(ppm): 列表页统一默认查 20 条`、`chore: sillyspec 工具升级 3.18.6 → 3.19.1`。
- 复杂提交用 `Merge sillyspec/<date>-<change>: ...` 格式合入 SillySpec 变更分支。
- 协作者尾注（仅主仓库历史，非硬性）：`Co-Authored-By: Claude <noreply@anthropic.com>`。

## 组件间 API 契约约定

- **REST 统一前缀 `/api`**：backend 所有 router 在 `app/main.py` 通过 `app.include_router(<x>_router, prefix="/api")` 挂载（health/workspace/members/auth/change/scan-docs/task/git-identity/agent/daemon/worktree/lease/git-gateway/change-writer/workflow/incident 等），前端与 daemon 均打 `/api/...`。
- **schema 定义**：请求/响应用 Pydantic v2 `BaseModel` + `Field(...)`；路径/查询参数用 FastAPI `Query(...)` 默认值（受 ruff `B008` ignore 支持）。
- **daemon ↔ backend**：REST + WebSocket（`ws@^8.18`）；session 运行态、turn 事件走 WS 推送，CRUD 走 REST。
- **transport 抽象**：spec 文档在 daemon 与 backend 间同步模式由全局开关 `SPEC_TRANSPORT`（`shared|tar`，默认 `shared`）决定，正交于 `SpecWorkspace.strategy`、不入库（纯运行时），backend `Settings.spec_transport` + `field_validator` 规范化。
  - `shared`：同机 Docker bind mount 共享物理盘（`SPEC_DATA_HOST_DIR` ↔ 容器 `/data/spec-workspaces`）。
  - `tar`：异机无共享盘时，daemon 本地缓存 `~/.sillyhub/daemon/specs/{ws}`，session 终态 `postSpecSync` 整树 tar 回传 backend 权威源 `/data/{ws}`（`apply_sync` 整树覆盖）。

## 构建命令（`local.yaml` commands 段）

| 用途 | 命令 |
|---|---|
| backend 安装 | `cd backend && uv sync --all-extras` |
| backend 运行 | `cd backend && uv run uvicorn app.main:app --reload --port 8000` |
| backend 测试 | `cd backend && uv run pytest -q --cov=app --cov-fail-under=60` |
| backend lint | `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app` |
| backend 格式化 | `cd backend && uv run ruff format . && uv run ruff check . --fix` |
| backend 迁移 | `cd backend && uv run alembic upgrade head` |
| frontend 安装 | `cd frontend && pnpm install` |
| frontend 运行 | `cd frontend && pnpm dev` |
| frontend 测试 | `cd frontend && pnpm test`（=`vitest run`） |
| frontend lint | `cd frontend && pnpm lint`（=`next lint`） |
| frontend typecheck | `cd frontend && pnpm typecheck`（=`tsc --noEmit`） |
| dev 起 docker | `docker compose -f deploy/docker-compose.dev.yml up -d` |
| 统一 test/lint | `make test` / `make lint` |

`test_strategy: module`（默认只测变更模块）。

## 目录约定

- `.claude/CLAUDE.md`：项目级硬性规则与执行顺序（本扫描文档主要来源）。
- `.claude/settings.json`：claude `PreToolUse` hook 配置（CI gate）。
- `.claude/hooks/pre-commit-ci-check.cjs`：claude 层 CI 检查脚本。
- `.sillyspec/.runtime/local.yaml`：SillySpec 本地配置（构建/测试/lint 命令 + 模块路径映射）。
- `.sillyspec/changes/<change>/`：SillySpec 变更工作区（proposal/design/plan/tasks/progress）。
- `.sillyspec/docs/<project>/scan/`：扫描文档（本文件所在位置）。
- `backend/`：FastAPI 应用（`app/` + `tests/` + `migrations/versions/` + `pyproject.toml` + `.pre-commit-config.yaml`）。`module_paths.backend = "backend/"`。
- `frontend/`：Next.js 14 应用。`module_paths.frontend = "frontend/"`。
- `sillyhub-daemon/`：Node ESM daemon（`src/` 编译到 `dist/`）。
- `deploy/`：docker-compose（`docker-compose.yml` 生产、`docker-compose.dev.yml` 开发）。`module_paths.deploy = "deploy/"`。

## 已知陷阱

- **复合 git 命令绕过 claude 层 hook**：claude 层按前缀匹配 `Bash(git commit*)`，`git add ... && git commit ...` 以 `git add` 开头会绕过 claude 层 mypy/frontend 检查，仅触发 git 层 ruff。要跑全量检查须单独执行 `git commit`。
- **cherry-pick / worktree commit 不触发 pre-commit hook**：`git -C <worktree> commit` + cherry-pick 不触发 Local CI hook，未格式化代码可能进主分支，首次正常 commit 时才暴露 ruff format 失败。
- **claude.exe 孤儿进程**：清理时禁止 `taskkill /IM` 通杀（会杀掉当前会话自身），须按 PID 精确终止并排除当前会话 PID。
- **daemon 多实例**：本机可能并存「连本地」（`daemon-start.bat`）与「连远程」（手动 cmd）两类 daemon；停止时须按 `--server` 区分，避免误杀，无自动拉起机制。
- **Docker 后端不热重载**：backend 容器挂载 `/host-projects` 而非 `/app`、无 `--reload`，跑镜像内代码；改后端源码后须 rebuild 镜像，curl 实测新端点（405≠401）确认生效。
- **Docker frontend healthcheck 误报**：busybox wget 走 Docker 注入的 `http_proxy`、忽略 `no_proxy`，容器 unhealthy 是探针误报，服务实际正常。
- **后端改完必实测 API**：曾出现 import 了未导入的 UTC 致 API 500 看板空；后端改完 curl 实测端点 + grep 确认 import 在当前文件，别只跑 tsc。
