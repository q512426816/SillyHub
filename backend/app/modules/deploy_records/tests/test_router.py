"""deploy_records router HTTP 层测试。

change 2026-10-14-deploy-release-notes task-02 / FR-02/FR-03/FR-06：
鉴权（403）、列表/详情 200、404 中文文案。
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest_asyncio

from app.modules.auth.model import User
from app.modules.workspace.model import Workspace

VALID_MD = """---
seq: 1
deployed_at: "2026-10-14 08:52:36"
status: success
commit_from: null
commit_to: ad6092e1d
summary: 文件树显式同步
agent: zcode-agent
commits:
  - sha: ad6092e1d
    message: "fix: sync"
    author: qinyi
---
## 🔧 修复
- 刷新触发面收窄
"""


def _make_ws(db_session_factory, tmp_path: Path) -> Workspace:
    """同步造 workspace 行（不经 POST /workspaces 的 scanner 副作用）。"""
    root = tmp_path / "router_ws"
    (root / "docs" / "releases").mkdir(parents=True)
    (root / "docs" / "releases" / "2026-10-14-001-ad6092e1d.md").write_text(
        VALID_MD, encoding="utf-8"
    )
    return Workspace(
        id=uuid.uuid4(),
        name="router-ws",
        slug=f"router-ws-{uuid.uuid4().hex[:6]}",
        root_path=str(root),
        type="other",
    )


def _token_for(user: User) -> str:
    from app.core.config import get_settings
    from app.core.security import create_access_token

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=bool(user.is_platform_admin),
        settings=get_settings(),
    )
    return token


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture()
async def seeded(db_session, tmp_path: Path) -> dict:
    """admin 用户（持 deploy_record:read，platform:admin 自动通过）+ 带 1 条记录的 workspace。"""
    import uuid as _uuid

    from app.core.security import password_hasher

    ws = _make_ws(db_session, tmp_path)
    admin = User(
        id=_uuid.uuid4(),
        email="deploy-admin@example.com",
        password_hash=password_hasher.hash("Admin123!@#"),
        display_name="DeployAdmin",
        status="active",
        is_platform_admin=True,
    )
    db_session.add_all([ws, admin])
    await db_session.commit()
    return {"ws": ws, "admin_token": _token_for(admin)}


async def test_list_requires_permission(client, tmp_path: Path) -> None:
    """未登录 → 401/403（FastAPI 依赖层拒绝），不暴露数据。"""
    resp = await client.get("/api/deploy-records")
    assert resp.status_code in (401, 403)


async def test_list_and_detail_roundtrip(client, seeded) -> None:
    headers = _auth(seeded["admin_token"])

    resp = await client.get("/api/deploy-records", headers=headers)
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) == 1
    item = items[0]
    assert item["status"] == "success"
    assert item["seq"] == 1
    assert item["workspace_name"] == "router-ws"
    assert item["commits_count"] == 1

    # record_id 含 "/"——path 形态整段接收 + 前端约定整段编码
    rid = item["record_id"]
    assert "/" in rid
    resp2 = await client.get(f"/api/deploy-records/{rid}", headers=headers)
    assert resp2.status_code == 200, resp2.text
    detail = resp2.json()
    assert detail["record_id"] == rid
    assert "刷新触发面收窄" in detail["content"]


async def test_detail_404_chinese_message(client, seeded) -> None:
    headers = _auth(seeded["admin_token"])
    resp = await client.get(f"/api/deploy-records/{seeded['ws'].id}/nope-nothing", headers=headers)
    assert resp.status_code == 404
    assert "未找到发布记录" in resp.text
