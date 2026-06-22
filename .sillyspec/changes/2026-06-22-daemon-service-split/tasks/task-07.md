---
id: task-07
title: 异常类定义迁入对应子包，facade service.py 集中 re-export，保持所有 import 路径不变
priority: P0
depends_on: [task-02, task-03, task-04, task-05, task-06]
blocks: [task-08]
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/lease/service.py
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/patch/service.py
  - backend/app/modules/daemon/service.py
author: qinyi
created_at: 2026-06-22T10:21:00+08:00
---

# task-07

> 本 task 是收尾 Wave 的第一步：把 task-02~06 迁移方法时**暂留在 facade `service.py`** 的异常类（domain errors / RPC errors / session errors / reopen errors / patch errors）按归属子域迁入对应子包 `service.py` 定义，并在 facade `service.py` 顶部集中 re-export，保证 `from app.modules.daemon.service import XxxError` 全部 import 路径零变化。
>
> 唯一交付：**异常类物理位置迁移 + facade re-export**。不增删类、不改 code/http_status、不动方法体。

## 修改文件

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 修改 | `backend/app/modules/daemon/runtime/service.py` | 新增 `DaemonRuntimeNotFound` 定义（从 facade 迁入） |
| 修改 | `backend/app/modules/daemon/lease/service.py` | 新增 lease 域 4 异常类 + `DaemonLeaseNoAgentRun`（从 facade 迁入） |
| 修改 | `backend/app/modules/daemon/run_sync/service.py` | 不迁入异常类（run_sync 域所有异常都是 lease/session/runtime 域的引用，本身无独有异常） |
| 修改 | `backend/app/modules/daemon/session/service.py` | 新增 session 域 8 异常类 + 3 个 frozenset 常量（从 facade 迁入） |
| 修改 | `backend/app/modules/daemon/patch/service.py` | 新增 `PatchApplyError` / `PatchConflictError`（从 facade 迁入） |
| 修改 | `backend/app/modules/daemon/service.py` | 删除异常类定义原位置 → 改为顶部 re-export 块（`from .runtime.service import DaemonRuntimeNotFound` 等显式列出全部符号），保留 `DaemonService` facade 类本体 |
| 不动 | `backend/app/modules/daemon/router.py` | D-002 零改动铁证 |
| 不动 | `backend/app/modules/daemon/permission_service.py` | 保持 `from ...service import` 不变（靠 facade re-export 命中） |
| 不动 | `backend/app/modules/daemon/ws_hub.py` | 同上 |
| 不动 | `backend/app/modules/daemon/lease_service.py` | 独立活 service，不碰 |
| 不动 | 所有 `backend/**/tests/*.py` | 所有测试 import 路径不变，靠 facade re-export 命中 |

> `run_sync/service.py` 若 run_sync 子域在迁移过程中需要引用任何异常（如 `DaemonAgentRunNotFound`），通过 facade re-export 间接引用即可，不在 run_sync 子包重复定义；如确有 run_sync 独有的异常，execute 时按 §边界处理 B2 判断归属（详见下文）。

## 覆盖来源(FR-05, D-002@v1)

- **FR-05**：9 异常类 + `DaemonService` re-export 兼容 —— 本 task 把全部异常类迁子包定义，facade re-export 覆盖 grep 收集的**全部**被引用符号，所有调用方 import 路径零变化。
- **D-002@v1**：facade 完全兼容、`router.py` 零改动 —— `router.py:55` 的 10 符号 import 语句一行不动，靠 facade re-export 命中。

## 实现要求

### R1. 先跑 grep 全量收集被引用符号清单（输出记录到本 task）

在动手迁移前，先执行下面命令，把**实际被引用的符号全量**记录到本 task 的 AC 表（作为 re-export 兜底清单）：

```bash
grep -rn "from app.modules.daemon.service import" backend/ --include=*.py
```

> 本 task 编写时（2026-06-22）已预跑，结果记录在 §接口定义 I3「re-export 清单」与 §验收标准 AC-01 中。**execute 时必须重跑一次**，因为 task-02~06 可能引入新的内部 import（如子 service 之间引用）。如重跑发现新符号，按归属表补入对应子包 + facade re-export。

### R2. 异常类按归属子域迁移（定义物理位置变更）

下表是 service.py 当前所有异常类/常量与目标归属（判据见 design §5.1：按操作的主对象归属）：

| 类 / 常量 | 当前位置 | 目标子包 | 归属理由 |
|----------|---------|---------|---------|
| `DaemonRuntimeNotFound` | service.py:43 | `runtime/service.py` | runtime 主对象 |
| `DaemonLeaseNotFound` | service.py:48 | `lease/service.py` | lease 主对象 |
| `DaemonLeaseNotPending` | service.py:53 | `lease/service.py` | lease 主对象 |
| `DaemonLeaseNotClaimed` | service.py:58 | `lease/service.py` | lease 主对象 |
| `DaemonInvalidClaimToken` | service.py:63 | `lease/service.py` | lease claim_token 校验 |
| `DaemonAgentRunNotFound` | service.py:68 | `lease/service.py` | lease 完成时校验 agent_run（lease 域持有） |
| `DaemonLeaseNoAgentRun` | service.py:73 | `lease/service.py` | lease metadata 校验 |
| `PatchApplyError` | service.py:85 | `patch/service.py` | patch 主对象 |
| `PatchConflictError` | service.py:90 | `patch/service.py` | patch 主对象 |
| `DaemonRuntimeOffline` | service.py:100 | `runtime/service.py` | runtime 连接态主对象（RPC 网关错误的前提） |
| `DaemonRpcTimeout` | service.py:107 | `runtime/service.py` | RPC 通道（runtime WS）超时；与 offline 同域，避免 run_sync 反向依赖 runtime |
| `DaemonRpcConflict` | service.py:114 | `runtime/service.py` | RPC 通道（runtime WS）rpc_id 冲突 |
| `DaemonRpcGatewayError` | service.py:121 | `runtime/service.py` | RPC 通道层网关错误 → 504 |
| `DaemonRpcForbiddenError` | service.py:128 | `runtime/service.py` | RPC 通道映射（daemon 业务错误 → 403） |
| `DaemonRpcRemoteGatewayError` | service.py:135 | `runtime/service.py` | RPC 通道映射（daemon 业务错误 → 502） |
| `DaemonRpcRemoteError` | service.py:142 | `runtime/service.py` | RPC 通道内部信号（非 AppError，ws_hub 抛 / router 映射） |
| `ACTIVE_SESSION_STATUSES` | service.py:160 | `session/service.py` | session 域状态常量 |
| `ACTIVE_TURN_STATUSES` | service.py:161 | `session/service.py` | session 域 turn 状态常量 |
| `TERMINAL_TURN_STATUSES` | service.py:162 | `session/service.py` | session 域 turn 状态常量 |
| `DaemonSessionNotFound` | service.py:165 | `session/service.py` | session 主对象 |
| `DaemonSessionNotActive` | service.py:170 | `session/service.py` | session 主对象 |
| `DaemonSessionTurnConflict` | service.py:175 | `session/service.py` | session 主对象 |
| `DaemonSessionNoCurrentRun` | service.py:180 | `session/service.py` | session 主对象 |
| `DaemonSessionInvariantViolation` | service.py:185 | `session/service.py` | session 主对象 |
| `DaemonSessionResumeUnsupported` | service.py:193 | `session/service.py` | session reopen（session 主对象） |
| `DaemonSessionNoAgentSession` | service.py:204 | `session/service.py` | session reopen（session 主对象） |
| `DaemonOffline` | service.py:216 | `session/service.py` | session reopen 时 runtime 离线（reopen 是 session 操作） |

> **`DaemonRpc*` 归属判断说明**：RPC 错误族（offline/timeout/conflict/gateway/forbidden/remote_gateway/remote）技术上由 ws_hub 抛、router 映射，看似"跨域"。但根因都是 runtime 的 WS 连接态/通道问题，归 `runtime` 子包最自然（runtime 子域已持有 WS 连接管理），且避免 run_sync/session 子包反向依赖 runtime。`ws_hub.py:19` 的 4 符号 import 通过 facade re-export 命中，路径不变。

> **dataclass（`SessionDispatchResult` / `SessionControlResult` / `SessionRecoveryResult`）归属**：这是 session 域的返回类型，随 session 方法迁入 `session/service.py`（已在 task-05 处理或本 task 一并迁移，execute 时确认；若 task-05 已迁则本 task 仅迁异常类+常量）。

### R3. facade service.py 改为顶部 re-export 块

facade `service.py` 顶部按子域分组，显式列出全部 re-export 符号（**禁止用 `import *`** —— 显式列出便于 grep 追踪 + 避免 namespace 污染 + 避免 ruff F401 误报）。

## 接口定义

### I1. runtime/service.py 新增块（顶部，import 之后、`class RuntimeService` 之前）

```python
from app.core.errors import AppError


class DaemonRuntimeNotFound(AppError):
    code = "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"
    http_status = 404


class DaemonRuntimeOffline(AppError):
    """Target daemon runtime has no active WS connection (R-01)."""

    code = "HTTP_504_DAEMON_RUNTIME_OFFLINE"
    http_status = 504


# ── RPC errors (WS 通道层；root cause 是 runtime 连接态/通道问题) ────────────


class DaemonRpcTimeout(AppError):
    """RPC round-trip exceeded the per-call timeout (R-01)."""

    code = "HTTP_504_DAEMON_RPC_TIMEOUT"
    http_status = 504


class DaemonRpcConflict(AppError):
    """rpc_id collision in the pending map (UUID4 practical impossibility)."""

    code = "HTTP_409_DAEMON_RPC_ID_CONFLICT"
    http_status = 409


class DaemonRpcGatewayError(AppError):
    """WS channel-layer failure (offline / timeout / send failure) → 504."""

    code = "HTTP_504_DAEMON_RPC_GATEWAY"
    http_status = 504


class DaemonRpcForbiddenError(AppError):
    """daemon returned error.code=forbidden (allowed_roots violation, FR-04)."""

    code = "HTTP_403_DAEMON_RPC_FORBIDDEN"
    http_status = 403


class DaemonRpcRemoteGatewayError(AppError):
    """daemon returned a non-forbidden business error → 502."""

    code = "HTTP_502_DAEMON_RPC_REMOTE"
    http_status = 502


class DaemonRpcRemoteError(Exception):
    """Internal signal carrying a daemon error dict up the send_rpc call chain.

    Deliberately NOT an AppError: the HTTP endpoint re-maps it to
    DaemonRpcForbiddenError (403) or DaemonRpcRemoteGatewayError (502), so the
    raw daemon code/message never leaks directly to HTTP status mapping.
    """

    def __init__(self, error: dict) -> None:
        self.code = error.get("code", "unknown")
        self.message = error.get("message", "")
        super().__init__(f"daemon rpc error: {self.code}: {self.message}")
```

### I2. lease/service.py 新增块

```python
from app.core.errors import AppError


class DaemonLeaseNotFound(AppError):
    code = "HTTP_404_DAEMON_LEASE_NOT_FOUND"
    http_status = 404


class DaemonLeaseNotPending(AppError):
    code = "HTTP_409_DAEMON_LEASE_NOT_PENDING"
    http_status = 409


class DaemonLeaseNotClaimed(AppError):
    code = "HTTP_409_DAEMON_LEASE_NOT_CLAIMED"
    http_status = 409


class DaemonInvalidClaimToken(AppError):
    code = "HTTP_403_DAEMON_INVALID_CLAIM_TOKEN"
    http_status = 403


class DaemonAgentRunNotFound(AppError):
    code = "HTTP_404_DAEMON_AGENT_RUN_NOT_FOUND"
    http_status = 404


class DaemonLeaseNoAgentRun(AppError):
    """Batch lease has no agent_run_id (dispatch always sets it; NULL is a bug).

    Fail-fast instead of silently returning an agent_run_id=None claim payload,
    which would make the daemon send empty agent_run_id submitMessages → backend
    422 storm → connection pool exhaustion (ql-004).
    """

    code = "HTTP_422_DAEMON_LEASE_NO_AGENT_RUN"
    http_status = 422
```

### I3. patch/service.py 新增块

```python
from app.core.errors import AppError


class PatchApplyError(AppError):
    code = "HTTP_422_PATCH_APPLY_ERROR"
    http_status = 422


class PatchConflictError(AppError):
    code = "HTTP_409_PATCH_CONFLICT"
    http_status = 409
```

### I4. session/service.py 新增块（含 3 frozenset 常量 + 8 异常类）

```python
from app.core.errors import AppError


# Status sets live at module level so router tests and future tasks can reuse
# them without re-deriving the business invariants.
ACTIVE_SESSION_STATUSES = frozenset({"pending", "active", "reconnecting"})
ACTIVE_TURN_STATUSES = frozenset({"pending", "running", "pending_approval"})
TERMINAL_TURN_STATUSES = frozenset({"completed", "failed", "killed", "cancelled"})


class DaemonSessionNotFound(AppError):
    code = "HTTP_404_DAEMON_SESSION_NOT_FOUND"
    http_status = 404


class DaemonSessionNotActive(AppError):
    code = "HTTP_409_DAEMON_SESSION_NOT_ACTIVE"
    http_status = 409


class DaemonSessionTurnConflict(AppError):
    code = "HTTP_409_DAEMON_SESSION_TURN_CONFLICT"
    http_status = 409


class DaemonSessionNoCurrentRun(AppError):
    code = "HTTP_409_DAEMON_SESSION_NO_CURRENT_RUN"
    http_status = 409


class DaemonSessionInvariantViolation(AppError):
    code = "HTTP_409_DAEMON_SESSION_INVARIANT_VIOLATION"
    http_status = 409


class DaemonSessionResumeUnsupported(AppError):
    """Target session provider is not resumable (provider != "claude").

    Only the Claude SDK supports ``--resume <session_id>``; codex/other
    providers cannot be reopened, so the ended session stays terminal.
    """

    code = "HTTP_409_DAEMON_SESSION_RESUME_UNSUPPORTED"
    http_status = 409


class DaemonSessionNoAgentSession(AppError):
    """Session has ``agent_session_id IS NULL`` (D-004@v1).

    A session that never reached a successful create-time SDK handshake (or
    whose create failed before the SDK returned a session id) has no SDK
    session to resume — reopen is impossible. The session is NOT mutated.
    """

    code = "HTTP_409_DAEMON_SESSION_NO_AGENT_SESSION"
    http_status = 409


class DaemonOffline(AppError):
    """Target runtime has no active WS connection — reopen needs a live daemon.

    Reopen drives an SDK resume ON the owning daemon (task-08), so the daemon
    must be connected. Distinct from :class:`DaemonRuntimeOffline` (504, used
    by RPC/inject paths where a stale lease must surface as a gateway fault):
    reopen is a user-initiated optimistic action, so 409 CONFLICT fits the
    "try again once the runtime reconnects" semantics better than a 5xx.
    """

    code = "HTTP_409_DAEMON_OFFLINE"
    http_status = 409
```

### I5. facade service.py 顶部 re-export 块（替换原异常类定义区）

> 删除 service.py:40~227（`# ── Domain errors` 到 `DaemonOffline` 结束，含 3 个 frozenset 与 3 个 dataclass 若尚未被 task-05 迁走），改为下面的集中 re-export 块。保留 `DaemonService` 类本体（facade）与 task-01~06 已就位的委托方法。

```python
# ── Re-export：异常类 + 状态常量已迁入对应子包，facade 集中 re-export
# 保持 `from app.modules.daemon.service import XxxError` 全部 import 路径不变
# (D-002@v1 facade 完全兼容 / FR-05)。
# 禁止用 `import *`：显式列出便于 grep 追踪 + 避免 namespace 污染。

from app.modules.daemon.runtime.service import (
    DaemonRpcConflict,
    DaemonRpcForbiddenError,
    DaemonRpcGatewayError,
    DaemonRpcRemoteError,
    DaemonRpcRemoteGatewayError,
    DaemonRpcTimeout,
    DaemonRuntimeNotFound,
    DaemonRuntimeOffline,
)
from app.modules.daemon.lease.service import (
    DaemonAgentRunNotFound,
    DaemonInvalidClaimToken,
    DaemonLeaseNoAgentRun,
    DaemonLeaseNotClaimed,
    DaemonLeaseNotFound,
    DaemonLeaseNotPending,
)
from app.modules.daemon.patch.service import (
    PatchApplyError,
    PatchConflictError,
)
from app.modules.daemon.session.service import (
    ACTIVE_SESSION_STATUSES,
    ACTIVE_TURN_STATUSES,
    TERMINAL_TURN_STATUSES,
    DaemonOffline,
    DaemonSessionInvariantViolation,
    DaemonSessionNoAgentSession,
    DaemonSessionNoCurrentRun,
    DaemonSessionNotActive,
    DaemonSessionNotFound,
    DaemonSessionResumeUnsupported,
    DaemonSessionTurnConflict,
)

# SessionDispatchResult / SessionControlResult / SessionRecoveryResult 三个
# dataclass 由 session 子域定义并 re-export（若 task-05 已迁入 session/service.py，
# 此处补 from .session.service import SessionDispatchResult, ...）。
```

> **re-export 顺序**：runtime → lease → patch → session（按子域字母序或依赖序，无循环即可）。ruff/black 不会重排 import 顺序破坏显式分组（isort 配置若启用，确认 `force_sort_within_sections = False` 或显式 `# noqa: I001`）。

## 边界处理

1. **B1 re-export 覆盖 grep 全部符号**：execute 时重跑 `grep -rn "from app.modules.daemon.service import" backend/ --include=*.py`，把每个被引用符号逐一对照 §接口定义 I5 的 re-export 块；任何 grep 命中但 re-export 未列出的符号，**补入对应子包定义 + facade re-export**。当前（2026-06-22）grep 收集到的全量符号（22 个）见 AC-01 表。

2. **B2 `DaemonRpc*` 归属判断**：RPC 错误族（offline/timeout/conflict/gateway/forbidden/remote_gateway/remote 共 7 个）统一归 `runtime` 子包。判据：根因是 runtime 的 WS 连接态/通道问题，runtime 子域已持有 WS 连接管理职责；归 runtime 避免让 run_sync/session 子包反向依赖 runtime（保持 design §10 R1 的子包无循环约束）。`DaemonRpcRemoteError` 是内部信号非 AppError，无 code/http_status，但仍随族迁入 runtime（`__init__(error: dict)` 签名与 code/message 属性零变化）。

3. **B3 import 路径零变化**：`router.py:55` / `permission_service.py:39` / `ws_hub.py:19` 及全部 `tests/*.py` 的 `from app.modules.daemon.service import ...` 语句**一行不动**。靠 facade re-export 命中。`git diff` 这些文件应为空（AC-05）。如 execute 时发现某个调用方 import 语句必须改动，说明 re-export 清单有遗漏，回到 B1 补全。

4. **B4 异常类 code + http_status 属性随迁**：迁移定义时**逐字符复制**（class body / docstring / code / http_status / `__init__` 签名），禁止任何改写。execute 时 diff 每个 class 前后内容应**字符级一致**（仅 location 变更）。特别核对：
   - `DaemonRpcRemoteError.__init__(self, error: dict)` 与 `self.code` / `self.message` 赋值
   - `DaemonLeaseNoAgentRun` / `DaemonSessionResumeUnsupported` / `DaemonSessionNoAgentSession` / `DaemonOffline` 的多行 docstring
   - 所有 `code = "HTTP_xxx_..."` 字符串与 `http_status = NNN` 数值

5. **B5 `AgentRunError` 等 agent 侧异常不碰**：本 task 仅迁 daemon `service.py` 顶部定义的异常类。`app.modules.agent` 模块的异常（如 `AgentRunError` 等）、`permission_service.py` 内部定义的 `DaemonPermission*` / `DaemonDialogNotFound`（service.py:60~89 区域，但这些定义在 permission_service.py 内，不在 daemon/service.py）**全部不动**。如 execute 时在 daemon/service.py 发现其他模块的异常（本 task 编写时未发现），原地保留并在本 task AC 注明。

6. **B6 循环 import 防护**：facade service.py re-export 子包符号时，子包 service.py **不得反向 import facade**（`from app.modules.daemon.service import ...`）。子包之间需要引用异常类时，直接 `from app.modules.daemon.runtime.service import DaemonRuntimeOffline`（子包→子包直引），绕过 facade，避免循环。execute 后跑 `python -c "import app.modules.daemon.service"` 与 `python -c "import app.modules.daemon.router"` 确认无 ImportError（AC-04）。

7. **B7 `run_sync` 子包无独有异常**：run_sync 域（sync_agent_run_status / close_interactive_run / submit_messages）抛出的都是 lease/session/runtime 域已定义的异常（如 `DaemonInvalidClaimToken` / `DaemonLeaseNotClaimed` / `DaemonRuntimeOffline`），通过子包间直引或 facade re-export 命中。run_sync/service.py 本 task **不新增任何异常类定义**。如 execute 发现 run_sync 有未归类的独有异常，按主对象判据归 lease 或 session，不归 run_sync（run_sync 是状态机同步，非独立错误域）。

8. **B8 ruff/mypy 干净**：re-export 块每个符号必须被 facade 自身或外部引用（否则 F401）。由于 grep 确认全部符号都有外部调用方，re-export 不会触发 F401；但 facade 内部若不再使用某符号（迁移后委托方法可能不再 raise），需确认 ruff 配置允许 re-export 模式（项目已有 `__all__` 或 `# noqa: F401` 惯例时沿用）。mypy：异常类基类 `AppError` 与 `Exception` 类型签名零变化，无新类型错误。

## 非目标

- **N1 不改异常类行为**：不修改任何 class body、docstring、code、http_status、`__init__` 签名。纯 location 迁移。
- **N2 不碰 agent 模块异常**：`app.modules.agent` 的异常类、`permission_service.py` 内的 `DaemonPermission*` / `DaemonDialogNotFound` 等不在本 task 范围。
- **N3 不删 facade `DaemonService` 类**：facade 类本体保留（task-01~06 已委托化），本 task 仅替换顶部的异常类定义区为 re-export 块。
- **N4 不改 router.py / permission_service.py / ws_hub.py / lease_service.py**：D-002 零改动铁证。
- **N5 不引入 `import *`**：显式列出 re-export 符号，便于 grep 追踪与静态分析。
- **N6 不重构异常类继承层级**：不抽共同基类、不改 `AppError` / `Exception` 继承。

## 参考

- design §7.3（异常类归属 / re-export 策略）
- design §6（文件变更清单：service.py 标注"异常类迁入子包 + facade re-export"）
- design §9（兼容策略：异常类 import 路径 facade re-export 保持不变）
- decisions.md D-002@v1（facade 完全兼容、router 零改动）

## TDD 步骤

> 本 task 是纯结构迁移（location 变更），无新逻辑，TDD 重点在**迁移前后行为等价的回归验证**而非先写新测试。

### Step 1 — grep 全量收集（迁移前基线）

```bash
# 1.1 记录迁移前所有调用方 import（作为 re-export 兜底清单）
grep -rn "from app.modules.daemon.service import" backend/ --include=*.py > /tmp/task07_imports_before.txt
cat /tmp/task07_imports_before.txt

# 1.2 记录迁移前每个符号的 class body（diff 基线，确保迁移字符级一致）
sed -n '40,227p' backend/app/modules/daemon/service.py > /tmp/task07_classes_before.txt
```

### Step 2 — 迁移定义（按 §接口定义 I1~I4 逐子包新增）

按 runtime → lease → patch → session 顺序，逐子包在 `service.py` 顶部（import 之后、`class XxxService` 之前）新增异常类定义块。每迁一个子包后跑 `python -c "import app.modules.daemon.<子包>.service"` 确认无 syntax/import 错误。

### Step 3 — facade re-export（按 §接口定义 I5 替换 service.py 顶部）

删除 service.py 原 `# ── Domain errors` 到 `DaemonOffline` 结束的整块，替换为 §I5 的 re-export 块。保留 `DaemonService` 类本体。

### Step 4 — 字符级 diff 校验

```bash
# 4.1 拼接各子包新增的 class 定义，与迁移前基线 diff（应仅 import 顺序差异）
cat backend/app/modules/daemon/{runtime,lease,patch,session}/service.py | \
  grep -A4 "^class " > /tmp/task07_classes_after.txt
diff /tmp/task07_classes_before.txt /tmp/task07_classes_after.txt
# 期望：每个 class 的 body 行完全一致（code/http_status/docstring/__init__）

# 4.2 重跑 grep 确认调用方 import 语句未变
grep -rn "from app.modules.daemon.service import" backend/ --include=*.py > /tmp/task07_imports_after.txt
diff /tmp/task07_imports_before.txt /tmp/task07_imports_after.txt
# 期望：空 diff（调用方一行未动）
```

### Step 5 — 回归测试

```bash
# 5.1 daemon 全测（含 test_session_recovery 16 用例、test_lease_service、test_ws_rpc 等）
make backend-test  # 或 cd backend && pytest app/modules/daemon/tests/ -v

# 5.2 agent 4 测试（import DaemonService 的测试，确认 facade re-export 命中）
cd backend && pytest app/modules/agent/tests/test_dispatch_metadata.py \
  app/modules/agent/tests/test_execution_context.py \
  app/modules/agent/tests/test_interactive_session_placement.py \
  app/modules/agent/tests/test_kill_and_state_mapping.py -v

# 5.3 静态检查
make backend-lint  # ruff check + format check + mypy
```

### Step 6 — import 冒烟

```bash
cd backend && python -c "
from app.modules.daemon.service import (
    DaemonLeaseNotFound, DaemonRpcForbiddenError, DaemonRpcGatewayError,
    DaemonRpcRemoteError, DaemonRpcRemoteGatewayError, DaemonRpcTimeout,
    DaemonRuntimeNotFound, DaemonRuntimeOffline, DaemonService, DaemonSessionNotFound,
)
from app.modules.daemon.service import (
    ACTIVE_SESSION_STATUSES, ACTIVE_TURN_STATUSES, DaemonSessionNotActive,
    DaemonRpcConflict, DaemonAgentRunNotFound, DaemonInvalidClaimToken,
    DaemonLeaseNoAgentRun, PatchApplyError, DaemonSessionInvariantViolation,
    DaemonSessionNoCurrentRun, DaemonSessionTurnConflict, DaemonLeaseNotClaimed,
)
print('all re-exports OK')
"
```

## 验收标准

| AC ID | 验收项 | 验证方法 | 通过判据 |
|-------|--------|---------|---------|
| AC-01 | grep 收集的 22 个被引用符号全部 re-export 覆盖 | 对照下表符号清单 vs §I5 re-export 块 | 22/22 命中，无遗漏 |
| AC-02 | 异常类定义字符级一致（迁移前后） | `diff` 迁移前 class body 与迁移后各子包 class body | 仅 location 变更，code/http_status/docstring/__init__ 字符级相同 |
| AC-03 | `make backend-test` 通过 | daemon 全测 + agent 4 测试 | 全绿，用例数与迁移前一致 |
| AC-04 | 无循环 import | `python -c "import app.modules.daemon.service"` 与 `python -c "import app.modules.daemon.router"` | 无 ImportError |
| AC-05 | 调用方零改动 | `git diff backend/app/modules/daemon/router.py backend/app/modules/daemon/permission_service.py backend/app/modules/daemon/ws_hub.py backend/app/modules/daemon/lease_service.py` + 所有 `tests/*.py` | diff 为空（D-002 零改动铁证） |
| AC-06 | `make backend-lint` 通过 | ruff check + format check + mypy | 无 F401（re-export 全有外部调用方）/ 无类型错误 |
| AC-07 | 子包间无反向 import facade | `grep -rn "from app.modules.daemon.service import" backend/app/modules/daemon/*/service.py` | 空（子包直引其他子包，不经过 facade） |
| AC-08 | run_sync 子包无新增异常类 | `grep -n "^class " backend/app/modules/daemon/run_sync/service.py` | 无异常类定义（仅 RunSyncService） |

### AC-01 符号清单（grep 全量收集结果，2026-06-22 基线）

> execute 时重跑 grep，若新增符号按归属表补入子包 + re-export。

| # | 符号 | 引用方 | 归属子包 | re-export 来源 |
|---|------|--------|---------|---------------|
| 1 | `DaemonLeaseNotFound` | router.py:55 | lease | lease/service.py |
| 2 | `DaemonRpcForbiddenError` | router.py:55 | runtime | runtime/service.py |
| 3 | `DaemonRpcGatewayError` | router.py:55 | runtime | runtime/service.py |
| 4 | `DaemonRpcRemoteError` | router.py:55, ws_hub.py:19 | runtime | runtime/service.py |
| 5 | `DaemonRpcRemoteGatewayError` | router.py:55 | runtime | runtime/service.py |
| 6 | `DaemonRpcTimeout` | router.py:55, ws_hub.py:19 | runtime | runtime/service.py |
| 7 | `DaemonRuntimeNotFound` | router.py:55, test_lease_service | runtime | runtime/service.py |
| 8 | `DaemonRuntimeOffline` | router.py:55, ws_hub.py:19, permission_service.py:39, test_session_service, test_session_user_log, test_ws_rpc | runtime | runtime/service.py |
| 9 | `DaemonService` | router.py:55 + 全部测试 | facade（service.py 本体） | service.py（类定义，非 re-export） |
| 10 | `DaemonSessionNotFound` | router.py:55, test_session_delete_active, test_session_service | session | session/service.py |
| 11 | `ACTIVE_SESSION_STATUSES` | permission_service.py:39 | session | session/service.py |
| 12 | `ACTIVE_TURN_STATUSES` | permission_service.py:39 | session | session/service.py |
| 13 | `DaemonSessionNotActive` | permission_service.py:39 | session | session/service.py |
| 14 | `DaemonRpcConflict` | ws_hub.py:19, test_ws_rpc | runtime | runtime/service.py |
| 15 | `DaemonAgentRunNotFound` | test_interactive_lifecycle_patch | lease | lease/service.py |
| 16 | `DaemonInvalidClaimToken` | test_interactive_lifecycle_patch, test_lease_service, test_wave5_integration | lease | lease/service.py |
| 17 | `DaemonLeaseNoAgentRun` | test_lease_service:816 | lease | lease/service.py |
| 18 | `DaemonSessionInvariantViolation` | test_session_recovery, test_session_service | session | session/service.py |
| 19 | `DaemonSessionNoCurrentRun` | test_session_service | session | session/service.py |
| 20 | `DaemonSessionTurnConflict` | test_session_service, test_session_user_log | session | session/service.py |
| 21 | `DaemonLeaseNotClaimed` | test_wave5_integration | lease | lease/service.py |
| 22 | `PatchApplyError` | test_wave5_integration | patch | patch/service.py |

> **补充未被外部引用但需随迁的符号**（保持 service.py 内部一致性，facade re-export 覆盖以防未来引用）：`DaemonLeaseNotPending`(lease)、`PatchConflictError`(patch)、`TERMINAL_TURN_STATUSES`(session)、`DaemonSessionResumeUnsupported`(session)、`DaemonSessionNoAgentSession`(session)、`DaemonOffline`(session)。这 6 个符号虽无 grep 命中，但定义在 service.py 顶部，必须随迁到对应子包（否则 service.py 顶部删除后它们会丢失），并在 facade re-export（防御性列出，ruff 可能报 F401 → 加 `# noqa: F401` 或确认项目 re-export 惯例）。
