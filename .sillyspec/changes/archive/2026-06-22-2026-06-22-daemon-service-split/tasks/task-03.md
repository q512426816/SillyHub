---
id: task-03
title: patch 方法迁入 patch/service.py（PatchService），facade 改委托
priority: P0
depends_on: [task-01]
blocks: [task-07]
requirement_ids: [FR-02]
decision_ids: []
author: qinyi
created_at: 2026-06-22T10:21:00+08:00
allowed_paths:
  - backend/app/modules/daemon/patch/service.py
  - backend/app/modules/daemon/service.py
---

# task-03

> Wave 3（小子域）。把 `DaemonService._apply_patch_to_worktree` / `_run_git_apply` 两个 patch 相关方法（约 97+18 行）迁入新建子包 `patch/` 的 `PatchService`，`DaemonService` 上的同名方法退化为委托。
> 纯结构重构，**运行时行为零变更**，`router.py` 零改动。
> 依据文档：`design.md` §5.2（目标目录结构）、§6（文件清单第 126-128 行 / 第 128 行修改项）、§7.1（facade 接口）、§7.5（AgentRun 状态机不变）、§9（兼容策略）。

## 修改文件

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新增 | `backend/app/modules/daemon/patch/__init__.py` | 子包入口（task-01 W1 已建空壳，本 task 仅确认存在） |
| 新增 | `backend/app/modules/daemon/patch/service.py` | `PatchService`：承载 `apply_patch_to_worktree` / `_run_git_apply` 两个方法（自 `DaemonService._apply_patch_to_worktree` / `_run_git_apply` 迁入，行为逐行不变） |
| 修改 | `backend/app/modules/daemon/service.py` | `DaemonService._apply_patch_to_worktree` / `_run_git_apply` 方法体改为委托 `self._patch.apply_patch_to_worktree(...)` / `self._patch._run_git_apply(...)`（私有同名保留，调用点零感知） |

> `patch/__init__.py`：若 task-01 已建空 `__init__.py`，本 task 不重复创建；若 task-01 建的只是目录占位，本 task 按 §6 清单补建 `__init__.py`（空文件即可，不强制 re-export —— facade 持有 `self._patch` 引用，外部无需 `from ...patch import PatchService`）。

## 覆盖来源(FR-02)

- **FR-02**：`DaemonService` 51 方法归位到 5 子域 service。本 task 覆盖其中 2 个 patch 相关方法（`_apply_patch_to_worktree` / `_run_git_apply`）的归位。迁后 `grep "class DaemonService" service.py` 确认 facade 化（patch 区段方法体为委托，无业务逻辑）。

## 实现要求

1. **行为逐行不变**：迁入 `PatchService` 的两个方法方法体与 `service.py:3186-3299` 逐字符一致，包括 docstring、注释、日志键名（`daemon_patch_check_failed_trying_3way` / `daemon_patch_applied`）、异常类型（`PatchApplyError` / `PatchConflictError`）、异常 `details` dict 字段名。
2. **私有方法名策略**：
   - `_run_git_apply`：迁入 `PatchService` 后**保留 `_` 私有名**（它是 `@staticmethod`，被 `_apply_patch_to_worktree` 内部调用）。
   - `_apply_patch_to_worktree`：迁入 `PatchService` 时**改为公开名 `apply_patch_to_worktree`**（去掉前导 `_`），因为 facade 通过 `self._patch.apply_patch_to_worktree(...)` 调用。**facade 侧保留原私有名 `_apply_patch_to_worktree`** 作为委托入口（见"调用点核对"）。
3. **`redact_output` import 处理**：
   - 核对结果：`_apply_patch_to_worktree` / `_run_git_apply` 方法体**本身不引用** `redact_output`（`service.py:3186-3299` 逐行核对确认）。`redact_output` 的实际调用点在 `complete_lease` 路径的 `service.py:898`（lease 子域，task-06 处理），不在本 task 范围。
   - 因此：**`patch/service.py` 不需要 `from app.modules.git_gateway.service import redact_output`**。
   - 若 execute 阶段 grep 发现 patch 方法体确有新增的 `redact_output` 引用（理论上不会发生），再补 import；否则保持精简。
4. **异常类暂留**：`PatchApplyError` / `PatchConflictError`（`service.py:85-92`）**此 task 不迁**，仍定义在 `service.py` 顶部。`patch/service.py` 通过 `from app.modules.daemon.service import PatchApplyError, PatchConflictError` 引用（task-07 统一迁异常类到子包 + facade re-export，届时改为从 `patch/` import）。
   - 注意：`service.py` ← `patch/service.py` 的反向 import（子包 import facade 模块的异常类）需检查是否引入循环 import。`patch/service.py` 仅 import 异常类（纯类定义，无 DaemonService 实例化），Python 模块级 import 异常类不会触发循环（类定义在模块顶部、在 DaemonService 类体之前）。若 execute 实测出现循环，降级为 task-07 提前迁异常类，但本 task 默认按"暂留 + 子包 import"实现。
5. **facade 委托签名**：facade 的 `_apply_patch_to_worktree` 签名、返回值、异常类型与原方法**完全一致**（`agent_run_id: UUID, patch_data: str, use_3way: bool = True` → `None`，可能 raise `PatchApplyError` / `PatchConflictError`）。`_run_git_apply` 在 facade 上**保留同名 staticmethod 委托**（虽然无外部调用点，但 W1 已为所有 51 方法建委托骨架，保持一致性；若 W1 未建则本 task 不主动加，避免 scope 蔓延 —— execute 时核对 W1 产出决定）。
6. **构造期引用**：`DaemonService.__init__` 中 `self._patch = PatchService(session)`（task-01 W1 已建，本 task 仅确认引用存在且类型正确）。

## 接口定义

### PatchService（`backend/app/modules/daemon/patch/service.py`）

```python
"""Patch service — applies unified diff patches to agent run worktrees.

Extracted from DaemonService (2026-06-22-daemon-service-split task-03).
Behavior is byte-for-byte identical to the original DaemonService._apply_patch_to_worktree
/ _run_git_apply methods.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlmodel import col
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
# 异常类暂留 service.py（task-07 统一迁子包 + re-export）
from app.modules.daemon.service import PatchApplyError, PatchConflictError
from app.modules.agent.model import AgentRun  # noqa: F401  (保留以对齐原 import 风格，execute 核对实际依赖)
from app.modules.workspace.model import AgentRunWorkspace, Workspace

log = get_logger(__name__)


class PatchService:
    """Applies unified diff patches to the workspace associated with an agent run.

    子域归位判据（design §5.1）：操作对象 = worktree patch 应用 → 归 patch 子域。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def apply_patch_to_worktree(
        self,
        agent_run_id: UUID,
        patch_data: str,
        use_3way: bool = True,
    ) -> None:
        """Apply a unified diff patch to the workspace associated with *agent_run_id*.

        Steps:
        1. Resolve the workspace root_path via the AgentRunWorkspace M:N table.
        2. Run ``git apply --check`` to validate the patch.
        3. If the check fails and *use_3way* is True, retry with ``--3way``.
        4. If 3way also fails raise :class:`PatchConflictError`.
        5. If the check succeeds, apply the patch normally.
        """
        # … 方法体从 DaemonService._apply_patch_to_worktree (service.py:3201-3280) 逐行迁入 …
        # （resolve workspace → git apply --check → optional --3way → PatchApplyError/PatchConflictError）

    @staticmethod
    async def _run_git_apply(
        *,
        workdir: Path,
        args: list[str],
        patch_data: str,
    ) -> tuple[bool, str]:
        """Run a ``git apply`` sub-command and return ``(ok, stderr)``."""
        # … 方法体从 DaemonService._run_git_apply (service.py:3290-3299) 逐行迁入 …
```

### redact_output import 说明

核对结论：patch 两个方法方法体**不引用** `redact_output`。`redact_output` 真实调用点在 `complete_lease`（`service.py:898`，lease 子域，task-06 处理）。`patch/service.py` 因此**不 import** `redact_output`。

> 若 execute 阶段代码差异与此结论不符（例如 design 编写后有人新增了 patch 方法对 redact_output 的调用），则在 `patch/service.py` 顶部补 `from app.modules.git_gateway.service import redact_output`。以实际 grep 结果为准。

### Facade 委托伪代码（`backend/app/modules/daemon/service.py`）

```python
class DaemonService:
    def __init__(self, session: AsyncSession) -> None:
        # … 其他子 service …
        self._patch = PatchService(session)  # task-01 W1 已建

    # ── patch（task-03 迁入 patch/service.py）──────────────────────────────────
    async def _apply_patch_to_worktree(
        self,
        agent_run_id: UUID,
        patch_data: str,
        use_3way: bool = True,
    ) -> None:
        # 私有同名保留：调用点（service.py:901 complete_lease 路径 / 测试 / agent test mock）
        # 通过 facade 私有名访问，委托不破坏调用方。
        return await self._patch.apply_patch_to_worktree(
            agent_run_id=agent_run_id,
            patch_data=patch_data,
            use_3way=use_3way,
        )

    # _run_git_apply：无外部调用点（仅被 _apply_patch_to_worktree 内部用，已随主体迁入 PatchService）。
    # facade 侧不保留同名委托（避免无用方法），除非 W1 已建 —— 以 W1 产出为准。
```

> execute 时核对 W1 是否已为 `_run_git_apply` 建 facade 委托骨架：若已建，保留委托（委托到 `self._patch._run_git_apply(...)`）；若未建，不新增。

## 边界处理

1. **私有方法名保留**：facade 的 `_apply_patch_to_worktree` **保留前导下划线**。理由：存在 3 个调用点按私有名访问 ——
   - `service.py:901`（`complete_lease` 路径内 `self._apply_patch_to_worktree(...)`）；
   - `backend/app/modules/daemon/tests/test_wave5_integration.py:120,134`（测试 `svc._apply_patch_to_worktree(...)`）；
   - `backend/app/modules/agent/tests/test_execution_context.py:432`（`patch.object(DaemonService, "_apply_patch_to_worktree", _capture)` mock 私有名）。
   去掉下划线会破坏这 3 个调用点；facade 策略要求零感知，故保留。
2. **`PatchService` 内部公开名**：迁入子 service 时去前导 `_` 改为 `apply_patch_to_worktree`（子 service 内部无"私有契约"约束，公开名更清晰；`_run_git_apply` 因仅被同类内部调用，保留 `_`）。这是 facade 私有名 ↔ 子 service 公开名的命名映射，facade 委托层负责桥接。
3. **`git_gateway` import 不迁**：`from app.modules.git_gateway.service import redact_output`（`service.py:32`）**保留在 `service.py`**，不迁入 `patch/service.py`。理由：`redact_output` 实际被 `service.py:839,843,898,1548` 使用（lease / run_sync 路径），不属 patch 子域；迁入 patch 反而制造跨子域 import。task-06 / task-04 各自处理自己路径对 `redact_output` 的依赖。
4. **patch 冲突异常行为不变**：`PatchConflictError`（HTTP 409）在 `--3way` 失败时抛出、`PatchApplyError`（HTTP 422）在 check 失败（非 3way 模式）/ apply 失败 / 无 workspace 时抛出的判定分支**逐行不变**。`details` dict 字段（`agent_run_id` / `workspace_id` / `stderr` / `check_stderr` / `merge_stderr`）键名与值结构不变。
5. **异常类暂留 service.py**：`PatchApplyError` / `PatchConflictError` 定义位置不变（`service.py:85-92`）。`patch/service.py` 通过 `from app.modules.daemon.service import PatchApplyError, PatchConflictError` 反向引用。task-07 统一将异常类迁入对应子包（patch 异常 → `patch/service.py` 或 `patch/errors.py`）并在 facade `service.py` re-export，届时 `patch/service.py` 改为本地引用、`service.py` 顶部删除原定义。本 task 不动异常类位置，避免与 task-07 冲突。
6. **循环 import 风险**：`patch/service.py` import `service.py` 的异常类（反向 import）。Python 模块 import 顺序：若 `service.py` 先被加载，其顶部 `from app.modules.daemon.patch.service import PatchService`（facade 持有引用）会触发 `patch/service.py` 加载，后者又 `from app.modules.daemon.service import PatchApplyError` —— 此时 `service.py` 模块对象已存在（在 sys.modules），但 `PatchApplyError` 类定义位于 `service.py` 顶部第 85 行（早于 `DaemonService` 类和底部 `PatchService` import），import 时已执行完成，可正常取到。**结论**：异常类定义位置在 facade import 子 service 之前，无循环。execute 时实测 `python -c "from app.modules.daemon.service import DaemonService"` 通过即验证。若实测失败，降级方案：task-07 提前到本 task 之前执行（先迁异常类到 patch 子包）。

## 非目标

- **不动异常类定义位置**（`PatchApplyError` / `PatchConflictError` 留在 `service.py`，task-07 处理迁子包 + re-export）。
- **不动 `git_gateway`**（`redact_output` 单一真相源保持，`service.py:32` import 不迁）。
- **不动 `router.py`**（facade 兼容策略 N3）。
- **不动 `complete_lease` / lease 路径对 `redact_output` 的使用**（task-06 处理）。
- **不改 patch 应用逻辑**（git apply --check / --3way 流程、异常分支、日志键名全部不变）。
- **不重构 `_run_git_apply` 为非 staticmethod**（保持原签名 `@staticmethod async def`）。
- **不动 `agent/tests/test_execution_context.py` 的 mock**（`patch.object(DaemonService, "_apply_patch_to_worktree", ...)` 继续工作 —— facade 保留了同名私有方法）。

## 参考

- `design.md` §5.2 目标目录结构（patch/ 子包）
- `design.md` §6 文件变更清单第 126-128 行（patch 新增项）+ 第 128 行（service.py 修改项）
- `design.md` §7.1 facade 接口（`_apply_patch_to_worktree` 委托到 `self._patch.apply_patch_to_worktree(...)`）
- `design.md` §7.5 生命周期契约表（patch 不在四对象状态机中，属 worktree 副作用，契约不变）
- `design.md` §9 兼容策略（facade 方法签名保留、router 零改动）
- `plan.md` Wave 3 / 任务总表 task-03 行
- 源码：`backend/app/modules/daemon/service.py:85-92`（异常类）、`:32`（redact_output import）、`:3186-3299`（patch 方法体）、`:901`（complete_lease 调用点）
- 源码：`backend/app/modules/daemon/tests/test_wave5_integration.py:110-137`（TestPatchApply 现有测试）
- 源码：`backend/app/modules/agent/tests/test_execution_context.py:432`（agent 测试 mock 私有名）

## TDD步骤

1. **迁前基线**（确认当前全测通过）：
   ```bash
   make backend-test  # 确认 test_wave5_integration.TestPatchApply 2 用例 + 全 daemon 套件绿
   ```
2. **新建 `patch/service.py`**：按"接口定义"创建 `PatchService`，方法体从 `service.py:3201-3299` 逐行复制（含 docstring / 注释 / 日志键名 / 异常分支 / details dict）。异常类暂用 `from app.modules.daemon.service import PatchApplyError, PatchConflictError`。
3. **改 facade 委托**：`service.py` 中 `_apply_patch_to_worktree` 方法体替换为 `return await self._patch.apply_patch_to_worktree(...)`；`_run_git_apply` 按 W1 产出决定保留委托或删除（优先保留以维持 51 方法签名一致性）。
4. **跑 daemon 全测**（核心验证 —— 行为不变铁证）：
   ```bash
   make backend-test  # 重点：test_wave5_integration.TestPatchApply 2 用例必过
   # test_execution_context.py 中 mock _apply_patch_to_worktree 的用例必过（验证私有名保留）
   ```
5. **lint + 类型**：
   ```bash
   make backend-lint  # ruff check + ruff format check + mypy
   ```
6. **循环 import 验证**：
   ```bash
   python -c "from app.modules.daemon.service import DaemonService; print('ok')"
   python -c "from app.modules.daemon.patch.service import PatchService; print('ok')"
   ```
7. **行为不变核对**：`git diff` 仅在 `patch/service.py`（新增）、`service.py`（patch 区段改委托）两文件；`router.py` diff 为空。

## 验收标准

| AC ID | 验收点 | 验证方法 | 通过判据 |
|-------|--------|---------|---------|
| AC-01 | `patch/service.py` 存在且定义 `PatchService` 类 | `grep "class PatchService" backend/app/modules/daemon/patch/service.py` | 命中 1 行 |
| AC-02 | `PatchService` 承载 `apply_patch_to_worktree` + `_run_git_apply` 两方法 | `grep -c "async def apply_patch_to_worktree\|async def _run_git_apply" patch/service.py` | 输出 2 |
| AC-03 | facade `_apply_patch_to_worktree` 改委托 | 读 `service.py` 该方法体 | 仅 `return await self._patch.apply_patch_to_worktree(...)`，无业务逻辑 |
| AC-04 | facade 保留私有名 `_apply_patch_to_worktree` | `grep "_apply_patch_to_worktree" service.py` | 命中（委托方法定义 + `:901` 调用点） |
| AC-05 | patch 方法行为逐行不变 | `git diff` 对比迁前迁后的方法体（移到新文件） | 方法体内容字符级一致（仅类归属 / 方法名去 `_` 变化） |
| AC-06 | 异常类 `PatchApplyError` / `PatchConflictError` 仍在 `service.py:85-92` | `grep -n "class Patch\(Apply\|Conflict\)Error" service.py` | 命中第 85 / 90 行（位置不变） |
| AC-07 | daemon 全测通过 | `make backend-test` | exit 0，`TestPatchApply` 2 用例 + agent `test_execution_context` mock 用例全绿 |
| AC-08 | lint + 类型通过 | `make backend-lint` | ruff + mypy exit 0 |
| AC-09 | 无循环 import | `python -c "from app.modules.daemon.service import DaemonService"` | 正常 import，无 ImportError |
| AC-10 | `router.py` 零改动 | `git diff backend/app/modules/daemon/router.py` | 输出为空 |
| AC-11 | `patch/service.py` 未引入 `redact_output` import（核对结论） | `grep "redact_output" patch/service.py` | 无命中（若 execute 发现方法体引用则补 import，此 AC 调整为"有命中且方法体确实使用"） |
| AC-12 | facade 持有 `self._patch = PatchService(session)` | `grep "self._patch = PatchService" service.py` | 命中 1 行（task-01 W1 已建，本 task 确认未破坏） |
