---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 代码约定（Conventions）

> 范围：`backend/`（Python 3.12 + FastAPI + SQLModel/SQLAlchemy 异步栈）。所有结论均给出真实文件与行号证据；工具配置以 `backend/pyproject.toml` 为准。相比上一版（6e78b29a，2026-07-26）新增：错误文案中文化与守护测试、pytest 禁 `importlib.reload(config)`、路由全 async、SSRF 出网防护、PPM 归属校验 service 层惯例、测试 in-memory fixture 细节。

## 框架隐形规则

下列规则不是写死在代码里的，而是由 `backend/pyproject.toml` 工具配置、全局 fixture 与守护测试隐式约束的。改动时先看清这些豁免与红线，否则会被 ruff/mypy 误判为「违规」而改错方向，或被守护测试直接拦下。

- **mypy 非严格，且批量禁用错误码**（`backend/pyproject.toml:75-82`）：`strict = false`，`disable_error_code = ["attr-defined", "union-attr", "assignment", "arg-type", "valid-type", "operator", "call-overload", "call-arg"]`，`plugins = ["pydantic.mypy"]`。SQLModel/Pydantic 动态属性、SQLAlchemy 表达式、FastAPI `Depends` 参数类型 mypy 均不报错——新写此类代码**无需**为这些码补 `# type: ignore`。`warn_unused_ignores = true`（同文件 78 行）意味着多余的 ignore 反而会被点名，不要无脑堆 ignore。
- **ruff 行宽 100、目标 py312**（`backend/pyproject.toml:84-87`），`select = ["E","F","I","B","UP","N","SIM","RUF","BLE"]`（89-90 行），但 `E501` 行长被整体忽略（91-102 行，注释「行长交给 formatter 兜底」）——不要手工折行去消 E501。格式化统一双引号（109-110 行 `quote-style = "double"`）。
- **异常按「事件」命名，而非 `Error` 后缀**：`N818` 被忽略（`backend/pyproject.toml:92-93`，注释明确「领域异常以事件命名，抽象基类 `AppError` 才带 Error 后缀」）。`ReleaseNotAllowed`、`IdentityRevoked`、`LeaseConflict` 等都是合规命名，勿改名为 `XxxError`。
- **下列 ruff 规则被显式豁免**（`backend/pyproject.toml:94-102`，每条带注释 rationale）：`B008`（FastAPI 参数默认值里写 `Query()`/`Depends()` 是标准模式）、`RUF012`（Pydantic/SQLModel 可变类属性是故意的）、`BLE001`（异步错误处理 `except Exception` 兜底常见）、`SIM105`/`SIM117`（禁 `contextlib.suppress`、允许嵌套 `with`）、`RUF006`/`RUF005`（fire-and-forget 任务与列表拼接风格不限）、`RUF001/002/003`（中文串/注释/文档串全角标点不报错）、`UP037`（注解前向引用引号化）。
- **测试目录放宽命名规则**（`backend/pyproject.toml:104-107`）：`tests/*` 与 `**/tests/*` 对 `N802/N803/N806/E402/B017` 豁免——测试函数可大写打头、允许后置 import、允许 `pytest.raises(BaseException)`。`migrations/versions/*` 豁免 `UP035`（alembic 模板用 `typing.Sequence`）。
- **pytest-asyncio = auto**（`backend/pyproject.toml:64`）：异步测试**无需** `@pytest.mark.asyncio`，直接 `async def test_...` 即可。`addopts = "-ra -o dist=loadscope"`（70 行）——xdist 分发用 loadscope（按模块/类绑 worker），不用默认 load，避免跨模块状态污染导致 reparse created=0 flaky（65-69 行注释详述根因）；并行用 `pytest-xdist`，CI 低资源残余 flaky 靠 `pytest-rerunfailures` 加 `--reruns 2 --reruns-delay 1` 兜底（42-48 行 dev 依赖注释）。
- **错误文案中文化 + 守护测试**：用户链路（`app/modules/` 下所有 `*router*.py`/`*service*.py`/`service.py`，加 `app/main.py`、`app/core/auth_deps.py`、`app/core/security.py`）的 `raise XxxError("…")`/`HTTPException(detail="…")` 字面量文案**必须含 CJK 字符**，f-string 取常量段做同款判定。由守护测试 `backend/tests/core/test_error_message_l10n.py:1-80` 静态 AST 扫描强制（策略见其 docstring；机器对机器链路如 `daemon/` 内部 RPC、`mcp_gateway` 协议端点、`platform_sync/`、`storage/` 有排除清单；`PENDING_L10N_FILES` 渐进白名单已清空、`ALLOWED_ENGLISH` 登记合法英文个案）。**新写用户可见报错一律中文**，否则该测试直接红。
- **pytest 禁 `importlib.reload(app.core.config)`**（`backend/tests/test_config.py:10-26` docstring 明文禁令）：reload 会在原地重执行模块产生新 `Settings` 类，conftest 的 `_reset_settings_cache` 补丁失效，`spec_data_root` 回退到 controller pid 目录 → reparse 扫空 → CI Linux 必现全红（2026-08-14 起 7 run）。pydantic-settings 在实例化时读 env，**`monkeypatch.setenv(...)` 后直接 `Settings()` 即可**，reload 纯属多余。（`app/modules/daemon/host_fs/tests/test_delegate_nfr.py:345-364` 中的 `importlib.reload(mod)` reload 的是测试内局部模块，不属本禁令范围。）
- **路由 handler 一律 `async def`**：`backend/app/modules/` 下 34 个 router 文件 451 个 handler 全部 `async def`，无同步 `def` + Depends 混写（grep 全量核实）。新增端点保持 async，同步阻塞操作（DNS 解析等）用 `asyncio.to_thread` 包裹（见 `backend/app/modules/tool_gateway/tool_policy.py` 的 SSRF 解析实现）。
- **测试 DB fixture：aiosqlite in-memory + 全模型注册**（`backend/conftest.py:138-202`）：`db_engine` 用 `create_async_engine("sqlite+aiosqlite:///:memory:")`（189 行），建表前**必须 import 全部 feature model 模块**把表挂到 `BaseModel.metadata`（144-187 行，漏一个就 FK `NoReferencedTableError` 连坐全部 DB 测试）；`db_session` 用 `async_sessionmaker(..., expire_on_commit=False)`（199-202 行）；autouse `_redirect_session_factory` 把 `get_session_factory()` 指向测试 engine，让 SSE/后台任务的短命 session 也落到 in-memory（205-219 行）。

## 代码风格

### 1. 模块分层：`router / service / schema / model` 四件套

每个业务域在 `backend/app/modules/<域>/` 下固定拆分，文件名一致，禁止路由/持久化/契约混写。router 薄（只做鉴权注入 + 调 service + 返回 schema），业务与 DB 全在 service：

- 路由层：一律 `router = APIRouter(prefix=..., tags=[...])` 挂载，如 `backend/app/modules/worktree/router.py:23`、`backend/app/modules/auth/router.py:40`、`backend/app/modules/daemon/router.py:256`、`backend/app/modules/llm_provider/router.py:35`（全量 grep 命中 15+ 处 `APIRouter(prefix="...")`，workspace 路径参数统一 `/workspaces/{workspace_id}` 前缀）。
- 服务层：`class XxxService:` 有状态类，如 `backend/app/modules/change/service.py:78-85`。
- 契约层：`XxxRequest / XxxRead` DTO + `model_config = ConfigDict(from_attributes=True)`，如 `backend/app/modules/worktree/schema.py:20`；持久化模型 `class Change(BaseModel, table=True)`（`backend/app/modules/change/model.py:118`）。

### 2. 依赖注入用 `Annotated` 别名，而非裸 `Depends(...)`

会话与当前用户通过类型别名复用，模块顶部声明一次，handler 直接引用：

- `backend/app/modules/worktree/router.py:25`：`SessionDep = Annotated[AsyncSession, Depends(get_session)]`；`backend/app/modules/worktree/router.py:68`：`CurrentUser = Annotated[User, Depends(get_current_user)]`。
- 单端点权限用 `Annotated[User, Depends(require_permission(Permission.TASK_RUN_AGENT))]`（`backend/app/modules/worktree/router.py:40`）；整组鉴权用路由级 `dependencies=[Depends(require_permission_any(...))]`（`backend/app/modules/admin/router.py:52` 起）。
- 鉴权统一走 `backend/app/core/auth_deps.py` 的 `get_current_user` / `get_current_principal`，不要在 service 里再读 request。

### 3. Service 是「持有 session 的有状态类」，查询走 `session.execute + scalars`

- 构造期接收 `AsyncSession`，字段命名 `self._session`：`backend/app/modules/change/service.py:78-85`。需要操作者身份时多带一个 actor 参数（`backend/app/modules/admin/users_service.py` 的 `def __init__(self, session, actor_id)` 同款）。
- 查询统一 SQLAlchemy 2.x 形态：`(await self._session.execute(stmt)).scalar() or 0`、`.scalars().all()`、`.scalars().first()`（`backend/app/modules/change/service.py:184,192,204,224,241`）。
- Service 间组合**复用同一 session**（不要各自开新事务）：`backend/app/modules/change/service.py:103` `SpecWorkspaceService(self._session).get(...)`。
- router 之外（后台任务/启动钩子）手动开 session 用 `async with get_session_factory()() as session:`，不要 `Depends(get_session)`（`backend/app/core/db.py` 的 `get_session_factory` 懒加载单例 + conftest `_redirect_session_factory` 印证）。

### 4. 异常分层：`AppError` 基类 + 中文 message + UPPER_SNAKE code，路由层不手写 `HTTPException`

- 基类契约：`backend/app/core/errors.py:28-56`——`code`/`http_status` 为类属性，`__init__` 可实例级覆盖 `code`/`http_status`/`details: dict | None`（只改实例不改类属性）。
- 域内异常按事件命名 + `code` 用大写蛇形字符串：`backend/app/modules/release/service.py:45-56`（`ReleaseError(AppError)` → `ReleaseNotAllowed` `code="RELEASE_NOT_ALLOWED"` / `ReleaseNotFound`）；`backend/app/core/errors.py:62-74` 的 `HTTP_400_WORKSPACE_PATH_NOT_FOUND` 形态同款。
- 全局注册：`backend/app/core/errors.py:363` `register_exception_handlers(app)`，在 `backend/app/main.py:223` 挂载，统一翻译成 `{code, message, request_id, details}` 响应体。**新错误继承 `AppError` 并给中文 message，不要在 router 里 `raise HTTPException`**（l10n 守护测试同时盯着这两类文案）。

### 5. SSRF 防护：出网请求必过 `assert_public_hostname` / `core/ssrf.py`

- 原语：`backend/app/modules/tool_gateway/tool_policy.py:350` `ToolPolicyService.assert_public_hostname`（IPv4+IPv6+`asyncio.to_thread` 防 DNS 阻塞）；全量校验入口 `backend/app/core/ssrf.py:37-53`（scheme 白名单 + 解析 host + 私网/保留地址拒）。
- 任何用户可控 URL 的出网（fetch models、probe 等）调用前必过校验：`backend/app/modules/llm_provider/router.py:147`、`backend/app/modules/llm_provider/probe.py:94`、`backend/app/modules/llm_provider/service.py:546,780`。新增出网端点照此模式，勿自写 IP 判定。

### 6. 日志：`structlog` + 模块级 `get_logger(__name__)`，事件名点分蛇形

不在业务代码用 `print` 或裸 `logging`。配置见 `backend/app/core/logging.py:13-46`（`merge_contextvars`、ISO UTC 时间戳、`format_exc_info`、JSONRenderer、`configure_logging` 在 `backend/app/main.py:84` 启动时调用）。各 service/router 顶部 `log = get_logger(__name__)`（如 `backend/app/core/errors.py:25`）。异常统一 `log.exception("<event>", ...)`，事件名点分蛇形（`app.start` 类风格）。

### 7. 权限/归属校验放 service 层（PPM 范式）

代填冒名防护用 `resolve_owner` 原语在 service 落库前逐字段校验，不在 router 做：`backend/app/modules/ppm/common/ownership.py:5-16,46`（`resolve_owner` 只读 `actor.is_platform_admin` 与 `actor.id`，鸭子类型；配套错误类 `PpmOwnershipDenied` 同模块 36 行）。跨子域接线与测试范式见 `backend/app/modules/ppm/common/tests/test_ownership.py`。

### 8. 审计：写操作走 `AsyncSession.info` 的 `audit_context`，不要另起一套

审计上下文放在 `AsyncSession.info["audit_context"]`，由 ORM 事件钩子读取落 `audit_logs` 表：`backend/app/core/audit_hooks.py:89-110`（`_get_audit_context` 从 connection.info 回退 session.info 提取）。手工审计场景（登录/settings 等）也复用同一上下文通道。

### 9. SQLModel 模型风格

- 持久化模型统一继承 `backend/app/models/base.py:13` 的 `class BaseModel(SQLModel)`（不是裸 `SQLModel`），共享同一 metadata 供 Alembic autogenerate 扫描（模块 docstring 明文）。
- 显式 `__tablename__` 蛇形命名（常为复数/域前缀）：`backend/app/modules/change/model.py:121` `"changes"`、208 行 `"change_documents"`、255 行 `"change_session_links"`、308 行 `"change_events"`。
- ORM → Pydantic 出参用 `model_config = ConfigDict(from_attributes=True)`（`backend/app/modules/worktree/schema.py:20` 等），新代码用 `ConfigDict(...)` 而非 dict 字面量旧写法。

### 10. 命名小细节

- 列表查询方法用 `list_`（尾下划线避开内置 `list`）：`backend/app/modules/change/service.py` 的 `async def list_(...)`；对应 router 用动词前缀 `list_changes`。
- 内部方法 `_` 前缀：`backend/app/modules/change/service.py` 的 `async def _resolve_change_dir(...)`。
- 模块/目录 snake_case；错误码 UPPER_SNAKE 字符串（见第 4 条）。

## 典型模式速查

1. **标准 CRUD 端点**：`backend/app/modules/worktree/router.py:23-68`——`APIRouter(prefix="/workspaces/{workspace_id}")` + `SessionDep`/`Annotated[User, Depends(require_permission(...))]` 注入 + `async def` handler 调 service。
2. **service 组合复用同 session**：`backend/app/modules/change/service.py:103`——`SpecWorkspaceService(self._session).get(...)`，不新开事务。
3. **出网 URL SSRF 校验**：`backend/app/modules/llm_provider/service.py:541-546`——解析 host → `await ToolPolicyService.assert_public_hostname(host)` → 再 httpx 请求。
4. **新错误类**：`backend/app/modules/release/service.py:45-56`——事件名类 + `code = "RELEASE_NOT_ALLOWED"` + 中文 message，由全局 handler 翻译。
5. **测试建库**：`backend/conftest.py:138-202`——in-memory engine + 全 model import 注册 + `expire_on_commit=False` session；env 相关测试用 `monkeypatch.setenv` + 直接 `Settings()`（`backend/tests/test_config.py:29-33`），**禁 reload**。
