# 代码约定(Conventions)

---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

> 范围:`backend/`(Python 3.12 + FastAPI + SQLModel/SQLAlchemy 异步栈)。所有结论均给出 `file:line` 证据;配置类陈述以 `backend/pyproject.toml` 为准。

## 框架隐形规则

下列规则不是写死在代码里的,而是由 `backend/pyproject.toml` 的工具配置隐式「允许」的。改动时需先看清这些豁免,否则会被 ruff/mypy 误判为「违规」而改错方向。

- **mypy 非严格,且批量禁用错误码**(`backend/pyproject.toml:60-67`):`strict = false`,且 `disable_error_code = ["attr-defined", "union-attr", "assignment", "arg-type", "valid-type", "operator", "call-overload", "call-arg"]`。含义:SQLModel/Pydantic 动态属性、SQLAlchemy 表达式类型推断、FastAPI `Depends`/`Query` 装饰出的参数类型,mypy 都不再报错——新写此类代码**无需**为这些码补 `# type: ignore`。`warn_unused_ignores = true`(`backend/pyproject.toml:63`)意味着**多余的 ignore 反而会被点名**,不要无脑堆 ignore。
- **ruff 行宽 100、目标 py312**(`backend/pyproject.toml:70-71`),但 `E501`(行长)被整体忽略(`backend/pyproject.toml:76`,注释「行长交给 formatter 兜底」)——**不要手工折行去消 E501**。
- **异常按「事件」命名,而非 `Error` 后缀**:`N818` 被忽略(`backend/pyproject.toml:77`,注释明确「领域异常以事件命名,只有抽象基类 `AppError` 带 Error 后缀」)。因此 `ReleaseNotAllowed`、`IdentityRevoked`、`LeaseConflict` 等都是合规命名,勿改名为 `XxxError`。
- **下列 ruff 规则被显式豁免**(`backend/pyproject.toml:80-87`,每条都带注释 rationale):
  - `B008`——FastAPI 在参数默认值里写 `Query()`/`Depends()` 是标准模式。
  - `RUF012`——Pydantic/SQLModel 的可变类属性(`model_config = ConfigDict(...)`、`code: str = ...`)是故意的。
  - `BLE001`——异步错误处理中 `except Exception` 兜底常见。
  - `SIM105`——禁用 `contextlib.suppress`,要显式 `try/except`;`SIM117`——允许嵌套 `with`。
  - `RUF006`——「发射后不管」的 asyncio 任务不需要保留引用;`RUF005`——列表拼接风格不限。
  - `RUF001/002/003`——中文字符串/注释/文档串中的全角标点不报错。
  - `UP037`——允许注解中的前向引用引号化(配合 `from __future__ import annotations`)。
- **测试目录放宽命名规则**(`backend/pyproject.toml:89-91`):`tests/*` 与 `**/tests/*` 对 `N802/N803/N806/E402/B017` 豁免——测试函数可用大写打头(`TestXxx`)、参数可大写、允许后置 import、允许 `pytest.raises(BaseException)`。`migrations/versions/*` 豁免 `UP035`(alembic 模板用 `typing.Sequence`)。
- **pytest-asyncio = auto**(`backend/pyproject.toml:54`):异步测试函数**无需**加 `@pytest.mark.asyncio` 装饰器即可被识别,新增测试直接 `async def test_...`。`addopts = "-ra"`、`testpaths = ["tests", "app"]`(同上文件 55-57 行)。
- **格式化引号统一双引号**(`backend/pyproject.toml:95`):`quote-style = "double"`,手写代码也请用双引号保持一致。

## 代码风格

### 1. 模块分层:`router / service / schema / model` 四件套

每个业务域在 `backend/app/modules/<域>/` 下固定拆分,文件名一致,禁止把路由/持久化/契约混在一起。证据(同结构遍布全部模块,Glob 命中 60+ 个文件):

- 路由层:`backend/app/modules/auth/router.py:36`、`backend/app/modules/worktree/router.py:23`、`backend/app/modules/daemon/router.py:242`——一律 `router = APIRouter(prefix=..., tags=[...])`,挂载时 `app.include_router(router)`。
- 服务层:`backend/app/modules/change_writer/service.py:41`、`backend/app/modules/git_gateway/service.py:157`、`backend/app/modules/admin/users_service.py:51`——`class XxxService:` 有状态类。
- 契约层:`backend/app/modules/worktree/schema.py:11` 起的 `XxxRequest / XxxRead`,`backend/app/modules/change/model.py:96` 的 `Change(BaseModel, table=True)` 持久化模型。

### 2. 依赖注入用 `Annotated` 别名,而非裸 `Depends(...)`

会话与当前用户通过类型别名复用,模块顶部统一声明一次,handler 直接引用别名。证据:

- `backend/app/modules/worktree/router.py:25`:`SessionDep = Annotated[AsyncSession, Depends(get_session)]`。
- `backend/app/modules/worktree/router.py:40,54,68`:`Annotated[User, Depends(require_permission(Permission.TASK_RUN_AGENT))]`、`CurrentUser = Annotated[User, Depends(get_current_user)]`。
- `backend/app/modules/admin/router.py:61,64-65`:路由级 `dependencies=[Depends(require_permission_any(...))]` 做整组鉴权,再逐参注入 `session` 与 `user`。
- 鉴权统一走 `backend/app/core/auth_deps.py:56,140` 的 `get_current_user` / `get_current_principal`,**不要在 service 里再读 request**。

### 3. Service 是「持有 session 的有状态类」,查询走 `session.execute + scalars`

Service 在构造期接收 `AsyncSession`,字段命名为 `_session`;查询统一走 SQLAlchemy 2.x `select(...) → execute → scalars().all()/.first()`。证据:

- `backend/app/modules/change_writer/service.py:44-45`、`backend/app/modules/git_gateway/service.py:160-161`:`def __init__(self, session: AsyncSession) -> None: self._session = session`;需要操作者身份时多带一个参数,见 `backend/app/modules/admin/users_service.py:54` `def __init__(self, session: AsyncSession, actor_id: uuid.UUID)`。
- `backend/app/modules/change/service.py:62,69` 同款构造。
- 查询形态(`backend/app/modules/change/service.py:145,151,163`):`(await self._session.execute(count_stmt)).scalar() or 0`、`list((await self._session.execute(base)).scalars().all())`、`.scalars().first()`;`backend/app/modules/worktree/service.py:185,213` 同款。
- Service 间组合**复用同一 session**(不要各自开新事务):`backend/app/modules/change/service.py:87` `SpecWorkspaceService(self._session).get(...)`。
- 在 router 之外(后台任务/启动钩子)手动开 session 时,用 `async with get_session_factory()() as session:`(`backend/app/main.py:305,341`),**不要** `Depends(get_session)`。

### 4. 异常分层:`AppError` 为域错误基类,路由层不手写 `HTTPException`

领域错误继承 `AppError`,由全局 handler 统一翻译成固定响应体(`code/message/request_id/details`)。证据:

- 基类与契约:`backend/app/core/errors.py:1-12`(响应形状文档)、`backend/app/core/errors.py:28-38`(`class AppError(Exception)`,`code`/`http_status` 为类属性,可在 `__init__` 实例级覆盖)。
- 典型领域异常:`backend/app/modules/release/service.py:45,50,55`(`ReleaseError(AppError)` → `ReleaseNotAllowed` / `ReleaseNotFound`)、`backend/app/modules/git_identity/service.py:23,28,33`(`IdentityNotFound / IdentityRevoked / IdentityExpired`)、`backend/app/modules/daemon/lease_service.py:28,35,42,49`(`LeaseConflict / LeaseNotFound / LeaseTokenMismatch / LeaseNotClaimable`)、`backend/app/modules/ppm/task/service.py:80-102`(域内再分一层 `TaskError(AppError)` 作子基类)。
- 全局注册:`backend/app/core/errors.py:343` `register_exception_handlers(app)`,在 `backend/app/main.py:148` 挂载;`errors.py:346/360/373/396` 分别捕获 `AppError / HTTPException / RequestValidationError / Exception`。**新错误请继承 `AppError` 并给 `code`,不要在 router 里 `raise HTTPException`。**

### 5. Schema/Model 分治与 ORM ↔ Pydantic 转换

- 持久化模型统一继承 `backend/app/models/base.py:13` 的 `BaseModel(SQLModel)`,以 `table=True` 落表(如 `backend/app/modules/change/model.py:96` `class Change(BaseModel, table=True)`)。
- 出入参 DTO 子类化(同 `BaseModel`),用 `model_config = ConfigDict(from_attributes=True)` 开启 ORM → Pydantic 转换:`backend/app/modules/worktree/schema.py:20`、`backend/app/modules/workspace/schema.py:188`、`backend/app/modules/llm_provider/schema.py:45`。少量历史写法 `model_config = {"from_attributes": True}`(如 `backend/app/modules/workflow/schema.py:21`)也接受,新代码建议用 `ConfigDict(...)` 形式。

### 6. 日志:`structlog` + 模块级 `get_logger(__name__)`,事件名点分蛇形

不在业务代码里用 `print` 或裸 `logging`。证据:`backend/app/core/logging.py:13,17` 配置 `structlog`(含 `merge_contextvars`);各 service/router 顶部 `log = get_logger(__name__)`,如 `backend/app/modules/worktree/service.py:27`、`backend/app/modules/git_gateway/service.py:30`、`backend/app/modules/health/router.py:29`、`backend/app/core/errors.py:25`。审计上下文走 `AsyncSession.info`(见 `backend/app/core/audit_hooks.py:93,104`),不要另起一套。异常统一 `log.exception("<event>", ...)`,事件名点分蛇形(如 `app.start`、`agent.stale_run_cleanup_failed`)。

### 7. 命名小细节

- 列表查询方法用 `list_`(尾下划线避开内置 `list`):`backend/app/modules/change/service.py:98` `async def list_(...)`;对应 router 用动词前缀,如 `backend/app/modules/change/router.py:71` `async def list_changes`。
- 内部方法以 `_` 前缀标内部:`backend/app/modules/change/service.py:75` `async def _resolve_change_dir(...)`。
- 数据库会话工厂懒加载、单例:`backend/app/core/db.py:24,79-83` `_SessionFactory: async_sessionmaker[AsyncSession] | None` + `get_session_factory()`;`get_session` 是给 `Depends` 用的依赖生成器(`backend/app/core/db.py:146`)。
