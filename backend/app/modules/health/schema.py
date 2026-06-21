"""Health/version response models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

DependencyStatus = Literal["ok", "down"]
OverallStatus = Literal["ok", "degraded"]


class HealthResponse(BaseModel):
    status: OverallStatus = Field(description="`ok` when every dependency reports `ok`.")
    db: DependencyStatus
    redis: DependencyStatus
    version: str
    commit_sha: str
    server_time: datetime
    environment: str


class VersionResponse(BaseModel):
    version: str
    commit_sha: str
    environment: str


class SystemStatusResponse(BaseModel):
    """服务器性能(psutil) + 业务统计(首页运行状态看板)。"""

    server_time: datetime
    # 性能(容器视角)
    cpu_percent: float = Field(description="CPU 使用率 %")
    memory_percent: float = Field(description="内存使用率 %")
    memory_used_mb: float
    memory_total_mb: float
    disk_percent: float = Field(description="磁盘使用率 %")
    disk_used_gb: float
    disk_total_gb: float
    # 业务统计
    tasks: int
    projects: int
    milestones: int
    users: int
