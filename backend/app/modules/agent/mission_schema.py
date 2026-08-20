"""Mission API schemas (Wave 5, 2026-06-19-multi-agent-orchestration)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class MissionCreateRequest(BaseModel):
    # BE-P2-4（2026-08-21 审查）：objective/worker_preset/scope 加输入上限——超大
    # 文本原先直接进 prompt 与 lease metadata JSON（placement.py:399-400），无界。
    objective: str = Field(max_length=8000)
    change_id: uuid.UUID | None = None
    budget_usd: float | None = Field(default=None, ge=0)
    constraints: dict | None = None
    mode: Literal["single", "team"] | None = None
    # task-05（2026-08-08-dispatch-worker-caller-worktree / 路径A，D-007@v1）：team 路径
    # 子模式。``"external"`` → ``router.create_mission`` 也走 team_mission_entry（跳过 GLM
    # planner），team_mission_entry 跳过 orchestrator spawn，caller（SillySpec）自己
    # dispatch_worker 调度。默认 None → 按 mode 走原逻辑（team 模式 spawn 主 agent，
    # single 模式走 planner，零回归，design §7.1 / §9）。Literal 风格沿用既有 mode 字段。
    orchestration_mode: Literal["team", "external"] | None = None
    session_id: uuid.UUID | None = None
    # 2026-07-12-team-main-agent-orchestration task-03 / D-002@v2：用户预设 worker 列表。
    # 每条 {agent_type, model, objective, role}。mode=team 时主 agent 按列表派 worker
    # （不自动拆，D-002）。mode=single 时忽略。nullable 兼容老调用（零回归）。
    worker_preset: list[dict] | None = Field(default=None, max_length=20)
    # 2026-07-12-team-main-agent-orchestration task-03 / D-003@v2：主 agent 配置
    # {agent_type, provider, model}。mode=team 时主 agent AgentRun 用此配置走 daemon lease。
    # nullable 兼容老调用（mode=single 零回归）。
    # task-12 / 2026-08-02-agent-profile-layer：可选增 agent_profile_id（UUID 字符串），
    # 主 agent run 据此绑定 AgentProfile（软约束兜底，design §8）。orchestrator
    # _resolve_main_agent_config 解析并透传 dispatch_to_daemon。缺失/非法 → None 零回归。
    main_agent_config: dict | None = None
    # 2026-08-19-cross-workspace-team-mission task-05 / D-005@v1：跨工作区支持。
    # anchor_workspace_id：主 agent 运行所在工作区（anchor）。NULL 按原逻辑使用 workspace_id。
    # scope_workspace_ids：mission 涉及的工作区范围（含 anchor）。NULL 按单工作区处理。
    # 两者可选，零回归单工作区 mission（design §7.2）。
    anchor_workspace_id: uuid.UUID | None = None
    scope_workspace_ids: list[uuid.UUID] | None = Field(default=None, max_length=20)


class MissionArtifactResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    content_ref: str | None = None
    created_at: datetime


class MissionWorkerRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str | None = None
    objective: str | None = None
    status: str
    total_cost_usd: float | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    artifacts: list[MissionArtifactResponse] = []
    # 2026-08-19-cross-workspace-team-mission task-05 / D-005@v1：跨工作区 worker 概要。
    # target_workspace_id：worker 实际运行所在工作区。NULL 表示单工作区模式。
    # target_workspace_name：目标工作区名称（概要字段，非校验）。
    target_workspace_id: uuid.UUID | None = None
    target_workspace_name: str | None = None


class MissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    change_id: uuid.UUID | None
    objective: str
    status: str  # derived via derive_status
    budget_usd: float | None
    cost_so_far: float
    constraints: dict | None
    cancelled_at: datetime | None
    created_at: datetime
    workers: list[MissionWorkerRunResponse]
    # 2026-08-19-cross-workspace-team-mission task-05 / D-005@v1：跨工作区 mission 概要。
    # project_id：关联项目 ID。NULL 表示单工作区 mission。
    # scope_workspace_ids：mission 涉及的工作区范围。NULL 按单工作区处理。
    # workspace_name / workspace_type：主工作区名称与类型（概要字段，非校验）。
    project_id: uuid.UUID | None = None
    scope_workspace_ids: list[uuid.UUID] | None = None
    workspace_name: str | None = None
    workspace_type: str | None = None
