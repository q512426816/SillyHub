---
id: task-01
title: 新建 5 子包空壳 + DaemonService 改为持有 5 子 service 引用的 facade（方法体暂保留原逻辑直接委托），跑 daemon 全测确认行为不变
priority: P0
wave: W1
depends_on: []
blocks: [task-02, task-03, task-04, task-05, task-06]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/runtime/__init__.py
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/lease/__init__.py
  - backend/app/modules/daemon/lease/service.py
  - backend/app/modules/daemon/run_sync/__init__.py
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/session/__init__.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/patch/__init__.py
  - backend/app/modules/daemon/patch/service.py
  - backend/app/modules/daemon/service.py
author: qinyi
created_at: 2026-06-22T10:21:00+08:00
---

# task-01: 新建 5 子包空壳 + DaemonService 改为持有 5 子 service 引用的 facade（方法体暂保留原逻辑直接委托），跑 daemon 全测确认行为不变

> 来源：design.md §5.2（目标目录）/ §5.3 W1（安全网）/ §6 文件清单 / §7.1 facade / §7.2 子 service 构造约定 / §7.5 契约表 / §9 兼容策略；plan.md Wave 1。
> 本质：**纯结构重构 W1 安全网**。子包先建空壳类（无业务逻辑），DaemonService `__init__` 持有 5 子 service 引用，但 51 个方法**方法体原样保留不动**。跑 daemon 全测确认行为零变化。
> 为什么这么做：让 facade 委托骨架在 W2-W6 之前先就位，后续每个 Wave 把方法体从 facade 搬到子 service 时，安全网（全测绿）始终在场。任何一个 Wave 出问题都可独立 `git revert` 而不破坏 facade 契约。

## 修改文件（精确路径）

> 共 **11 个文件**（10 新建 + 1 修改）。**禁止动 `router.py`**（D-002 零改动铁证）。

### 新建（10 个空壳）

1. `backend/app/modules/daemon/runtime/__init__.py` — 子包入口（空文件，或 `"""runtime subdomain."""` 单行 docstring）。
2. `backend/app/modules/daemon/runtime/service.py` — 定义 `class RuntimeService` 空壳。
3. `backend/app/modules/daemon/lease/__init__.py` — 子包入口。
   - 注意：design §6 规定 `lease/__init__.py` 在 W6 完成后导出 `LeaseService`；但 **task-01 此步骤保持空**（仅占位），不提前 export，避免误引导调用方。
4. `backend/app/modules/daemon/lease/service.py` — 定义 `class LeaseService` 空壳。
5. `backend/app/modules/daemon/run_sync/__init__.py` — 子包入口。
6. `backend/app/modules/daemon/run_sync/service.py` — 定义 `class RunSyncService` 空壳。
7. `backend/app/modules/daemon/session/__init__.py` — 子包入口。
8. `backend/app/modules/daemon/session/service.py` — 定义 `class SessionService` 空壳。
9. `backend/app/modules/daemon/patch/__init__.py` — 子包入口。
10. `backend/app/modules/daemon/patch/service.py` — 定义 `class PatchService` 空壳。

### 修改（1 个）

11. `backend/app/modules/daemon/service.py` — `DaemonService` 类：
    - `__init__` 末尾追加 5 行：实例化并持有 5 子 service 引用（`self._rt / self._lease / self._run / self._sess / self._patch`）。
    - **51 个方法的方法体一行不改**（原逻辑全部保留）。
    - 顶部 import 块追加 5 行子 service import。
    - **不删除任何 import、不动异常类定义、不动 dataclass（`RecoveryDecision` 等）、不动模块级常量**。

### 禁止改动（验收时 git diff 必须为空）

- `backend/app/modules/daemon/router.py` — D-002 零改动铁证。

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|------|------|------------|
| FR-01 | router.py 零改动（调用方零感知） | facade 方法签名零变化 → router git diff 必空 |
| FR-02 | DaemonService 51 方法归位（facade 化） | 本 task 先建 facade 持引用骨架，方法体留 facade（归位在 W2-W6 完成） |
| D-002@v1 | facade 完全兼容，router 零改动 | __init__ 持有引用但不破坏 51 方法 → 全测绿 = 行为不变 |

## 实现要求

### 步骤 1：建 5 子包空壳（10 文件）

每个子包建 `__init__.py`（单行 docstring）+ `service.py`（空壳类定义）。**子包 service.py 只定义类 + `__init__` 接 session，不放任何业务方法**。

`runtime/service.py` 模板（其余 4 个同构，仅类名替换）：

```python
"""Runtime subdomain service — registration / heartbeat / lifecycle.

Shell only in W1; methods migrate here in task-02 (W2).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession


class RuntimeService:
    """Runtime lifecycle operations.

    W1: empty shell. W2 (task-02) will migrate register_runtime / heartbeat /
    get_runtime / list_runtimes / mark_offline / disable_runtime /
    enable_runtime / delete_runtime / cleanup_stale_runtimes +
    _get_owned_runtime / _is_recent_heartbeat from DaemonService.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
```

5 个类名一一对应：`RuntimeService` / `LeaseService` / `RunSyncService` / `SessionService` / `PatchService`。

`__init__.py` 模板：

```python
"""runtime subdomain — daemon runtime lifecycle (register/heartbeat/启停)."""
```

> **注意**：`lease/__init__.py` 在 W1 阶段保持空 docstring 占位，**不提前 `from .service import LeaseService`**。design §6 规定 lease 子包 `__init__.py` 导出 `LeaseService` 是 W6 的事，task-01 不抢跑，避免给调用方误信号。其余 4 个子包 `__init__.py` 同样仅占位，本 task 一律不 re-export（W1 纯内部骨架，对外不可见）。

### 步骤 2：DaemonService.__init__ 追加 5 子 service 引用

修改 `backend/app/modules/daemon/service.py` 第 280-281 行的 `__init__`：

```python
# 修改前
def __init__(self, session: AsyncSession) -> None:
    self._session = session

# 修改后
def __init__(self, session: AsyncSession) -> None:
    self._session = session
    # W1 安全网：持有 5 子 service 引用。方法体仍保留在 facade（本类）内，
    # 子包为空壳。W2-W6 逐步把方法体迁入对应子 service。
    # 跨域调用通过持有引用（非 lazy import）解决循环依赖：
    # 子 service 构造期只接 session，不 import 兄弟子包。
    self._rt: RuntimeService = RuntimeService(session)
    self._lease: LeaseService = LeaseService(session)
    self._run: RunSyncService = RunSyncService(session)
    self._sess: SessionService = SessionService(session)
    self._patch: PatchService = PatchService(session)
```

> **保持 `self._session`**：51 个方法体仍用 `self._session` 直接操作 DB（W1 不动方法体），所以原 `self._session = session` 必须保留，仅在下面追加 5 行子引用。

### 步骤 3：顶部 import 追加 5 行

在 `service.py` 顶部 import 块（现有 daemon 内部 import 之后、`log = get_logger(__name__)` 之前）追加：

```python
from app.modules.daemon.lease.service import LeaseService
from app.modules.daemon.patch.service import PatchService
from app.modules.daemon.run_sync.service import RunSyncService
from app.modules.daemon.runtime.service import RuntimeService
from app.modules.daemon.session.service import SessionService
```

> 5 个子包只 import 同级的 5 个 service 类，**子 service 构造期不反向 import 兄弟子包**（避免循环）。子 service 如需跨域调用（如 session 要建 lease），留待 W2-W6 迁移方法体时用 lazy import（参考 `router.py:624` 模式）解决，本 task 不涉及。

### 步骤 4：51 方法方法体不动

- **不动**：第 285-3378 行的所有 `async def` / `def` 方法体，包括：
  - runtime 域：`register_runtime` / `heartbeat` / `get_runtime` / `list_runtimes` / `mark_offline` / `disable_runtime` / `delete_runtime` / `enable_runtime` / `cleanup_stale_runtimes` / `_get_owned_runtime` / `_is_recent_heartbeat`
  - lease 域：`create_lease` / `claim_lease` / `_build_claim_payload` / `start_lease` / `lease_heartbeat` / `complete_lease` / `get_lease` / `list_leases` / `expire_leases` / `_get_lease_and_verify_token` / `handle_lease_expiry` / `handle_expired_leases_batch`
  - run_sync 域：`sync_agent_run_status` / `close_interactive_run` / `submit_messages` / `_run_post_scan_validation` / `_trigger_stage_completion_callback` / `_publish_run_event`
  - session 域：`_get_owned_session_for_update` / `_get_current_run` / `_publish_session_event` / `create_session` / `_converge_failed_dispatch` / `inject_session` / `interrupt_session` / `end_session` / `recover_session_after_daemon_restart` / `_converge_crashed_run` / `_assert_no_other_active_run` / `confirm_session_reconnected` / `mark_session_recovery_failed` / `list_agent_sessions` / `get_agent_session` / `reopen_session` / `delete_agent_session` / `_end_session_for_delete` / `get_agent_session_logs`
  - patch 域：`_apply_patch_to_worktree` / `_run_git_apply`
- **不动**：异常类定义（第 40-271 行）、dataclass（`RecoveryDecision` 等）、模块级常量（`DEFAULT_RUNTIME_STALE_SECONDS`）、`stamp` 静态方法（第 3379 行）。

> **W1 的本质**：facade 现在持有 5 子 service 引用（`self._rt` 等）但**暂不使用**。这些引用是 W2-W6 迁移方法体时的"注入位点"。W1 阶段它们是死引用（mypy 会因未使用属性报错？不会，mypy 不检查未使用实例属性；ruff 也不报）。子 service 实例化本身只做 `self._session = session`，无副作用，不影响行为。

### 步骤 5：跑 daemon 全测确认行为不变

```bash
# 在 backend/ 下
make backend-test            # 或 pytest backend/tests -k daemon
# 重点测试集（必须全绿）：
#   - tests/modules/daemon/test_session_recovery.py (16 用例)
#   - tests/modules/daemon/test_lease_service.py
#   - tests/modules/daemon/test_run_input_service.py
#   - tests/modules/daemon/test_runtime_*.py
#   - tests/modules/daemon/test_session_*.py
```

```bash
make backend-lint            # ruff check + ruff format check + mypy
```

```bash
# router.py 零改动铁证
git diff --stat backend/app/modules/daemon/router.py   # 必须输出空
git diff backend/app/modules/daemon/router.py          # 必须无内容
```

> **测试失败处理**：W1 是纯结构重构（加 5 个空壳类 + __init__ 追加 5 行无副作用引用），按定义不可能改变行为。若测试失败，**禁止调整测试或逻辑代码绕过**，必须定位根因（最常见：子包 `__init__.py` / `service.py` 命名错误、import 路径拼错、子 service 构造抛异常），修复后重跑。

## 接口定义

### DaemonService.__init__ 签名（迁移前后对比）

```python
# 迁移前（service.py:280）
def __init__(self, session: AsyncSession) -> None:
    self._session = session

# 迁移后（task-01）—— 签名不变，仅方法体追加 5 行持引用
def __init__(self, session: AsyncSession) -> None:
    self._session = session
    self._rt: RuntimeService = RuntimeService(session)
    self._lease: LeaseService = LeaseService(session)
    self._run: RunSyncService = RunSyncService(session)
    self._sess: SessionService = SessionService(session)
    self._patch: PatchService = PatchService(session)
```

**签名契约**：`__init__(self, session: AsyncSession) -> None` **零变化**。router.py:100 `svc = DaemonService(session)` 不受影响。

### 5 子 service 构造约定（design §7.2）

所有 5 个子 service：

- 构造签名统一：`def __init__(self, session: AsyncSession) -> None: self._session = session`
- 构造期**只接 session**，不 import 兄弟子包、不建跨域引用。
- 构造期**无副作用**（不开连接、不发 RPC、不查 DB），保证 `DaemonService.__init__` 多实例化 5 子 service 不引入性能/状态变化。
- 跨域调用（如 session 要建 lease）→ **W2-W6 迁移方法体时**用 **lazy import**（函数级 `from app.modules.daemon.xxx.service import XxxService`，参考 `router.py:624` 注释）或**持引用**（通过 facade 传入），避免模块级循环 import。
- W1 阶段子 service 内部无任何业务方法，构造后即为空对象，仅作为 facade 持有的"迁移位点"存在。

### 委托方法示例（W1 阶段不实现，仅说明 W2-W6 目标形态）

```python
# W1 现状（task-01 完成后）—— 方法体仍在 facade
async def register_runtime(self, user_id, *, name=None, ...):
    # 原逻辑原样保留（3000 行类体不动）
    now = datetime.now(UTC)
    stmt = select(DaemonRuntime).where(...)
    ...

# W2 目标形态（task-02 才做，本 task 不做）—— 方法体改为委托
async def register_runtime(self, user_id, *, name=None, ...):
    return await self._rt.register_runtime(user_id, name=name, ...)
```

> **task-01 不实现委托**，子包是空壳，方法体留 facade。上例仅为说明 W1→W2 的演化方向。

## 边界处理

1. **子包空壳不得破坏现有行为**：5 个子 service `__init__` 只做 `self._session = session`，无 DB 查询、无网络调用、无文件 IO。`DaemonService.__init__` 多实例化 5 个子 service 不增加事务、不开新连接。验证手段：daemon 全测 100% 绿 + 手动核对子 service `__init__` 体仅一行赋值。

2. **facade 51 方法签名零变化**：禁止任何形式的重命名、参数增减、返回类型调整、默认值修改、装饰器增删。W1 完成后 `grep "async def\|^    def " service.py` 输出方法清单与迁移前逐位一致。若 ruff/mypy 报"未使用参数 self._rt 等"——不会，实例属性不被检查未使用。

3. **循环引用预防**：子 service 构造期不 import 兄弟子包（5 个子 service 模块互不 import）。`service.py` 顶部单向 import 5 个子 service 类（facade → 子，单向下行）。W2-W6 迁移方法体后如需跨域调用，用 lazy import（`router.py:624` 已示范：模块级 import 会绑死 mock 引用，函数级 import 才能被 per-test patch）。本 task 阶段子 service 无方法体，无跨域调用，**不可能触发循环**。

4. **router.py 零改动验证**：task-01 完成后必须执行 `git diff backend/app/modules/daemon/router.py`，输出必须为空。若非空，立即回退 router.py 改动（task-01 不应碰它）。验收脚本：`git diff --exit-code backend/app/modules/daemon/router.py` 必须返回 0。

5. **异常类定义不动**：service.py 顶部第 40-271 行的异常类（`DaemonRuntimeNotFound` / `DaemonLeaseNotFound` / `PatchApplyError` / `DaemonRpcTimeout` 等）和数据类（`RecoveryDecision`）**原位保留**，不迁子包。异常类迁移 + facade re-export 是 task-07（收尾 Wave）的工作，task-01 一律不动。router.py:55 的 9 个异常 import 路径保持 `from app.modules.daemon.service import ...` 不变。

6. **子 service 构造失败处理**：若任一子 service `__init__` 抛异常（如未来 W2 在 `__init__` 里加了 DB 预查询），会导致 `DaemonService(session)` 失败 → router 所有 daemon 端点 500。W1 阶段子 service `__init__` 是纯赋值，不会失败。防御：5 个子 service `__init__` 体内**禁止任何可能抛异常的语句**（无 await、无 select、无外部调用），仅 `self._session = session`。

7. **测试隔离**：daemon 测试通过 fixture 注入 mock session/redis/ws_hub。子 service 接收的是同一个被注入的 `session`，行为与 facade 一致。若测试因新增子 service 实例化而失败（如 mock 不允许被多次 `__init__`），修复 mock 而非回退结构。

## 非目标

- **不迁任何方法体**到子 service（方法体迁移是 task-02~task-06 的工作）。
- **不改 `router.py`**（任何一行都不动，D-002 铁证）。
- **不处理异常类 re-export**（task-07 的工作）。
- **不补 daemon.md 模块文档**（task-08 的工作）。
- **不在 `lease/__init__.py` 提前 export LeaseService**（W6 的工作，避免调用方误用）。
- **不删 service.py 任何 import**（即使 W1 后某些 import 暂未被子 service 用，留待方法体迁移时由各 Wave 自行整理）。
- **不调整任何方法签名、返回类型、异常类型**。
- **不动 `lease_service.py` / `permission_service.py` / `ws_hub.py`**（D-003 独立活 service 原位保留）。

## 参考

- design.md §5.2 目标目录结构（5 子包布局）
- design.md §5.3 W1（"facade 委托骨架先就位并跑通全测"的安全网定义）
- design.md §6 文件变更清单（10 新增 + service.py 修改）
- design.md §7.1 facade 代码示例（`__init__` 持 5 子 service 引用）
- design.md §7.2 子 service 构造约定（接 session、跨域用 lazy import / 持引用）
- design.md §7.5 生命周期契约表（W1 不改变任何状态机，仅位置占位）
- design.md §9 兼容策略（facade 方法签名全保留、router 零变更、回滚每 Wave 独立）
- design.md §10 R1 循环引用风险（lazy import / 持有引用缓解，W1 验证）
- plan.md Wave 1 task-01 行
- `backend/app/modules/daemon/router.py:624` lazy import 模式注释（跨域调用模板）
- `backend/app/modules/ppm/` 子包分层最佳实践（同构参考）

## TDD 步骤

> **纯结构重构**：本 task 无新功能、无新行为，**不写新测试**。验证手段 = 跑现有 daemon 全测确认行为不变。

1. **迁移前基线**（先跑一遍，记录绿基线）：
   ```bash
   cd backend && pytest tests/modules/daemon/ -v 2>&1 | tail -20
   # 记录通过用例数（如 "312 passed"），作为迁移后对照
   ```

2. **实施步骤 1-4**（建 10 空壳 + 改 service.py __init__ + import）。

3. **迁移后验证**：
   ```bash
   # 3.1 daemon 全测（用例数必须与基线一致，全绿）
   cd backend && pytest tests/modules/daemon/ -v
   # 期望：与步骤 1 基线用例数相同 + 0 failed

   # 3.2 全量后端测试（确认未引入跨模块回归）
   make backend-test

   # 3.3 lint + 类型检查
   make backend-lint    # ruff check + ruff format check + mypy，全绿

   # 3.4 router.py 零改动铁证
   git diff --exit-code backend/app/modules/daemon/router.py && echo "ROUTER UNCHANGED"
   # 期望：输出 "ROUTER UNCHANGED"，exit code 0
   ```

4. **失败处置**：
   - 用例数减少 → 结构破坏，回退检查（最可能：子 service `__init__` 有副作用、import 路径错）。
   - 用例数增加 → 不可能（未加测试），若发生需排查是否有 conftest 自动收集新文件。
   - mypy 报子 service 属性未使用 → 不会（实例属性不检查）；若报，检查是否误加类型注解触发 strict 模式。
   - ruff 报未使用 import → 检查 service.py 顶部新增的 5 行 import 是否全部被 `__init__` 使用（应全部使用）。

## 验收标准

| AC ID | 验收项 | 验证方法 | 通过判据 |
|-------|--------|---------|---------|
| AC-01 | 5 子包目录存在 | `ls backend/app/modules/daemon/{runtime,lease,run_sync,session,patch}/` | 5 目录各含 `__init__.py` + `service.py` |
| AC-02 | 5 子 service 类定义存在 | `grep "^class \(Runtime\|Lease\|RunSync\|Session\|Patch\)Service" backend/app/modules/daemon/*/service.py` | 5 行命中，类名正确 |
| AC-03 | 子 service `__init__` 仅接 session | 检查 5 个 `service.py` 的 `__init__` 方法体 | 每个仅 `self._session = session`，无其他语句 |
| AC-04 | DaemonService 持有 5 子 service 引用 | `grep "self._\(rt\|lease\|run\|sess\|patch\)" backend/app/modules/daemon/service.py` | 至少 5 行命中（`self._rt =`/`self._lease =`/...） |
| AC-05 | DaemonService 51 方法签名零变化 | `git diff main -- backend/app/modules/daemon/service.py \| grep "^[+-].*async def\|^[+-].*def "` | 仅 `__init__` 内部 +5 行，方法定义行无增删改 |
| AC-06 | daemon 全测通过 | `cd backend && pytest tests/modules/daemon/ -v` | 全绿，用例数 = 迁移前基线 |
| AC-07 | 全量后端测试通过 | `make backend-test` | 全绿 |
| AC-08 | backend lint 通过 | `make backend-lint` | ruff check / format check / mypy 全绿 |
| AC-09 | router.py 零改动 | `git diff --exit-code backend/app/modules/daemon/router.py` | exit code 0，无输出（D-002 铁证） |
| AC-10 | router.py:55 的 9 异常类 + DaemonService import 不变 | `python -c "from app.modules.daemon.service import DaemonLeaseNotFound, DaemonRpcForbiddenError, DaemonRpcGatewayError, DaemonRpcRemoteError, DaemonRpcRemoteGatewayError, DaemonRpcTimeout, DaemonRuntimeNotFound, DaemonRuntimeOffline, DaemonService, DaemonSessionNotFound"` | 无 ImportError |
| AC-11 | 子包无循环 import | `python -c "import app.modules.daemon.service"` | 无 ImportError / 循环警告 |
| AC-12 | 5 子包 `__init__.py` 不提前 export | `grep -L "from .service import" backend/app/modules/daemon/*/(__init__).py`（5 个 `__init__.py` 均不包含 export 语句） | 5 文件均为空/docstring 占位 |

> **核心铁律**：AC-06（daemon 全测绿）+ AC-09（router diff 空）= W1 安全网就位。任一不满足，禁止进入 W2。
