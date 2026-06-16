---
id: task-10
title: backend `uv run pytest` 全过；frontend `pnpm lint && pnpm build` 全过
priority: P0
estimated_hours: 1
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09]
blocks: [task-11]
allowed_paths: []
---

# Task-10 — backend pytest + frontend lint/build 验收 gate

## 1. 目标

本任务是 **Wave 5 验收 gate**：在 task-01..09 全部实现完成之后，统一在 backend/ 与 frontend/ 跑全套质量门禁，确认：

- **后端**：`uv run pytest` 全过（含 task-05 新增的 ≥15 个 `test_members_router.py` 用例 + 现有 ~1081 个用例无回归）
- **前端**：`pnpm lint && pnpm tsc --noEmit && pnpm build` 全过（task-06..09 新增的 5 个文件不引入 lint/类型错误，现有页面不回归）

依据文档：

- `plan.md` §任务列表 task-10：「backend `uv run pytest` 全过；frontend `pnpm lint && pnpm build` 全过」
- `plan.md` §验收标准 第 1-2 条：「backend pytest 全过（≥15 新增用例 + 现有 1081 用例不回归）」「frontend `pnpm lint` 无新增错误，`pnpm build` 成功」
- `requirements.md` FR-01..08：每个 GWT 用例的最终落点都在 `test_members_router.py` 或前端构建产物中
- `.github/workflows/backend-ci.yml` 第 37-52 行：CI 跑 `ruff check` / `ruff format --check` / `mypy app` / `pytest -q --cov=app --cov-fail-under=60`
- `.github/workflows/frontend-ci.yml` 第 39-51 行：CI 跑 `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build`

**本任务严格只跑命令、记录结果，不做任何实现修复**。任何失败必须回到对应的 task-N.md 修复后重新进入 task-10 复跑。

## 2. 修改文件

**本任务不修改任何文件**（`allowed_paths: []`）。

- 不写代码、不写测试、不改配置
- 如 pytest / lint / build 失败，必须**回到对应 task-N.md**（task-01..09）按其验收标准修复，不能在 task-10 内 hot-fix
- 例外：若失败是**已存在的回归 bug**（与本变更无关，main 分支本来就有），记录在 task-10 的"运行记录"节并报告给上层，不在 task-10 修

## 3. 实现要求

### 3.1 后端 — 在 `backend/` 跑 pytest

```bash
cd backend
uv run pytest -x --tb=short
```

- **`-x`**：首个失败即停止（避免雪崩输出刷屏；定位首个回归用例即可）
- **`--tb=short`**：traceback 只保留关键帧，便于快速判断是哪个 task 的实现问题
- **`-q` 备选**：CI 用 `-q --cov=app --cov-fail-under=60`，本任务本地复跑时可省略 `--cov`（不强制 coverage，避免 coverage fail-under 噪音干扰首次验收）；最终提交前再补一次 `-q --cov=app --cov-fail-under=60` 确认 CI 等价

### 3.2 前端 — 在 `frontend/` 跑 lint + typecheck + build

```bash
cd frontend
pnpm lint && pnpm tsc --noEmit && pnpm build
```

- **`pnpm lint`**：等价 `next lint`，跑 ESLint（eslint-config-next 14.2.5 默认规则集 + 自定义 rules）；预期 0 error
- **`pnpm tsc --noEmit`**：等价 `pnpm typecheck`，跑 TypeScript 编译器仅类型检查不产出；预期 0 error（task-06 API client 函数签名 + task-07 对话框 props + task-09 表格类型必须正确）
- **`pnpm build`**：等价 `next build`，跑 Next.js 生产构建（含 ESLint + 类型检查 + 静态分析 + chunk split）；预期 build success，`.next/` 产物正常生成

> **三步必须串联 `&&`**：lint 失败立即停（避免 typecheck / build 在脏 lint 状态下输出错误干扰判断）。

### 3.3 失败处理流程（**严格遵守**）

1. 在 task-10 内**只记录**：失败的命令、失败的用例名 / 文件:行号、错误类型（assert / ImportError / TypeError / lint rule id / TS error code）
2. 把失败归类到对应 task：
   - pytest `test_members_router.py::test_xxx` 失败 → **回到 task-05**（test 实现）或 **task-02**（service 实现）或 **task-03**（router 实现）
   - pytest `test_members_router.py` 用例报 schema 校验错 → **回到 task-01**（schema 实现）
   - pytest collect error `ImportError: cannot import name 'members_router'` → **回到 task-04**（router 装载）
   - frontend tsc 报 `lib/workspace-members.ts` 类型错 → **回到 task-06**
   - frontend tsc 报 `components/workspace-member-add-dialog.tsx` 类型错 → **回到 task-07**
   - frontend build 报 `app/(dashboard)/workspaces/[id]/layout.tsx` 或 `components/workspace-tabs.tsx` 错 → **回到 task-08**
   - frontend build 报 `app/(dashboard)/workspaces/[id]/members/page.tsx` 错 → **回到 task-09**
3. 修复后**重新**回到 task-10 从 §3.1 / §3.2 第一步复跑（**禁止**只跑失败的子集，因为修复可能引入新回归）

### 3.4 运行环境前置（**复跑前确认**）

- 后端：`uv sync --all-extras` 已执行（dev 依赖 pytest / pytest-asyncio / aiosqlite / ruff / mypy 已装）；Python 3.12
- 前端：`pnpm install --frozen-lockfile` 已执行（lockfile 未漂移）；Node ≥20
- 后端 conftest.py 第 25-36 行已注入 test env vars（`DATABASE_URL` / `REDIS_URL` / `SECRET_KEY` / `ENVIRONMENT=test` / `SPEC_DATA_ROOT` / `SILLYSPEC_MASTER_KEY`），**无需手动 export**；DB 用 SQLite `:memory:`，**不需要**起 Postgres/Redis

## 4. 接口定义

本任务是 CLI 命令验收 gate，无代码接口。**期望退出码全部 = 0**：

| 命令 | 工作目录 | 期望退出码 | 失败归类 |
|------|----------|-----------|----------|
| `uv run pytest -x --tb=short` | `backend/` | `0` | task-01..05 |
| `uv run ruff check .` | `backend/` | `0`（可选，CI 必跑） | task-01..05（lint fail） |
| `uv run ruff format --check .` | `backend/` | `0`（可选，CI 必跑） | task-01..05（format fail） |
| `uv run mypy app` | `backend/` | `0`（可选，CI 必跑） | task-01..05（type fail） |
| `pnpm lint` | `frontend/` | `0` | task-06..09 |
| `pnpm tsc --noEmit` | `frontend/` | `0` | task-06..09 |
| `pnpm build` | `frontend/` | `0` | task-06..09 |

> **CI 等价性**：本任务本地命令 = CI workflow 跑的命令子集。task-10 通过后，`.github/workflows/backend-ci.yml` + `frontend-ci.yml` push 触发应同样通过（task-12 提交后由 GitHub Actions 复核）。

## 5. 边界处理

1. **pytest 因 SQLite 不支持 ILIKE 报错**（`sqlalchemy.exc.OperationalError: no such function: ILIKE` 或 `NotImplementedError`）：常见于 `members_service.search_users_for_invite` 写了 `User.email.ilike(...)`，SQLite 不支持 ILIKE。**处理**：回到 **task-05** 把测试期望改为不依赖 ILIKE，或回到 **task-02** service 实现改用 `func.lower(User.email).like(func.lower(f"%{q}%"))` 兼容 SQLite（**禁止**在 task-10 直接改 service / test 代码）。判定方法：失败用例名含 `search` / `test_search_users`。

2. **pre-commit hook 报 ruff 修复需求**（`ruff check` 或 `ruff format --check` 失败，提示 `[Errno 2] No such file` 或 `would reformat`）：**处理**：本任务**不允许**直接 `ruff check --fix`，因为 `allowed_paths: []`；必须把命令执行权交回对应 task-N.md（task-01..05 范围内的 backend 文件，由该 task 重新跑 `uv run ruff check --fix app tests && uv run ruff format app tests`）。若 hook 在 task-12 提交阶段才触发，按 task-12 流程处理（不在 task-10 修）。

3. **frontend lint 报 `@typescript-eslint/no-unused-vars` / `react/no-unescaped-entities`**（task-06 API client 中导出了但 page.tsx 未用的函数，或 task-07 对话框 JSX 含未转义引号）：**处理**：回到 **task-06**（unused export）或 **task-07**（unescaped entities），按其验收标准清理 import 或加 `{"\""}` 转义。**禁止**在 task-10 内改 frontend 代码。

4. **frontend tsc 报 `error TS2532: Object is possibly 'undefined'` 或 `error TS2322: Type 'X' is not assignable to type 'Y'`**（task-06 API client 返回类型与 backend schema 不一致，或 task-09 表格 row 类型与 API 响应不匹配）：**处理**：回到 **task-06**（client 函数签名修正，与 design.md §5.1 Pydantic schema 字段 1:1）或 **task-09**（page.tsx 内 `members: WorkspaceMemberView[]` 类型修正）。**禁止**在 task-10 内 `// @ts-ignore` 绕过。

5. **pytest collect error：`ImportError: cannot import name 'WorkspaceMemberView' from 'app.modules.workspace.schema'`**：task-01 schema 未实现或命名与 task-02/03/05 引用不一致。**处理**：回到 **task-01**（按 design.md §5.1 字段名 + 类名严格对齐），重跑 task-05。

6. **frontend build 报 `Module not found: Can't resolve '@/components/workspace-tabs'`**：task-08 文件未创建或路径错。**处理**：回到 **task-08**，按其 §2 文件清单核对 `frontend/src/components/workspace-tabs.tsx` 存在且 export `WorkspaceTabs`。

7. **pytest 报 `assert 403 == 200` 等权限断言失败**（task-05 测试期望 admin 可访问，实际 403）：可能是 task-03 router 未正确挂 `require_permission_any(Permission.WORKSPACE_MEMBER_MANAGE)`，或 task-02 service 内的权限检查写错。**处理**：回到 **task-03**（router 装饰器）或 **task-02**（service 权限分支）。

8. **回归用例失败（与本变更无关的旧用例挂了）**：例如 `test_auth_login` / `test_workspace_crud` 失败。**处理**：先 `git stash` 当前改动跑一次 baseline，确认 main 分支本就失败 → 记录为 **既有 bug**，报告给上层不在 task-10 修；若 main baseline 通过而本变更引入回归 → 二分 task-01..09 找出引入方，回到对应 task 修。

## 6. 非目标

- **不做 e2e**（Playwright / Puppeteer / 浏览器手测）：归 task-11
- **不做 Docker 部署**（compose build / 容器内健康检查）：归 task-11
- **不写新测试**：本任务只跑现有测试，不新增 `test_*.py`
- **不写新代码**：`allowed_paths: []`，禁止动任何源码 / 配置 / lockfile
- **不跑 coverage 强制门槛**：本地复跑用 `-x --tb=short` 不带 `--cov-fail-under`；最终提交前补一次 `--cov-fail-under=60`（CI 等价）但失败仍回到对应 task-N 修，不在 task-10 调阈值
- **不跑 mypy 强制门槛**：task-10 默认不跑 mypy（pyproject.toml 第 58 行已 disable 多个 error code，宽松配置）；CI 必跑但本任务可选，失败回到 task-01..05
- **不跑 frontend vitest**（`pnpm test`）：design.md §3 非目标声明前端依赖 e2e 手测，本变更不引入 vitest 用例；CI workflow 跑 vitest 但当前应 0 用例（无新增），如有失败记录即可
- **不修 lockfile**：`pnpm-lock.yaml` / `uv.lock` 不动；如缺依赖由对应 task-N 加

## 7. 参考

- **CI 配置**：
  - `.github/workflows/backend-ci.yml`（第 37-52 行 ruff / mypy / pytest 命令）
  - `.github/workflows/frontend-ci.yml`（第 39-51 行 lint / typecheck / test / build 命令）
- **后端测试配置**：
  - `backend/pyproject.toml` 第 44-49 行：`[tool.pytest.ini_options]` async mode auto、testpaths=`["tests", "app"]`
  - `backend/conftest.py`：注入 SQLite `:memory:` engine、auth_admin_token / auth_headers fixture、env vars 默认值（无需手动 export）
- **前端测试配置**：
  - `frontend/package.json` scripts：`lint` / `typecheck` / `test` / `build`
  - `frontend/tsconfig.json`（严格模式，task-06..09 类型必须自洽）
- **依赖任务**：task-01..09 的验收标准（每个 task 的 §9 验收表格）
- **plan.md 验收标准**：§验收标准 第 1-2 条

## 8. TDD 步骤

**N/A** — 本任务是验收 gate，不是 TDD 实现任务。无 Red-Green-Refactor 循环。

替代的"运行-记录-分流"循环：

1. **Run**：按 §3.1 / §3.2 跑命令
2. **Record**：在下方 §10 运行记录表填入命令、退出码、失败摘要
3. **Triage**：按 §3.3 / §5 把失败分流到 task-N
4. **Loop**：task-N 修复后回到 step 1 重跑（直到所有命令退出码 = 0）

## 9. 验收标准

| 编号 | 检查项 | 通过条件 |
|------|--------|----------|
| AC-1 | backend pytest 全过 | `cd backend && uv run pytest -x --tb=short` 退出码 = 0；输出 `=== X passed in Ys ===`，X ≥ 1096（现有 ~1081 + task-05 新增 ≥15） |
| AC-2 | backend pytest 无回归 | 失败用例**全部**来自 task-05 新增的 `test_members_router.py`（即"现有 1081 用例 0 回归"）；任何现有用例失败 = 不通过 |
| AC-3 | frontend lint 0 error | `cd frontend && pnpm lint` 退出码 = 0；输出 `✔ No ESLint warnings or errors` 或等价；允许 warning（design.md 未禁 warning）但禁止 error |
| AC-4 | frontend tsc 0 error | `cd frontend && pnpm tsc --noEmit` 退出码 = 0；输出无 `error TSxxxx`；task-06 API client 函数签名 + task-07/09 组件 props 类型自洽 |
| AC-5 | frontend build success | `cd frontend && pnpm build` 退出码 = 0；输出 `✓ Compiled successfully` + `✓ Generating static pages`；`.next/BUILD_ID` 生成；新增的 `/workspaces/[id]/members` 路由出现在 route清单 |
| AC-6 | coverage 不强制 | 本任务**不**因 `--cov-fail-under=60` 失败而 fail；最终提交前补跑一次确认 CI 等价（记录到 §10），但 coverage 数值本身不是 task-10 通过条件 |
| AC-7 | 失败分流正确 | 任何失败都**回到对应 task-N.md** 修复并在该 task 的验收记录中说明；task-10 内 git diff = 空（`allowed_paths: []`） |
| AC-8 | 运行记录完整 | §10 表格填满：每条命令的退出码、用时、失败摘要（若有）；最终一次全绿 run 的完整 stdout 摘要贴入 |

## 10. 运行记录（执行时填入）

| # | 命令 | 工作目录 | 退出码 | 用时 | 结果摘要 / 失败归类 |
|---|------|----------|--------|------|---------------------|
| 1 | `uv run pytest -x --tb=short` | `backend/` | _待填_ | _待填_ | _待填_ |
| 2 | `uv run ruff check .`（可选） | `backend/` | _待填_ | _待填_ | _待填_ |
| 3 | `uv run ruff format --check .`（可选） | `backend/` | _待填_ | _待填_ | _待填_ |
| 4 | `uv run mypy app`（可选） | `backend/` | _待填_ | _待填_ | _待填_ |
| 5 | `pnpm lint` | `frontend/` | _待填_ | _待填_ | _待填_ |
| 6 | `pnpm tsc --noEmit` | `frontend/` | _待填_ | _待填_ | _待填_ |
| 7 | `pnpm build` | `frontend/` | _待填_ | _待填_ | _待填_ |
| 8 | `uv run pytest -q --cov=app --cov-fail-under=60`（CI 等价，最终复跑） | `backend/` | _待填_ | _待填_ | _待填_ |

## 11. 风险与回滚

- **风险 R-1**：pytest collect error 导致 0 用例运行（exit 0 但实际没跑）→ 误判通过。**缓解**：AC-1 显式要求 `X ≥ 1096`，0 passed 不满足；另外用 `uv run pytest --collect-only | wc -l` 抽查用例数 ≥ 1096。
- **风险 R-2**：frontend build 因 Next.js cache 陈旧报错（`.next/cache` 内 stale）。**缓解**：复跑前 `rm -rf frontend/.next` 清缓存重 build。
- **风险 R-3**：pnpm / uv 全局版本不对（CI 用 pnpm 9.6.0 + uv 0.4.18，本地可能装了更新版）。**缓解**：`package.json` 第 50 行 `packageManager: "pnpm@9.6.0"` corepack 自动切版本；uv 用 `.python-version` 锁 3.12。
- **风险 R-4**：测试用例在 Windows（本机 win32）跑过但在 CI（ubuntu）跑挂（路径分隔符 / 行尾 / 文件权限差异）。**缓解**：task-10 本地通过后，task-12 提交 → GitHub Actions 复核；若 CI 挂，回到对应 task-N 修（不在 task-10 修）。
- **回滚**：本任务不产生代码改动，无回滚成本。失败的 task-N 各自有自己的回滚策略（见各 task 的 §10）。
