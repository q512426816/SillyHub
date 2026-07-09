"""scan 模式强制单元测试（task-07 / FR-001, FR-006）。

验证 ``prepare_interactive_dispatch`` 在 2026-07-08 D-001 后强制写入 lease
``metadata`` 的 ``manual_approval=True`` + ``ask_user_only=True``，无论入参
传什么（scan 模式统一）。并确认 ``metadata`` 不含 ``permissionMode=
bypassPermissions``（task-02 撤回验证）。

依据：
  - design：changes/2026-07-08-daemon-permission-verify-fix/design.md（D-001 强制 scan 模式）
  - 源码：app/modules/agent/placement.py:448-449（强制 True）+ :555-556（scan 入口）
  - task-02 撤回：placement.py 不写 permissionMode=bypassPermissions（daemon 侧
    session-manager.ts:799 permissionMode='default'，backend lease metadata 无该字段）
"""

import json
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.agent.placement import RunPlacementService


def _runtime_dict() -> dict:
    """_get_online_runtime 返回的 runtime 字典（含 daemon_instance_id）。"""
    return {
        "id": uuid.uuid4(),
        "daemon_instance_id": uuid.uuid4(),
    }


def _capture_session() -> MagicMock:
    """捕获 ``self._session.execute`` 的 Raw SQL insert，便于断言 metadata JSON。

    RunPlacementService.prepare_interactive_dispatch 经 Raw SQL INSERT INTO
    daemon_task_leases 写 lease，metadata 以 ``json.dumps(metadata)`` 传入 bind
    参数 ``:metadata``。本 mock 记录所有 execute 调用的 kwargs，供测试解析。
    """
    session = MagicMock()
    session.execute = AsyncMock()
    session.flush = AsyncMock()
    return session


def _lease_metadata_from_execute(mock_execute: MagicMock) -> dict:
    """从 execute 的 Raw SQL 调用中提取 lease metadata dict。

    prepare_interactive_dispatch 的 INSERT 语句 bind 参数含 ``metadata`` 键
    （json 字符串）。遍历所有 execute 调用，找到含 metadata 键的那次并解析。
    """
    for call in mock_execute.call_args_list:
        # execute(text(...), {params dict})
        if len(call.args) < 2:
            continue
        params = call.args[1]
        if isinstance(params, dict) and "metadata" in params:
            return json.loads(params["metadata"])
    return {}


@pytest.mark.asyncio
async def test_prepare_interactive_dispatch_forces_scan_mode_regardless_of_input():
    """D-001：入参 manual_approval=False / ask_user_only=False 时，lease metadata
    仍强制写入 ``manual_approval=True`` + ``ask_user_only=True``（scan 模式统一）。

    入参保留签名兼容但不再生效（placement.py:446-449 注释）。
    """
    session = _capture_session()
    svc = RunPlacementService(session)
    # mock _get_online_runtime：返回可用 runtime，不抛 NoOnlineDaemonError。
    svc._get_online_runtime = AsyncMock(return_value=_runtime_dict())

    await svc.prepare_interactive_dispatch(
        agent_session_id=uuid.uuid4(),
        agent_run_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        prompt="stage dispatch prompt",
        model=None,
        manual_approval=False,  # 显式 False
        ask_user_only=False,  # 显式 False
    )

    metadata = _lease_metadata_from_execute(session.execute)
    assert metadata["manual_approval"] is True, "D-001：入参 False 仍强制 True（scan 模式统一）"
    assert metadata["ask_user_only"] is True, "D-001：入参 False 仍强制 True（scan 模式统一）"


@pytest.mark.asyncio
async def test_prepare_interactive_dispatch_scan_mode_metadata_fields():
    """lease metadata 含 scan 模式必备字段 + 各 stage 入口共享同一强制逻辑
    （FR-001：verify/stage/brainstorm/plan/execute 经 prepare_interactive_dispatch
    派发，metadata 均含 manual_approval=True + ask_user_only=True）。

    本用例以「verify stage」为代表验证（其余 stage 走同一函数，强制逻辑无分支）。
    同时断言 metadata 保留 session_id / run_id / prompt / provider / claim_token
    等 daemon claim 所需字段未丢失。
    """
    session = _capture_session()
    svc = RunPlacementService(session)
    svc._get_online_runtime = AsyncMock(return_value=_runtime_dict())

    agent_session_id = uuid.uuid4()
    agent_run_id = uuid.uuid4()
    user_id = uuid.uuid4()

    await svc.prepare_interactive_dispatch(
        agent_session_id=agent_session_id,
        agent_run_id=agent_run_id,
        user_id=user_id,
        provider="claude",
        prompt="verify stage prompt",
        model="claude-sonnet",
        # 不传 manual_approval/ask_user_only（用默认 False）——仍应强制 True
    )

    metadata = _lease_metadata_from_execute(session.execute)
    # FR-001：scan 模式强制
    assert metadata["manual_approval"] is True
    assert metadata["ask_user_only"] is True
    # daemon claim 所需字段保留（强制 scan 模式不破坏既有契约）
    assert metadata["session_id"] == str(agent_session_id)
    assert metadata["run_id"] == str(agent_run_id)
    assert metadata["prompt"] == "verify stage prompt"
    assert metadata["provider"] == "claude"
    assert metadata["model"] == "claude-sonnet"
    assert "claim_token" in metadata
    assert isinstance(metadata["claim_token"], str)
    assert len(metadata["claim_token"]) > 0


@pytest.mark.asyncio
async def test_scan_mode_not_bypass_permission_mode_in_metadata():
    """task-02 撤回验证：lease metadata 不含 ``permissionMode=bypassPermissions``。

    635c0d4a 曾在 metadata 写 permissionMode=bypassPermissions（试图绕 daemon
    侧权限审批修 5min 超时），但 bypassPermissions 下 SDK 仍调 canUseTool 未生效
    且语义混淆，task-02 撤回。5min 超时真实根因是 ask_user_only=false（task-01 修）。
    本用例钉死：metadata 无 ``permissionMode`` 键或非 ``bypassPermissions``，
    daemon 侧 permissionMode 走 default（session-manager.ts:799）。
    """
    session = _capture_session()
    svc = RunPlacementService(session)
    svc._get_online_runtime = AsyncMock(return_value=_runtime_dict())

    await svc.prepare_interactive_dispatch(
        agent_session_id=uuid.uuid4(),
        agent_run_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        prompt="any stage prompt",
        model=None,
    )

    metadata = _lease_metadata_from_execute(session.execute)
    # scan 模式强制仍在
    assert metadata["manual_approval"] is True
    assert metadata["ask_user_only"] is True
    # task-02 撤回：无 bypassPermissions
    permission_mode = metadata.get("permissionMode")
    assert permission_mode != "bypassPermissions", (
        "task-02 撤回：bypassPermissions 已移除，permissionMode 应为 default 或缺失"
    )
