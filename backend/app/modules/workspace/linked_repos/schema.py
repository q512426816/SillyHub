"""关联仓 API schema（task-02，FR-01/FR-02）。

Producer：linked_repos/router.py；Consumer：前端（api-types 经 openapi 生成）。
sync_status_summary 在 task-02 为空占位，task-03 接管填充（见任务卡 crud-api.shapes）。
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

SyncLayerName = Literal["projects_yaml", "repos_registry"]
SyncStatusName = Literal["ok", "skipped", "failed"]


class SyncStateBrief(BaseModel):
    """单层落盘状态摘要（GET 聚合视图用；task-03 填充）。"""

    machine_id: UUID
    layer: SyncLayerName
    status: SyncStatusName
    detail: str | None = None
    synced_at: datetime


class LinkedRepoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    repo_url: str | None = None
    description: str | None = None
    rel_path: str | None = None
    # 当前用户的成员级本机路径（无则 None）。
    my_path: str | None = None
    # 落盘状态摘要：普通成员=自己绑定机器；owner/admin=全部机器（task-03 接管）。
    sync_status_summary: list[SyncStateBrief] = Field(default_factory=list)


class LinkedRepoCreate(BaseModel):
    """登记关联仓（owner/admin）。name 对齐 sillyspec 子项目名规则。"""

    name: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.\-]+$")
    repo_url: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=2000)
    rel_path: str | None = Field(default=None, max_length=500)


class LinkedRepoUpdate(BaseModel):
    """编辑共享字段（owner/admin）。name 不可改（唯一键 + yaml 文件名，改名会产生
    落盘产物错位——design 数据模型节）。"""

    repo_url: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=2000)
    rel_path: str | None = Field(default=None, max_length=500)


class MyPathUpdate(BaseModel):
    """成员级本机路径 upsert（成员本人；path=None 清除）。"""

    path: str | None = Field(default=None, max_length=1000)
