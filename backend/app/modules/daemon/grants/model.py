"""DaemonRuntimeGrant SQLModel table — daemon 共享统一授权（design §8 / D-006@v1）。

Change 2026-08-28-daemon-agent-share task-01：一行 = 某人（granted_by）把某台
守护进程**机器级**授权（daemon_instance_id，对齐原 shared 绑定语义——共享的是
「我的守护进程」整机，使用时按 provider 解析到具体 DaemonRuntime）给某授权对象
（grantee）：工作区（workspace，grantee_id=workspace_id）或全平台
（platform，grantee_id=NULL，绑定列见下）。撤销不删行（enabled 软开关，对齐原
owner 撤销置 shared=False 语义）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlmodel import Field

from app.models.base import BaseModel


class DaemonRuntimeGrant(BaseModel, table=True):
    """统一授权行：工作区共享与平台共享智能体共用本表（design §5 Phase 1）。"""

    __tablename__ = "daemon_runtime_grants"
    __table_args__ = (
        # 唯一约束 (daemon_instance_id, grantee_type, grantee_id, granted_by_user_id)
        # ——同工作区允许多个 lender 各自共享（granted_by 参与唯一键区分）。
        # D-008@v1：platform 行 grantee_id=NULL，PG 默认 NULLS DISTINCT 语义
        # NULL≠NULL 会使唯一约束失效、允许重复建共享智能体行——故 PG16 下以
        # NULLS NOT DISTINCT 下发（postgresql_nulls_not_distinct 方言 kwarg；
        # SQLite create_all 建表时该 kwarg 被方言忽略，退化为普通 UNIQUE，
        # platform 行（grantee_id NULL）唯一性由 PG 部署方言保证，测试跳过）。
        # 该约束同时充当 daemon_instance_id 前导列索引（design §8 "index" 注记，
        # 不另建单列索引）。模型与迁移建表两侧同语义（20260828120000）。
        UniqueConstraint(
            "daemon_instance_id",
            "grantee_type",
            "grantee_id",
            "granted_by_user_id",
            name="uq_daemon_runtime_grants",
            postgresql_nulls_not_distinct=True,
        ),
        # 授权查询热路径：WHERE grantee_type=? AND grantee_id=?（+ enabled 过滤）。
        Index("ix_daemon_runtime_grants_grantee", "grantee_type", "grantee_id"),
        # lender 视图 / 开关双写定位：WHERE granted_by_user_id=?。
        Index("ix_daemon_runtime_grants_lender", "granted_by_user_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # 被授权的守护进程实体（机器级授权对象，design §5 Phase 1）。ondelete=RESTRICT
    # 对齐 workspace_member_runtimes.daemon_id 先例：删 daemon_instance 前需先撤销
    # 全部 grant，避免悬空授权行。
    daemon_instance_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("daemon_instances.id", ondelete="RESTRICT"),
            nullable=False,
        ),
    )
    # workspace=工作区共享（grantee_id=workspace_id）/ platform=平台共享智能体
    # （grantee_id=NULL，绑定列必填）。"user" 为预留枚举位（design §3 非目标，
    # 本次不启用），启用时加值即可——String(20) 自由字符串列，免后续加值迁移。
    grantee_type: Literal["workspace", "platform"] = Field(
        sa_column=Column(String(20), nullable=False),
    )
    # 授权对象 id：workspace 行=workspaces.id；platform 行=NULL。多态目标列，
    # 不建 FK 硬约束（grantee_type 扩展 "user" 后指向 users.id，FK 无法多态）。
    grantee_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    # lender（workspace 共享=开共享的开发人员；platform 共享=平台管理员）。
    granted_by_user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    # —— platform 绑定列（grantee_type=platform 时由 service 层强制非空，
    #    task-04 落地校验；本层保持可空——workspace 行全部为 NULL）——
    # 共享智能体档案（会话创建入口的检测锚点，design §5 Phase 3）。
    agent_profile_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    # 平台源码工作区（platform 会话强制 cwd=其 root_path）。
    source_workspace_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    # 钉定的管理员 runtime（D-003@v1：仅管理员自己名下在线 runtime）。
    pinned_runtime_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    # 共享输出目录（D-002@v2：读源码不受限、写操作限制在此目录内；
    # service 校验 ⊆ 管理员 runtime 的 allowed_roots）。
    writable_dir: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True),
    )
    # 软开关：撤销/停用置 False（行保留），鉴权查询一律过滤 enabled=true。
    enabled: bool = Field(
        default=True,
        sa_column=Column(
            Boolean,
            nullable=False,
            server_default=text("true"),
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
