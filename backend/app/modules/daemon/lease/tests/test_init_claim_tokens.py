"""task-10 / P0 / FR-01 FR-03 / D-002：claim 阶段 token 注入单测。

被测：``app.modules.daemon.lease.context.build_claim_payload`` 的 ``mode=='init'``
分支（task-04，context.py:579-649）。claim 时现算签发 ``shpsync_`` + ``shmcp_`` 明文，
注入 ``payload.platform_config.local_yaml``，daemon 写入用户本地 ``local.yaml``。

**P0 安全契约（D-002）**：明文绝不落 ``lease.metadata_``（``daemon_task_leases.metadata_``
是持久化 JSON 列，被 ``audit/service.py:74`` 读取）。本测试守住该契约的两条口径：

1. **payload 内存**（正问）：``build_claim_payload`` 返回的 ``payload.platform_config.local_yaml``
   必须含两明文 token（前缀 ``shpsync_`` / ``shmcp_``）—— 证明 claim 确实签发并注入。
2. **lease.metadata_ 持久化**（反问，P0）：claim 后从 DB 重读 ``lease.metadata_``，必须
   **不含** ``local_yaml`` / ``platform_token`` / ``mcp_token`` 明文（``build_claim_payload``
   不 commit，DB 行维持 dispatch 落盘的原始 metadata）。

actor_user_id / workspace_id 缺失或非法 → 防御降级（不签 token、不注入 local_yaml，
不抛 500，context.py:620 的 ``and`` 守护）。

mock 策略：``context.py`` 内 lazy import 两 service 类后实例化调 ``.get_or_issue(...)``，
故 ``patch.object(ServiceCls, "get_or_issue", new=AsyncMock(...))`` 在类上替换方法即可
拦截（实例属性查找命中类上的 mock，AsyncMock 非函数描述符不绑 self，``call_args.kwargs``
直接是 ``workspace_id=...`` / ``created_by=...``）。复用根 ``backend/conftest.py`` 的
``db_session`` / ``db_engine`` fixture（pytest conftest 父目录发现，本目录不另起 conftest，
遵守 task-10 constraints）；helper 复用 ``test_lease_service`` 的 ``_create_user`` /
``_create_runtime`` + 本地 init lease 构造（test_lease_service 未暴露 init lease helper）。

注：B1 dispatch（task-05 ``start_init_dispatch``）**不签 token**，签发在 claim（task-04）；
故本测试挂 ``daemon/lease/tests/``（claim 路径），不挂 ``agent/tests/``。B1 防回退断言
（dispatch 后 ``lease.metadata_.platform_config`` 不含 local_yaml/token）在
``agent/tests/test_start_init_dispatch.py`` 扩展。
"""

from __future__ import annotations

import contextlib
import json
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.modules.daemon.lease.context import build_claim_payload
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.tests.test_lease_service import (
    _create_runtime,
    _create_user,
)
from app.modules.mcp_gateway.service import McpTokenService
from app.modules.platform_sync.token_service import PlatformSyncTokenService
from app.modules.workspace.model import Workspace

# ── 明文 token 样本（带真实前缀，证明注入链路 + 守住前缀契约）──────────────
# shpsync_ = platform_sync 进度同步（PLATFORM_SYNC_TOKEN_PREFIX, token_service.py:40）
# shmcp_   = mcp_gateway 派发（MCP_TOKEN_PREFIX, service.py:66）
_PLATFORM_PLAIN = "shpsync_testAAAA_" + "p" * 30
_MCP_PLAIN = "shmcp_testBBBB_" + "m" * 30


# ---------------------------------------------------------------------------
# Helpers — init lease 构造（kind='batch' + mode='init' + agent_run_id=NULL）
# ---------------------------------------------------------------------------


async def _create_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"init-claim-ws-{uuid.uuid4().hex[:6]}",
        slug=f"init-claim-ws-{uuid.uuid4().hex[:6]}",
        root_path="/tmp/init-claim-test-workspace",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_init_lease(
    session: AsyncSession,
    runtime_id: uuid.UUID,
    *,
    workspace_id: uuid.UUID | None,
    actor_user_id: uuid.UUID | None,
    platform_config: dict | None = None,
    root_path: str = "/Users/test/my-project",
) -> DaemonTaskLease:
    """构造 init lease 行（kind='batch', agent_run_id=NULL, metadata.mode='init'）。

    init lease 特征（context.py:573-577 注释）：不启 agent（无 agent_run_id），daemon 端
    ``_runInitLease`` 读 payload 写 ``.sillyspec-platform.json`` + pull spec。``workspace_id``
    / ``actor_user_id`` 透传为 metadata 字段（claim 时 context.py:581/609 解析回 UUID）。
    """
    meta: dict[str, Any] = {
        "mode": "init",
        "runtime_id": str(runtime_id),
        "root_path": root_path,
        "latest_spec_version": 0,
        # platform_config 默认镜像 task-05 start_init_dispatch 落盘形态：仅 server_origin +
        # strategy（B1 dispatch 不签 token，design §5.3.1）。
        "platform_config": platform_config
        if platform_config is not None
        else {"server_origin": "http://localhost:8000", "strategy": "platform-managed"},
    }
    if workspace_id is not None:
        meta["workspace_id"] = str(workspace_id)
    if actor_user_id is not None:
        meta["actor_user_id"] = str(actor_user_id)

    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,  # init lease 无 AgentRun（D-005@v1）
        status="claimed",
        kind="batch",
        claimed_at=now,
        lease_expires_at=None,
        metadata_=meta,
        created_at=now,
        updated_at=now,
    )
    session.add(lease)
    await session.commit()
    await session.refresh(lease)
    return lease


@contextlib.contextmanager
def _patch_token_services(
    plat_plain: str = _PLATFORM_PLAIN,
    mcp_plain: str = _MCP_PLAIN,
):
    """替换两 service 类的 ``get_or_issue`` 为受控 AsyncMock，返回 ``(row, 明文)``。

    context.py lazy import + 实例化调 ``.get_or_issue(...)``；类上替换方法即可拦截。
    yield ``(plat_mock, mcp_mock)`` 供 call_count / call_args 断言。
    """
    plat_mock = AsyncMock(return_value=(MagicMock(name="platform_sync_row"), plat_plain))
    mcp_mock = AsyncMock(return_value=(MagicMock(name="mcp_token_row"), mcp_plain))
    with (
        patch.object(PlatformSyncTokenService, "get_or_issue", new=plat_mock),
        patch.object(McpTokenService, "get_or_issue", new=mcp_mock),
    ):
        yield plat_mock, mcp_mock


async def _setup(session: AsyncSession) -> tuple[uuid.UUID, uuid.UUID, Workspace, uuid.UUID]:
    """造 user + runtime + workspace + actor，返回四元组（actor 独立于 daemon 登记用户，
    验证 created_by 取 lease_meta.actor_user_id 而非 runtime.user_id）。"""
    user_id = await _create_user(session)
    rt = await _create_runtime(session, user_id)
    ws = await _create_workspace(session)
    actor = uuid.uuid4()
    return user_id, rt.id, ws, actor


# ---------------------------------------------------------------------------
# 用例组 A：claim 注入 payload（正问 — 明文确实注入 payload.platform_config.local_yaml）
# ---------------------------------------------------------------------------


class TestInitClaimInjectsTokensIntoPayload:
    """FR-01 / FR-03：claim 时两 service.get_or_issue 各签一次，明文注入
    ``payload.platform_config.local_yaml``。"""

    @pytest.mark.asyncio
    async def test_payload_local_yaml_contains_both_plaintext_tokens(
        self, db_session: AsyncSession
    ) -> None:
        """payload.platform_config.local_yaml 含 platform_token + mcp_token 明文。"""
        _u, rt_id, ws, actor = await _setup(db_session)
        lease = await _create_init_lease(db_session, rt_id, workspace_id=ws.id, actor_user_id=actor)

        with _patch_token_services():
            payload = await build_claim_payload(db_session, lease)

        # platform_config 双写（snake + camel，context.py:601-602）
        assert isinstance(payload.get("platform_config"), dict)
        assert isinstance(payload.get("platformConfig"), dict)
        local_yaml = payload["platform_config"]["local_yaml"]
        assert local_yaml["platform_token"] == _PLATFORM_PLAIN
        assert local_yaml["mcp_token"] == _MCP_PLAIN
        # 前缀契约（design §5.2 D-001 + mcp_gateway MCP_TOKEN_PREFIX）
        assert _PLATFORM_PLAIN.startswith("shpsync_")
        assert _MCP_PLAIN.startswith("shmcp_")
        # local_yaml 仅两 token，url 由 daemon _serverOrigin() 拼（D-002 / design §5.4）
        assert set(local_yaml.keys()) == {"platform_token", "mcp_token"}

    @pytest.mark.asyncio
    async def test_actor_user_id_passed_as_created_by_and_workspace_matches(
        self, db_session: AsyncSession
    ) -> None:
        """lease_meta.actor_user_id 解析为两 get_or_issue 的 created_by；
        workspace_id 同源（D-005 created_by 归属 + workspace 隔离键）。"""
        _u, rt_id, ws, actor = await _setup(db_session)
        lease = await _create_init_lease(db_session, rt_id, workspace_id=ws.id, actor_user_id=actor)

        with _patch_token_services() as (plat_mock, mcp_mock):
            await build_claim_payload(db_session, lease)

        plat_kwargs = plat_mock.call_args.kwargs
        mcp_kwargs = mcp_mock.call_args.kwargs
        assert plat_kwargs["created_by"] == actor
        assert mcp_kwargs["created_by"] == actor
        assert plat_kwargs["workspace_id"] == ws.id
        assert mcp_kwargs["workspace_id"] == ws.id

    @pytest.mark.asyncio
    async def test_each_token_service_called_exactly_once(self, db_session: AsyncSession) -> None:
        """claim 单次触发：两 get_or_issue 各调一次（幂等性语义，token_service.get_or_issue
        每次签新，design §5.2）。"""
        _u, rt_id, ws, actor = await _setup(db_session)
        lease = await _create_init_lease(db_session, rt_id, workspace_id=ws.id, actor_user_id=actor)

        with _patch_token_services() as (plat_mock, mcp_mock):
            await build_claim_payload(db_session, lease)

        assert plat_mock.call_count == 1
        assert mcp_mock.call_count == 1


# ---------------------------------------------------------------------------
# 用例组 B：P0 安全契约 — 明文不落 lease.metadata_（DB 持久化口径）
# ---------------------------------------------------------------------------


class TestInitClaimPlaintextNotPersisted:
    """D-002 / P0：claim 后 lease.metadata_（DB 持久化行）不含明文 token /
    local_yaml。``build_claim_payload`` 只读 lease + 构造 payload dict，**不 commit**，
    故 DB 行维持 dispatch（task-05）落盘的原始 metadata（仅 server_origin + strategy）。

    口径说明（task-10 acceptance "lease.metadata_ 落库后查无 platform_token mcp_token
    明文"）：通过 fresh session 重读 DB（绕开 identity map + 内存别名），验证持久化 JSON
    列干净——这是 ``audit/service.py:74`` 实际读取的源，P0 真正要守的持久化面。
    """

    @pytest.mark.asyncio
    async def test_db_metadata_has_no_local_yaml_no_plaintext_after_claim(
        self, db_session: AsyncSession, db_engine: Any
    ) -> None:
        """fresh session 重读 DB：metadata_ 不含 local_yaml / 两明文 token / 两键名。"""
        _u, rt_id, ws, actor = await _setup(db_session)
        lease = await _create_init_lease(db_session, rt_id, workspace_id=ws.id, actor_user_id=actor)

        with _patch_token_services():
            payload = await build_claim_payload(db_session, lease)

        # sanity：payload 确实拿到了明文（否则下面的"不落库"断言无信息量）
        assert payload["platform_config"]["local_yaml"]["platform_token"] == _PLATFORM_PLAIN

        # fresh session 绕开 identity map，读 DB 持久化真值
        factory = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)
        async with factory() as fresh:
            db_lease = await fresh.get(DaemonTaskLease, lease.id)
            assert db_lease is not None
            db_meta = db_lease.metadata_ or {}

        db_meta_json = json.dumps(db_meta, sort_keys=True)
        # P0：明文不落库（local_yaml 键 / 两 token 明文 / 两 token 键名均不得出现）
        assert "local_yaml" not in db_meta_json, (
            "P0 violation: local_yaml leaked into persisted lease.metadata_"
        )
        assert _PLATFORM_PLAIN not in db_meta_json, (
            "P0 violation: platform_token plaintext persisted in lease.metadata_"
        )
        assert _MCP_PLAIN not in db_meta_json, (
            "P0 violation: mcp_token plaintext persisted in lease.metadata_"
        )
        assert "platform_token" not in db_meta_json, (
            "P0 violation: platform_token key persisted in lease.metadata_"
        )
        assert "mcp_token" not in db_meta_json, (
            "P0 violation: mcp_token key persisted in lease.metadata_"
        )
        # platform_config 维持 B1 dispatch 落盘形态：仅 server_origin + strategy
        assert set(db_meta.get("platform_config", {}).keys()) == {
            "server_origin",
            "strategy",
        }

    @pytest.mark.asyncio
    async def test_metadata_top_level_keys_have_no_token_keys(
        self, db_session: AsyncSession
    ) -> None:
        """lease.metadata_ 顶层键集合不含 local_yaml / platform_token / mcp_token
        （task-10 constraints 字面 "不含...键"——顶层键口径）。"""
        _u, rt_id, ws, actor = await _setup(db_session)
        lease = await _create_init_lease(db_session, rt_id, workspace_id=ws.id, actor_user_id=actor)

        with _patch_token_services():
            await build_claim_payload(db_session, lease)

        meta = lease.metadata_ or {}
        assert "local_yaml" not in meta
        assert "platform_token" not in meta
        assert "mcp_token" not in meta


# ---------------------------------------------------------------------------
# 用例组 C：防御降级 — actor_user_id / workspace_id 缺失不签 token（context.py:620）
# ---------------------------------------------------------------------------


class TestInitClaimDefensiveDegrade:
    """context.py:620 ``if _init_ws is not None and _init_actor is not None``——
    任一缺失 / 非法 UUID → 不调 get_or_issue、不注入 local_yaml、不抛 500（防御降级）。"""

    @pytest.mark.asyncio
    async def test_no_token_issued_when_actor_user_id_missing(
        self, db_session: AsyncSession
    ) -> None:
        """actor_user_id 缺失 → 两 service 不被调，payload.platform_config 无 local_yaml。"""
        _u, rt_id, ws, _actor = await _setup(db_session)
        lease = await _create_init_lease(db_session, rt_id, workspace_id=ws.id, actor_user_id=None)

        with _patch_token_services() as (plat_mock, mcp_mock):
            payload = await build_claim_payload(db_session, lease)

        assert plat_mock.call_count == 0
        assert mcp_mock.call_count == 0
        pc = payload.get("platform_config", {})
        assert "local_yaml" not in pc
        # platform_config 透传维持 server_origin + strategy（未被 local_yaml 污染）
        assert set(pc.keys()) == {"server_origin", "strategy"}

    @pytest.mark.asyncio
    async def test_no_token_issued_when_workspace_id_missing(
        self, db_session: AsyncSession
    ) -> None:
        """workspace_id 缺失 → 两 service 不被调（workspace 是 token 绑定键 + 隔离键）。"""
        _u, rt_id, _ws, actor = await _setup(db_session)
        lease = await _create_init_lease(db_session, rt_id, workspace_id=None, actor_user_id=actor)

        with _patch_token_services() as (plat_mock, mcp_mock):
            payload = await build_claim_payload(db_session, lease)

        assert plat_mock.call_count == 0
        assert mcp_mock.call_count == 0
        assert "local_yaml" not in payload.get("platform_config", {})


# ---------------------------------------------------------------------------
# 用例组 D：内存别名断开 — task-04 shallow-copy 缺口已修复
# ---------------------------------------------------------------------------


class TestInitClaimInMemoryNoPlaintext:
    """内存口径守 P0：``context.py:374`` ``lease_meta = dict(lease.metadata_ or {})`` 是
    **浅拷贝**——嵌套 ``platform_config`` dict 与 ``lease.metadata_["platform_config"]``
    原本共享同一对象。task-04 早期实现 ``_init_pc_dict["local_yaml"] = {...}``（context.py:641）
    原地 mutate 该共享对象 → claim 后**内存** ``lease.metadata_["platform_config"]["local_yaml"]``
    含明文（DB 持久化行因不 commit + JSON 列无 MutableDict 跟踪本就干净，见用例组 B）。

    **修复**（task-10 实证上浮 → 调度者修 context.py：构造 payload 时对 platform_config
    新建 dict ``{**_init_pc_src}`` 断开与 ``lease.metadata_`` 的引用共享）：claim 后内存
    ``lease.metadata_`` 也不含明文，design §9 "明文绝不落 lease.metadata_" 内存口径守住。

    本测试原为 xfail（strict=True）跟踪缺口，修复后转硬断言恒绿。
    """

    @pytest.mark.asyncio
    async def test_inmemory_metadata_has_no_plaintext(self, db_session: AsyncSession) -> None:
        _u, rt_id, ws, actor = await _setup(db_session)
        lease = await _create_init_lease(db_session, rt_id, workspace_id=ws.id, actor_user_id=actor)

        with _patch_token_services():
            await build_claim_payload(db_session, lease)

        meta_json = json.dumps(lease.metadata_ or {}, sort_keys=True)
        assert _PLATFORM_PLAIN not in meta_json
        assert _MCP_PLAIN not in meta_json
        assert "local_yaml" not in meta_json
