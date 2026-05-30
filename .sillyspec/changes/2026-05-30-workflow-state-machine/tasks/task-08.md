---
id: task-08
title: "get_session 注入 audit_context"
priority: P0
estimated_hours: 1
depends_on: [task-07]
blocks: [task-09]
allowed_paths:
  - backend/app/core/db.py
---

# task-08: get_session 注入 audit_context

## 修改文件（必填）
- `backend/app/core/db.py` — 修改 get_session 函数签名和实现

## 实现要求

### 目标

修改 `get_session()` 函数，在 yield session 之前，尝试从 FastAPI 请求上下文获取当前认证用户信息，并注入 `audit_context` 到 `session.info`。后续 `audit_hooks.py`（task-09）会读取 `session.info["audit_context"]` 来记录审计日志的 actor。

### audit_context 数据结构

```python
# session.info["audit_context"]
{
    "actor_id": uuid.UUID,           # 当前认证用户的 ID
    "workspace_id": uuid.UUID | None, # 当前工作区 ID（可选，非所有路由都有 workspace_id）
}
```

### 修改后的 get_session 签名

```python
from fastapi import Request

async def get_session(
    request: Request = None,  # Optional — 不传或不在 FastAPI 上下文中时为 None
) -> AsyncIterator[AsyncSession]:
```

**重要**：FastAPI 的依赖注入系统会将 `Request` 自动注入。但 `get_session` 也可能在 FastAPI 上下文外被调用（lifespan、后台任务），因此 `request` 必须有默认值 `None`。

### 控制流伪代码

```python
async def get_session(request: Request = None) -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    async with factory() as session:
        # --- 注入 audit_context ---
        _inject_audit_context(session, request)
        # --- end ---
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
```

### _inject_audit_context 辅助函数

```python
import uuid

def _inject_audit_context(session: AsyncSession, request: Request | None) -> None:
    """Try to inject audit_context from FastAPI request into session.info.

    Silently skips if:
    - request is None (outside FastAPI, e.g. lifespan, background tasks)
    - user is not authenticated (system operations)
    - session.info already has audit_context (caller set it manually)
    """
    if request is None:
        return
    if "audit_context" in session.info:
        return

    # 从 request.state 获取已认证的用户信息
    # 这需要 get_current_user / get_optional_user 在更早的依赖链中
    # 将 user 信息存入 request.state
    user = getattr(request.state, "user", None)
    if user is None:
        return

    actor_id = getattr(user, "id", None)
    if actor_id is None:
        return

    workspace_id = None
    # 尝试从路径参数获取 workspace_id
    path_params = request.path_params
    if "workspace_id" in path_params:
        try:
            workspace_id = uuid.UUID(path_params["workspace_id"])
        except (ValueError, TypeError):
            pass

    session.info["audit_context"] = {
        "actor_id": actor_id,
        "workspace_id": workspace_id,
    }
```

### 与现有 get_current_user 的集成

**关键问题**：`get_current_user` 依赖 `Depends(get_session)`，所以 `get_session` 不能反过来依赖 `get_current_user`（循环依赖）。

**解决方案**：不在 `get_session` 中直接调用 `get_current_user`。而是在 `get_current_user`（以及 `get_optional_user`）成功认证后，将 user 对象存入 `request.state.user`，使得后续同一个请求中的 `get_session` 可以读取。

**但** FastAPI 的依赖解析顺序是：`get_session` 先被解析（因为 `get_current_user` 依赖它），所以 `get_session` 运行时 `request.state.user` 还不存在。

**最终方案**：修改策略 — 不在 `get_session` yield 之前注入，而是在 `get_session` yield 之后、路由 handler 执行之前，通过一个轻量的方式注入。

**推荐实现**：采用 **lazy 注入** 模式。`get_session` 注册一个 session event hook（`before_flush`），在第一次实际使用 session 时从 `request.state.user` 读取。但这样实现复杂。

**实际推荐方案**：在 `get_session` 中直接尝试从 `request.scope` 中读取已有的认证信息（不依赖 `get_current_user`），或者采用更简单的方式：

#### 最终实现方案（推荐）

不在 `get_session` 中主动注入。改为提供一个辅助函数 `set_audit_context`，在 `get_current_user` 成功后调用。同时在 `get_session` 中注册 `before_flush` hook，在 flush 时检查 `session.info["audit_context"]`。

**不，这太复杂了。回到最简方案。**

#### 最简方案（最终推荐）

**观察**：在 FastAPI 依赖图中，`get_session` 被注入到路由 handler，同时也被 `get_current_user` 依赖。FastAPI 保证同一请求中同一个 dependency 只执行一次（缓存）。所以执行顺序是：

1. FastAPI 解析路由 handler 的依赖
2. `get_current_user` 需要 `get_session`，所以先执行 `get_session` → yield session
3. `get_current_user` 执行，拿到 session 和 request，认证用户
4. 路由 handler 收到 session（同一个对象）和 user

**问题**：`get_session` yield 时 user 还没认证。

**解决**：把注入逻辑放在 `get_session` yield 之后、session 被关闭之前。但 yield 后代码在路由 handler 返回后才执行。

**最终最简方案**：

```python
async def get_session(request: Request = None) -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    async with factory() as session:
        if request is not None:
            # 注册 before_flush 监听器，在第一次 flush/commit 前注入
            # 但这样做需要在 audit_hooks 中配合
            # 最简方案：把 request 存到 session.info，让 audit_hooks 自己读
            session.info["request"] = request
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
```

然后在 `audit_hooks.py`（task-09）中：

```python
def _get_audit_context(session: AsyncSession) -> dict | None:
    # 优先使用手动设置的 audit_context
    if "audit_context" in session.info:
        return session.info["audit_context"]
    # 其次从 request 推导
    request = session.info.get("request")
    if request is None:
        return None
    user = getattr(request.state, "user", None)
    ...
```

**但** task-09 不负责这个，而且 design.md 明确说 task-08 负责"注入 audit_context"。

#### 最终确定方案

**在 `get_session` 中把 `request` 引用存入 `session.info["request"]`。同时提供一个 `sync_audit_context(session)` 辅助函数，在 `get_current_user` 认证成功后立即调用，将 user 信息写入 `session.info["audit_context"]`。**

但 task-08 的要求说"不修改 auth_deps.py"。所以不能在 `get_current_user` 中调用。

#### 真正的最终方案

**采用 SQLAlchemy `before_flush` 事件**。在 `get_session` 中：

1. 把 `request` 存入 `session.info["request"]`
2. 注册一个一次性的 `before_flush` 钩子，在首次 flush 时从 `request.state.user` 读取用户信息并注入 `audit_context`
3. 注入后自动移除钩子

```python
from sqlalchemy import event

async def get_session(request: Request = None) -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    async with factory() as session:
        if request is not None:
            session.info["request"] = request
            # 注册 before_flush 钩子，在首次 flush 时注入 audit_context
            @event.listens_for(session.sync_session, "before_flush")
            def _inject_on_flush(sync_session, flush_context, instances):
                if "audit_context" in session.info:
                    return
                req = session.info.get("request")
                if req is None:
                    return
                user = getattr(req.state, "user", None)
                if user is None:
                    return
                actor_id = getattr(user, "id", None)
                if actor_id is None:
                    return
                workspace_id = None
                path_params = req.path_params
                if "workspace_id" in path_params:
                    try:
                        import uuid
                        workspace_id = uuid.UUID(path_params["workspace_id"])
                    except (ValueError, TypeError):
                        pass
                session.info["audit_context"] = {
                    "actor_id": actor_id,
                    "workspace_id": workspace_id,
                }
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
```

**等等，这也有问题**。`get_current_user` 中间件在 `get_session` 之后才执行。当 `before_flush` 触发时，`get_current_user` 早已执行完毕，`request.state.user` 应该已经被设置了（如果路由 handler 依赖了 `get_current_user`）。

**但是**：如果路由 handler 没有 `await` 任何需要认证的依赖，直接就 flush 了怎么办？不太可能，因为所有路由都有认证依赖。而且即使没有，audit hook 也不会记录（因为 `audit_context` 为空）。

**最终确认此方案可行**，理由：
- `before_flush` 在 session.flush() 或 commit() 时触发
- 到那时路由 handler 已经在执行，认证依赖已经被解析
- `request.state.user` 已被设置（如果路由有认证）

**但**，看现有 `get_current_user` 代码（`auth_deps.py:41-63`），它**不会**将 user 存入 `request.state`。它只是 return user。所以 `request.state.user` 不存在。

#### 重新审视 — 真正可行的方案

回到核心问题：`get_session` 执行时 user 还未认证。那就在 `get_session` 中只存 `request` 引用到 `session.info`，让 **audit_hooks** 在 `after_insert/after_update/after_delete` 事件触发时自己从 `session.info["request"]` → `request.state.user` 读取。

但这要求 `get_current_user` 在认证成功后将 user 存入 `request.state.user`。而 task-08 说"不修改 auth_deps.py"。

**解决方案**：在 `get_session` 中存 `request`，在 audit_hooks 中直接解码 JWT token 获取 user_id（不依赖 `get_current_user` 的结果）。但这样会重复认证逻辑。

**最终最终方案（务实）**：

修改 `get_session`：
1. 接受可选的 `request: Request = None` 参数
2. 如果有 request，存入 `session.info["request"]`
3. 尝试从 request 中直接解码 bearer token（复用 `auth_deps._extract_bearer` 和 `security.decode_access_token`）获取 user_id
4. 如果解码成功，注入 `audit_context`
5. 如果解码失败（无 token、无效 token），不注入

```python
async def get_session(request: Request = None) -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    async with factory() as session:
        if request is not None and "audit_context" not in session.info:
            _try_inject_audit_context(session, request)
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


def _try_inject_audit_context(session: AsyncSession, request: Request) -> None:
    """尝试从 request 的 Authorization header 解码用户并注入 audit_context。"""
    # 延迟导入避免循环依赖
    from app.core.auth_deps import _extract_bearer
    from app.core.config import get_settings
    from app.core.security import AccessTokenError, decode_access_token

    token = _extract_bearer(request)
    if not token:
        return

    try:
        settings = get_settings()
        payload = decode_access_token(token, settings=settings)
    except (AccessTokenError, Exception):
        return  # 无效 token，静默跳过

    if payload.sub is None:
        return

    workspace_id = None
    path_params = request.path_params
    if "workspace_id" in path_params:
        try:
            import uuid
            workspace_id = uuid.UUID(path_params["workspace_id"])
        except (ValueError, TypeError):
            pass

    session.info["audit_context"] = {
        "actor_id": payload.sub,
        "workspace_id": workspace_id,
    }
```

**问题**：`_extract_bearer` 是 `auth_deps` 模块的内部函数（以 `_` 开头）。依赖内部函数不好。

**改进**：在 `db.py` 内部自己解析 Authorization header，不依赖 `auth_deps._extract_bearer`：

```python
def _extract_token_from_request(request: Request) -> str | None:
    """从 Authorization header 提取 Bearer token。"""
    raw = request.headers.get("authorization") or request.headers.get("Authorization")
    if not raw:
        return None
    parts = raw.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None
```

这段逻辑与 `auth_deps._extract_bearer` 重复，但完全独立、无外部依赖。

## 接口定义

### 修改后的 get_session 签名

```python
from fastapi import Request

async def get_session(
    request: Request = None,
) -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: yield a session with audit_context injected when possible."""
```

### 新增模块级函数

```python
def _extract_token_from_request(request: Request) -> str | None:
    """从 Authorization header 提取 Bearer token。不依赖 auth_deps。"""


def _try_inject_audit_context(session: AsyncSession, request: Request) -> None:
    """尝试解码 Bearer token 并注入 audit_context 到 session.info。

    成功时 session.info["audit_context"] = {"actor_id": uuid.UUID, "workspace_id": uuid.UUID | None}
    失败时静默跳过，不抛异常。
    """
```

### 新增 import

```python
# 文件顶部新增
import uuid

from fastapi import Request
```

注意：`uuid` 已被 `workspace_id` 解析逻辑使用。`Request` 用于函数签名。

延迟导入（在函数内部）：
```python
from app.core.config import get_settings
from app.core.security import AccessTokenError, decode_access_token
```

### session.info 数据布局

| Key | Type | 设置时机 | 说明 |
|-----|------|---------|------|
| `audit_context` | `dict` | get_session yield 前 | `{"actor_id": uuid.UUID, "workspace_id": uuid.UUID \| None}` |

### 控制流

```
get_session(request)
  ├── factory = get_session_factory()
  ├── async with factory() as session:
  │     ├── if request is not None:
  │     │     └── _try_inject_audit_context(session, request)
  │     │           ├── _extract_token_from_request(request) → token
  │     │           ├── if no token → return (不注入)
  │     │           ├── decode_access_token(token) → payload
  │     │           ├── if decode fails → return (不注入)
  │     │           ├── extract workspace_id from path_params
  │     │           └── session.info["audit_context"] = {actor_id, workspace_id}
  │     ├── try: yield session
  │     └── except: rollback + raise
```

## 边界处理（至少 5 条）

1. **无 Request 对象（系统任务、后台 job、lifespan）**：`request` 参数为 `None`，不进入注入逻辑，`session.info` 中没有 `audit_context`。audit hook 检测到缺失后静默跳过。
2. **Request 无 Authorization header（未认证端点）**：`_extract_token_from_request` 返回 `None`，不注入。audit hook 静默跳过。
3. **Token 无效或过期**：`decode_access_token` 抛异常被 `except` 捕获，不注入。不抛出异常到上层（静默吞掉）。
4. **session.info 已有 audit_context（手动预设）**：在 `_try_inject_audit_context` 开头检查 `"audit_context" not in session.info`，已有则不覆盖。
5. **测试环境**：测试通过 `dependency_overrides` 替换 `get_session`，不触发注入逻辑。直接使用 `db_session` fixture 的测试也不会有 `request`。
6. **路径无 workspace_id（如 /api/auth/login）**：`workspace_id` 设为 `None`，`audit_context` 中 `workspace_id` 为 `None`。
7. **workspace_id 格式非法**：`uuid.UUID()` 转换失败被 `except (ValueError, TypeError)` 捕获，`workspace_id` 保持 `None`。
8. **get_settings 抛异常**：`_try_inject_audit_context` 的最外层 `except Exception` 捕获，不注入，不传播异常。

## 非目标

- 不写测试（task-09 负责 audit hooks 测试）
- 不修改路由层代码
- 不修改 `auth_deps.py`
- 不创建 `audit_hooks.py`（task-09 负责）
- 不改变 session 的 `autoflush` / `expire_on_commit` 等行为
- 不处理 bulk insert 的审计（design.md 已记录为已知限制）

## 参考

- **design.md** "AuditContext 数据结构" 章节：`session.info["audit_context"]` 结构定义为 `{"actor_id": uuid.UUID, "workspace_id": uuid.UUID}`
- **db.py** 当前 `get_session` 实现：60-68 行，纯 yield session + rollback on error
- **auth_deps.py** 用户认证方式：`get_current_user` 通过 `_extract_bearer` + `decode_access_token` 解码 JWT
- **conftest.py** 测试覆盖：通过 `app.dependency_overrides[get_session]` 替换，不会触发注入逻辑
- **security.py** `decode_access_token` 返回 payload 对象，`payload.sub` 为 user_id (uuid.UUID)

## TDD 步骤

1. 修改 `db.py`：新增 `_extract_token_from_request` 和 `_try_inject_audit_context` 函数
2. 修改 `get_session` 函数签名，添加 `request: Request = None` 参数
3. 在 `get_session` 中调用 `_try_inject_audit_context`
4. 运行 `python -c "from app.core.db import get_session"` 验证可 import
5. 运行全量测试 `cd backend && python -m pytest` 确认现有测试通过
6. 确认测试中 `get_session` 不受影响（因为被 override 了）

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | 修改后 `from app.core.db import get_session` 可正常导入 | 无报错，无 ImportError |
| AC-02 | 有 Bearer token 的请求：session.info 包含 `audit_context`，`actor_id` 与 token 中 `sub` 一致 | `session.info["audit_context"]["actor_id"] == payload.sub` |
| AC-03 | 无 Bearer token 的请求：session.info 不包含 `audit_context` | `"audit_context" not in session.info` |
| AC-04 | 无效 token（过期、伪造）：session.info 不包含 `audit_context`，不抛异常 | 无报错，无 audit_context |
| AC-05 | request 为 None（非 FastAPI 上下文）：session.info 不包含 `audit_context` | 无报错 |
| AC-06 | 路径包含 `workspace_id` 时：`audit_context["workspace_id"]` 为正确 UUID | UUID 值正确 |
| AC-07 | 路径不含 `workspace_id` 时：`audit_context["workspace_id"]` 为 None | `workspace_id is None` |
| AC-08 | 运行全量测试 `python -m pytest` | 所有现有测试通过，无回归 |
| AC-09 | `get_session` 的 `autoflush=False` 和 `expire_on_commit=False` 未改变 | session factory 配置不变 |
| AC-10 | `session.info` 已有 `audit_context` 时：不覆盖 | 原有值保留 |
