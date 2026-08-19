"""跨工作区 mission schema 扩展单测（task-05 / AC-01~AC-04）。

change ``2026-08-19-cross-workspace-team-mission`` task-05：

- **AC-01（CreateRequest 可选字段）**：MissionCreateRequest 可选传 anchor_workspace_id
  与 scope_workspace_ids。缺省时 NULL，零回归单工作区行为。design §7.2。
- **AC-02（MissionResponse 概要字段）**：MissionResponse 新增 project_id /
  scope_workspace_ids / workspace_name / workspace_type。全可选，NULL 表示单工作区。
  design §7.2。
- **AC-03（MissionWorkerRunResponse target 概要）**：MissionWorkerRunResponse 新增
  target_workspace_id / target_workspace_name。全可选，NULL 表示单工作区 worker。
  design §7.2。
- **AC-04（向后兼容）**：旧字段全部保留，model_validate 往返不断言。序列化/反序列化
  兼容旧数据。design §7.2 零回归原则。

测试策略：纯 schema 层单测，不涉及 DB / router / orchestrator（由后续 task 覆盖）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from app.modules.agent.mission_schema import (
    MissionCreateRequest,
    MissionResponse,
    MissionWorkerRunResponse,
)


class TestMissionCreateRequestCrossWorkspace:
    """MissionCreateRequest 跨工作区字段测试（AC-01）。"""

    def test_anchor_and_scope_optional_default_none(self) -> None:
        """anchor_workspace_id / scope_workspace_ids 缺省时为 None。"""
        req = MissionCreateRequest(objective="测试单工作区 mission")
        assert req.anchor_workspace_id is None
        assert req.scope_workspace_ids is None

    def test_anchor_and_scope_can_be_provided(self) -> None:
        """可显式传入 anchor / scope。"""
        anchor = uuid.uuid4()
        scope = [uuid.uuid4(), uuid.uuid4()]
        req = MissionCreateRequest(
            objective="跨工作区 mission",
            anchor_workspace_id=anchor,
            scope_workspace_ids=scope,
        )
        assert req.anchor_workspace_id == anchor
        assert req.scope_workspace_ids == scope

    def test_scope_can_be_empty_list(self) -> None:
        """scope_workspace_ids 可传空列表（虽业务逻辑校验≥1，但 schema 允许）。"""
        req = MissionCreateRequest(
            objective="空 scope",
            scope_workspace_ids=[],
        )
        assert req.scope_workspace_ids == []

    def test_anchor_alone_without_scope_allowed(self) -> None:
        """可只传 anchor 不传 scope（虽业务语义不完整，但 schema 允许）。"""
        anchor = uuid.uuid4()
        req = MissionCreateRequest(
            objective="仅 anchor",
            anchor_workspace_id=anchor,
        )
        assert req.anchor_workspace_id == anchor
        assert req.scope_workspace_ids is None

    def test_backward_compatible_all_old_fields(self) -> None:
        """旧字段全部保留（objective / change_id / budget_usd / constraints / mode 等）。"""
        req = MissionCreateRequest(
            objective="完整字段",
            change_id=uuid.uuid4(),
            budget_usd=100.0,
            constraints={"key": "value"},
            mode="team",
            orchestration_mode="external",
            session_id=uuid.uuid4(),
            worker_preset=[{"agent_type": "coder", "model": "claude-sonnet"}],
            main_agent_config={"agent_type": "planner", "provider": "anthropic"},
        )
        assert req.objective == "完整字段"
        assert req.change_id is not None
        assert req.budget_usd == 100.0
        assert req.constraints == {"key": "value"}
        assert req.mode == "team"
        assert req.orchestration_mode == "external"
        assert req.session_id is not None
        assert req.worker_preset is not None
        assert req.main_agent_config is not None

    def test_model_validate_round_trip(self) -> None:
        """model_validate 往返不断言（向后兼容序列化）。"""
        original = MissionCreateRequest(
            objective="往返测试",
            anchor_workspace_id=uuid.uuid4(),
            scope_workspace_ids=[uuid.uuid4()],
        )
        dict_repr = original.model_dump()
        reconstructed = MissionCreateRequest.model_validate(dict_repr)
        assert reconstructed.objective == original.objective
        assert reconstructed.anchor_workspace_id == original.anchor_workspace_id
        assert reconstructed.scope_workspace_ids == original.scope_workspace_ids


class TestMissionResponseCrossWorkspace:
    """MissionResponse 跨工作区概要字段测试（AC-02）。"""

    def test_project_and_scope_optional_default_none(self) -> None:
        """project_id / scope_workspace_ids / workspace_name / workspace_type 缺省时为 None。"""
        # MissionResponse 是 from_attributes=True，此处用构造函数模拟 ORM 对象行为
        resp = MissionResponse(
            id=uuid.uuid4(),
            workspace_id=uuid.uuid4(),
            change_id=None,
            objective="测试单工作区",
            status="pending",
            budget_usd=None,
            cost_so_far=0.0,
            constraints=None,
            cancelled_at=None,
            created_at=datetime.utcnow(),
            workers=[],
        )
        assert resp.project_id is None
        assert resp.scope_workspace_ids is None
        assert resp.workspace_name is None
        assert resp.workspace_type is None

    def test_project_and_scope_can_be_provided(self) -> None:
        """可显式传入 project_id / scope / 概要字段。"""
        project_id = uuid.uuid4()
        scope = [uuid.uuid4(), uuid.uuid4()]
        resp = MissionResponse(
            id=uuid.uuid4(),
            workspace_id=uuid.uuid4(),
            change_id=None,
            objective="跨工作区 mission",
            status="pending",
            budget_usd=None,
            cost_so_far=0.0,
            constraints=None,
            cancelled_at=None,
            created_at=datetime.utcnow(),
            workers=[],
            project_id=project_id,
            scope_workspace_ids=scope,
            workspace_name="主工作区",
            workspace_type="frontend",
        )
        assert resp.project_id == project_id
        assert resp.scope_workspace_ids == scope
        assert resp.workspace_name == "主工作区"
        assert resp.workspace_type == "frontend"

    def test_backward_compatible_all_old_fields(self) -> None:
        """旧字段全部保留（id / workspace_id / change_id / objective / status 等）。"""
        mission_id = uuid.uuid4()
        workspace_id = uuid.uuid4()
        change_id = uuid.uuid4()
        created_at = datetime.utcnow()
        resp = MissionResponse(
            id=mission_id,
            workspace_id=workspace_id,
            change_id=change_id,
            objective="完整字段",
            status="running",
            budget_usd=50.0,
            cost_so_far=25.0,
            constraints={"deadline": "2026-12-31"},
            cancelled_at=None,
            created_at=created_at,
            workers=[],
        )
        assert resp.id == mission_id
        assert resp.workspace_id == workspace_id
        assert resp.change_id == change_id
        assert resp.objective == "完整字段"
        assert resp.status == "running"
        assert resp.budget_usd == 50.0
        assert resp.cost_so_far == 25.0
        assert resp.constraints == {"deadline": "2026-12-31"}
        assert resp.cancelled_at is None
        assert resp.created_at == created_at

    def test_model_validate_round_trip(self) -> None:
        """model_validate 往返不断言（向后兼容序列化）。"""
        original = MissionResponse(
            id=uuid.uuid4(),
            workspace_id=uuid.uuid4(),
            change_id=None,
            objective="往返测试",
            status="completed",
            budget_usd=None,
            cost_so_far=10.0,
            constraints=None,
            cancelled_at=None,
            created_at=datetime.utcnow(),
            workers=[],
            project_id=uuid.uuid4(),
            scope_workspace_ids=[uuid.uuid4()],
            workspace_name="测试工作区",
            workspace_type="backend",
        )
        dict_repr = original.model_dump()
        reconstructed = MissionResponse.model_validate(dict_repr)
        assert reconstructed.id == original.id
        assert reconstructed.project_id == original.project_id
        assert reconstructed.scope_workspace_ids == original.scope_workspace_ids
        assert reconstructed.workspace_name == original.workspace_name
        assert reconstructed.workspace_type == original.workspace_type


class TestMissionWorkerRunResponseCrossWorkspace:
    """MissionWorkerRunResponse 跨工作区 target 概要字段测试（AC-03）。"""

    def test_target_fields_optional_default_none(self) -> None:
        """target_workspace_id / target_workspace_name 缺省时为 None。"""
        resp = MissionWorkerRunResponse(
            id=uuid.uuid4(),
            role="coder",
            objective="写代码",
            status="running",
            total_cost_usd=None,
            started_at=datetime.utcnow(),
            finished_at=None,
            artifacts=[],
        )
        assert resp.target_workspace_id is None
        assert resp.target_workspace_name is None

    def test_target_fields_can_be_provided(self) -> None:
        """可显式传入 target_workspace_id / target_workspace_name。"""
        target_ws = uuid.uuid4()
        resp = MissionWorkerRunResponse(
            id=uuid.uuid4(),
            role="reviewer",
            objective="代码审查",
            status="pending",
            total_cost_usd=None,
            started_at=None,
            finished_at=None,
            artifacts=[],
            target_workspace_id=target_ws,
            target_workspace_name="审查工作区",
        )
        assert resp.target_workspace_id == target_ws
        assert resp.target_workspace_name == "审查工作区"

    def test_backward_compatible_all_old_fields(self) -> None:
        """旧字段全部保留（id / role / objective / status / artifacts 等）。"""
        run_id = uuid.uuid4()
        started_at = datetime.utcnow()
        resp = MissionWorkerRunResponse(
            id=run_id,
            role="tester",
            objective="测试用例",
            status="completed",
            total_cost_usd=5.0,
            started_at=started_at,
            finished_at=datetime.utcnow(),
            artifacts=[],
        )
        assert resp.id == run_id
        assert resp.role == "tester"
        assert resp.objective == "测试用例"
        assert resp.status == "completed"
        assert resp.total_cost_usd == 5.0
        assert resp.started_at == started_at
        assert resp.finished_at is not None

    def test_model_validate_round_trip(self) -> None:
        """model_validate 往返不断言（向后兼容序列化）。"""
        original = MissionWorkerRunResponse(
            id=uuid.uuid4(),
            role="planner",
            objective="规划",
            status="running",
            total_cost_usd=None,
            started_at=datetime.utcnow(),
            finished_at=None,
            artifacts=[],
            target_workspace_id=uuid.uuid4(),
            target_workspace_name="规划工作区",
        )
        dict_repr = original.model_dump()
        reconstructed = MissionWorkerRunResponse.model_validate(dict_repr)
        assert reconstructed.id == original.id
        assert reconstructed.target_workspace_id == original.target_workspace_id
        assert reconstructed.target_workspace_name == original.target_workspace_name
