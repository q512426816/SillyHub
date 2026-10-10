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


# ── 2026-10-10-linked-repos-local-echo task-02/03：本机现状快照与导入（FR-01~04）──


class LocalSnapshotEntry(BaseModel):
    """对照条目（双源合并后：rel_path 取 projects 源、abs_path 取 repos 源，Grill Gap A）。"""

    key: str
    sources: list[str] = Field(default_factory=list)
    rel_path: str | None = None
    abs_path: str | None = None
    role: str | None = None
    state: str | None = None
    detail: str | None = None
    match: Literal["both", "local_only", "platform_only"]
    platform_repo_id: UUID | None = None
    platform_rel_path: str | None = None


class LocalSnapshotResponse(BaseModel):
    """本机现状快照（手动现拉即弃，D-003/D-005；四态降级，Gap B）。"""

    status: Literal["ok", "daemon_offline", "daemon_unsupported", "binding_missing"]
    fetched_at: str | None = None
    projects_skipped: str | None = None
    repos_skipped: str | None = None
    entries: list[LocalSnapshotEntry] = Field(default_factory=list)
    platform_only_names: list[str] = Field(default_factory=list)


class ImportEntryInput(BaseModel):
    """导入条目（合并形态：一次导入同时落 rel_path 与 my_path）。

    名合法性不在请求级校验（422 会拒整批）——service 层逐条判定 failed
    （快照来源理论合法，运行时脏值按条目级容错，FR-03 逐条独立成败）。
    """

    name: str = Field(min_length=1, max_length=100)
    rel_path: str | None = Field(default=None, max_length=500)
    abs_path: str | None = Field(default=None, max_length=1000)


class ImportRequest(BaseModel):
    entries: list[ImportEntryInput] = Field(default_factory=list, max_length=50)


class ImportResultItem(BaseModel):
    name: str
    result: Literal["imported", "skipped", "failed"]
    detail: str | None = None


class ImportResponse(BaseModel):
    results: list[ImportResultItem] = Field(default_factory=list)
