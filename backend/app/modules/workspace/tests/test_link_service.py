"""PPM 项目 ↔ 工作区 关联表级逻辑测试(link_service)。

change ``2026-07-28-ppm-project-link-workspace`` task-08 / AC-2~AC-5。
DB 层直测(仿 ``workspace/tests/test_m2n_task.py``):覆盖 bind/unbind/list、
重复 409、存在性 404、软删除工作区过滤(FR-06)、CASCADE(AC-5,SQLite 开
PRAGMA foreign_keys)。权限校验(403)在 HTTP 测试覆盖。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError

# 显式注册 incident/release 模型表:app.main 在 client fixture 内导入(晚于 db_engine
# 的 create_all),incident 经由全局 metadata 提前注册但 releases 时序未到会触发
# NoReferencedTableError(pre-existing 测试基建缺口,非本变更引入)。收集期导入确保
# create_all 能解析 incidents.release_id 外键。conftest 用同款 noqa-F401 范式。
from app.modules.incident import model as _incident_model  # noqa: F401
from app.modules.ppm.project.model import PpmProjectMaintenance
from app.modules.release import model as _release_model  # noqa: F401
from app.modules.workspace import link_service
from app.modules.workspace.model import PpmProjectWorkspace, Workspace


async def _create_workspace(
    session: AsyncSession, name: str = "WS", *, deleted: bool = False
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=name.lower(),
        root_path=f"/{name.lower()}",
        status="active",
        deleted_at=datetime.now(UTC) if deleted else None,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_project(
    session: AsyncSession, name: str = "项目A", code: str = "P-001"
) -> PpmProjectMaintenance:
    p = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_name=name,
        project_code=code,
        project_status="进行中",
    )
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return p


async def test_bind_and_list_both_dimensions(db_session: AsyncSession) -> None:
    ws = await _create_workspace(db_session, "WS1")
    proj = await _create_project(db_session)

    await link_service.bind(db_session, ppm_project_id=proj.id, workspace_id=ws.id)

    by_ws = await link_service.list_by_workspace(db_session, workspace_id=ws.id)
    assert len(by_ws) == 1
    assert by_ws[0].project_id == proj.id
    assert by_ws[0].project_name == "项目A"

    by_proj = await link_service.list_by_project(db_session, ppm_project_id=proj.id)
    assert len(by_proj) == 1
    assert by_proj[0].workspace_id == ws.id


async def test_bind_multiple_workspaces_for_project(db_session: AsyncSession) -> None:
    ws1 = await _create_workspace(db_session, "WS1")
    ws2 = await _create_workspace(db_session, "WS2")
    proj = await _create_project(db_session)

    await link_service.bind(db_session, ppm_project_id=proj.id, workspace_id=ws1.id)
    await link_service.bind(db_session, ppm_project_id=proj.id, workspace_id=ws2.id)

    by_proj = await link_service.list_by_project(db_session, ppm_project_id=proj.id)
    assert {w.workspace_id for w in by_proj} == {ws1.id, ws2.id}


async def test_bind_duplicate_raises_409(db_session: AsyncSession) -> None:
    ws = await _create_workspace(db_session, "WS1")
    proj = await _create_project(db_session)
    await link_service.bind(db_session, ppm_project_id=proj.id, workspace_id=ws.id)

    with pytest.raises(AppError) as exc:
        await link_service.bind(db_session, ppm_project_id=proj.id, workspace_id=ws.id)
    assert exc.value.http_status == 409


async def test_bind_project_not_found_404(db_session: AsyncSession) -> None:
    ws = await _create_workspace(db_session, "WS1")
    with pytest.raises(AppError) as exc:
        await link_service.bind(db_session, ppm_project_id=uuid.uuid4(), workspace_id=ws.id)
    assert exc.value.http_status == 404


async def test_bind_workspace_not_found_404(db_session: AsyncSession) -> None:
    proj = await _create_project(db_session)
    with pytest.raises(AppError) as exc:
        await link_service.bind(db_session, ppm_project_id=proj.id, workspace_id=uuid.uuid4())
    assert exc.value.http_status == 404


async def test_bind_soft_deleted_workspace_404(db_session: AsyncSession) -> None:
    ws = await _create_workspace(db_session, "WS1", deleted=True)
    proj = await _create_project(db_session)
    with pytest.raises(AppError) as exc:
        await link_service.bind(db_session, ppm_project_id=proj.id, workspace_id=ws.id)
    assert exc.value.http_status == 404


async def test_unbind_removes_link(db_session: AsyncSession) -> None:
    ws = await _create_workspace(db_session, "WS1")
    proj = await _create_project(db_session)
    await link_service.bind(db_session, ppm_project_id=proj.id, workspace_id=ws.id)

    await link_service.unbind(db_session, ppm_project_id=proj.id, workspace_id=ws.id)

    assert await link_service.list_by_workspace(db_session, workspace_id=ws.id) == []


async def test_unbind_idempotent_when_absent(db_session: AsyncSession) -> None:
    ws = await _create_workspace(db_session, "WS1")
    proj = await _create_project(db_session)
    # 未绑定直接 unbind 不抛错(DELETE 幂等语义)
    await link_service.unbind(db_session, ppm_project_id=proj.id, workspace_id=ws.id)


async def test_list_filters_soft_deleted_workspace(db_session: AsyncSession) -> None:
    """软删除的工作区不出现在项目的关联列表里(FR-06 / AC-4)。"""
    ws_active = await _create_workspace(db_session, "WS-ACTIVE")
    ws_deleted = await _create_workspace(db_session, "WS-DELETED", deleted=True)
    proj = await _create_project(db_session)

    # bind 会拒绝软删工作区(404),故软删那条直接插底层行模拟历史残留。
    db_session.add(PpmProjectWorkspace(ppm_project_id=proj.id, workspace_id=ws_deleted.id))
    await link_service.bind(db_session, ppm_project_id=proj.id, workspace_id=ws_active.id)

    by_proj = await link_service.list_by_project(db_session, ppm_project_id=proj.id)
    assert {w.workspace_id for w in by_proj} == {ws_active.id}


async def test_cascade_delete_project(db_session: AsyncSession) -> None:
    """删 PPM 项目 → 关联记录级联消失(AC-5)。SQLite 需开 PRAGMA foreign_keys。"""
    await db_session.execute(text("PRAGMA foreign_keys=ON"))
    ws = await _create_workspace(db_session, "WS1")
    proj = await _create_project(db_session)
    await link_service.bind(db_session, ppm_project_id=proj.id, workspace_id=ws.id)

    await db_session.delete(proj)
    await db_session.commit()

    rows = list(
        (
            await db_session.execute(
                select(PpmProjectWorkspace).where(PpmProjectWorkspace.ppm_project_id == proj.id)
            )
        )
        .scalars()
        .all()
    )
    assert rows == []


async def test_cascade_delete_workspace(db_session: AsyncSession) -> None:
    """硬删工作区 → 关联记录级联消失。"""
    await db_session.execute(text("PRAGMA foreign_keys=ON"))
    ws = await _create_workspace(db_session, "WS1")
    proj = await _create_project(db_session)
    await link_service.bind(db_session, ppm_project_id=proj.id, workspace_id=ws.id)

    await db_session.delete(ws)
    await db_session.commit()

    rows = list(
        (
            await db_session.execute(
                select(PpmProjectWorkspace).where(PpmProjectWorkspace.workspace_id == ws.id)
            )
        )
        .scalars()
        .all()
    )
    assert rows == []
