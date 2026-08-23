"""``platform_change_progress`` table — SillySpec 进度同步层聚合存储。

Schema 对齐 design §8.1/§8.2 + 跨仓契约 ``sillyhub-progress-sync-contract.md`` §3/§4.2。
存客户端 ``serializeForSync`` 裸六表 JSON 投影 + 元字段，按 ``(workspace_id, change_name)``
复合唯一约束在 workspace 内聚合（D-001@v1；change_name 由全局聚合改为 workspace 内聚合）。

Change 2026-08-11-change-progress-projection task-02：加 ``workspace_id`` 列 + 复合唯一约束，
为收件箱 workspace 隔离（task-06/07）与变更中心实时投影（task-08）提供数据基础。

约束取 nullable + 复合唯一约束（非复合 PK）：design §9 要求 shk_live_ 过渡期
``workspace_id=None`` 可写（投影 join 不命中走 fallback）。复合 PK 列在 SQL 不允许 NULL，
会阻断过渡期写入，故 model 与 task-03 migration 统一用「nullable 列 + 复合唯一约束」
（唯一约束允许多 NULL，老行/过渡期 NULL 安全）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlmodel import Field

from app.models.base import BaseModel


class PlatformChangeProgressORM(BaseModel, table=True):
    """workspace 级 change 进度聚合行（design §8.2 / D-001@v1）。

    ``latest_progress`` 按裸 JSON 透传 serializeForSync 六表（NG-6 不强类型化）。
    ``last_pushed_at`` / ``last_pusher`` 用 String 而非 DateTime：契约 §7 明确
    base_ts 比对用 ISO 8601 UTC **字符串字典序**，存客户端
    ``X-SillySpec-Pushed-At`` 原值避免读写时区/精度转换（R-04 前提）。
    ``updated_at`` 是服务端落库审计字段（非比对基准），用 timezone-aware DateTime。

    ``(workspace_id, change_name)`` 复合唯一约束：同一 workspace 内 change_name 唯一，
    不同 workspace 各占一行（D-001@v1 收件箱隔离）；workspace 删则级联删其下进度行。
    ``workspace_id`` nullable：shk_live_ 过渡期 None 行可写（design §9），投影 join 不命中
    走 fallback。
    ``id`` 独立 UUID 主键（``default=uuid.uuid4``）：change_name 去主键后主键唯一性由 id 保证
    （D-001@v1；change_name 全表唯一 → 同 workspace 内唯一，跨 workspace 同名各占一行）。
    """

    __tablename__ = "platform_change_progress"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "change_name",
            name="uq_platform_change_progress_workspace_change",
        ),
    )

    id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            primary_key=True,
            nullable=False,
            default=uuid.uuid4,
        ),
    )
    workspace_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    change_name: str = Field(
        sa_column=Column(String, nullable=False),
    )
    latest_progress: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    last_pushed_at: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    last_pusher: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    # ── Change 2026-08-14-platform-sync-docs-approval（D-002@v1 / D-003@v1 单写者）──
    # documents：四件套全文扁平 map（CLI syncDocuments 写，POST documents 才动）。
    # approval：审批记录（平台写，POST approval 才动）。两列独立于 latest_progress——
    # upsert_progress 定向列 UPDATE 不触碰，三个写入方互不覆盖。
    documents: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    approval: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )


class QuicklogEntryORM(BaseModel, table=True):
    """CLI 推送的 quicklog 条目原文（design §5.1 / D-003 双链路推送落点）。

    ``payload`` 裸存 CLI 推送的结构化 JSON（QuicklogEntryDTO，含 ql_id/timestamp/
    title/status/linked_changes/files/body_sections 等）；派生字段（author enrich、
    影响模块 module-map 推导、stale 判定）在查询时计算，**不入库**（D-005：避免
    「已暂存」语义固化、stale 阈值演进要刷数据）。

    ``(workspace_id, ql_id)`` 复合唯一约束支撑幂等 upsert（D-004）：同一 quick 会话
    的 CLI 重跑 ``--done`` 整条覆盖，不产生重复行。
    ``workspace_id`` 只由 shpsync_ token 派生（auth.py G6/D-004@v1 通道），payload 不含
    也不接受 workspace 字段——此处必填，无 shk_live_ 过渡期 NULL 场景。
    """

    __tablename__ = "quicklog_entries"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "ql_id",
            name="uq_quicklog_entries_workspace_ql",
        ),
    )

    id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            primary_key=True,
            nullable=False,
            default=uuid.uuid4,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    ql_id: str = Field(
        sa_column=Column(String(128), nullable=False),
    )
    payload: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
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


class AgentSessionLogORM(BaseModel, table=True):
    """CLI 推送的 agent 会话日志元信息行（design §3.1 / D-002 / D-003）。

    Change 2026-08-23-platform-agent-log-ingest task-01：承接 CLI ``sillyspec run``
    每次入口探测本地 harness 会话日志后的 best-effort POST 上报（协议
    ``docs/platform-agent-log-protocol.md``），只落**路径与元信息**、不落日志内容
    （内容解析由 daemon 按路径读文件，可选增强，本次不做）。

    只存结构化列、不存 payload JSON 原文（D-002）：协议明言「整行存 entries 元信息」，
    本表无派生逻辑、展示字段固定（quicklog 存 payload 是因为派生字段查询时算，此处
    不同）；CLI schema 升版的未知字段由 Pydantic ``extra=ignore`` 静默丢弃（不 422），
    字段演进靠 schema 升版加列。

    时间字段（``first_seen_at`` / ``last_seen_at`` / ``pushed_at``）存 CLI ISO 8601 UTC
    **原文 String**（D-003，对齐 ``last_pushed_at`` 先例避免时区/精度转换）：CLI 恒发
    UTC Z 格式 → 字符串字典序 = 时间序，比较/排序直接用，``last_seen_at`` 即列表排序键。

    ``(workspace_id, log_path)`` 复合唯一约束支撑幂等 upsert（design §3.2 D-005：CLI
    重跑整行覆盖，CLI 留底文件是 invocations 计数权威，服务端不自己累加）。
    ``workspace_id`` 只由 shpsync_ token 派生（auth.py D-004@v1 通道），无 shk_live_
    过渡期 NULL 场景，此处必填 NOT NULL；workspace 删则级联删本表行。
    ``log_path`` 存 CLI 上报原样（Windows 盘符/反斜杠，NFR-02）。

    Change 2026-08-23-agent-activity-sessions task-03（design §3.3.1 / FR-04）：加
    ``agent_session_id`` 列——会话化归属落点（design §3.3.3：body 级 hub_session_id
    命中直挂、无关联按 entry ctx 聚合 find-or-create，task-04 实现）。NULL = 未归属
    （存量行不回填，R-03）；ON DELETE SET NULL——会话删除不拖日志行（行属 workspace
    留底审计）。
    """

    __tablename__ = "platform_agent_logs"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "log_path",
            name="uq_platform_agent_logs_workspace_path",
        ),
        # 会话维度过滤（GET /api/agent-logs?session_id=，FR-08/§3.3.6）+ 归属回查。
        Index("ix_platform_agent_logs_agent_session_id", "agent_session_id"),
    )

    id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            primary_key=True,
            nullable=False,
            default=uuid.uuid4,
        ),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    log_path: str = Field(
        sa_column=Column(String(1024), nullable=False),
    )
    harness: str = Field(
        sa_column=Column(String(32), nullable=False),
    )
    # codex-rollout-jsonl 等 CLI 侧探测出的格式标识。
    format: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    # agent CLI 自身会话 id。
    session_id: str | None = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    # sillyhub-daemon / zcode / …（日志的产生方）。
    originator: str | None = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    # 探测通道（如 codex-session-meta-cwd）。
    detected_via: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    # entry 级 agent 工作目录。
    agent_cwd: str | None = Field(
        default=None,
        sa_column=Column(String(1024), nullable=True),
    )
    # 上报时文件存在性。
    exists: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False),
    )
    size_bytes: int | None = Field(
        default=None,
        sa_column=Column(BigInteger, nullable=True),
    )
    mtime_ms: float | None = Field(
        default=None,
        sa_column=Column(Float, nullable=True),
    )
    # 以下两个时间字段为 CLI ISO 8601 UTC 原文 String（D-003）。
    first_seen_at: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    last_seen_at: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    # CLI 侧累计调用次数（CLI 留底文件是计数权威，D-005）。
    invocations: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    # 只含 flag 名，不含参数值（协议 §7）。
    last_command: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    # 顶层 body 带下的扫描 run id（辅助归属）。
    scan_run_id: str | None = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    # 本行最近一次上报的 body.pushed_at（D-003 同款 String 原文）。
    pushed_at: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    # 2026-08-23-agent-activity-sessions task-03 / FR-04：所属平台会话（会话化归属，
    # design §3.3.3，归属写入在 task-04）。NULL = 未归属（存量行不回填，R-03）；
    # ON DELETE SET NULL——会话删除不拖日志行（行属 workspace 留底审计）。
    agent_session_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id", ondelete="SET NULL"),
            nullable=True,
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
