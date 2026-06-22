---
id: task-02
title: runtime 方法迁入 runtime/service.py（RuntimeService），facade 改委托
priority: P0
depends_on: [task-01]
blocks: [task-07]
requirement_ids: [FR-02]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/service.py
author: qinyi
created_at: 2026-06-22T10:21:00+08:00
---

# task-02 runtime 方法迁入 runtime/service.py（RuntimeService），facade 改委托

## 修改文件（精确路径与操作）

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新增 | `backend/app/modules/daemon/runtime/service.py` | 定义 `RuntimeService` 类，承接 `DaemonService` 的 10 个 runtime 方法 + 2 个私有辅助 |
| 修改 | `backend/app/modules/daemon/service.py` | `DaemonService` 的 10 个 runtime 方法体改为 `return await self._rt.<method>(...)` 委托；删除已迁出的方法体实现与 `DEFAULT_RUNTIME_STALE_SECONDS` 常量（常量随迁） |

> `runtime/__init__.py` 由 task-01 已建（空壳子包），本任务不新建 `__init__.py`。
> runtime 相关异常类 `DaemonRuntimeNotFound` / `DaemonRuntimeOffline` **此 task 先留在 `service.py`**（task-07 统一迁子包 + facade re-export）。`RuntimeService` 通过 `from app.modules.daemon.service import DaemonRuntimeNotFound` 引用即可（无循环：service.py 不 import runtime/service.py 的 RuntimeService，RuntimeService 由 DaemonService 构造期持有，但 service.py 顶层 import 异常类即可）。

## 覆盖来源（FR-02, D-004@v1）

- **FR-02**（51 方法按 5 子域归位）：本 task 完成 runtime 子域 10 方法归位。
- **D-004@v1**（方案 A 5 子域标准粒度，session 不细分）：runtime 作为 5 子域之一独立成包，粒度符合 D-004。

## 实现要求

1. 在 `backend/app/modules/daemon/runtime/service.py` 新建 `RuntimeService` 类，构造签名 `def __init__(self, session: AsyncSession) -> None`，内部 `self._session = session`（与 `DaemonService` 现有约定一致，见 design §7.2）。
2. 将 `DaemonService` 中以下方法**逐字搬运**到 `RuntimeService`（方法体不变、签名不变、返回值不变、异常类型不变）：
   - `register_runtime`
   - `heartbeat`
   - `get_runtime`
   - `list_runtimes`
   - `mark_offline`
   - `disable_runtime`
   - `delete_runtime`
   - `enable_runtime`
   - `cleanup_stale_runtimes`
   - `_get_owned_runtime`（私有辅助，随主方法 `disable_runtime`/`delete_runtime`/`enable_runtime` 归位，design §6 已列）
   - `_is_recent_heartbeat`（私有辅助 + `@staticmethod`，随 `enable_runtime` 归位，design §6 已列）
3. `DEFAULT_RUNTIME_STALE_SECONDS = 45` 常量**随迁移**到 `runtime/service.py` 顶部（`RuntimeService.enable_runtime` / `cleanup_stale_runtimes` 默认参数引用它）。`service.py` 中删除该常量定义；若 facade `DaemonService` 的委托方法签名需要默认值（`enable_runtime` / `cleanup_stale_runtimes` 的 `max_age_seconds: int = DEFAULT_RUNTIME_STALE_SECONDS`），facade 侧改用**字面量 `45`** 或从 `runtime/service.py` import 常量——本 task 选择「facade 签名默认值用字面量 `45`」，避免 service.py 顶层 import runtime 子包（保持 facade 与子包单向依赖：子包 import facade 的异常类，facade 不 import 子包模块级符号，仅构造期持有实例）。
4. `RuntimeService` 的方法体中所有异常类引用（`DaemonRuntimeNotFound`）改为 `from app.modules.daemon.service import DaemonRuntimeNotFound` 顶层 import。
5. `service.py` 中 `DaemonService` 的 10 个 runtime 方法**保留同名方法签名**，方法体改为单行委托：
   ```python
   async def heartbeat(self, runtime_id: uuid.UUID) -> DaemonRuntime:
       return await self._rt.heartbeat(runtime_id)
   ```
   私有辅助 `_get_owned_runtime` / `_is_recent_heartbeat` 在 facade 上**不再保留同名方法**（它们是 runtime 内部实现细节，facade 的其他子域不会调用 runtime 私有辅助）——但若 task-01 的 facade 骨架已在 facade 上留了这两个私有方法的委托，则保留委托 `return await self._rt._get_owned_runtime(...)` / `return self._rt._is_recent_heartbeat(...)`（`_is_recent_heartbeat` 是 staticmethod，facade 委托形式为 `return RuntimeService._is_recent_heartbeat(...)` 或 `return self._rt._is_recent_heartbeat(...)`，二者等价，选后者保持一致性）。
6. 迁移后 `DaemonService.__init__`（task-01 已建）中的 `self._rt = RuntimeService(session)` 保持不变（task-01 已建骨架），本 task 仅补全 `RuntimeService` 类体 + 改 facade 方法体为真实委托。
7. `runtime/service.py` 顶部 import 清单（按字母序，ruff 规范）：
   ```python
   from __future__ import annotations

   import uuid
   from datetime import UTC, datetime, timedelta
   from typing import TYPE_CHECKING

   from sqlalchemy import or_, select
   from sqlalchemy.ext.asyncio import AsyncSession
   from sqlmodel import col

   from app.core.logging import get_logger
   from app.modules.daemon.model import DaemonRuntime
   from app.modules.daemon.service import DaemonRuntimeNotFound

   if TYPE_CHECKING:
       pass

   log = get_logger(__name__)

   DEFAULT_RUNTIME_STALE_SECONDS = 45
   ```
   > 实际 import 以搬运后 ruff/mypy 通过为准，上面是预期清单。

## 接口定义（照此搬砖）

### RuntimeService 类签名（`runtime/service.py`）

```python
class RuntimeService:
    """Runtime lifecycle: register / heartbeat / enable / disable / cleanup."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def register_runtime(
        self,
        user_id: uuid.UUID,
        *,
        name: str | None = None,
        provider: str | None = None,
        version: str | None = None,
        os: str | None = None,
        arch: str | None = None,
        capabilities: dict | None = None,
    ) -> DaemonRuntime: ...

    async def heartbeat(self, runtime_id: uuid.UUID) -> DaemonRuntime: ...

    async def get_runtime(self, runtime_id: uuid.UUID) -> DaemonRuntime | None: ...

    async def list_runtimes(self, user_id: uuid.UUID) -> list[DaemonRuntime]: ...

    async def mark_offline(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID | None = None,
    ) -> DaemonRuntime: ...

    async def disable_runtime(
        self, runtime_id: uuid.UUID, user_id: uuid.UUID
    ) -> DaemonRuntime: ...

    async def delete_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None: ...

    async def enable_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        max_age_seconds: int = DEFAULT_RUNTIME_STALE_SECONDS,
    ) -> DaemonRuntime: ...

    async def cleanup_stale_runtimes(
        self,
        max_age_seconds: int = DEFAULT_RUNTIME_STALE_SECONDS,
    ) -> int: ...

    async def _get_owned_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> DaemonRuntime: ...

    @staticmethod
    def _is_recent_heartbeat(value: datetime | None, max_age_seconds: int) -> bool: ...
```

> 方法体内容 = `DaemonService` 现有实现逐字搬运（`self._session` 不变，因 RuntimeService 也用 `self._session`）。

### facade 委托伪代码（`service.py` 中 `DaemonService` 改写）

```python
class DaemonService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._rt = RuntimeService(session)
        # ... 其他 4 子 service 由对应 task 接入，本 task 不动 ...

    # ── Runtime operations（委托 RuntimeService）────────────────────────
    async def register_runtime(
        self,
        user_id: uuid.UUID,
        *,
        name: str | None = None,
        provider: str | None = None,
        version: str | None = None,
        os: str | None = None,
        arch: str | None = None,
        capabilities: dict | None = None,
    ) -> DaemonRuntime:
        return await self._rt.register_runtime(
            user_id,
            name=name,
            provider=provider,
            version=version,
            os=os,
            arch=arch,
            capabilities=capabilities,
        )

    async def heartbeat(self, runtime_id: uuid.UUID) -> DaemonRuntime:
        return await self._rt.heartbeat(runtime_id)

    async def get_runtime(self, runtime_id: uuid.UUID) -> DaemonRuntime | None:
        return await self._rt.get_runtime(runtime_id)

    async def list_runtimes(self, user_id: uuid.UUID) -> list[DaemonRuntime]:
        return await self._rt.list_runtimes(user_id)

    async def mark_offline(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID | None = None,
    ) -> DaemonRuntime:
        return await self._rt.mark_offline(runtime_id, user_id)

    async def disable_runtime(
        self, runtime_id: uuid.UUID, user_id: uuid.UUID
    ) -> DaemonRuntime:
        return await self._rt.disable_runtime(runtime_id, user_id)

    async def delete_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        return await self._rt.delete_runtime(runtime_id, user_id)

    async def enable_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        max_age_seconds: int = 45,  # DEFAULT_RUNTIME_STALE_SECONDS 随迁后字面量
    ) -> DaemonRuntime:
        return await self._rt.enable_runtime(
            runtime_id, user_id, max_age_seconds=max_age_seconds
        )

    async def cleanup_stale_runtimes(
        self,
        max_age_seconds: int = 45,  # 同上
    ) -> int:
        return await self._rt.cleanup_stale_runtimes(max_age_seconds)
```

> `_get_owned_runtime` / `_is_recent_heartbeat` 是 runtime 内部辅助，**facade 不保留同名委托**（除非 task-01 骨架已写，则保留为 `return await self._rt._get_owned_runtime(...)` / `return self._rt._is_recent_heartbeat(...)`）。判断依据：`grep -n "_get_owned_runtime\|_is_recent_heartbeat" service.py`，若 facade 内除 runtime 方法体外无其他调用点，则可删；若有（理论上不应有，因为只有 runtime 方法用），则保留委托。

## 边界处理（至少 5 条）

1. **方法签名零变**：10 个方法的参数名、参数顺序、关键字参数 `*` 分隔、默认值、返回类型注解、异常类型**逐位一致**（design §7.1 "签名不变"铁律）。迁移前后用 `git diff` 核对 `DaemonService.<method>` 的签名行必须仅方法体变化、签名行零变化。
2. **异常类暂留 service.py**：`DaemonRuntimeNotFound` / `DaemonRuntimeOffline` 此 task **不迁**，留在 `service.py` 顶部原位（task-07 统一迁子包 + facade re-export）。`RuntimeService` 通过 `from app.modules.daemon.service import DaemonRuntimeNotFound` 引用——这构成 `runtime/service.py → service.py` 的单向依赖，`service.py` 不 import `runtime/service.py` 的模块级符号（仅在 `__init__` 中 `RuntimeService(session)` 实例化，实例化不触发模块级循环），**无循环 import 风险**。若 mypy/ruff 报循环（理论上不会，因 service.py 的顶层 import 不含 runtime/service.py），回退方案：异常类改用 `if TYPE_CHECKING:` import 或直接在 runtime/service.py 内临时复制定义（task-07 删除复制）。
3. **常量随迁 + facade 用字面量**：`DEFAULT_RUNTIME_STALE_SECONDS = 45` 从 `service.py` 删除，迁入 `runtime/service.py`。`DaemonService.enable_runtime` / `cleanup_stale_runtimes` 的 `max_age_seconds` 默认值改用字面量 `45`（注释 `# DEFAULT_RUNTIME_STALE_SECONDS 随迁后字面量`），**不**从 `runtime/service.py` import 常量——保持 facade 不依赖子包模块级符号的单向依赖原则。task-07 异常类 re-export 时若需统一常量来源，再评估是否在 facade re-export 常量。
4. **私有辅助随迁**：`_get_owned_runtime`（被 `disable_runtime`/`delete_runtime`/`enable_runtime` 调用）和 `_is_recent_heartbeat`（被 `enable_runtime` 调用）随主方法迁入 `RuntimeService`，design §6 已明确列出。迁后 `DaemonService` 内若仍有对这两个私有方法的引用（仅 runtime 方法体，迁后已删），需清理；非 runtime 子域不会调用 runtime 私有辅助（grep 确认）。
5. **`_is_recent_heartbeat` 是 `@staticmethod`**：迁移时保留 `@staticmethod` 装饰器不动。facade 委托形式：若 task-01 骨架未保留 facade 的 `_is_recent_heartbeat`，则不补；若已保留，委托写法为 `return self._rt._is_recent_heartbeat(value, max_age_seconds)`（实例调用 staticmethod 合法，等价于 `RuntimeService._is_recent_heartbeat(...)`）。**不**在 facade 重复 `@staticmethod` 装饰（facade 的是实例委托方法）。
6. **`register_runtime` 幂等逻辑零改动**：`register_runtime` 的"按 user_id + provider + name 查 existing → update 或 create"幂等分支（service.py 现有实现）逐字搬运，不优化、不重构、不合并 commit。design §3 N4 明确"纯结构重构，无逻辑变更"。
7. **日志 logger 命名空间**：`RuntimeService` 用 `log = get_logger(__name__)`，`__name__` 变为 `app.modules.daemon.runtime.service`（原 `app.modules.daemon.service`）。日志 key（如 `daemon_runtime_registered`）不变，仅 logger 名称变化——可接受（运维按 key 检索不按 logger 名）。若需保持 logger 名完全一致，可在 runtime/service.py 用 `get_logger("app.modules.daemon.service")` 字面量，但本 task 选择 `__name__` 自然值（更符合子包化后的模块边界）。
8. **facade `__init__` 不重复初始化**：`self._rt = RuntimeService(session)` 已由 task-01 建好，本 task **不**改 `__init__`，仅补 `RuntimeService` 类体 + 改 facade 方法体。若 task-01 因 RuntimeService 未定义而用了 `# placeholder` 注释占位，本 task 删除占位、接入真实 `RuntimeService`。

## 非目标

- **不动异常类 re-export**：`DaemonRuntimeNotFound` / `DaemonRuntimeOffline` 不迁子包、不在 facade 加 re-export 语句（task-07 范围）。
- **不动 router.py**：facade 签名兼容，router 零改动（design §3 N3、§9）。`git diff router.py` 必须为空。
- **不动 `DaemonLeaseService` / `permission_service.py` / `ws_hub.py`**：本 task 仅动 `runtime/service.py` 和 `service.py` 两个文件（allowed_paths 锁定）。
- **不迁其他子域**：lease / run_sync / session / patch 由 task-03~06 负责，本 task 只迁 runtime。
- **不改 `register_runtime` 等方法体逻辑**：纯搬运，design §3 N4 铁律。
- **不补 `runtime/__init__.py` 的导出**：task-01 已建空 `__init__.py`，本 task 不改它（`RuntimeService` 由 `DaemonService.__init__` 通过 `from app.modules.daemon.runtime.service import RuntimeService` 直接 import，不经 `__init__` 导出）。
- **不写新测试**：迁移行为不变，复用现有 daemon 测试套件作为安全网（design §5.3 W2 "全测 + mypy + ruff"）。

## 参考

- **design §5.1 归位判据**：`DaemonRuntime`（注册/心跳/启停）→ runtime 子域。
- **design §6 文件清单**：`runtime/service.py` 承载 register/heartbeat/get/list/mark_offline/enable/disable/delete/cleanup_stale + `_get_owned_runtime`/`_is_recent_heartbeat`。
- **design §7.1 facade 签名不变**：方法签名/返回值/异常类型完全不变，facade 内部委托。
- **design §7.2 子 Service 构造约定**：接受 `session: AsyncSession`，与 `DaemonService` 一致。
- **design §7.5 Runtime 生命周期契约表**：
  | 事件 | 状态转移 | 关键字段 | 承载（变更后） |
  |------|---------|---------|---------------|
  | register | → online | runtime_id, user_id, last_heartbeat | runtime/service.py |
  | heartbeat | online→online（刷新） | last_heartbeat | runtime/service.py |
  | mark_offline | online→offline | status | runtime/service.py |
  | enable / disable | offline↔online(disabled) | status, placement_enabled | runtime/service.py |
  | delete | →（删除） | — | runtime/service.py |
- **源码定位**：`backend/app/modules/daemon/service.py` 285-498 行（runtime 方法区），`DEFAULT_RUNTIME_STALE_SECONDS = 45` 在第 37 行。
- **循环依赖验证**：task-01（W1 安全网）已验证子包 lazy import / 持有引用避免循环（design §10 R1）。

## TDD 步骤（迁移后跑 daemon 全测确认 runtime 相关测试绿）

> 本 task 为纯结构重构（搬运），无新逻辑，TDD 体现为"迁移后现有测试套件仍全绿"。

1. **迁移前基线（绿）**：在 task-01 完成后、本 task 开始前，运行
   ```
   pytest backend/app/modules/daemon/tests/ -v
   ```
   记录所有 runtime 相关测试用例为绿色基线（如 `test_register_runtime`、`test_heartbeat`、`test_cleanup_stale_runtimes`、`test_enable/disable_runtime`、`test_delete_runtime`、`test_mark_offline` 等，具体以现有测试文件为准）。
2. **迁移（搬砖）**：按「实现要求」逐字搬运 10 方法 + 2 私有辅助到 `RuntimeService`，改 facade 为委托。
3. **迁移后验证（绿）**：再次运行
   ```
   pytest backend/app/modules/daemon/tests/ -v
   ```
   对比迁移前后：用例数相同、全部通过、无新增 skip/fail。runtime 相关测试用例必须逐项绿。
4. **lint + 类型检查**：
   ```
   ruff check backend/app/modules/daemon/runtime/service.py backend/app/modules/daemon/service.py
   ruff format --check backend/app/modules/daemon/runtime/service.py backend/app/modules/daemon/service.py
   mypy backend/app/modules/daemon/runtime/service.py backend/app/modules/daemon/service.py
   ```
   全过。
5. **签名一致性核对**：`git diff backend/app/modules/daemon/service.py` 检查 `DaemonService` 的 10 个 runtime 方法的**签名行**（`async def <method>(...) -> ...:`）迁移前后逐位一致，仅方法体变化。
6. **router 零改动核对**：`git diff backend/app/modules/daemon/router.py` 必须为**空**。

## 验收标准

| AC | 验收点 | 验证方式 | 期望 |
|---|---|---|---|
| AC-1 | `RuntimeService` 类创建且含 10 方法 + 2 私有辅助 | `grep -n "class RuntimeService" runtime/service.py` + 逐一核对方法名 | RuntimeService 定义存在，10 公有 + 2 私有方法齐全 |
| AC-2 | 方法签名零变（facade + RuntimeService 与原 DaemonService 一致） | `git diff` 核对 10 方法的签名行（参数名/顺序/`*`/默认值/返回注解） | 签名行逐位一致，仅方法体由实现变委托 |
| AC-3 | facade 委托正确 | `grep -n "self._rt\." service.py` 在 10 个 runtime 方法体内各命中 1 次 | 10 处 `return await self._rt.<method>(...)`，无残留原实现 |
| AC-4 | `DEFAULT_RUNTIME_STALE_SECONDS` 随迁 | `grep -n "DEFAULT_RUNTIME_STALE_SECONDS" runtime/service.py service.py` | 常量定义仅在 runtime/service.py；facade 默认值用字面量 `45` |
| AC-5 | 异常类暂留 service.py（不迁、不 re-export） | `grep -n "class DaemonRuntimeNotFound\|class DaemonRuntimeOffline" service.py` | 两个异常类仍在 service.py 原位定义 |
| AC-6 | 无循环 import | `python -c "from app.modules.daemon.runtime.service import RuntimeService"` + `from app.modules.daemon.service import DaemonService` | 两条 import 均成功，无 ImportError |
| AC-7 | daemon 全测通过 | `pytest backend/app/modules/daemon/tests/ -v` | 全绿，用例数与迁移前一致，runtime 相关用例逐项绿 |
| AC-8 | lint + 类型检查通过 | `ruff check` + `ruff format --check` + `mypy` 两个文件 | 全过，无 error |
| AC-9 | router 零改动 | `git diff backend/app/modules/daemon/router.py` | diff 为空（design §3 N3 / D-002 铁证） |
| AC-10 | 变更范围受限 | `git diff --name-only` | 仅 `runtime/service.py`（新增）+ `service.py`（修改）两个文件 |
| AC-11 | Runtime 生命周期契约不变 | 对照 design §7.5 runtime 契约表，register/heartbeat/mark_offline/enable/disable/delete 状态转移迁移前后一致 | 6 事件状态流转零变更 |
