"""2026-08-18-workspace-role-type task-08：type 受控词表端到端语义测试。

覆盖 design §5.2/§5.3 的破坏面与语义（FR-01/FR-02/FR-03/FR-08）：
- Create 缺 type 422 / 非法值 422 / 合法 8 值全过（D-002@v1）；
- Update omit 不改 / null 清空（type/role/description 三字段一致，D-005@v1）；
- ``?unclassified=true`` 只出空 type 行，与 ``?type=`` 同传 422（D-005@v1）；
- WorkspaceBrief 含 role/description（FR-08，link_service.list_by_project）；
- parser 归一冒烟（frontend→frontend-code、未知原样，D-003@v1）——在
  test_parser.py 已有细测，此处只做词表贯通冒烟。

helper 仿 test_workspace_admin_management.py（直接插行避免文件系统扫描依赖）。
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User
from app.modules.ppm.project.model import PpmProjectMaintenance
from app.modules.workspace.constants import WORKSPACE_TYPE_VALUES
from app.modules.workspace.link_service import list_by_project
from app.modules.workspace.model import PpmProjectWorkspace, Workspace
from app.modules.workspace.parser import WorkspaceParser

# ── helpers（仿 test_workspace_admin_management.py）──────────────────────────


async def _create_user(session: AsyncSession, *, is_platform_admin: bool = False) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"role-type-{uid}@example.com",
        password_hash="irrelevant",
        display_name=f"User-{str(uid)[:4]}",
        status="active",
        is_platform_admin=is_platform_admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _token_for(user: User) -> str:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=settings,
    )
    return token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_workspace_row(
    session: AsyncSession,
    *,
    created_by: uuid.UUID,
    name: str = "ws",
    ws_type: str | None = None,
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        status="active",
        type=ws_type,
        created_by=created_by,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


# ── Create：必填 + 枚举校验（D-002@v1）──────────────────────────────────────


@pytest.mark.asyncio
async def test_create_missing_type_returns_422(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    admin = await _create_user(db_session, is_platform_admin=True)
    resp = await client.post(
        "/api/workspaces",
        json={"name": "No Type", "root_path": str(tmp_path / "ws")},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_create_invalid_type_returns_422(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    admin = await _create_user(db_session, is_platform_admin=True)
    # daemon-client / web 均为已废弃旧值，词表外一律 422。
    for bad in ("daemon-client", "web", "service", "not-a-type"):
        resp = await client.post(
            "/api/workspaces",
            json={
                "name": f"Bad {bad}",
                "root_path": str(tmp_path / "ws"),
                "type": bad,
            },
            headers=_headers(_token_for(admin)),
        )
        assert resp.status_code == 422, f"type={bad!r} 应被 Literal 校验拒绝: {resp.text}"


@pytest.mark.asyncio
async def test_create_all_eight_values_accepted(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    admin = await _create_user(db_session, is_platform_admin=True)
    for value in WORKSPACE_TYPE_VALUES:
        resp = await client.post(
            "/api/workspaces",
            json={
                "name": f"WS {value}",
                "root_path": str(tmp_path / f"ws-{value}"),
                "type": value,
            },
            headers=_headers(_token_for(admin)),
        )
        assert resp.status_code == 201, f"type={value!r} 应为合法值: {resp.text}"
        assert resp.json()["type"] == value


# ── Update：omit 不改 / null 清空（type/role/description 三字段一致）─────────


@pytest.mark.asyncio
async def test_update_omit_keeps_null_clears(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """D-005@v1：三字段语义一致——omit=不改，显式 null=清空（exclude_unset）。"""
    admin = await _create_user(db_session, is_platform_admin=True)
    created = await client.post(
        "/api/workspaces",
        json={
            "name": "Patch Semantics",
            "root_path": str(tmp_path / "ws"),
            "type": "backend-code",
            "role": "api",
            "description": "订单域后端",
        },
        headers=_headers(_token_for(admin)),
    )
    assert created.status_code == 201, created.text
    ws_id = created.json()["id"]

    # omit：只 PATCH name，type/role/description 不动。
    resp = await client.patch(
        f"/api/workspaces/{ws_id}",
        json={"name": "Patch Semantics 2"},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Patch Semantics 2"
    assert body["type"] == "backend-code"
    assert body["role"] == "api"
    assert body["description"] == "订单域后端"

    # null：三字段一起显式清空。
    resp = await client.patch(
        f"/api/workspaces/{ws_id}",
        json={"type": None, "role": None, "description": None},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["type"] is None
    assert body["role"] is None
    assert body["description"] is None

    # 清空后重新赋值（含 type 换值）仍可写。
    resp = await client.patch(
        f"/api/workspaces/{ws_id}",
        json={"type": "fullstack", "role": "all-in-one", "description": "全栈"},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["type"] == "fullstack"
    assert body["role"] == "all-in-one"
    assert body["description"] == "全栈"


@pytest.mark.asyncio
async def test_update_invalid_type_returns_422(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    admin = await _create_user(db_session, is_platform_admin=True)
    created = await client.post(
        "/api/workspaces",
        json={"name": "Bad Patch", "root_path": str(tmp_path / "ws"), "type": "other"},
        headers=_headers(_token_for(admin)),
    )
    assert created.status_code == 201, created.text
    resp = await client.patch(
        f"/api/workspaces/{created.json()['id']}",
        json={"type": "daemon-client"},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 422, resp.text


# ── 列表：unclassified 谓词 + 与 type 互斥（D-005@v1）───────────────────────


@pytest.mark.asyncio
async def test_list_unclassified_filters_null_type_rows(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _create_user(db_session, is_platform_admin=True)
    ws_null = await _create_workspace_row(db_session, created_by=admin.id, name="ws-null")
    await _create_workspace_row(
        db_session, created_by=admin.id, name="ws-typed", ws_type="frontend-code"
    )

    resp = await client.get(
        "/api/workspaces?unclassified=true", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == str(ws_null.id)
    assert body["items"][0]["type"] is None

    # 未传 unclassified：两行都在（默认不过滤 NULL）。
    resp = await client.get("/api/workspaces", headers=_headers(_token_for(admin)))
    assert resp.json()["total"] == 2


@pytest.mark.asyncio
async def test_list_unclassified_with_type_conflict_422(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _create_user(db_session, is_platform_admin=True)
    resp = await client.get(
        "/api/workspaces?unclassified=true&type=other", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_list_type_illegal_value_422(client: AsyncClient, db_session: AsyncSession) -> None:
    admin = await _create_user(db_session, is_platform_admin=True)
    resp = await client.get(
        "/api/workspaces?type=daemon-client", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 422, resp.text


# ── Brief：含 role/description（FR-08）───────────────────────────────────────


async def test_brief_contains_role_and_description(db_session: AsyncSession) -> None:
    """link_service.list_by_project：Brief 带 role/description，NULL 兜底不炸。"""
    user = await _create_user(db_session)
    ws_filled = await _create_workspace_row(
        db_session,
        created_by=user.id,
        name="ws-filled",
        ws_type="frontend-code",
    )
    ws_filled.role = "订单前端"
    ws_filled.description = "订单域界面"
    ws_empty = await _create_workspace_row(
        db_session, created_by=user.id, name="ws-empty", ws_type=None
    )
    db_session.add_all([ws_filled, ws_empty])
    await db_session.flush()

    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_name="项目甲",
        project_code="P-RT-001",
        project_status="进行中",
    )
    db_session.add(project)
    await db_session.flush()
    db_session.add_all(
        [
            PpmProjectWorkspace(ppm_project_id=project.id, workspace_id=ws_filled.id),
            PpmProjectWorkspace(ppm_project_id=project.id, workspace_id=ws_empty.id),
        ]
    )
    await db_session.commit()

    briefs = await list_by_project(db_session, ppm_project_id=project.id)
    by_id = {b.workspace_id: b for b in briefs}
    assert len(briefs) == 2

    filled = by_id[ws_filled.id]
    assert filled.role == "订单前端"
    assert filled.description == "订单域界面"
    assert filled.type == "frontend-code"

    # NULL 兜底：role/description/type 均为 None（存量行没填不炸）。
    empty = by_id[ws_empty.id]
    assert empty.role is None
    assert empty.description is None
    assert empty.type is None


# ── parser 归一冒烟（D-003@v1；细测见 test_parser.py）────────────────────────


def test_parser_normalize_smoke(tmp_path: Path) -> None:
    """yaml 组件 type 经 YAML_TYPE_NORMALIZE_MAP：frontend→frontend-code，
    映射不上的非空值保留原值，None 保持 None。"""
    projects = tmp_path / "projects"
    projects.mkdir(parents=True)
    (projects / "a.yaml").write_text("id: a\nname: A\ntype: frontend\n", encoding="utf-8")
    (projects / "b.yaml").write_text("id: b\nname: B\ntype: legacy-mystery\n", encoding="utf-8")
    (projects / "c.yaml").write_text("id: c\nname: C\n", encoding="utf-8")

    result = WorkspaceParser().parse(tmp_path)
    assert result.errors == []
    types = {w.component_key: w.type for w in result.workspaces}
    assert types["a"] == "frontend-code"
    assert types["b"] == "legacy-mystery"
    assert types["c"] is None
