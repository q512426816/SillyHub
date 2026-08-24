"""task-07 单测：TeamMissionCreateBlock DTO + validate_team_mission_block 共享校验。

钉死（2026-08-24-session-team-mission-context / design §5.E1/§7 / FR-05/06 / D-010）：
- TeamMissionCreateBlock 六字段（objective/scope_workspace_ids/project_id/
  budget_usd/worker_preset/main_agent_config）形态逐字对齐 TeamMissionTriggerRequest
  （同名同 annotation），第七字段 orchestrator_workspace_id（UUID|None，默认 None，
  本卡只透传不校验语义——消费侧 task-09）；
- SessionCreateRequest.team_mission 可选内嵌块：不带 team_mission 的旧请求体校验
  行为不变（runtime_id/provider 二选一仍生效、缺省 None）；openapi 产出具名 schema
  （供 pnpm gen:types 与 task-09/12/13 消费）；
- validate_team_mission_block 共享函数（自 trigger 端点抽出，行为逐字不变）：
  scope 去重保序 / 未传回落 fallback_workspace_id / 两者皆无 422 / 非项目经理
  403 / scope 越界 422 / anchor backend-code 优先（项目与非项目多工作区两路径）；
  TeamMissionTriggerRequest 与 TeamMissionCreateBlock 均可作入参（结构同形）；
- trigger 端点改为调用共享函数（单一实现，无复制粘贴）——既有
  test_session_team_mission.py 断言零改动全绿（回归由该文件守护）。
"""

from __future__ import annotations

import inspect
import json
import uuid

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.modules.daemon.schema import (
    SessionCreateRequest,
    TeamMissionCreateBlock,
    TeamMissionTriggerRequest,
)

# 两 DTO 共用的六字段（TeamMissionCreateBlock 对其逐字对齐 TeamMissionTriggerRequest）。
_SHARED_FIELDS = (
    "objective",
    "scope_workspace_ids",
    "project_id",
    "budget_usd",
    "worker_preset",
    "main_agent_config",
)


# ── Seeding helpers（镜像 test_session_team_mission.py 同款范式）───────────────


def _ws(name: str, ws_type: str, tmp_path):
    from app.modules.workspace.model import Workspace

    ws_id = uuid.uuid4()
    return Workspace(
        id=ws_id,
        name=f"{name} Workspace",
        slug=f"{name}-{ws_id.hex[:8]}",
        root_path=str(tmp_path / name),
        status="active",
        type=ws_type,
    )


async def _user(db_session, *, admin: bool = False):
    """建普通用户（或平台超管）并返回 ORM User（validate 共享函数入参）。"""
    from app.modules.auth.model import User

    user = User(
        id=uuid.uuid4(),
        email=f"t07-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name="T07",
        status="active",
        is_platform_admin=admin,
    )
    db_session.add(user)
    await db_session.commit()
    return user


async def _project(db_session, tmp_path, *, manager: uuid.UUID, ws_ids: list[uuid.UUID]):
    """建项目 + 经理成员 + 关联工作区，返回 (project, workspaces)。"""
    from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
    from app.modules.workspace.model import PpmProjectWorkspace

    project = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_name="T07 Project",
        project_code=f"T07-{uuid.uuid4().hex[:6]}",
        project_status="进行中",
        project_type="研发",
        created_by=manager,
    )
    db_session.add(project)
    db_session.add(
        PpmProjectMember(pm_project_id=project.id, user_id=manager, role_name="项目经理")
    )
    for ws_id in ws_ids:
        db_session.add(PpmProjectWorkspace(ppm_project_id=project.id, workspace_id=ws_id))
    await db_session.commit()
    return project


# ── TeamMissionCreateBlock DTO ────────────────────────────────────────────────


class TestTeamMissionCreateBlockDTO:
    def test_shared_fields_align_trigger_request_verbatim(self) -> None:
        """六字段与 TeamMissionTriggerRequest 同名同 annotation（逐字对齐口径）。"""
        trigger_fields = TeamMissionTriggerRequest.model_fields
        block_fields = TeamMissionCreateBlock.model_fields
        for name in _SHARED_FIELDS:
            assert name in block_fields, f"TeamMissionCreateBlock 缺字段 {name}"
            assert block_fields[name].annotation == trigger_fields[name].annotation, (
                f"字段 {name} annotation 与 TeamMissionTriggerRequest 不一致"
            )

    def test_passthrough_all_seven_fields(self) -> None:
        """七字段全量透传（str 入参 UUID 自动收敛，orchestrator_workspace_id 在内）。"""
        orchestrator_ws = uuid.uuid4()
        block = TeamMissionCreateBlock(
            objective="帮我分析这个仓库的架构",
            scope_workspace_ids=[str(uuid.uuid4()), str(uuid.uuid4())],
            project_id=str(uuid.uuid4()),
            budget_usd=5.0,
            worker_preset=[{"role": "dev", "agent_type": "claude_code"}],
            main_agent_config={"provider": "claude"},
            orchestrator_workspace_id=str(orchestrator_ws),
        )
        assert block.objective == "帮我分析这个仓库的架构"
        assert len(block.scope_workspace_ids) == 2
        assert all(isinstance(i, uuid.UUID) for i in block.scope_workspace_ids)
        assert isinstance(block.project_id, uuid.UUID)
        assert block.budget_usd == 5.0
        assert block.worker_preset == [{"role": "dev", "agent_type": "claude_code"}]
        assert block.main_agent_config == {"provider": "claude"}
        assert block.orchestrator_workspace_id == orchestrator_ws

    def test_all_fields_optional_defaults_none(self) -> None:
        """全字段可缺省（空块合法）——orchestrator_workspace_id 默认 None=当前会话默认。"""
        block = TeamMissionCreateBlock()
        for name in (*_SHARED_FIELDS, "orchestrator_workspace_id"):
            assert getattr(block, name) is None, f"{name} 缺省应为 None"

    def test_uses_trigger_request_constraints(self) -> None:
        """约束口径与 TeamMissionTriggerRequest 一致：objective/prompt 超长、
        scope/worker_preset 超上限、budget 负数 → ValidationError。"""
        with pytest.raises(ValidationError):
            TeamMissionCreateBlock(objective="x" * 8001)
        with pytest.raises(ValidationError):
            TeamMissionCreateBlock(scope_workspace_ids=[uuid.uuid4()] * 21)
        with pytest.raises(ValidationError):
            TeamMissionCreateBlock(worker_preset=[{"role": "dev"}] * 21)
        with pytest.raises(ValidationError):
            TeamMissionCreateBlock(budget_usd=-1.0)


# ── SessionCreateRequest 旧请求体回归 + team_mission 挂载 ─────────────────────


class TestSessionCreateRequestTeamMission:
    def test_legacy_body_defaults_team_mission_none(self) -> None:
        """不带 team_mission 的旧请求体：缺省 None，其余字段照旧。"""
        req = SessionCreateRequest(prompt="hi", provider="claude")
        assert req.team_mission is None
        req2 = SessionCreateRequest(prompt="hi", runtime_id=str(uuid.uuid4()))
        assert req2.team_mission is None

    def test_runtime_or_provider_either_or_unchanged(self) -> None:
        """runtime_id/provider 二选一校验不受 team_mission 影响：都缺 → 422。"""
        with pytest.raises(ValidationError):
            SessionCreateRequest(prompt="hi")
        # team_mission 存在也不豁免二选一（预会话派团队仍须选引擎入口）
        with pytest.raises(ValidationError):
            SessionCreateRequest(prompt="hi", team_mission=TeamMissionCreateBlock())
        # provider 单独 / runtime 单独 / 两者齐全照旧合法
        assert SessionCreateRequest(prompt="hi", provider="claude").provider == "claude"
        assert SessionCreateRequest(prompt="hi", runtime_id=str(uuid.uuid4())).runtime_id
        assert (
            SessionCreateRequest(
                prompt="hi", runtime_id=str(uuid.uuid4()), provider="claude"
            ).provider
            == "claude"
        )

    def test_explicit_null_team_mission_ok(self) -> None:
        """显式 null 与缺省等价（前端旧 payload 上送 null 也不炸）。"""
        req = SessionCreateRequest(prompt="hi", provider="claude", team_mission=None)
        assert req.team_mission is None

    def test_team_mission_block_passthrough(self) -> None:
        """内嵌 dict 收敛为 TeamMissionCreateBlock 并逐字段透传。"""
        orchestrator_ws = uuid.uuid4()
        req = SessionCreateRequest(
            prompt="hi",
            provider="claude",
            team_mission={
                "objective": "重构登录模块",
                "scope_workspace_ids": [str(uuid.uuid4())],
                "orchestrator_workspace_id": str(orchestrator_ws),
                "budget_usd": 2.5,
            },
        )
        assert isinstance(req.team_mission, TeamMissionCreateBlock)
        assert req.team_mission.objective == "重构登录模块"
        assert req.team_mission.orchestrator_workspace_id == orchestrator_ws
        assert req.team_mission.budget_usd == 2.5

    def test_openapi_named_schema(self) -> None:
        """openapi 产出具名 TeamMissionCreateBlock schema 且 SessionCreateRequest
        的 team_mission 属性引用之（pnpm gen:types / task-09/12/13 消费）。"""
        from app.main import app

        schema = app.openapi()
        assert "TeamMissionCreateBlock" in schema["components"]["schemas"]
        prop = schema["components"]["schemas"]["SessionCreateRequest"]["properties"]["team_mission"]
        assert "#/components/schemas/TeamMissionCreateBlock" in json.dumps(prop)


# ── validate_team_mission_block 共享函数 ──────────────────────────────────────


class TestValidateTeamMissionBlock:
    async def test_scope_dedup_preserves_order(self, db_session, tmp_path) -> None:
        """scope 去重保序：[backend, frontend, backend, frontend] → [backend,
        frontend]；TeamMissionCreateBlock 可作入参（create 路径 task-09 同款）。"""
        from app.modules.daemon.router import validate_team_mission_block

        user = await _user(db_session)
        ws_backend = _ws("backend", "backend-code", tmp_path)
        ws_frontend = _ws("frontend", "frontend-code", tmp_path)
        db_session.add_all([ws_backend, ws_frontend])
        await db_session.commit()

        block = TeamMissionCreateBlock(
            scope_workspace_ids=[ws_backend.id, ws_frontend.id, ws_backend.id, ws_frontend.id]
        )
        scope_ids, anchor_id = await validate_team_mission_block(
            db_session, user, block, fallback_workspace_id=None
        )
        assert scope_ids == [ws_backend.id, ws_frontend.id]
        # 非项目多工作区 anchor：backend-code 优先（frontend 不在则取 backend）
        assert anchor_id == ws_backend.id

    async def test_scope_falls_back_to_workspace(self, db_session, tmp_path) -> None:
        """scope 未传 → fallback_workspace_id（trigger=会话绑定工作区）；单工作区
        anchor 即该工作区（免查 Workspace type）。"""
        from app.modules.daemon.router import validate_team_mission_block

        user = await _user(db_session)
        ws = _ws("backend", "backend-code", tmp_path)
        db_session.add(ws)
        await db_session.commit()

        scope_ids, anchor_id = await validate_team_mission_block(
            db_session, user, TeamMissionTriggerRequest(), fallback_workspace_id=ws.id
        )
        assert scope_ids == [ws.id]
        assert anchor_id == ws.id

    async def test_missing_scope_and_workspace_422(self, db_session) -> None:
        """scope 未传且 fallback_workspace_id=None → 422（CC-10 同款语义）。"""
        from app.modules.daemon.router import validate_team_mission_block

        user = await _user(db_session)
        with pytest.raises(HTTPException) as ei:
            await validate_team_mission_block(
                db_session, user, TeamMissionTriggerRequest(), fallback_workspace_id=None
            )
        assert ei.value.status_code == 422

    async def test_non_project_manager_403(self, db_session, tmp_path) -> None:
        """非项目经理（非超管且非项目成员）+ project_id → PermissionDenied(403)。"""
        from app.core.errors import PermissionDenied
        from app.modules.daemon.router import validate_team_mission_block

        manager = await _user(db_session)
        outsider = await _user(db_session)
        ws = _ws("backend", "backend-code", tmp_path)
        db_session.add(ws)
        await db_session.commit()
        project = await _project(db_session, tmp_path, manager=manager.id, ws_ids=[ws.id])

        with pytest.raises(PermissionDenied) as ei:
            await validate_team_mission_block(
                db_session,
                outsider,
                TeamMissionTriggerRequest(project_id=project.id, scope_workspace_ids=[ws.id]),
                fallback_workspace_id=None,
            )
        assert ei.value.http_status == 403

    async def test_manager_scope_out_of_bounds_422(self, db_session, tmp_path) -> None:
        """项目经理（超管）绕过经理校验，专测越界：scope 含项目未关联工作区 → 422。"""
        from app.modules.daemon.router import validate_team_mission_block

        admin = await _user(db_session, admin=True)
        ws_backend = _ws("backend", "backend-code", tmp_path)
        ws_orphan = _ws("orphan", "business-doc", tmp_path)
        db_session.add_all([ws_backend, ws_orphan])
        await db_session.commit()
        project = await _project(db_session, tmp_path, manager=admin.id, ws_ids=[ws_backend.id])

        with pytest.raises(HTTPException) as ei:
            await validate_team_mission_block(
                db_session,
                admin,
                TeamMissionTriggerRequest(
                    project_id=project.id,
                    scope_workspace_ids=[ws_backend.id, ws_orphan.id],
                ),
                fallback_workspace_id=None,
            )
        assert ei.value.status_code == 422

    async def test_project_anchor_backend_code_priority(self, db_session, tmp_path) -> None:
        """项目路径 anchor：scope=[frontend, backend] 两者均关联 → backend-code 优先
        （frontend 在前也不抢）。"""
        from app.modules.daemon.router import validate_team_mission_block

        manager = await _user(db_session)
        ws_backend = _ws("backend", "backend-code", tmp_path)
        ws_frontend = _ws("frontend", "frontend-code", tmp_path)
        db_session.add_all([ws_backend, ws_frontend])
        await db_session.commit()
        project = await _project(
            db_session,
            tmp_path,
            manager=manager.id,
            ws_ids=[ws_backend.id, ws_frontend.id],
        )

        scope_ids, anchor_id = await validate_team_mission_block(
            db_session,
            manager,
            TeamMissionTriggerRequest(
                project_id=project.id,
                scope_workspace_ids=[ws_frontend.id, ws_backend.id],
            ),
            fallback_workspace_id=None,
        )
        assert scope_ids == [ws_frontend.id, ws_backend.id]
        assert anchor_id == ws_backend.id

    async def test_non_project_multi_scope_anchor_backend_code(self, db_session, tmp_path) -> None:
        """非项目多工作区路径 anchor：查 Workspace type，backend-code 优先否则第一个。"""
        from app.modules.daemon.router import validate_team_mission_block

        user = await _user(db_session)
        ws_doc = _ws("docs", "business-doc", tmp_path)
        ws_backend = _ws("backend", "backend-code", tmp_path)
        db_session.add_all([ws_doc, ws_backend])
        await db_session.commit()

        _, anchor_id = await validate_team_mission_block(
            db_session,
            user,
            TeamMissionTriggerRequest(scope_workspace_ids=[ws_doc.id, ws_backend.id]),
            fallback_workspace_id=None,
        )
        assert anchor_id == ws_backend.id

    def test_trigger_endpoint_uses_shared_validator(self) -> None:
        """trigger 端点已改为调用共享函数（单一实现，无复制粘贴；create 路径
        task-09 复用同一函数）。"""
        from app.modules.daemon import router as router_mod

        src = inspect.getsource(router_mod.trigger_session_team_mission)
        assert "validate_team_mission_block(" in src
