"""daemon-chat（quick-chat）端点：派发 workspace_id 归一化回归。

ql-20260906-001（审计 #6）：端点用 raw text() 查 user_workspace_roles 解析派发
上下文——SQLite 下 raw SELECT 不经类型回转，workspace_id 列是 CHAR(32) hex 字符串
（PG 是 UUID 对象）。未归一化直传 placement.dispatch_to_daemon 时内部
workspace_id.hex 对 str 抛 AttributeError，被端点 except Exception 吞掉后 run 标
failed、误报「No online daemon runtime found」（真因掩盖；生产 PG 不受影响，
违背本仓 SQLite/PG 双方言安全惯例——placement.py raw SQL 结果归一化先例在
agent 模块已有）。本端点此前零测试覆盖。

author: qinyi
created_at: 2026-09-06 02:20:00
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

from httpx import AsyncClient
from sqlalchemy import select

from app.modules.auth.model import Role, User, UserWorkspaceRole
from app.modules.workspace.model import Workspace


async def _make_membership(db_session, user_id: uuid.UUID) -> Workspace:
    """建工作区 + 角色 + 成员关系（端点 raw SQL 查询的就是这行）。"""
    role = Role(key=f"dc-{uuid.uuid4().hex[:8]}", name="member")
    ws = Workspace(
        id=uuid.uuid4(),
        name="daemon-chat-ws",
        slug=f"dc-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/daemon-chat-test",
        status="active",
        component_key="comp",
    )
    db_session.add(role)
    db_session.add(ws)
    await db_session.flush()
    db_session.add(UserWorkspaceRole(user_id=user_id, workspace_id=ws.id, role_id=role.id))
    await db_session.commit()
    return ws


class TestQuickChatWorkspaceIdNormalization:
    async def test_dispatch_receives_uuid_workspace_id(
        self, db_session, client: AsyncClient, auth_headers
    ) -> None:
        """派发收到的 workspace_id 必须已归一化为 uuid.UUID（SQLite raw 返回 hex str）。"""
        user = (
            await db_session.execute(select(User).where(User.email == "admin@example.com"))
        ).scalar_one()
        ws = await _make_membership(db_session, user.id)

        with patch(
            "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
            new_callable=AsyncMock,
            return_value="lease-test-1",
        ) as dispatch:
            resp = await client.post(
                "/api/daemon-chat",
                headers=auth_headers,
                params={"prompt": "hi"},
            )

        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "pending"
        dispatch.assert_awaited_once()
        received = dispatch.await_args.kwargs.get("workspace_id")
        # 修复前：SQLite 下 received 是 'workspace_id 列的 32 位 hex 字符串'，
        # isinstance 检查失败（真实链路里 placement 内 .hex 直接 AttributeError）。
        assert isinstance(received, uuid.UUID), f"workspace_id 未归一化: {received!r}"
        assert received == ws.id
