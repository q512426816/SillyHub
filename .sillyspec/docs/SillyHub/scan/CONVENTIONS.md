# 代码约定(Conventions)

---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 5a00fc7e
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

本文件记录 SillyHub 三端(backend / frontend / daemon)在框架之上、容易被新人踩坑的隐形约定与统一代码风格。所有条目均给出源码或配置定位作为证据。

## 框架隐形规则

这些是“看不出来、但违反就会出错或被 review 打回”的隐性规则。

1. **后端模块按 `router / service / model / schema` 分文件分层,service 在请求内实例化**。
   每个 `backend/app/modules/<域>/` 下固定包含 `router.py`(HTTP 层)、`service.py`(业务)、`model.py`(表)、`schema.py`(Pydantic IO)。路由里不在模块级 new service,而是在每个请求处理函数内 `svc = IncidentService(session)` 注入会话,保证异步隔离。证据:`backend/app/modules/incident/router.py:24`(`router = APIRouter(tags=["incidents"])`)与 `:40`(`svc = IncidentService(session)`);`backend/app/modules/incident/service.py:41`(`class IncidentService:`)+ `:44`(`def __init__(self, session: AsyncSession)`)+ `:79` `async def list_incidents` / `:93` `async def get`。

2. **数据模型必须继承 `app.models.base.BaseModel`,而不是直接继承 `SQLModel`**。
   项目封装了 `class BaseModel(SQLModel)` 作为唯一模型基类,业务表写成 `class Incident(BaseModel, table=True)`。绕过它会丢失后续可能挂在基类上的公共字段/钩子。证据:`backend/app/models/base.py:13-16`(`class BaseModel(SQLModel)` 且注释明确 “Inherit from this — not SQLModel”);`backend/app/modules/incident/model.py:9-14`(`from sqlmodel import Field` + `from app.models.base import BaseModel` + `class Incident(BaseModel, table=True)`)。

3. **领域错误继承 `AppError`,命名按“事件”而非 `Error` 后缀**。
   所有业务异常派生自 `backend/app/core/errors.py:28` 的 `class AppError(Exception)`(带 `code` / `http_status` 类属性)。子类按事件命名,如 `IncidentNotFound`、`IdentityNotFound`、`LlmProviderNotFound`、`PlanNotFound`,这是 ruff `N818` 被显式关闭的结果(配置注释见下)。证据:`backend/app/modules/incident/service.py:26/31/36` 三个子类;`backend/app/modules/git_identity/service.py:23`、`backend/app/modules/llm_provider/service.py:30`、`backend/app/modules/ppm/plan/service.py:106` 同模式。

4. **前端 API 类型一律来自自动生成的 `api-types.ts`,禁止手写同名接口**。
   `frontend/src/lib/api-types.ts` 由 `scripts/gen-api-types.mjs` 从后端 OpenAPI 产出,消费方写 `import type { components } from "@/lib/api-types"`。漂移由 `package.json` 的 `gen:types:check` 脚本(`git diff --exit-code src/lib/api-types.ts`)在 CI 守护,改后端 schema 后忘了重生成会直接挂。证据:`frontend/package.json:13-14`(`gen:types` / `gen:types:check` 脚本);消费例:`frontend/src/lib/knowledge.ts:5`、`frontend/src/lib/health.ts:2`、`frontend/src/lib/git-identities.ts:2`(均带中文注释“类型从 OpenAPI 自动生成”)。

5. **daemon 是纯 ESM,相对 import 必须带 `.js` 后缀,Node 内置模块走 `node:` 前缀;MCP 工具入参用 zod 校验**。
   TS 源里写 `import ... from './cursor-version.js'`(编译后产物名)和 `from 'node:fs'`,漏后缀在 ESM 下运行时会 `ERR_MODULE_NOT_FOUND`。MCP server 的工具 schema 用 `z.object({...})` 定义并附 `.describe()` 给 LLM 看。证据:`sillyhub-daemon/src/cmd-shim.ts:19-21`(`import { readFileSync, existsSync } from 'node:fs'` + `import { resolveCursorVersionEntry } from './cursor-version.js'`);`sillyhub-daemon/src/mcp-server.ts:36`(`import { z } from 'zod'`)与 `:164-169`(`workspace_id: z.string().describe(...)` 等)。

6. **UI 与文档默认中文**(CLAUDE.md 规则 12)。
   面向用户的文案、注释、错误提示用中文,专业术语除外;这与后端 ruff 关闭 `RUF001/002/003`(中文标点/全角歧义)互相呼应。证据:前端 `frontend/src/lib/knowledge.ts:7` 中文注释;后端 `backend/pyproject.toml:79` 注释 `RUF001/002/003: project uses Chinese text`。

## 代码风格

1. **后端 lint/format**:`ruff` `line-length = 100`、`target-version = "py312"`、`quote-style = "double"`(双引号)。select `E/F/I/B/UP/N/SIM/RUF/BLE`,显式 ignore 一批(含义见原注释):`E501`(交给 formatter)、`N818`(错误类按事件命名)、`RUF001/002/003`(中文文本)、`BLE001`(异步常需 catch 裸 `Exception`)、`SIM105`(显式 try/except 优于 `contextlib.suppress`)、`B008`(FastAPI `Query()` 写在参数默认值是标准模式)、`RUF012`(Pydantic 可变类属性)、`RUF006`(fire-and-forget task 不留引用)。证据:`backend/pyproject.toml:69-95`。测试目录放宽 `N802/N803/N806/E402/B017`(`:89-91`)。

2. **后端类型检查宽松**:`mypy` `strict = false`、`ignore_missing_imports = true`、启用 `pydantic.mypy` 插件,并把 `attr-defined/union-attr/assignment/arg-type/valid-type/operator/call-overload/call-arg` 等高频噪声码整体 disable。约定:`# type: ignore[code]` 后面**不接中文**(否则 mypy 把中文当 code 报 syntax 错)。证据:`backend/pyproject.toml:60-67`。

3. **后端测试**:`pytest-asyncio` `asyncio_mode = "auto"`(异步测试函数无需装饰器)、`testpaths = ["tests", "app"]`(同时发现顶层集成套件与模块内单测)、`python_files = ["test_*.py"]`。生产 PG、单测 SQLite 的方言差异要注意(`date_trunc` 等需分支)。证据:`backend/pyproject.toml:53-58`。

4. **后端依赖注入**:会话依赖固定别名 `SessionDep = Annotated[AsyncSession, Depends(get_session)]`,权限用 `Depends(require_permission(Permission.X))` 或 `require_permission_any(...)`。证据:`backend/app/modules/incident/router.py:26,38,51,67`。

5. **前端组件目录**:`frontend/src/components/` 下平铺业务组件,`components/ui/`(shadcn 风格原子件 button/card/dialog/badge)、`components/layout/`(page-container/section-card/page-header/form-layout/data-table)、`components/charts/`(echarts 图)、`components/<域>/`(如 `daemon/`、`changes/`、`permissions/`)按域分子目录;组件文件 kebab-case `.tsx`,同目录 `__tests__/` 放测试。Tailwind 与 antd 共存:`cn(...)` 拼类名(`AgentProviderSelect.tsx:80` `className={cn(DEFAULT_CLS, className)}`),antd 组件直接 `from "antd"` 导入(`app/m/ppm/task-plans/page.tsx:27`)。数据层放 `frontend/src/lib/`,纯 `export async function fetchX` 作请求函数,react-query 的 `useQuery`/`useMutation` hook 同文件封装(例 `frontend/src/lib/mcp-settings.ts:17,93,128`),query key 集中在 `frontend/src/lib/query-keys.ts`。

6. **daemon 测试**:`vitest`,与前端共用栈;ESM 包 `package.json` 需 `"type": "module"`,导入路径见上方框架隐形规则 5。
