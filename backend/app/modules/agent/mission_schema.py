"""Mission API schemas (Wave 5, 2026-06-19-multi-agent-orchestration)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class MissionCreateRequest(BaseModel):
    objective: str
    change_id: uuid.UUID | None = None
    budget_usd: float | None = None
    constraints: dict | None = None
    mode: Literal["single", "team"] | None = None
    session_id: uuid.UUID | None = None
    # 2026-07-12-team-main-agent-orchestration task-03 / D-002@v2：用户预设 worker 列表。
    # 每条 {agent_type, model, objective, role}。mode=team 时主 agent 按列表派 worker
    # （不自动拆，D-002）。mode=single 时忽略。nullable 兼容老调用（零回归）。
    worker_preset: list[dict] | None = None
    # 2026-07-12-team-main-agent-orchestration task-03 / D-003@v2：主 agent 配置
    # {agent_type, provider, model}。mode=team 时主 agent AgentRun 用此配置走 daemon lease。
    # nullable 兼容老调用（mode=single 零回归）。
    main_agent_config: dict | None = None


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
