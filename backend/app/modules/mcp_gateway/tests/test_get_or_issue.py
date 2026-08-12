"""Tests for :meth:`McpTokenService.get_or_issue`（task-09 / design §5.2 §7.1 / D-001）。

覆盖 5 场景：

1. 空表 ``get_or_issue`` 直接签新——返 row+明文，DB 仅一条且 ``revoked_at`` 为空。
2. 先 ``create`` 一条同维度 token（同 workspace_id + 同 created_by），再
   ``get_or_issue``——旧 revoke 新签，至多一条活 token。
3. 多次 ``get_or_issue`` 同 workspace——不堆积（活 token 恒为 1，历史行保留供审计）。
4. 签出的 token ``scope`` 落库为 ``['dispatch']``（非 ``'workspace'`` 非 ``'read'``），
   属 :data:`MCP_SCOPES` 合法值；``authenticate`` 返非空 :class:`McpTokenPrincipal`。
5. ``get_or_issue`` 内部吊销旧 token 后，旧明文 ``authenticate`` 返 ``None``。

Fixture 复用（蓝图 constraints）：

- ``db_session`` 来自根 conftest（pytest 自动向上发现，非本目录 conftest 定义）。
- ``mcp_tokens`` 表靠本文件 import :class:`McpTokenORM` 自动注册到
  ``BaseModel.metadata``，根 conftest ``db_engine`` 的 ``create_all`` 即建表
  （FK 目标 ``workspaces`` 已由 ``Workspace`` import 注册）。与 ``test_service.py``
  的 NOTE 同思路。
- ``_hermetic_dns`` autouse fixture 来自 ``mcp_gateway/tests/conftest.py``
  （本目录），离线 SSRF getaddrinfo 替身——本测试不触 webhook，但 autouse 仍生效，
  无副作用。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.mcp_gateway.auth import (
    MCP_SCOPE_DISPATCH,
    MCP_SCOPE_READ,
    MCP_SCOPES,
)
from app.modules.mcp_gateway.model import McpTokenORM
from app.modules.mcp_gateway.service import (
    MCP_TOKEN_PREFIX,
    McpTokenPrincipal,
    McpTokenService,
)
from app.modules.workspace.model import Workspace


async def _make_workspace(session: AsyncSession) -> Workspace:
    """建一个 workspace（与 test_service.py 同 helper，根 conftest 已注册 workspaces 表）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


def _svc(session: AsyncSession) -> McpTokenService:
    """与 test_service.py 同构造：复用全局 settings（缓存 TTL 等用默认值）。"""
    return McpTokenService(session, settings=get_settings())


async def _count_active(session: AsyncSession, workspace_id: uuid.UUID) -> int:
    """该 workspace 下 ``revoked_at IS NULL`` 的 token 数（活 token 数）。"""
    stmt = (
        select(func.count())
        .select_from(McpTokenORM)
        .where(McpTokenORM.workspace_id == workspace_id)
        .where(McpTokenORM.revoked_at.is_(None))
    )
    return int((await session.execute(stmt)).scalar_one())


async def _count_all(session: AsyncSession, workspace_id: uuid.UUID) -> int:
    """该 workspace 下全部 token 数（含已吊销，design §7.2 list 含已吊销）。"""
    stmt = (
        select(func.count())
        .select_from(McpTokenORM)
        .where(McpTokenORM.workspace_id == workspace_id)
    )
    return int((await session.execute(stmt)).scalar_one())


# ── 场景 1：空表签新 ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_or_issue_on_empty_table_issues_new(db_session: AsyncSession) -> None:
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)

    row, plaintext = await svc.get_or_issue(workspace_id=ws.id, created_by=None)

    # 明文带 shmcp_ 前缀（与 create 同前缀，便于 GitHub secret scanning 识别）
    assert plaintext.startswith(MCP_TOKEN_PREFIX)
    assert len(plaintext) > len(MCP_TOKEN_PREFIX)
    # 落库形态
    assert row.workspace_id == ws.id
    assert row.name == "init-provisioned"
    assert row.revoked_at is None
    assert row.token_hash != plaintext  # 库存 sha256，不存明文（R-06）
    # DB 仅此一条，且为活 token
    assert await _count_all(db_session, ws.id) == 1
    assert await _count_active(db_session, ws.id) == 1


# ── 场景 2：有旧（同维度）→ 吊销 + 签新 ─────────────────────────────────


@pytest.mark.asyncio
async def test_get_or_issue_revokes_existing_same_dimension_token(
    db_session: AsyncSession,
) -> None:
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)

    # 先 create 同维度 token（同 workspace_id + 同 created_by=None）
    old_row, old_plaintext = await svc.create(
        workspace_id=ws.id, name="manual-old", scope=["read"], created_by=None
    )
    assert await _count_active(db_session, ws.id) == 1

    # get_or_issue 应吊销旧 token 再签新
    new_row, new_plaintext = await svc.get_or_issue(workspace_id=ws.id, created_by=None)

    # 新明文 != 旧明文（确保是真签发新 token，非返旧）
    assert new_plaintext != old_plaintext
    assert new_plaintext.startswith(MCP_TOKEN_PREFIX)
    # 新 row 为活 token
    assert new_row.revoked_at is None
    # 旧 row 已被 revoke（refresh from DB——old_row 是 revoke 前的快照）
    refreshed_old = (
        await db_session.execute(select(McpTokenORM).where(McpTokenORM.id == old_row.id))
    ).scalar_one()
    assert refreshed_old.revoked_at is not None
    # 至多一条活 token（D-001 不堆积语义）
    assert await _count_active(db_session, ws.id) == 1
    # 总行数 2（旧吊销行保留供审计 + 新活行）
    assert await _count_all(db_session, ws.id) == 2


# ── 场景 3：多次调用不堆积 ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_or_issue_repeated_calls_do_not_accumulate(
    db_session: AsyncSession,
) -> None:
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)

    plaintexts: list[str] = []
    for _ in range(4):
        _, plaintext = await svc.get_or_issue(workspace_id=ws.id, created_by=None)
        plaintexts.append(plaintext)

    # 4 次签发的明文两两不同（每次都签新，非复用）
    assert len(set(plaintexts)) == 4
    # 活 token 恒为 1（不堆积——每次调用都先吊销上一条）
    assert await _count_active(db_session, ws.id) == 1
    # 总行数 4（历史吊销行保留供审计，list_for_workspace 含已吊销）
    assert await _count_all(db_session, ws.id) == 4


# ── 场景 4：scope=['dispatch'] 合法性 + authenticate 非 None ─────────────


@pytest.mark.asyncio
async def test_get_or_issue_scope_is_dispatch_and_authenticates(
    db_session: AsyncSession,
) -> None:
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)

    row, plaintext = await svc.get_or_issue(workspace_id=ws.id, created_by=None)

    # scope 精确为 ['dispatch']——execute 派 Wave 子代理语义，必须取 MCP_SCOPES 合法值
    assert row.scope == [MCP_SCOPE_DISPATCH]
    # 合法性：dispatch ∈ MCP_SCOPES
    assert MCP_SCOPE_DISPATCH in MCP_SCOPES
    # 非 'workspace'（防字面垃圾误持久化）
    assert "workspace" not in row.scope
    # 非 'read'（防错配其它 scope）
    assert MCP_SCOPE_READ not in row.scope

    # authenticate 返非空 Principal，且 scope 透传为 ['dispatch']
    principal = await svc.authenticate(plaintext)
    assert isinstance(principal, McpTokenPrincipal)
    assert principal is not None
    assert principal.workspace_id == ws.id
    assert principal.scope == [MCP_SCOPE_DISPATCH]


# ── 场景 5：旧 token 被 get_or_issue 吊销后 authenticate 返 None ─────────


@pytest.mark.asyncio
async def test_get_or_issue_revoked_old_token_does_not_authenticate(
    db_session: AsyncSession,
) -> None:
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)

    # 先 create 同维度 token（同 workspace_id + 同 created_by=None）
    _, old_plaintext = await svc.create(
        workspace_id=ws.id, name="pre-existing", scope=["read"], created_by=None
    )
    # 旧明文此刻可认证（写正缓存或走 DB 均成功）
    assert await svc.authenticate(old_plaintext) is not None

    # get_or_issue 吊销旧 token（内部 revoke 会 commit + 精确清正缓存）再签新
    await svc.get_or_issue(workspace_id=ws.id, created_by=None)

    # 旧明文已吊销 → authenticate 返 None（缓存已清 + DB revoked_at 非空）
    assert await svc.authenticate(old_plaintext) is None
