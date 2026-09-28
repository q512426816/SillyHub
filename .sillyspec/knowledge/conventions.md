---
author: qinyi
created_at: 2026-06-23 02:00:00
---

# 项目约定 (Conventions)

## SillySpec 文档驱动开发流程

本项目使用 SillySpec 文档驱动开发（见 `.claude/CLAUDE.md` 硬性规则）：

- **执行顺序：文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收**
- 禁止无文档改代码、禁止先写代码再补文档
- 新功能/大改动走完整流程：`sillyspec run brainstorm` → plan → execute → verify
- 小修复/小调整：`sillyspec run quick`
- 修改代码前必须说明依据的文档路径；实现完成后对照文档验收
- 本项目未正式上线，数据可清空，不考虑版本迭代兼容
- 提交被 hook 拦截时禁止跳过，必须解决问题再提交

## 子项目构建 / 测试 / lint 命令

monorepo 根无统一命令，必须 cd 到对应子项目：

| 子项目 | 技术栈 | test | lint |
|---|---|---|---|
| backend | FastAPI + uv | `cd backend && uv run pytest` | `cd backend && uv run ruff check .` |
| frontend | Next.js + pnpm | `cd frontend && pnpm test` | `cd frontend && pnpm lint` |
| sillyhub-daemon | Node + pnpm (ESM) | `cd sillyhub-daemon && pnpm test` | `cd sillyhub-daemon && pnpm lint` |

frontend/daemon 构建用 `pnpm build`；backend（Python）无独立 build 步骤。

## 目录约定

- `backend/` — FastAPI 后端（app/core 基础设施 + app/modules/<domain> 业务模块）
- `frontend/` — Next.js 14 前端（src/app App Router）
- `sillyhub-daemon/` — Node.js 本地守护进程（src/，ESM）
- `deploy/` — Docker Compose 部署配置
- `docs/` — 项目级设计文档
- `.sillyspec/` — SillySpec 规范、扫描文档、变更、知识库

## 提交规范

commit message 用类型前缀 + 中文描述，例：`fix(agent-run): 修复调度 scan 链路`、`feat(frontend): 新增 SSE hook`。常见前缀：feat / fix / docs / refactor / test / chore。

## SillySpec 变更状态机（StageEnum + TRANSITION map）

SillySpec 变更生命周期是显式 FSM，定义在工具内部 StageEnum + TRANSITION 映射：
- **StageEnum**：PROPOSE → PLAN → EXECUTE → VERIFY → ARCHIVE（正常前进），外加 BLOCKED（异常态）。
- **TRANSITION**：VERIFY **通过** → ARCHIVE（验收 OK 收尾）；VERIFY **不通过** → BLOCKED → 回退到 PROPOSE/PLAN/EXECUTE 之一重做（按失败原因）。
- 改 SillySpec 工具自身逻辑（stage 流转、auto_dispatch、verify 判定）时，所有状态变迁必须走 TRANSITION map，禁止跳态（如 EXECUTE 直接到 ARCHIVE）。
- 副作用约束：变更进入 ARCHIVE 后 `current_stage` 清空、`status=archived` 是终态判据，不复活。

## backend Python 工程约定（model.py 单数 / ruff 配置）

- **文件名单数**：SQLModel 数据模型文件名是 `model.py`（非 `models.py`），与 router.py / service.py 同级；找模型类 grep `model.py` 而非 `models.py`。
- **ruff 配置**（`backend/pyproject.toml`）：`line-length = 100`；select 含 `E/F/I/B/UP/N/SIM/RUF/BLE`；ignore = `E501 N818 RUF001-003 BLE001 SIM105 SIM117 B008 RUF012 RUF006 RUF005 UP037`（含 `mypy` 侧 `disable_error_code = ["attr-defined","union-attr","assignment","arg-type","valid-type","operator","call-overload","call-arg","unused-ignore"]`）。
- 提交前格式化：`cd backend && uv run ruff format .`（staged 文件先 format 再 add 再 commit，否则 pre-commit hook 拦）。
- APIRouter 统一 `prefix="/api"`（见 Backend 模块组织）。

## daemon ESM import 必须带 .js 扩展名

`sillyhub-daemon` 是 Node ESM（`"type": "module"`），**所有相对路径 import 必须显式写 `.js` 后缀**（即便源文件是 `.ts`）：`import { X } from './config.js'`、`from './types.js'`。
- 漏 `.js` 会在 `pnpm build`（tsc/tsx）或运行时报 ERR_MODULE_NOT_FOUND。
- 改 daemon import 时养成习惯：源码 `.ts`，import 路径写 `.js`；类型 import 用 `import type`。

## backend 模块分层与基类/异常约定（router/service/schema + BaseModel + AppError）

backend 业务模块（`app/modules/<域>/`）除 `model.py` 单数命名外，还有三条隐形硬约定，新增模块 / 加表 / 抛业务异常时必须遵守：

- **四文件分层**：`router.py`（FastAPI APIRouter，HTTP 层）+ `service.py`（业务）+ `model.py`（SQLModel 表）+ `schema.py`（Pydantic IO DTO）。`app/main.py` 注册 router 统一 `prefix="/api"`。
- **service 在请求处理函数内实例化、注入 session**（非模块级单例）：router 里 `async def handler(session: SessionDep, ...): svc = IncidentService(session); ...`。保证异步会话隔离，别在模块级 `svc = XService(...)`。
- **数据模型必须继承 `app.models/base.py` 的 `BaseModel`**（`class BaseModel(SQLModel): pass`，文件注释明示 "Inherit from this — not SQLModel"），写成 `class Foo(BaseModel, table=True)`。绕过它直接继承 `SQLModel` 会脱离共享 metadata 对象（Alembic autogenerate 扫的是 `BaseModel` 的 metadata），导致迁移漏表。
- **领域错误继承 `app/core/errors.py` 的 `AppError`**（带类属性 `code` / `http_status`，可经 `__init__` 实例级覆盖），子类**按事件命名**（`IncidentNotFound` / `LlmProviderNotFound` / `PlanNotFound`），**不带 `Error` 后缀**——这正是 ruff `N818` 被显式关闭的原因。全局异常处理器按 `AppError` → HTTP 映射，业务 service 抛 `AppError` 子类而非裸 `HTTPException`。

## 前端 SSE 消费统一 fetch-sse：token 走 Authorization header，禁用 EventSource

frontend 所有 SSE / 流式消费统一走 `frontend/src/lib/fetch-sse.ts`（fetch + ReadableStream 实现的 EventSource 替代品），**禁止新代码用浏览器原生 EventSource**：

- **动机（安全）**：EventSource 无法自定义请求头，token 只能拼 URL query，会被访问日志明文记录；fetch-sse 把 token 放 Authorization header（backend auth_deps 已 header-only，不认 query token）。
- 接口形状贴齐 EventSource（onopen/onmessage/onerror/addEventListener/readyState/close），从 EventSource 迁移只改构造方式。
- **SSE 一律走 fetch-sse + Next route handler 透传**（`frontend/src/app/api/**/stream/route.ts`）；页面直连后端流式端点会被 Next 代理缓冲，route handler 是唯一合法流式出口，且 handler 自带鉴权。
- 新增流式功能（agent-run 流 / daemon 会话 / 导入进度等）复用 fetch-sse，勿再新写裸 EventSource 或散写 fetch+ReadableStream 解析。样板：`frontend/src/lib/agent-stream.ts`、`frontend/src/lib/daemon.ts`。

## Tailwind md: 是视口断点非容器断点：侧栏内嵌组件禁用响应式前缀

Tailwind 的 `md:` / `lg:` 等前缀按**浏览器视口**宽度生效，与组件所在容器的实际宽度无关：

- 桌面视口下，即使组件被塞进 320px 侧栏/折叠卡，`md:grid-cols-2` 仍强制两栏把内容挤崩。已两次踩坑（change-detail-layout-rework + ql-20260811-002：侧栏折叠卡内嵌 md: 两栏文件树/会话区挤崩，最终改宽 Dialog 承载）。
- 规范：**容器内布局决策不用视口断点前缀**；侧栏里的宽内容改用宽 Dialog（radix Portal 脱离侧栏容器，max-w 可放开）承载，参照 `frontend/src/components/changes/detail/` 的做法。
- 该认知已固化进代码注释与测试标题（`frontend/src/components/changes/detail/change-sessions-card.tsx:20`、`__tests__/quicklog-drawer.test.tsx:81`），review 时把侧栏内嵌组件里的 `md:` 前缀当坏味道拦。

## 模块卡片 H1 用中文名（module-id）

平台（SillyHub）文档列表按 markdown 首个 H1 提取 title 展示（backend scan_docs parser._extract_title）。模块卡片 H1 必须写「# 中文短名（module-id）」全角括号格式（如 `# 变更中心（change）`），不能只写英文 module-id——否则平台文档列表显示一墙英文代号不可读。scan 文档/flows/术语表同理用中文标题。墓碑卡中文名带「已删除」标记。2026-08-18 ql-20260818-003 补齐 200 张卡片时确立。

## 2026-06-15 — Alembic migration 目录与 schema 领先版本号的处理

- **目录路径**：`backend/alembic.ini` 的 `script_location = migrations`，所以 migration 文件真实路径是 `backend/migrations/versions/`，**不是**默认的 `backend/alembic/versions/`。确认 head 用 `cd backend && alembic history` / `alembic heads`。
- **schema 领先 alembic 版本号**：当 model 先加列但漏补 migration 时，开发库会因某次 SQLModel `metadata.create_all` / 手动改动已把列加进表，而 `alembic_version` 表还停在旧 head。此时 `alembic upgrade head` 对新 migration 的 `ADD COLUMN` 报 `DuplicateColumnError`。
- **正确处理**（不破坏数据、不手动改表）：`alembic stamp <新revision>` 把版本号对齐到新 migration（告诉 alembic「列已存在，版本到此」），再 `alembic downgrade -1` + `alembic upgrade head` 往返验证双向 DDL。`stamp` 是 alembic 处理「schema 已手动变更但版本号滞后」的标准手段。
- **干净库不受影响**：全新库 upgrade head 会从建表 migration 顺序执行到新 ADD COLUMN，列那时不存在，正常通过——这正是补 migration 要解决的「干净部署必崩」。
- **模块文档惯例**：`backend/migrations/versions/**` 不命中任何业务模块 glob（如 `backend/app/modules/agent/**`），故 migration 改动跳过模块文档同步。

## 2026-06-24 — daemon 任何自 spawn 路径 Windows 必须 resolveWindowsCmdShim（.cmd/.bat/.ps1）

> 来源：ql-20260624-002-b2f7（codex-app-server-driver）。batch task-runner 早有 resolveWindowsCmdShim，interactive codex driver 漏接——当时的漏接已接线修复，本条保留为新增 spawn 路径的防回归约定。

- 现象：codex interactive session 在 Windows 永远起不来，daemon 日志 `interactive_session_create_failed code=EINVAL error=spawn EINVAL`。
- 根因：agent-detector 在 Windows 给的是 npm cmd-shim `codex.cmd`；driver 直接 `spawn(codex.cmd, args, {stdio})` 无 shell/无 wrapper 解析 → Windows CreateProcess 对 `.cmd/.bat/.ps1` 返回 EINVAL。batch `task-runner.ts` 早用通用 `cmd-shim.ts` 的 `resolveWindowsCmdShim`，唯独 interactive codex driver 漏接。
- codex 特殊点：cmd-shim 引用的不是真 .exe 而是 `codex.js`（node ESM 入口），`codex.js` 内部 `stdio:"inherit"` spawn 真 `codex.exe`，故解析结果 = `node.exe + [codex.js]`。
- 通用坑（防回归）：**任何自己 `child_process.spawn` 的路径**（interactive driver / 新 provider runtime / 任何长驻 stdio 子进程），Windows 上 spawn agent-detector 给的 `.cmd/.bat/.ps1` wrapper 前必须先 `resolveWindowsCmdShim` 解析成 `{exe, prependArgs}` 再 `spawn(exe, [...prependArgs, ...业务args], {shell:false})`，解析失败才回退 `shell:true`。新增 interactive driver 时对照 `task-runner.ts` 接线，别各自 spawn——否则只在 Windows 环境暴露（posix CI 跑不到，易漏）。

## 2026-07-08 — Pydantic 必填派生字段不能用 model_validate(ORM)+model_copy 两段式

> 来源：2026-07-07-daemon-machine-runtime-hierarchy task-03/04（_build_machine_read bug，task-04 测试捕获）。

- 现象：DTO 含必填派生字段（如 `runtime_count: int` 无 default），用 `Model.model_validate(orm_instance)` + `model_copy(update={派生字段: 值})` 两段式构造时，`model_validate` 在 `model_copy` 填值**前**就抛 `ValidationError: Field required`（ORM 无此属性）。
- 解法：派生字段在构造时显式传——全字段直构 `Model(field1=orm.x, ..., 派生字段=value)`；或给派生字段加 `default=0`（model_validate 用 default 不崩，model_copy 覆盖真实值，适合派生字段总有组装覆盖的场景）。
- 对比 `_runtime_read`（router.py:433）用 model_validate + model_copy 不崩，因 DaemonRuntimeRead 所有字段在 ORM 都有或 optional；DaemonMachineRead 崩是因 runtime_count/online_runtime_count 必填且 ORM 无。
- 通用坑：DTO 有"派生/聚合"必填字段（不在源 ORM 上）时，避开 model_validate(ORM) 两段式，用全字段直构或给派生字段 default。

## 2026-08-19 — Windows 下 execFile 调 npm 全局 CLI 必 ENOENT，须 spawn+shell 或 cmd-shim 解析

> 来源：2026-08-19-runtime-live-daemon-read task-11 实现期实测 + 仓内先例交叉验证。

- 现象：`execFile('sillyspec', [...])` 在 Windows 返回 ENOENT——npm 全局 bin 是 `.cmd` shim（`C:\nvm4w\nodejs\sillyspec.cmd`），execFile 无 PATHEXT 解析；Node ≥18.20 同时因 CVE-2024-27980 拒绝无 shell 调 `.cmd`/.bat。
- 仓内范式：① `spec-sync.ts runInitCmd`（X-06 注释）`spawn(cmd, {shell:true})` + 超时 taskkill /T /F 杀树；② `cmd-shim.ts resolveWindowsCmdShim` 读 `.cmd` 提取真实 exe + target 直接 spawn（重任务用）；③ `preflight.ts runWithTreeKill` 同范式。
- 注入防线：shell:true 时命令串拼接是注入面，入参必须白名单（本例 workspace_id UUID 正则先于拼接，`; rm -rf` / `&& calc` / `$(whoami)` / 反引号全拒）。
- 通用坑：task 卡/设计文档写「execFile 非 shell 防注入」在 Windows 调 npm bin 场景是**纸上方案**——落地前先实测平台行为，防注入诉求改为入参白名单 + shell 隔离双层。

## MCP server 子进程不继承 claude.exe 完整环境：env 必须放 mcpServers[*].env

claude.exe（2.1.x）spawn MCP server 子进程时 env 为「白名单基线（PATH/HOME 等 12 个）+ per-server env 覆盖合并」，不继承完整父环境。给 MCP server 注入自定义变量（如 MCP_SESSION_ID）必须放在 options.mcpServers['<server>'].env（daemon mcp-config.ts 的 server config env 字段），放 SDK 顶层 options.env 无效。证据链：claude-sdk-driver.ts:407 透传 → sdk.d.ts:1092 McpStdioServerConfig.env → sdk.mjs --mcp-config 全量序列化 → claude.exe StdioClientTransport.start spawn env 合并。来源：2026-08-22-team-session-unify spike-01。
