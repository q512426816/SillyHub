---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 代码约定（Conventions）

本文件记录 SillyHub（backend / frontend / sillyhub-daemon 三端 + 仓库级工程约定）在框架之上、违反就会出错或被 review 打回的隐形规则与统一代码风格。所有条目均给出源码或配置定位作为证据（基于 744e3de4 全量重扫逐条核实）。

## 框架隐形规则

### 仓库级（SillySpec 流程与平台横切）

1. **所有变更走 SillySpec 文档驱动流程，改代码前必须先说明依据**。新功能 / 大改动走完整流程（brainstorm → plan → execute → verify → archive），≤3 文件小改动走 quick；代码先行的不回头补流程，用 `quick --done` + quicklog 条目收尾；quicklog 由 CLI 写骨架、`--done` 后手动精修。依据：根 `CLAUDE.md` 核心规则 1/3/4/7/15；`.claude/CLAUDE.md` 规则 2/3/4。
2. **SillySpec CLI 一律在主仓库根目录跑，永不 `cd` 进 worktree/子目录**——`cd` 会让 sillyspec 把当前目录当成独立项目实例，写出分裂的进度库 / artifact / QUICKLOG。依据：根 `CLAUDE.md` 规则 22。
3. **代码必须兼容 Windows / Linux / macOS**（路径分隔、换行、并发都要顾）。依据：根 `CLAUDE.md` 规则 13；`Makefile:2` 头注释 "All commands are designed to work on Linux / macOS and on Windows via Git Bash"。
4. **UI 与文档默认中文**（面向用户的文案、注释、错误提示用中文，专业术语除外）。依据：`.claude/CLAUDE.md` 规则 12；后端 ruff 显式 ignore `RUF001/002/003`（中文标点/全角歧义，`backend/pyproject.toml:94` 注释 "project uses Chinese text"）。
5. **前端样式统一参考设计系统**：改任何页面照 `.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md`（页面级实现规范），总纲见 `.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/` 下的 prototype 与 design.md。依据：根 `CLAUDE.md` 规则 20。

### 类型与数据契约

6. **前端 API 类型一律由 `pnpm gen:types` 从后端 OpenAPI 自动生成，禁止手写同名接口**。`frontend/src/lib/api-types.ts` 由 `scripts/gen-api-types.mjs` 产出，漂移由 `gen:types:check`（`git diff --exit-code src/lib/api-types.ts`）在 CI 守护；后端 schema 改动后同 change 内必须重生成并提交 `api-types.ts` + `backend/openapi.json`。daemon 同理：`sillyhub-daemon/src/api-types.ts` 由同一机制生成（`gen:types:check` 对 `src/api-types.ts`）。依据：`frontend/package.json:13-14`、`sillyhub-daemon/package.json` scripts 段（gen:types / gen:types:check）；根 `CLAUDE.md` 规则 21。
7. **后端面向用户的报错文案必须中文化，且有守护测试把关**。`backend/tests/core/test_error_message_l10n.py` 用 AST 扫描 `app/modules/` 下所有 router/service 及用户链路 core 文件，断言 `raise SomeError("…")` / `HTTPException(detail="…")` 的字面量与 f-string 常量段必含 CJK 字符；机器对机器链路（platform_sync / mcp_gateway / daemon 内部 RPC / storage）在排除清单，合法英文个案登记 `ALLOWED_ENGLISH`。新增用户链路报错若写纯英文会直接挂测试。依据：`backend/tests/core/test_error_message_l10n.py:1-50`（docstring 策略）。
8. **前端 `Date.toLocaleString()` 必须显式传 `"zh-CN"`**——不传则依赖运行环境 locale，开发机 zh-CN 过、CI en-US 红（Windows Node 忽略 LANG，本地无法复现）。全仓日期格式化已清零此债，新代码照此惯例。依据：`frontend/src/components/change-file-tree.tsx`、`frontend/src/components/workspace-card.tsx`、`frontend/src/components/changes/detail/change-stage-header.tsx` 等 15+ 文件均为 `toLocaleString("zh-CN", …)` 写法。

### 后端

9. **模块按 `router / service / model / schema` 四文件分层，service 在请求内实例化**。路由不在模块级 new service，而是在每个请求处理函数内 `svc = XxxService(session)` 注入会话。依据：`backend/app/modules/incident/` 目录（router.py / service.py / model.py / schema.py）；`backend/app/modules/incident/router.py:24`（`router = APIRouter(tags=["incidents"])`）、`:26`（`SessionDep = Annotated[AsyncSession, Depends(get_session)]`）、`:40,55,69…`（每个 handler 内 `svc = IncidentService(session)`）。
10. **数据模型必须继承 `app.models.base.BaseModel`，而不是直接继承 `SQLModel`**——所有表共享同一 metadata 对象（Alembic autogenerate 扫的就是它）。依据：`backend/app/models/base.py:13-14`（`class BaseModel(SQLModel)`，注释明确 "Inherit from this — not SQLModel"）。
11. **领域错误继承 `AppError`，按“事件”命名而非 `Error` 后缀**（如 `IncidentNotFound`、`WorkspaceNotFound`）。依据：`backend/app/core/errors.py:28-38`（`class AppError(Exception)` 带 `code` / `http_status` 类属性）；ruff 显式 ignore `N818`（`backend/pyproject.toml:92-93`）。
12. **测试里禁止 `importlib.reload(app.core.config)`**——reload 会分裂出新的 Settings 类，conftest 补丁落在旧类上，spec_root 回退 pid 目录导致 reparse parsed=0、CI 大面积红（2026-08-14 起 7 run 全红的根因）。pydantic-settings 本就在实例化时读 env，`monkeypatch.setenv` 后直接 `Settings()` 即可。依据：`backend/tests/test_config.py:10-26`（docstring 记录完整事故链与替代写法）。

### daemon（Node.js）

13. **daemon 是纯 ESM：相对 import 必须带 `.js` 后缀，Node 内置模块走 `node:` 前缀**——TS 源里写 `from './cursor-version.js'`（编译后产物名），漏后缀运行时 `ERR_MODULE_NOT_FOUND`。依据：`sillyhub-daemon/package.json`（`"type": "module"`）；`sillyhub-daemon/src/cmd-shim.ts:19,21`（`from 'node:fs'` + `from './cursor-version.js'`）。
14. **MCP 工具入参一律 zod schema 校验并附 `.describe()` 给 LLM 看**。依据：`sillyhub-daemon/src/mcp-server.ts:36`（`import { z } from 'zod'`）、`:168-169`（`workspace_id: z.string().describe('Target workspace UUID')` 等）。

## 代码风格

1. **后端 lint/format：ruff**。`line-length = 100`、`target-version = "py312"`；select `E/F/I/B/UP/N/SIM/RUF/BLE`；显式 ignore 及理由见配置注释：`E501`（行长交给 formatter）、`N818`（错误按事件命名）、`RUF001/002/003`（中文文本）、`BLE001`（异步常需 catch 裸 Exception）、`SIM105/SIM117`、`B008`（FastAPI `Query()` 写参数默认值是标准模式）、`RUF012`（Pydantic 可变类属性）、`RUF006/RUF005`、`UP037`。tests 放宽 `N802/N803/N806/E402/B017`，alembic migrations 放宽 `UP035`。依据：`backend/pyproject.toml:84-107`。
2. **后端类型检查：mypy 宽松模式**。`strict = false`、`ignore_missing_imports = true`、启用 `pydantic.mypy` 插件，`disable_error_code` 整体关掉 `attr-defined/union-attr/assignment/arg-type/valid-type/operator/call-overload/call-arg` 等高频噪声码。约定：`# type: ignore[code]` 后面不接中文（否则被当 code 报语法错）。依据：`backend/pyproject.toml:75-82`。
3. **后端测试：pytest + pytest-asyncio + xdist loadscope**。`asyncio_mode = "auto"`（异步测试无需装饰器）；`testpaths = ["tests", "app"]`（顶层集成套件与模块内单测都发现）；xdist 分发固定 `-o dist=loadscope`（按模块绑 worker，消除跨文件状态污染导致的 reparse flaky，注释记录 2026-08-13 ql-002 定位）。生产 PG、单测 SQLite 方言差异要注意。依据：`backend/pyproject.toml:63-73`。
4. **后端日志：structlog**（stdlib logging + structlog 双轨，merge_contextvars / add_log_level / iso-utc TimeStamper 等处理器，幂等配置）。权限缓存失效等可监控异常升 ERROR 级走 structlog。依据：`backend/app/core/logging.py:13-30`；`backend/app/core/permission_cache.py:234`。
5. **后端依赖注入**：会话固定别名 `SessionDep = Annotated[AsyncSession, Depends(get_session)]`，权限用 `Depends(require_permission(Permission.X))`。依据：`backend/app/modules/incident/router.py:26` 及各模块 router 同款。
6. **前端 lint：ESLint（eslint-config-next）**。`next/core-web-vitals` 预设 + `no-unused-vars` warn（`argsIgnorePattern: "^_"`，未用参数/变量前缀 `_`）。依据：`frontend/.eslintrc.json`；`frontend/package.json:9`（`lint: next lint`）。
7. **前端样式：Tailwind + antd 共存，`cn()` 拼类名 + cva 做变体**。`cn = twMerge(clsx(...))` 统一入口；shadcn 风格原子件用 `cva` 定义变体（如 `buttonVariants`）；`components/ui/`（原子件）、`components/layout/`、`components/charts/`、`components/<域>/` 按域分目录，组件文件 kebab-case `.tsx`，同目录 `__tests__/` 放测试。依据：`frontend/src/lib/utils.ts`（cn 实现）；`frontend/src/components/ui/button.tsx:2,6`（`cva` + `buttonVariants`）；`frontend/tailwind.config.ts`。
8. **前端测试：vitest + @testing-library/react**。jsdom 环境、`globals: true`、`clearMocks: true`（每测试清 mock 调用计数；刻意不开 restoreMocks——大量测试在 beforeAll 级持久化 spy）；`testTimeout: 15000` 治全量并行 flaky；纯逻辑测试按 `environmentMatchGlobs` 白名单切 node 环境省 jsdom 启动。依据：`frontend/vitest.config.ts`（含逐条中文注释说明取舍）。
9. **daemon：tsc 严格模式**。`strict: true` + `noUncheckedIndexedAccess` + `noImplicitOverride` + `verbatimModuleSyntax`（type 导入必须显式 `import type`）+ `isolatedModules`。依据：`sillyhub-daemon/tsconfig.json:7-15`；测试与前端共用 vitest 栈（`sillyhub-daemon/package.json` test 脚本 + `vitest.config.ts` / `vitest.spikes.config.ts`）。

## 典型代码模式

1. **后端 router→service 分层调用**：router 拿 `SessionDep` → 请求内 `svc = IncidentService(session)` → 调 service 方法 → schema 序列化返回。例：`backend/app/modules/incident/router.py`（:26 SessionDep、:40 实例化）+ `backend/app/modules/incident/service.py`。
2. **前端数据获取（react-query 三件套）**：`src/lib/` 下纯 `export async function fetchX` 请求函数 + 同文件封装 `useQuery`/`useMutation` hook + query key 统一走 `queryKeys` 工厂（凡影响查询结果的变量都进 key）。例：`frontend/src/lib/mcp-settings.ts:17,93-94,110-111`；key 工厂：`frontend/src/lib/query-keys.ts`。
3. **前端组件变体（cva + cn）**：原子件用 `cva` 声明变体表导出 `xxxVariants`，业务组件用 `cn(...)` 合并外部 className。例：`frontend/src/components/ui/button.tsx:2,6`；`frontend/src/lib/utils.ts`。
4. **daemon MCP 工具 schema（zod + describe）**：`z.object({...})` 定义入参，每个字段 `.describe()` 面向 LLM。例：`sillyhub-daemon/src/mcp-server.ts:36,164-169`。
5. **后端领域错误定义**：继承 `AppError` 按事件命名、构造时传中文用户文案。例：`backend/app/core/errors.py:28-38`（基类）；`backend/app/modules/incident/service.py`（`IncidentNotFound` 等子类同模式）。
