"""task-09（2026-06-23-spec-transport-tar-sync）C 组：build_claim_payload
interactive 分支 transport 透传单测。

守护 task-03 的 tar/shared 分流 + D-007@v1（spec 同步在 interactive 路径）。覆盖：
  - C1: tar 模式透传 workspace_id + transport，不透传 spec_root（task-03 边界 E6）
  - C2: shared 模式现状不变（D-004 守护）—— 透传 specRoot、不透传 wsId
  - C3: tar 模式 ws_id 缺失（quick-chat）—— 不含 wsId，仍不含 specRoot（边界 E4）
  - C4: transport/transportMode 同值同源（C1/C2 内联，边界 E5）
  - C5: tar 模式 workspace_id malformed —— UUID 解析失败 ws_id=None，降级（边界 E3）

设计来源：design.md §7.2（透传伪代码）+ §7.4 契约表（build_claim_payload tar 模式事件）。
复用 test_lease_service.py 的 _create_user / _create_runtime / _create_interactive_lease helper。
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.lease.context import build_claim_payload
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.tests.test_lease_service import (
    _create_interactive_lease,
    _create_runtime,
    _create_user,
)
from app.modules.workspace.model import Workspace


def _patch_transport(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    """Patch ``app.modules.daemon.lease.context.get_settings`` 返回
    spec_transport=value 的 mock settings。

    build_claim_payload 在 context.py:90 调 ``get_settings().spec_transport``；
    monkeypatch 替换该模块内 import 的 get_settings 引用，返回 SimpleNamespace
    仅含 spec_transport 字段（duck-type，对齐 build_claim_payload 只读该字段的契约）。
    conftest 的 _reset_settings_cache autouse fixture 会在用例间 cache_clear，
    但本 patch 直接替换模块符号，不依赖真 Settings cache，互不影响。
    """
    from app.modules.daemon.lease import context as ctx_module

    fake_settings = SimpleNamespace(spec_transport=value)
    monkeypatch.setattr(
        ctx_module,
        "get_settings",
        lambda: fake_settings,
    )


class TestBuildClaimPayloadTransport:
    """task-03（2026-06-23-spec-transport-tar-sync）：interactive claim payload
    transport 分流（tar/shared）+ workspace_id 透传单测。

    与 test_lease_service.py 的 TestBuildClaimPayloadInteractiveSpecRoot 解耦：
    后者只测 shared 模式 specRoot 透传（AC-01~04），本类聚焦 transport 分流 + wsId 透传。
    """

    @pytest.mark.asyncio
    async def test_c1_tar_mode_passes_workspace_id_and_transport(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """C1: tar 模式透传 workspace_id + transport，不透传 spec_root（边界 E6）。

        即便 lease_meta.spec_root 有值（placement.py:485 写入），tar 模式也不透传——
        backend 容器路径对 daemon 异机无意义，daemon 必须走 pull 拉本地缓存。
        """
        _patch_transport(monkeypatch, "tar")
        ws_id = uuid.uuid4()

        user_id = await _create_user(db_session)
        rt: DaemonRuntime = await _create_runtime(db_session, user_id)
        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "hello",
                "provider": "claude_code",
                "claim_token": "tok",
                # task-03 tar 模式：metadata 同时带 spec_root（placement 写入）+ workspace_id
                "spec_root": "/data/spec-workspaces/should-be-ignored",
                "workspace_id": str(ws_id),
            },
        )

        payload = await build_claim_payload(db_session, lease)

        # tar 模式透传
        assert payload["transport"] == "tar"
        assert payload["transportMode"] == "tar"
        # C4（内联）：transport / transportMode 同值同源
        assert payload["transport"] == payload["transportMode"]
        # wsId 双写（camelCase + snake_case）
        assert payload["workspaceId"] == str(ws_id)
        assert payload["workspace_id"] == str(ws_id)
        # 关键守护（边界 E6）：不透传 spec_root（即便 metadata 有值）
        assert "specRoot" not in payload
        assert "spec_root" not in payload
        assert "runtimeRoot" not in payload
        assert "runtime_root" not in payload

    @pytest.mark.asyncio
    async def test_c2_shared_mode_passes_spec_root_not_workspace_id(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """C2: shared 模式现状不变（D-004 守护）—— 透传 specRoot、不透传 wsId。

        shared 模式 bind mount 共享，daemon 不 pull 不 sync；payload 维持既有
        specRoot/spec_root 双写 + transport='shared'。
        """
        _patch_transport(monkeypatch, "shared")
        ws_id = uuid.uuid4()

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "hello",
                "provider": "claude_code",
                "claim_token": "tok",
                "spec_root": "/data/spec-workspaces/shared-123",
                "workspace_id": str(ws_id),
            },
        )

        payload = await build_claim_payload(db_session, lease)

        # shared 模式透传 specRoot 双写（既有行为）
        assert payload["specRoot"] == "/data/spec-workspaces/shared-123"
        assert payload["spec_root"] == "/data/spec-workspaces/shared-123"
        assert payload["transport"] == "shared"
        assert payload["transportMode"] == "shared"
        # C4（内联）：同值同源
        assert payload["transport"] == payload["transportMode"]
        # D-004 守护：shared 模式不透传 wsId（不 pull，wsId 无意义）
        assert "workspaceId" not in payload
        # 注意：shared 分支 payload 顶层 workspace_id 字段来自 line 53 默认 None
        # （interactive 分支未覆盖写），需排除这一既有默认值，只断言不透传 tar 专属 wsId
        assert payload.get("workspace_id") is None

    @pytest.mark.asyncio
    async def test_c3_tar_mode_missing_workspace_id_quick_chat(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """C3: tar 模式 ws_id 缺失（quick-chat 场景）—— 不含 wsId，仍不含 specRoot。

        quick-chat 经普通 prepare_interactive_dispatch，不写 workspace_id（边界 E4）。
        tar 语义不因 ws_id 缺失回退 shared——仍标 transport='tar'，但不透传 wsId，
        daemon 侧 _startInteractiveSession 走 `transport==='tar' && !workspaceId` warn 分支。
        """
        _patch_transport(monkeypatch, "tar")

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "hello",
                "provider": "claude_code",
                "claim_token": "tok",
                # quick-chat：无 workspace_id，也无 spec_root
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["transport"] == "tar"
        assert payload["transportMode"] == "tar"
        # 不透传 wsId（quick-chat 无 spec 同步语义）
        assert "workspaceId" not in payload
        # 仍不含 specRoot（tar 语义不回退 shared，边界 E4）
        assert "specRoot" not in payload
        assert "spec_root" not in payload

    @pytest.mark.asyncio
    async def test_c4_transport_and_transport_mode_same_source(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """C4: transport / transportMode 同值同源（边界 E5）—— daemon 侧字段名归一化
        两端都覆盖（camelCase transportMode + snake_case transport）。

        独立用例：明确验证双写来自同一 settings.spec_transport 源，任一缺失或不同值
        都会在此 fail。
        """
        _patch_transport(monkeypatch, "tar")
        ws_id = uuid.uuid4()

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "hi",
                "claim_token": "tok",
                "workspace_id": str(ws_id),
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert "transport" in payload
        assert "transportMode" in payload
        assert payload["transport"] == payload["transportMode"]
        # 显式断言值（不只是相等，还要正确）
        assert payload["transport"] == "tar"

    @pytest.mark.asyncio
    async def test_c5_tar_mode_malformed_workspace_id_degrades(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """C5: tar 模式 workspace_id malformed（非 UUID）—— UUID 解析失败 ws_id=None，
        不透传 workspaceId（边界 E3 降级），仍不含 specRoot。

        ws_id 解析在 context.py:104-108 用 try/except 兜底，malformed → ws_id=None，
        tar 分支 ws_id is None → 不 set workspaceId/workspace_id（line 114 守卫）。
        """
        _patch_transport(monkeypatch, "tar")

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "hi",
                "claim_token": "tok",
                "workspace_id": "not-a-uuid",  # malformed
                "spec_root": "/data/ignored",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["transport"] == "tar"
        # malformed → ws_id=None → 不透传 workspaceId（降级，边界 E3）
        assert "workspaceId" not in payload
        # 仍不含 specRoot（tar 语义，边界 E6）
        assert "specRoot" not in payload
        assert "spec_root" not in payload

    @pytest.mark.asyncio
    async def test_c6_workspace_path_source_daemon_client_overrides_global(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """C6（方案 A）：workspace.path_source='daemon-client' 锁死 tar，覆盖全局 settings.spec_transport。

        即便 _patch_transport('shared')，build_claim_payload 查到真实 Workspace 行
        path_source='daemon-client' → transport_for_path_source → 'tar'。
        守护 per-workspace 决策优先于全局兜底（C1-C5 无 Workspace 行全走兜底，本用例补真实行）。
        """
        # 全局 shared，但 workspace.path_source='daemon-client' 应覆盖为 tar
        _patch_transport(monkeypatch, "shared")
        user_id = await _create_user(db_session)
        rt: DaemonRuntime = await _create_runtime(db_session, user_id)
        ws = Workspace(
            id=uuid.uuid4(),
            name="client-ws",
            slug=f"client-ws-{uuid.uuid4().hex[:8]}",
            root_path="/tmp/client-project",
            status="active",
            path_source="daemon-client",
            daemon_runtime_id=rt.id,
        )
        db_session.add(ws)
        await db_session.commit()

        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "hi",
                "claim_token": "tok",
                "workspace_id": str(ws.id),
                "spec_root": "/data/spec-workspaces/c6",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        # path_source='daemon-client' → tar（覆盖全局 shared）
        assert payload["transport"] == "tar"
        assert payload["transportMode"] == "tar"
        # tar 分支透传 workspaceId（与 C1 同款）
        assert payload["workspaceId"] == str(ws.id)
        assert payload["workspace_id"] == str(ws.id)
        # tar 分支不透传 specRoot（边界 E6）
        assert "specRoot" not in payload

    @pytest.mark.asyncio
    async def test_c7_workspace_path_source_server_local_overrides_global(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """C7（方案 A）：workspace.path_source='server-local' 锁死 shared，覆盖全局 tar。

        _patch_transport('tar')，但 workspace.path_source='server-local' → transport='shared'。
        守护 server-local 锁死 shared（即便全局 tar）+ shared 分支透传 specRoot（C2 同款）。
        """
        _patch_transport(monkeypatch, "tar")
        user_id = await _create_user(db_session)
        rt: DaemonRuntime = await _create_runtime(db_session, user_id)
        ws = Workspace(
            id=uuid.uuid4(),
            name="server-ws",
            slug=f"server-ws-{uuid.uuid4().hex[:8]}",
            root_path="/tmp/server-project",
            status="active",
            path_source="server-local",
        )
        db_session.add(ws)
        await db_session.commit()

        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "hi",
                "claim_token": "tok",
                "workspace_id": str(ws.id),
                "spec_root": "/data/spec-workspaces/c7",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        # path_source='server-local' → shared（覆盖全局 tar）
        assert payload["transport"] == "shared"
        assert payload["transportMode"] == "shared"
        # shared 分支透传 specRoot（与 C2 同款）
        assert payload["specRoot"] == "/data/spec-workspaces/c7"
        # shared 分支不透传 workspaceId（D-004 守护）
        assert "workspaceId" not in payload
