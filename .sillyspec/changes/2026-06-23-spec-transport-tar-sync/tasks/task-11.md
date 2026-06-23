---
id: task-11
title: stage 链路测试（propose/plan/execute spec 写盘链路 tar 覆盖，含 design §5.0 事实修正）（覆盖：FR-03, D-007@v1）
priority: P1
estimated_hours: 2
depends_on: [task-05, task-06, task-10]
blocks: [task-12]
requirement_ids: [FR-03]
decision_ids: [D-007@v1]
allowed_paths:
  - backend/app/modules/agent/tests/
  - sillyhub-daemon/tests/
author: qinyi
created_at: 2026-06-23 11:20:01
---

# task-11：stage 链路（propose/plan/execute）spec 写盘 tar 覆盖测试

## 0. 关键发现：design §5.0 关于 stage 走 interactive 的事实修正（前置必读）

> **本任务在调研被测代码时发现 design.md §5.0 / §5.3 Wave2 存在与真实代码不符的表述，特此
> 修正并以真实代码为唯一依据写测试。修正不改变变更总目标（G1 异机 spec 回传 + 全 spec 写盘
> 链路覆盖），只修正「stage 经哪条 lease 路径」的实现位置描述。**

**design §5.0 原表述**（与代码冲突）：

> 真实路径：scan（`prepare_scan_interactive_dispatch`）和 stage（`start_stage_dispatch`→
> `dispatch_to_daemon`→`prepare_interactive_dispatch`）都创建 `kind='interactive'` lease。

**真实代码**（核实 `backend/app/modules/agent/service.py` + `placement.py`）：

| 入口 | placement 调用 | lease kind | agent_run_id 列 | daemon 执行路径 | spec-sync 生效点 |
|---|---|---|---|---|---|
| `start_scan_dispatch` | `prepare_scan_interactive_dispatch`（service.py:1369 / placement.py:429） | **interactive**（placement.py:504-523） | **NULL**（placement.py:399） | `_startInteractiveSession`（daemon.ts:1711） | **task-06**：`_startInteractiveSession` pull + `onSessionEnd` sync |
| `start_stage_dispatch`（propose/plan/execute/brainstorm/verify/archive/quick） | `dispatch_to_daemon`（service.py:1103 / placement.py:163） | **batch**（placement.py:269-287 INSERT 未指定 kind，DB 默认 `'batch'`） | **= run.id**（placement.py:282） | `_runLeaseStateMachine` → `TaskRunner.runLease`（batch） | **task-05**：runLease 步骤 1.5 pull + 步骤 8.5 sync（改调 spec-sync utility） |

**证据**：
- `placement.py:269-287`（`dispatch_to_daemon` 的 INSERT 语句）：`INSERT INTO daemon_task_leases (id, agent_run_id, runtime_id, status, metadata, created_at, updated_at)` —— **无 kind 列**，DB 默认值 `'batch'`；`agent_run_id` 绑定 `agent_run_id.hex`（run.id）。
- `placement.py:392-409`（`prepare_interactive_dispatch` 的 INSERT 语句）：显式 `kind='interactive'` + `agent_run_id=NULL`。
- `backend/app/modules/agent/tests/test_interactive_session_placement.py:223-259`（`TestBatchDispatchUnchanged`）：明确断言 batch lease `lease.kind == "batch"` 且 `lease.agent_run_id == run.id`（"the OPPOSITE of interactive"）。
- `service.py:1103`：stage 调 `dispatch_to_daemon`（非 `prepare_interactive_dispatch`）。
- `service.py:1369`：scan 调 `prepare_scan_interactive_dispatch`（interactive）。

**修正结论（本任务测试依据）**：
- **stage（propose/plan/execute/...）走 batch lease，经 TaskRunner.runLease**，spec 同步由 **task-05**（task-runner 改调 spec-sync utility）覆盖，**task-06 的 daemon.ts interactive 接入对 stage 不触发**。
- **全 spec 写盘链路覆盖（D-007@v1）= scan（interactive，task-06）+ stage（batch，task-05）两条路径分别验证 transport=tar 时 spec-sync utility 被正确调用**。本任务的连带价值是守护「task-05 的 batch 改调对 stage 同样生效」，而非原描述的「stage 复用 task-06 interactive」。
- D-007@v1 的核心（spec-sync 抽成共享 utility，batch + interactive 共用）**依然成立**——utility 由 task-04 提供，batch 路径（task-05）与 interactive 路径（task-06）都调用它；stage 作为 batch 的消费方自动获得 tar 覆盖，**无需 stage 专属 daemon 改动**（X-001 连带收益的真正含义）。

> **本任务建议**：在实现完成后，由 verify 阶段把 design §5.0 / §5.3 Wave2 的表述同步修正为
> 上表（design §5.0 的 stage 链路描述）。本蓝图测试以真实代码为准。

## 1. 目标与范围

本任务是 `2026-06-23-spec-transport-tar-sync` Wave 2 的**测试守护任务**，验证 **stage
（propose/plan/execute 等）spec 写盘链路在 transport=tar 下被正确覆盖**，补齐 Wave 1（scan）
之外的全 spec 写盘链路测试盲区。**不实现任何产品代码**。

三组独立单元测试：

- **测试组 D（backend `start_stage_dispatch` platform_args tar 分支）**：覆盖 task-10 的
  `start_stage_dispatch` 行 1006-1023 `platform_args` 按 transport 分支——tar 模式含 daemon
  本地路径 `~/.sillyhub/daemon/specs/{ws}`（复用 task-02 的 `resolve_prompt_spec_root`
  helper，task-10 调用）、shared 模式含宿主路径 `spec_data_host_dir/{ws}`（现状不变）。
  框架：pytest，沿用 `test_interactive_session_placement.py` + `test_e2e_stage_dispatch.py`
  的 mock 模式。
- **测试组 E（daemon task-runner batch 路径 spec-sync 对 stage lease 触发）**：守护
  task-05 的 batch 改调——构造 stage 类型的 batch lease（`kind='batch'` + `agent_run_id`
  非空 + metadata 含 `stage='propose'`/`workspace_id`），驱动 `TaskRunner.runLease`，断言
  tar 模式下 `pullSpecBundle`（步骤 1.5）+ `postSpecSync`（步骤 8.5）被调用、shared 模式零触发。
  框架：vitest + 复用 task-09 测试组 B 的 mock 模式（`daemon-kind-dispatch.test.ts` 的
  `createMockClient` + ws 消息驱动）。
- **测试组 F（链路契约守护：stage lease kind=batch + 双路径并存）**：守护 §0 的修正结论不被
  回归——构造 `start_stage_dispatch` 产生的 lease，断言 `kind=='batch'` 且 `agent_run_id`
  非 NULL（证明 stage 不走 interactive，task-05 而非 task-06 是 stage 的生效点）。一条契约
  断言用例，防止未来有人误把 stage 改走 interactive（破坏 task-05 覆盖）或误删 task-05 改调。

**铁律**：守护 **全 spec 写盘链路**（scan interactive + stage batch 两条路径）在 tar 模式下
spec-sync utility 都被正确调用——任一环节回归（如 task-05 改调漏了 stage metadata 场景、
task-10 的 platform_args tar 分支写错路径）→ 对应用例 fail。

## 2. 覆盖来源

| 来源 | 章节 | 关联点 |
|---|---|---|
| **本蓝图 §0** | design §5.0 stage 路径事实修正表 | 本任务测试依据（真实代码为准） |
| design.md §5.0 | X-001：spec-sync 抽成共享 utility，batch + interactive 共用 | 测试组 E 守护 batch 路径（stage 消费方） |
| design.md §5.3 Wave 2 | stage prompt 分支（`start_stage_dispatch` 同走 interactive，自动复用 Wave1 spec 同步）+ 测试 | 任务范围（路径表述以 §0 修正为准） |
| design.md §7.1 | `resolve_prompt_spec_root` helper 接口 | 测试组 D 断言 task-10 复用 helper 输出 |
| design.md §7.4 | 生命周期契约表（run sillyspec scan/stage 事件：`--spec-root` 本地路径） | 测试组 D 断言 stage prompt 的 --spec-root |
| decisions.md D-001@v1 | transport 正交 strategy，走全局 config | 测试组 D monkeypatch settings.spec_transport |
| decisions.md D-004@v1 | shared 模式保持现状（不 pull 不 sync） | 测试组 D shared 分支 + E shared 零触发 |
| decisions.md D-007@v1 | spec-sync utility batch + interactive 共用；X-001 连带收益：stage 无需专属 daemon 改动 | 全任务基线 + 测试组 E + F 守护 |
| task-02.md §1 | `resolve_prompt_spec_root` helper（task-10 复用） | 测试组 D 被测契约来源 |
| task-05.md §1 | task-runner runLease 改调 spec-sync utility（batch 行为不变） | 测试组 E 被测契约来源 |
| task-06.md §1 | daemon.ts interactive 接入（对 stage 不生效，§0 已证） | 测试组 F 证伪守护 |
| task-09.md §4.2/§4.3 | 测试组 B（daemon interactive mock 模式）+ C（backend payload 测试模式） | 本任务 mock 模式参考（避免重复） |
| task-10.md（plan 占位） | `start_stage_dispatch` platform_args 按 transport 分支 | 测试组 D 被测接口 |
| plan.md task-11 行 | stage 链路测试（复用 Wave1 spec-sync），全 spec 写盘链路覆盖 | 任务范围（D-007@v1） |
| `backend/app/modules/agent/service.py:929-1134` | `start_stage_dispatch` 真实实现（platform_args 行 1006-1023；dispatch_to_daemon 行 1103） | 测试组 D/F 被测代码 |
| `backend/app/modules/agent/placement.py:163-300` | `dispatch_to_daemon` 真实实现（batch lease INSERT 行 269-287） | 测试组 F 契约断言依据 |
| `backend/tests/modules/change/test_e2e_stage_dispatch.py` | 现有 stage dispatch e2e 测试模式（mock start_stage_dispatch + db_session） | 测试组 D mock 模式参考 |

## 3. 修改文件（均为新增测试文件）

| 操作 | 文件路径 | 测试组 | 框架 | 守护对象 |
|---|---|---|---|---|
| 新增 | `backend/app/modules/agent/tests/test_start_stage_dispatch_transport.py` | D + F | pytest | task-10 `start_stage_dispatch` platform_args tar/shared 分支 + stage lease kind=batch 契约 |
| 新增 | `sillyhub-daemon/tests/spec-transport-tar-sync/task-runner-stage-spec-sync.test.ts` | E | vitest | task-05 task-runner runLease batch 路径对 stage lease 的 spec-sync 触发 |

> **路径说明**：
> - 测试组 D/F 合并到一个 backend 文件——两者都围绕 `start_stage_dispatch` 产物（platform_args
>   + lease kind），共享 helper（构造 Change/Workspace/SpecWorkspace + mock placement），拆两
>   文件会重复 fixture。文件放 `backend/app/modules/agent/tests/`（与 `test_interactive_session_placement.py`
>   同目录，frontmatter `allowed_paths` 一致）。
> - 测试组 E 单独 daemon 文件，放 `sillyhub-daemon/tests/spec-transport-tar-sync/` 子目录（与
>   task-09 测试组 A/B 同目录前缀，变更 slug 隔离）。文件名 `task-runner-stage-spec-sync.test.ts`
>   明确「stage lease + task-runner batch 路径」，区别于 task-09 测试组 B（interactive 路径）。

## 4. 实现要求

### 4.1 测试组 D：start_stage_dispatch platform_args tar/shared 分支

> 目标函数：`AgentService.start_stage_dispatch`（`backend/app/modules/agent/service.py:929`），
> 被测代码段：行 1006-1023（`platform_args` 按 transport 分支，task-10 改造点）。
> **本任务只测不改**（task-10 实现 platform_args 分支，本任务守护）。

**用例清单**：

| 用例 | 场景 | 断言要点 |
|---|---|---|
| D1 | tar 模式 platform_args 含 daemon 本地路径 | `monkeypatch settings.spec_transport='tar'`，SpecWorkspace `strategy='platform-managed'` + `spec_root` 非空，mock `dispatch_to_daemon` 捕获 `prompt` 参数 → prompt 含 `--spec-root ~/.sillyhub/daemon/specs/{ws_id}`（task-10 复用 task-02 helper 输出） |
| D2 | tar 模式 platform_args 含 runtime + workspace-id | D1 基础上断言 prompt 同时含 `--runtime-root ~/.sillyhub/daemon/specs/{ws_id}/runtime` + `--workspace-id {ws_id}`（与 scan bundle 对齐，task-10 行 1019-1023） |
| D3 | shared 模式 platform_args 含宿主路径（D-004 现状） | `settings.spec_transport='shared'`（默认），同 D1 构造 → prompt 含 `--spec-root {spec_data_host_dir}/{ws_id}`（宿主路径，bind mount 共享，现状零改动） |
| D4 | shared 模式 platform_args 含宿主 runtime | D3 基础上断言 `--runtime-root {spec_data_host_dir}/{ws_id}/runtime`（task-10 行 1018 host_runtime_root） |
| D5 | 非 platform-managed workspace 无 platform_args | SpecWorkspace `strategy='repo-native'`（或无 SpecWorkspace）→ `platform_args` 为空串（task-10 行 1011 条件 `spec_ws.strategy == "platform-managed"`），prompt 不含 `--spec-root` |
| D6 | platform-managed 但 spec_root 为空 | SpecWorkspace `strategy='platform-managed'` 但 `spec_root=None` → `platform_args` 为空（task-10 行 1011 条件 `and spec_ws.spec_root`），降级不注入 |
| D7 | tar/shared 双模式 transport 值正交于 strategy | D1/D3 用例 cross-check：同 workspace（platform-managed）仅 transport 不同 → platform_args 路径前缀不同（`~/.sillyhub/...` vs 宿主路径），证明 D-001 transport 正交 strategy（D-006 双轨语义） |

**mock 策略**（参考 `test_start_scan_dispatch_daemon_client.py` + `test_e2e_stage_dispatch.py`）：
- `patch.object(service, "_mark_no_online_daemon", AsyncMock())` 避免 daemon 离线标记。
- `patch("app.modules.agent.placement.RunPlacementService.dispatch_to_daemon", AsyncMock(...))`
  捕获 `prompt` 参数（dispatch_to_daemon 的 `prompt=` kwarg 即 stage 渲染后的 prompt）。
- `patch("app.modules.agent.placement.RunPlacementService.decide_backend", AsyncMock(return_value=ExecutionBackend.DAEMON))`
  绕过 runtime 在线判定。
- `monkeypatch` settings.spec_transport：patch `app.core.config.get_settings` 返回带
  `spec_transport` 字段的 mock（以 task-01 实际暴露入口为准，对齐 task-09 测试组 C 的
  `_patch_transport` helper）。
- 真实 DB（`db_session` fixture）构造 Change + Workspace + SpecWorkspace 行（参考
  `test_e2e_stage_dispatch.py` 的 `_create_workspace` + Change 构造模式）。

**fixture 复用**：从 `test_e2e_stage_dispatch.py` import `_create_workspace`（或复制最小版本），
从 `test_interactive_session_placement.py` 复制 `_create_user`/`_create_runtime`（若 D 组
需要 runtime；D1-D7 因 mock 了 decide_backend/dispatch_to_daemon，可能不需要 runtime 行——
实现时按 mock 深度决定是否构造）。

### 4.2 测试组 E：task-runner batch 路径对 stage lease 的 spec-sync 触发

> 目标函数：`TaskRunner.runLease`（`sillyhub-daemon/src/task-runner.ts`，task-05 改调
> spec-sync utility）。**本任务只测不改**（task-05 实现改调，本任务守护 stage lease 场景）。
> 区别于 task-09 测试组 A（utility 纯函数）+ B（interactive 路径）：本组测 **batch 路径
> + stage 类型 lease**，证明 stage 经 batch 自动获得 tar 覆盖。

**用例清单**：

| 用例 | 场景 | 断言要点 |
|---|---|---|
| E1 | stage lease tar 模式 pull 触发 | 构造 batch lease（`kind='batch'` + `agent_run_id` 非空 + metadata `{transport:'tar', workspaceId:'ws-1', stage:'propose', spec_root:null}`），mock client.getSpecBundle 返回 tar → 驱动 runLease → `pullSpecBundle`（vi.mock `./spec-sync` spy）被调、wsId=`'ws-1'`、spec 解到 `resolveSpecDir('ws-1')` |
| E2 | stage lease tar 模式 sync 触发 | E1 基础上，runLease 跑完（mock child exit 0）→ `postSpecSync`（spy）被调、wsId=`'ws-1'`、specRoot=`resolveSpecDir('ws-1')`（步骤 8.5，task-05 改调） |
| E3 | stage lease shared 模式零触发（D-004） | metadata `{transport:'shared'}`（或无 transport 字段，task-05 默认 shared）→ `pullSpecBundle` + `postSpecSync` 均未被调（specRoot=null，步骤 1.5/8.5 守卫 `if (specRoot)`） |
| E4 | stage 子阶段覆盖（propose/plan/execute） | 参数化用例：metadata.stage 分别为 `'propose'`/`'plan'`/`'execute'`，tar 模式 → 三者均触发 pull+sync（证明 stage 类型不影响 spec-sync，kind=batch 才是生效条件） |
| E5 | stage lease tar 模式 pull 404 容错 | mock getSpecBundle reject `{status:404}` → utility 容错 mkdir 空目录返回路径非 null → runLease 继续（specRoot 非空）→ postSpecSync 仍触发（首次 scan-style 场景对 stage 同样适用，agent 生成新文档后回传） |
| E6 | stage lease tar 模式 sync 失败不阻塞（R-03） | mock postSpecSync reject → runLease 不抛错、TaskResult.success 仍按 child exitCode（步骤 8.5 容错，task-runner.ts:488-490 对齐） |

**mock 策略**（参考 `task-09-spec-pull-push.test.ts` batch 路径 + `daemon-kind-dispatch.test.ts`）：
- `vi.mock('../../src/spec-sync.js', ...)` 替换 `pullSpecBundle`/`postSpecSync`/`resolveSpecDir`
  为 `vi.fn()` spy（E 组只验 task-runner 调用契约，utility 内部行为由 task-09 测试组 A 覆盖）。
- mock child process：`createFakeChild`（参考 `task-09-spec-pull-push.test.ts` + `helpers/fake-child.ts`）
  返回 exit 0 的 fake child，驱动 runLease 走完步骤 1-9。
- mock client：`{ getSpecBundle: vi.fn(), postSpecSync: vi.fn(), ... }` 覆盖 ClientLike 所需方法。
- lease payload 构造：参考 `task-09-spec-pull-push.test.ts` 的 lease payload 构造模式，额外
  注入 `stage`/`transport`/`workspaceId`/`spec_root:null`（tar 模式不透传 spec_root 触发 pull）。

**与 task-09 测试组 B 的区分**：
- task-09 B 组测 **interactive 路径**（`_startInteractiveSession`/`onSessionEnd`，scan 专用）。
- 本 E 组测 **batch 路径**（`TaskRunner.runLease`，stage 专用）。
- 两者正交，文件分立（`spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts` vs
  `spec-transport-tar-sync/task-runner-stage-spec-sync.test.ts`），mock 注入点不同（B 组 mock
  SessionManager，E 组 mock child process）。

### 4.3 测试组 F：stage lease kind=batch 契约守护（§0 修正结论防回归）

> 目标：守护 §0 表格的结论——stage 走 batch lease（非 interactive），证明 task-05 而非
> task-06 是 stage spec-sync 生效点。一条契约断言用例（轻量），防未来误改。

**用例清单**：

| 用例 | 场景 | 断言要点 |
|---|---|---|
| F1 | start_stage_dispatch 产生 batch lease | 真实 DB 调 `start_stage_dispatch`（mock dispatch_to_daemon 捕获 lease_id，或直接查 daemon_task_leases 表）→ lease `kind == 'batch'` + `agent_run_id == run.id`（非 NULL）。守护 stage 不被误改为 interactive（否则 task-05 覆盖失效、需 task-06 接入） |
| F2 | start_scan_dispatch 产生 interactive lease（对照） | 同一 fixture 框架调 `start_scan_dispatch`（mock prepare_scan_interactive_dispatch）→ lease `kind == 'interactive'` + `agent_run_id is None`。F1/F2 对照守护「scan interactive + stage batch」分流不被打破 |

> F2 用例若 task-09 测试组 B 或现有 `test_interactive_session_placement.py` 已充分覆盖
> interactive lease kind，可省略（避免重复）——实现时确认，若已有覆盖则只留 F1。

## 5. 接口定义

### 5.1 测试组 D/F（pytest）函数签名

```python
# backend/app/modules/agent/tests/test_start_stage_dispatch_transport.py
"""task-11（2026-06-23-spec-transport-tar-sync）：start_stage_dispatch platform_args
transport 分支测试 + stage lease kind=batch 契约守护（§0 修正结论）。

覆盖 design §7.1（resolve_prompt_spec_root helper，task-10 复用）+ §7.4 契约表
（run sillyspec stage 事件 --spec-root 本地路径）+ §0 stage 路径修正表。

守护 task-10（platform_args tar/shared 分支）+ §0 结论（stage batch lease）。
"""
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.agent.service import AgentService
from app.modules.change.model import Change
from app.modules.workspace.model import Workspace


async def _create_platform_workspace(
    session: AsyncSession, *, strategy: str = "platform-managed", spec_root: str | None = "/data/spec-workspaces/ws"
) -> tuple[uuid.UUID, uuid.UUID]:
    """构造 Workspace + SpecWorkspace + Change，返回 (workspace_id, change_id)。
    参考 test_e2e_stage_dispatch.py 的 _create_workspace + Change 构造模式。"""
    ...


def _patch_transport(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    """patch settings.spec_transport（以 task-01 实际 get_settings 入口为准，
    对齐 task-09 测试组 C 的 _patch_transport helper）。"""
    ...


@pytest.mark.asyncio
async def test_stage_dispatch_tar_mode_platform_args_contains_daemon_local_path(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D1: tar 模式 platform_args 含 daemon 本地路径 ~/.sillyhub/daemon/specs/{ws}。"""
    _patch_transport(monkeypatch, "tar")
    ws_id, change_id = await _create_platform_workspace(db_session)
    captured_prompt: dict[str, str] = {}

    async def _capture_prompt(*args, **kwargs):
        captured_prompt["prompt"] = kwargs.get("prompt", "")
        return uuid.uuid4()  # lease_id

    with (
        patch.object(AgentService, "_mark_no_online_daemon", new=AsyncMock()),
        patch(
            "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
            new=AsyncMock(side_effect=_capture_prompt),
        ),
        patch(
            "app.modules.agent.placement.RunPlacementService.decide_backend",
            new=AsyncMock(),
        ),
    ):
        service = AgentService(db_session)
        await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uuid.uuid4(),
            stage="propose",
            prompt_template="propose.md",
            requires_worktree=True,
            read_only=False,
        )

    assert f"~/.sillyhub/daemon/specs/{ws_id}" in captured_prompt["prompt"]
    assert f"--spec-root ~/.sillyhub/daemon/specs/{ws_id}" in captured_prompt["prompt"]


@pytest.mark.asyncio
async def test_stage_dispatch_shared_mode_platform_args_contains_host_path(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D3: shared 模式 platform_args 含宿主路径 spec_data_host_dir/{ws}（D-004 现状）。"""
    ...


@pytest.mark.asyncio
async def test_stage_dispatch_produces_batch_lease(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """F1: start_stage_dispatch 产生 kind='batch' lease（§0 修正结论守护）。"""
    # 真实走 start_stage_dispatch（mock decide_backend + dispatch_to_daemon 捕获 lease_id），
    # 查 daemon_task_leases 表断言 kind='batch' + agent_run_id=run.id。
    ...
```

### 5.2 测试组 E（vitest）函数签名

```typescript
// sillyhub-daemon/tests/spec-transport-tar-sync/task-runner-stage-spec-sync.test.ts
/**
 * task-11（2026-06-23-spec-transport-tar-sync）：task-runner batch 路径对 stage lease
 * 的 spec-sync 触发测试。守护 task-05（runLease 改调 spec-sync utility）对 stage 类型
 * lease 生效 —— 证明 stage（propose/plan/execute）经 batch 路径自动获得 tar 覆盖
 * （§0 修正结论 + D-007@v1 X-001 连带收益）。
 *
 * 区别于 task-09 测试组 B（interactive 路径，scan 专用）：本组测 batch 路径（stage 专用）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock spec-sync 替换为 spy（E 组只验 task-runner 调用契约）
vi.mock('../../src/spec-sync.js', () => ({
  pullSpecBundle: vi.fn(async (_c: unknown, _ws: string) => '/fake/spec/dir'),
  postSpecSync: vi.fn(async () => ({ ok: true, reparsed: 0 })),
  resolveSpecDir: vi.fn((ws: string) => `/fake/spec/dir/${ws}`),
}));
import { pullSpecBundle, postSpecSync } from '../../src/spec-sync.js';

// 参考 task-09-spec-pull-push.test.ts 的 createFakeChild + lease payload 构造模式
function makeStageLeasePayload(overrides: Partial<{
  stage: string;
  transport: string;
  workspaceId: string;
  specRoot: string | null;
}> = {}) {
  return {
    kind: 'batch',
    agent_run_id: '00000000-0000-0000-0000-000000000001', // batch 特征：非空
    workspaceId: overrides.workspaceId ?? 'ws-stage-1',
    transport: overrides.transport ?? 'tar',
    stage: overrides.stage ?? 'propose',
    spec_root: overrides.specRoot ?? null, // tar 模式不透传 spec_root 触发 pull
    prompt: 'stage prompt',
    provider: 'claude',
    // ... 其余 batch lease 必需字段
    ...overrides,
  };
}

// E1-E6 用例：构造 stage batch lease + fake child（exit 0），驱动 TaskRunner.runLease，
// 断言 pullSpecBundle/postSpecSync spy 调用契约。
describe('task-runner batch stage lease spec-sync（task-05+task-11, D-007@v1）', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  // E1-E6 用例 ...
});
```

## 6. 边界处理（≥5）

| # | 边界场景 | 处理（测试侧） | 来源 |
|---|---|---|---|
| 1 | **复用 task-09 测试模式避免重复** | D 组 monkeypatch settings 模式复用 task-09 C 组 `_patch_transport` helper；E 组 vi.mock spec-sync + fake child 模式复用 task-09 B 组 + 遗留 `task-09-spec-pull-push.test.ts`。**不重复** task-09 测试组 A（utility 纯函数）+ B（interactive 路径）+ C（build_claim_payload）的用例，本任务只补 stage 维度盲区 | task-09 §4 / 非目标 |
| 2 | **stage 子阶段覆盖（propose/plan/execute）** | E4 参数化用例覆盖三个 stage 值，证明 stage 类型不影响 spec-sync 触发（kind=batch 才是生效条件）。D 组主测 propose（代表），不穷举所有 stage（避免膨胀） | design §5.3 Wave2 / STAGE_AGENT_CONFIG |
| 3 | **shared 模式零触发守护（D-004 核心不变式）** | D3/D4（platform_args 含宿主路径）+ E3（pull/sync 未调）共同守护 shared 模式不被 tar 改动污染。任一回归（task-10 对 shared 也写 daemon 本地路径、task-05 对 shared 也触发 sync）→ 对应用例 fail | design §5.1 / §9 / D-004@v1 |
| 4 | **§0 修正结论防回归（F 组核心）** | F1 断言 stage lease `kind=='batch'` + `agent_run_id==run.id`。若未来有人误把 stage 改走 interactive（如 service.py:1103 误调 prepare_interactive_dispatch），task-05 的 batch 覆盖失效、需重接 task-06 —— F1 fail 暴露。**这是 §0 修正的直接守护** | 本蓝图 §0 / design §5.0 修正 |
| 5 | **tar 模式 platform_args 非 platform-managed 降级** | D5/D6 用例守护 `spec_ws.strategy == "platform-managed" and spec_ws.spec_root` 条件——非 platform-managed 或 spec_root 空 → platform_args 为空（task-10 行 1011 条件），不注入 --spec-root（stage 走本地 .sillyspec，行为不变） | service.py:1011 现有条件 |
| 6 | **stage lease tar 模式 pull 404 容错（R-02 连带）** | E5 用例守护首次 stage（backend 无历史 spec bundle）时 pull 404 → utility 容错 mkdir 空目录 → specRoot 非空 → postSpecSync 仍触发（agent 生成 design.md/plan.md 等后回传）。**与 scan 首次场景同构**，证明 utility 404 容错对 stage 同样适用 | design §7.2 E-01 / §10 R-02 / task-04 §4.3 |
| 7 | **stage lease sync 失败不阻塞（R-03 连带）** | E6 用例守护 task-05 改调后 batch 路径 R-03 容错语义不变——postSpecSync reject → runLease 不抛错、TaskResult.success 按 child exitCode（步骤 8.5，task-runner.ts:488-490 对齐） | design §10 R-03 / task-05 §1 |
| 8 | **transport 正交 strategy（D-001）cross-check** | D7 用例同 workspace（platform-managed）仅切换 transport → platform_args 路径前缀不同，证明 transport 与 strategy 正交、不互相污染 | decisions.md D-001@v1 / D-006@v1 双轨 |
| 9 | **daemon interactive 接入对 stage 不生效的证明（§0）** | E 组通过构造 batch lease 驱动 runLease（而非 _startInteractiveSession）证明 stage 经 batch 路径——**不构造 interactive session**，反向证明 task-06 的 daemon.ts 接入点对 stage lease 不触发。若有人误以为 stage 走 interactive 而只测 task-06 路径，会漏掉 task-05 覆盖 | 本蓝图 §0 / design §5.0 修正 |

## 7. 非目标

- **不实现任何产品代码**：本任务 allowed_paths 只含测试目录。task-10（start_stage_dispatch
  platform_args 分支）+ task-05（task-runner 改调）的产品代码改动属对应 task。本任务发现产品
  bug 时反馈对应 task 修。
- **不重复 task-09 的 utility 单测**：spec-sync.ts 4 函数（resolveSpecDir/pullSpecBundle/
  packSpecDir/postSpecSync）的纯函数测试 + 404 容错 + Tar Slip 由 task-09 测试组 A 覆盖。本
  任务 E 组用 vi.mock 把 utility 替换为 spy，只验 task-runner 调用契约（stage lease 场景）。
- **不重复 task-09 的 interactive 接入测试**：daemon.ts `_startInteractiveSession`/`onSessionEnd`
  接入（scan interactive 路径）由 task-09 测试组 B 覆盖。本任务只测 batch 路径（stage）。
- **不做端到端真机测试**：异机拓扑 `SPEC_TRANSPORT=tar` stage 全流程文件落 backend `/data/{ws}`
  的端到端验证属 **task-12**（Wave 3）。本任务只做单元/组件级测试（backend platform_args 单测 +
  daemon task-runner batch mock 驱动），不拉起真实 backend/daemon/driver/网络。
- **不测 build_claim_payload transport 透传**：task-03 的 claim payload tar 透传由 task-09
  测试组 C 覆盖。本任务 D 组聚焦 start_stage_dispatch 的 platform_args（prompt 侧），不重复
  claim payload 测试。
- **不测 transport config 字段读取**：`Settings.spec_transport` env 读取/枚举校验属 task-01
  测试范围。本任务 D 组 monkeypatch 值。
- **不改 design.md §5.0 表述**：§0 修正结论在蓝图中标注，design.md 的同步修正属 task-13
  （Wave 3 文档同步）范围。本任务测试以真实代码为准，不依赖 design 表述。
- **不穷举所有 stage 子阶段**：D 组测 propose 代表，E4 参数化覆盖 propose/plan/execute 三个
  核心写盘 stage；brainstorm/verify/archive/quick 不穷举（spec-sync 行为不随 stage 值变化，
  E4 已证）。

## 8. 参考

### 8.1 现有 stage dispatch 测试模式（backend）

- `backend/tests/modules/change/test_e2e_stage_dispatch.py`：
  - **参考点**：`_create_workspace` helper（构造 Workspace 行）；Change 行构造模式
    （`change_key`/`current_stage`/`stages` JSON）；`_patch_stage_dispatch_creates_run`
    contextmanager（mock `AgentService.start_stage_dispatch`）；`db_session` fixture +
    `tmp_path`。
  - **本任务 D 组对齐**：复用 Workspace/Change 构造模式，但**不 mock start_stage_dispatch**
    （D 组要真实走 start_stage_dispatch 捕获 platform_args），改为 mock 其下游
    `dispatch_to_daemon`/`decide_backend`。
- `backend/app/modules/agent/tests/test_start_scan_dispatch_daemon_client.py`：
  - **参考点**：mock `dispatch_to_daemon` + `decide_backend` + `_mark_no_online_daemon` 的
    patch 组合模式（本任务 D 组直接复用，scan 与 stage 的 mock 下游一致）。
- `backend/app/modules/agent/tests/test_interactive_session_placement.py`：
  - **参考点**：`_create_user`/`_create_runtime` helper；`TestBatchDispatchUnchanged`
    （batch lease kind 断言模式，本任务 F 组直接对齐）；`db_session` fixture。

### 8.2 现有 daemon batch 路径测试模式

- `sillyhub-daemon/tests/task-09-spec-pull-push.test.ts`（变更 2026-06-22 遗留，测 batch
  TaskRunner.runLease 的 pull/push）：
  - **参考点**：`vi.hoisted` + `vi.mock('node:os')` 固定 homedir；`createFakeChild`
    （`helpers/fake-child.ts`）驱动 runLease；lease payload 构造模式；mock
    HubClient.getSpecBundle/postSpecSync。
  - **本任务 E 组复用**：直接复用 fake child + lease payload 构造，**新增 stage 类型 lease
    场景**（注入 `stage`/`transport`/`workspaceId`/`spec_root:null`）。
- `sillyhub-daemon/tests/daemon-kind-dispatch.test.ts`：
  - **参考点**：mock Daemon 构造签名、`createMockClient()` 桩对象、ws 消息驱动
    `_runLeaseStateMachine`（batch 分流）。

### 8.3 被测接口契约（来自 task-02/05/10 蓝图）

- **resolve_prompt_spec_root**（task-02 §4，task-10 复用）：`resolve_prompt_spec_root(transport,
  ws_id, settings) -> str`，tar 返回 `~/.sillyhub/daemon/specs/{ws_id}`，shared 返回
  `{spec_data_host_dir}/{ws_id}`。
- **start_stage_dispatch platform_args**（task-10 改造点，service.py:1006-1023）：tar 模式
  `platform_args = f" --spec-root {resolve_prompt_spec_root('tar', ws_id, settings)}"
  f" --runtime-root {resolve_prompt_spec_root('tar', ws_id, settings)}/runtime"
  f" --workspace-id {ws_id}"`；shared 模式用宿主路径（现状）。
- **task-runner runLease spec-sync**（task-05 改调）：步骤 1.5
  `pullSpecBundle(this.client, wsId, { existingSpecRoot })`（tar 模式 spec_root=null 触发）；
  步骤 8.5 `postSpecSync(this.client, wsId, specRoot)`（specRoot 非空触发，R-03 容错）。

## 9. TDD（测试驱动顺序）

> 本任务**只写测试不改产品代码**，TDD 顺序体现为「测试与 task-05/10 同步落地」：
> task-05/10 实现时先写接口骨架，本任务测试随之 RED→GREEN。

1. **RED（task-10 platform_args 分支先于测试）**：
   - task-10 提交 start_stage_dispatch platform_args tar 分支（可能漏复用 helper 或路径写错）
     → 本任务 D1 测试 fail（prompt 不含 `~/.sillyhub/daemon/specs/{ws}`）。
   - task-10 修正复用 `resolve_prompt_spec_root` → D1 GREEN。
2. **RED（task-05 task-runner 改调先于测试）**：
   - task-05 提交 runLease 改调骨架（可能漏改步骤 8.5）→ 本任务 E2 测试 fail
     （postSpecSync 未被调）。
   - task-05 完整改调 → E2 GREEN。
3. **RED（§0 契约先于测试）**：
   - 若有人误把 stage 改走 interactive（service.py:1103 误调 prepare_interactive_dispatch）
     → 本任务 F1 测试 fail（lease.kind != 'batch'）。
   - 修正回 batch → F1 GREEN。
4. **REFACTOR**：测试稳定后不重构产品代码；测试自身可优化 fixture 复用（D 组 helper 提取、
   E 组 fake child 工厂复用 task-09 模式），保持用例独立可读。

**落地节奏**：本任务依赖 task-05/06/10（frontmatter `depends_on`）。task-05/10 实现后本任务
D/E 组测试可 GREEN；task-06 依赖用于 §0 契约对照（F 组证明 stage 不走 task-06 路径）。若并行
开发，本任务测试可先写（RED 状态），待依赖任务实现后转 GREEN。

## 10. 验收标准（AC）

| AC | 验收项 | 验证方式 | 覆盖 |
|---|---|---|---|
| AC-1 | 新增 `backend/app/modules/agent/tests/test_start_stage_dispatch_transport.py`，含 D1-D7 + F1 共 8 用例 | `cd backend && uv run pytest app/modules/agent/tests/test_start_stage_dispatch_transport.py` 全通过 | FR-03, D-001@v1, D-004@v1 |
| AC-2 | D1 用例守护 tar 模式 platform_args 含 `~/.sillyhub/daemon/specs/{ws}`（task-10 复用 task-02 helper） | pytest D1 pass | design §7.1/§7.4, FR-03 |
| AC-3 | D3 用例守护 shared 模式 platform_args 含宿主路径（D-004 现状不变） | pytest D3 pass | D-004@v1 |
| AC-4 | D5/D6 用例守护非 platform-managed / spec_root 空 → platform_args 为空（降级） | pytest D5+D6 pass | service.py:1011 条件 |
| AC-5 | D7 用例守护 transport 正交 strategy（同 workspace 切换 transport 路径不同） | pytest D7 pass | D-001@v1 / D-006@v1 |
| AC-6 | F1 用例守护 stage lease `kind=='batch'` + `agent_run_id==run.id`（§0 修正结论防回归） | pytest F1 pass | 本蓝图 §0 / design §5.0 修正 |
| AC-7 | 新增 `sillyhub-daemon/tests/spec-transport-tar-sync/task-runner-stage-spec-sync.test.ts`，含 E1-E6 共 6 用例 | `pnpm vitest run tests/spec-transport-tar-sync/task-runner-stage-spec-sync.test.ts` 全通过 | FR-03, D-007@v1 |
| AC-8 | E1+E2 用例守护 stage batch lease tar 模式 pull+sync 触发（task-05 改调对 stage 生效） | vitest E1+E2 pass | D-007@v1（X-001 连带） |
| AC-9 | E3 用例守护 stage batch lease shared 模式零触发（D-004） | vitest E3 pass | D-004@v1 |
| AC-10 | E4 用例守护 propose/plan/execute 三 stage 均触发（stage 类型不影响 spec-sync） | vitest E4 pass（参数化 3 case） | design §5.3 Wave2 |
| AC-11 | E5 用例守护 stage lease tar 模式 pull 404 容错（R-02 连带，首次 stage 场景） | vitest E5 pass | design §7.2 E-01 / §10 R-02 |
| AC-12 | E6 用例守护 stage lease sync 失败不阻塞（R-03 连带，task-05 改调后容错不变） | vitest E6 pass | design §10 R-03 |
| AC-13 | 全部测试不真实网络/不真实 backend（mock + db_session + fake child） | 代码审查：无真实 HTTP/fetch、无真实 daemon spawn | 非目标 |
| AC-14 | `cd backend && uv run pytest` + `uv run mypy` + `uv run ruff check .` 通过（含新增 test_start_stage_dispatch_transport.py） | 本地跑全量 | 全局 AC |
| AC-15 | `cd sillyhub-daemon && pnpm vitest run` + `pnpm tsc --noEmit` 通过（含新增 task-runner-stage-spec-sync.test.ts，不破坏现有测试） | 本地跑全量 | 全局 AC |
| AC-16 | 现有 `task-09-spec-pull-push.test.ts`（batch 路径，非 stage 场景）仍通过（本任务不冲突） | vitest 全量含该文件 pass | 非冲突守护 |
| AC-17 | 现有 `test_e2e_stage_dispatch.py`（stage e2e，mock start_stage_dispatch）仍通过 | pytest test_e2e_stage_dispatch.py pass | D-004 回归守护 |
| AC-18 | git diff 只含 2 个新增测试文件（无产品代码改动） | `git diff --name-only` 仅 2 文件 | 非目标 |
| AC-19 | D-007@v1 守护：E 组测试断言 stage 经 batch 路径（TaskRunner.runLease）调 spec-sync utility（pullSpecBundle/postSpecSync 从 `./spec-sync` import），证明 stage 无需专属 daemon 改动即获 tar 覆盖（X-001 连带收益） | 代码审查 E 组 mock 注入方式 + §0 修正表 | D-007@v1（X-001 修正核心 + 连带） |
| AC-20 | §0 修正结论在蓝图显式标注（design §5.0 stage 路径表述与代码冲突，本任务以代码为准） | 蓝图 §0 存在 + 测试以 batch 路径为准 | 本蓝图 §0 |

## 11. 依赖关系

- **depends_on: task-05**：E 组测试 task-runner runLease 改调 spec-sync utility（batch 路径）
  由 task-05 实现。task-05 未完成则 E 组 RED（runLease 未调 utility）。
- **depends_on: task-06**：F 组 §0 契约对照需要 task-06 的 interactive 接入存在（证明 scan
  走 interactive、stage 不走）。task-06 未完成则 F 组对照意义减弱（但仍可守护 stage batch）。
- **depends_on: task-10**：D 组测试 start_stage_dispatch platform_args tar/shared 分支由
  task-10 实现。task-10 未完成则 D 组 RED（platform_args 无 transport 分支）。
- **blocks: task-12**：端到端验证（task-12）依赖本任务单元测试 GREEN 作为底层守护——本任务
  fail 则 task-12 端到端无意义（stage 链路底层已断）。
- **不依赖 task-01/02/03/04/07/08/09**：task-01（config）由 D 组 monkeypatch 跳过；task-02
  （helper）由 task-10 复用，D 组只验 task-10 输出；task-03（claim payload）由 task-09 C 组
  测；task-04（utility）由 task-09 A 组测；task-07（sync 端点）属 backend 接收侧；task-08
  （context_builder）独立；task-09（scan 链路测试）本任务复用其模式但不依赖其实现。

## 12. 风险

| 风险 | 等级 | 应对 |
|---|---|---|
| §0 修正结论与 design §5.0 表述冲突，实现者困惑 | P2 | 蓝图 §0 显式标注修正 + 证据链（placement.py INSERT + test_interactive_session_placement.py 断言）；建议 task-13 同步 design.md 表述；测试以真实代码为唯一依据 |
| D 组 monkeypatch settings 方式与 task-01 实际入口不符 | P2 | `_patch_transport` helper 以 task-01 暴露的 `get_settings` 入口为准（对齐 task-09 C 组）；备选 `monkeypatch.setattr(Settings, 'spec_transport', value)` |
| D 组 mock 深度不足导致 start_stage_dispatch 提前 return（如 decide_backend 抛 NoOnlineDaemonError） | P2 | 参考 `test_start_scan_dispatch_daemon_client.py` 的完整 patch 组合（`_mark_no_online_daemon` + `dispatch_to_daemon` + `decide_backend`），确保走到 platform_args 构造 + dispatch_to_daemon 调用 |
| E 组 fake child 驱动 runLease 时序复杂（step 1-9 全跑） | P2 | 复用 `task-09-spec-pull-push.test.ts` 的 fake child 模式（已验证可驱动 runLease 全流程）；E 组只额外注入 stage metadata，不改变驱动机制 |
| F 组查 daemon_task_leases 表时 SQLite 默认值 'batch' 与 PostgreSQL 不一致 | P3 | F1 断言 `kind == 'batch'`（默认值），SQLite/PostgreSQL 均适用；若 DB schema 显式 DEFAULT 'batch' 则无风险，实现时确认 migration |
| task-05/10 实现与蓝图接口签名偏差导致测试失败 | P2 | 本任务实现时以**实际代码签名**为准（蓝图为参考）；发现偏差反馈对应 task 修代码或本任务调整测试断言 |
