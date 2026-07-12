"""Pydantic schemas for daemon endpoints."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# ── Interactive session list / read (task-12, FR-10 / D-005@v1) ──────────────
# DTO for GET /api/daemon/sessions. Field nullability aligns with the actual
# AgentSession ORM (runtime_id / lease_id are nullable in model.py), so we do
# NOT coerce missing values into fake non-null strings.


class AgentSessionRead(BaseModel):
    id: uuid.UUID
    runtime_id: uuid.UUID | None
    lease_id: uuid.UUID | None
    provider: str
    status: str
    agent_session_id: str | None
    config: dict | None
    turn_count: int
    created_at: datetime
    last_active_at: datetime | None
    ended_at: datetime | None
    change_id: uuid.UUID | None
    workspace_id: uuid.UUID | None
    # 2026-07-11-unify-runtime-session-dialog / FR-08: 首条 user_input 摘要前 30 字，
    # 由 router 层注入（非 ORM 字段）；FR-05 deleted_at 软删时间戳（ORM 直接映射）。
    title: str | None = None
    deleted_at: datetime | None = None
    # 当前运行 run（attach 恢复 currentRunId，启用打断按钮；非 ORM 字段，router 注入）
    current_run_id: uuid.UUID | None = None

    model_config = {"from_attributes": True}


class AgentSessionListResponse(BaseModel):
    items: list[AgentSessionRead]
    total: int
    limit: int
    offset: int


# ── Change-scoped session list (2026-07-09-change-detail-session task-09 / D-005@v1) ─
# DTO for GET /api/workspaces/{wid}/changes/{cid}/sessions. Cross-member visible
# (D-005@v1): rows are scoped by change_id only, no user_id filter. Title is a
# clean user_input excerpt (X-04) extracted from the earliest AgentRunLog with
# channel="user_input" across the session's runs.


class ChangeSessionAuthor(BaseModel):
    """变更会话列表项的作者信息（D-005@v1 跨成员可见）。"""

    user_id: uuid.UUID
    display_name: str | None = None

    model_config = {"from_attributes": True}


class AgentSessionListItem(BaseModel):
    """变更级会话列表项（GET /workspaces/{wid}/changes/{cid}/sessions）。

    跨成员可见（D-005@v1），标题取自该会话最早一条 channel=user_input 的
    AgentRunLog 摘要（前 30 字，X-04 干净来源）。
    """

    id: uuid.UUID
    provider: str
    status: str
    turn_count: int
    author: ChangeSessionAuthor
    last_active_at: datetime | None
    title: str | None

    model_config = {"from_attributes": True}


class SessionReopenResponse(BaseModel):
    """Response body for POST /sessions/{id}/reopen (task-05 / FR-2).

    ``status`` is the backend-side placeholder state immediately after a
    successful reopen request — the daemon runs the SDK resume asynchronously
    (task-07 drives the full lease/WS transition, task-08 the daemon SDK
    resume), so the endpoint never blocks on daemon confirmation (design §4.3.1
    step 7).
    """

    session_id: str
    status: str


# ── Register ────────────────────────────────────────────────────────────────


class DaemonRegisterProviderItem(BaseModel):
    """单个 provider 上报项（per-daemon register body 内 ``providers[]`` 元素）。

    design §5.2：daemon 一次性上报其探测到的所有 provider，后端为每个 provider
    upsert 一行 daemon_runtimes。
    """

    provider: str = Field(min_length=1, max_length=50)
    version: str | None = Field(default=None, max_length=50)
    status: str = Field(default="online", max_length=20)


class DaemonRegisterRequest(BaseModel):
    """Per-daemon 注册请求体（design §5.2 / D-006）。

    daemon 启动一次性上报其 ``daemon_local_id``（=本地 config.runtime_id，后端
    不自生成）+ 机器级字段 + 探测到的 provider 列表。后端先 upsert
    daemon_instances，再为每个 provider upsert daemon_runtimes，并清理 stale runtime。

    WS breaking（D-007）：旧 daemon 按 per-provider body 上报（无 daemon_local_id）
    → pydantic 校验 daemon_local_id 必填失败 → 422 拒绝。
    """

    daemon_local_id: uuid.UUID = Field(description="daemon 本地 uuid，复用身份")
    server_url: str = Field(max_length=255)
    hostname: str = Field(max_length=255)
    os: str | None = Field(default=None, max_length=50)
    arch: str | None = Field(default=None, max_length=50)
    # daemon 自身版本（2026-07-04-daemon-version-management D-001）。
    # daemon_version=语义版本（DAEMON_VERSION），daemon_build_id=git SHA（BUILD_ID）。
    # Optional 兼容旧 daemon（不上报则 NULL，D-008）。
    daemon_version: str | None = Field(default=None, max_length=50)
    daemon_build_id: str | None = Field(default=None, max_length=50)
    allowed_roots: list[str] = Field(default_factory=lambda: ["~/.sillyhub"])
    providers: list[DaemonRegisterProviderItem] = Field(min_length=1)


class DaemonRegisterRuntimeItem(BaseModel):
    """register 响应内单个 provider 的运行时映射。"""

    provider: str
    runtime_id: uuid.UUID
    allowed_roots: list[str] = Field(default_factory=list)


class DaemonRegisterResponse(BaseModel):
    """Per-daemon 注册响应（design §5.2 step 5）。

    daemon 侧缓存 ``runtimes`` 的 ``runtime_id``，用于后续 WS payload 标识
    具体 provider 会话（连接路由按 daemon_id，但单条 WS 内仍需 runtime_id 分发）。
    """

    daemon_instance_id: uuid.UUID
    runtimes: list[DaemonRegisterRuntimeItem]


class OwnerRead(BaseModel):
    """Nested owner DTO for platform-admin global views (task-04 / D-006@v1).

    Populated by list endpoints via JOIN ``users``; detail endpoints may
    leave it ``None``.
    """

    user_id: uuid.UUID | None = None
    email: str | None = None
    display_name: str | None = None


class DaemonRuntimeRead(BaseModel):
    """Response body for daemon runtime info.

    2026-07-03-daemon-entity-binding task-05：机器级字段（os / arch / capabilities /
    allowed_roots / display_alias）已上提到 daemon_instances（design §4.2），本 DTO
    这些字段保留为 optional 占位（default=None / default_factory），让现有返回该
    DTO 的端点（disable / enable / get / list / update）在 runtime 行不含这些列时
    不崩。语义正确的机器级视图由后续 daemon_instance Read 承载（task-06/前端）。
    """

    id: uuid.UUID
    # 所属守护进程实体（design §4.2）。前端 workspace-access-guide 等靠这个字段
    # 解析 daemon_id 写 PUT /my-binding（缺失会 fallback runtime_id → daemon_not_owned 403）。
    daemon_instance_id: uuid.UUID | None = None
    # 机器级，已挪到 daemon_instances；此处占位 default=None 防 model_validate 崩。
    display_alias: str | None = None
    name: str | None
    provider: str | None
    version: str | None
    # daemon 进程版本（2026-07-04-daemon-version-management D-005），JOIN daemon_instances 带出。
    # 区别于 version（= provider/agent CLI 版本）。default None 兼容不 JOIN 的端点。
    daemon_version: str | None = None
    daemon_build_id: str | None = None
    os: str | None = None
    arch: str | None = None
    status: str | None
    last_heartbeat_at: datetime | None
    capabilities: dict | None = None
    # 机器级沙箱，已挪到 daemon_instances；占位 default。
    allowed_roots: list[str] = Field(default_factory=lambda: ["~/.sillyhub"])
    owner: OwnerRead | None = None
    created_at: datetime
    updated_at: datetime

    @field_validator("allowed_roots", mode="before")
    @classmethod
    def _coerce_none_roots(cls, v: object) -> list[str]:
        # 2026-07-06-allowed-roots-per-runtime：DB runtime.allowed_roots 可能为 NULL
        # （disabled/stale runtime 无 daemon_instance，迁移 copy 不到 default）→ []
        return [] if v is None else v  # type: ignore[return-value]

    model_config = {"from_attributes": True}


class DaemonRuntimeUpdate(BaseModel):
    """Request body for PATCH /api/daemon/runtimes/{runtime_id} (task-04 / D-002@v1).

    ``display_alias`` 省略 = 不变；显式 ``null`` = 清空；字符串 = 更新。
    """

    display_alias: str | None = Field(default=None, max_length=200)


class DaemonRuntimeAllowedRootsUpdate(BaseModel):
    """Request body for PUT /api/daemon/runtimes/{runtime_id}/allowed-roots.

    2026-06-29-runtime-allowed-roots-config task-02：admin 配置可访问目录沙箱。
    每条路径绝对路径或 ``~`` 开头（daemon 侧展开 homedir）；后端只校验格式。
    """

    allowed_roots: list[str] = Field(min_length=1, max_length=50)


class DaemonRuntimeListResponse(BaseModel):
    """Response body for GET /api/daemon/runtimes/page (task-04 / FR-04)."""

    items: list[DaemonRuntimeRead]
    total: int
    limit: int
    offset: int


# ── Daemon instances list ─────────────────────────────────────────────────────
# DTO for GET /api/daemon/instances (task-10 / FR-09). Used by the frontend
# workspace-daemon-switcher to list online daemon instances for the current user.


class DaemonInstanceProviderItem(BaseModel):
    """A single provider runtime nested under a daemon instance.

    ``provider`` is the provider slug (e.g. "claude", "codex").
    ``status`` is the runtime status within this daemon.
    """

    provider: str
    status: str
    version: str | None = None


class DaemonInstanceRead(BaseModel):
    """Frontend-oriented daemon instance DTO with nested provider info.

    Used by GET /api/daemon/instances for the workspace-daemon-switcher
    (task-10, design §7). Includes the list of provider runtimes so the
    frontend can render provider badges without an extra HTTP round-trip.
    """

    id: uuid.UUID
    hostname: str
    display_alias: str | None = None
    status: str
    # daemon 进程版本（2026-07-04-daemon-version-management D-005），from_attributes 自动映射。
    version: str | None = None
    build_id: str | None = None
    providers: list[DaemonInstanceProviderItem] = Field(default_factory=list)


# ── Daemon machines（machine→runtime 两级）─────────────────────────────────
# 2026-07-07-daemon-machine-runtime-hierarchy task-01：entity-binding 已把机器级
# 字段（hostname/os/arch/version/build_id/allowed_roots/status/last_heartbeat_at/
# display_alias）上提到 daemon_instances（design §4），本组 DTO 直接读 instance 行
# + 嵌套其下 runtimes，作为机器级聚合读视图（GET /api/daemon/machines 响应 +
# PATCH /api/daemon/machines/{id} 请求体）。组装逻辑见 task-02/03，本卡只定义契约。


class DaemonMachineRead(BaseModel):
    """机器级聚合读视图 DTO（design §5.1 / task-01）。

    一行 = 一台 daemon 机器（daemon_instances），机器级字段直接读 instance 行；
    其下 runtimes 嵌套该机器全部 daemon_runtimes（含各自 capabilities/allowed_roots）。
    派生 runtime_count / online_runtime_count 由 service 层组装时填入。
    """

    id: uuid.UUID
    hostname: str
    display_alias: str | None = None
    os: str | None = None
    arch: str | None = None
    status: str
    last_heartbeat_at: datetime | None
    # daemon 语义版本，来自 daemon_instance.version（不是 provider/agent CLI 版本）。
    version: str | None = None
    # daemon 构建 SHA，来自 daemon_instance.build_id（区别于 version 的语义版本）。
    build_id: str | None = None
    created_at: datetime
    owner: OwnerRead | None = None  # JOIN users（admin 全局视图带出负责人）
    runtime_count: int  # 该 instance 下 runtime 总数
    online_runtime_count: int  # status=='online' 的 runtime 数
    runtimes: list[DaemonRuntimeRead] = Field(default_factory=list)  # 该机器全部 runtime

    model_config = {"from_attributes": True}


class DaemonMachineUpdate(BaseModel):
    """Request body for PATCH /api/daemon/machines/{instance_id}（design §5.2 / D-001）。

    ``display_alias`` 省略 = 不变；显式 ``null``/空白 = 清空（与 runtime 级
    ``DaemonRuntimeUpdate`` 语义一致）。
    """

    display_alias: str | None = Field(default=None, max_length=200)


class DaemonMachineListResponse(BaseModel):
    """Response body for GET /api/daemon/machines（design §5.1 / FR-1）。

    机器级分页（默认 20/页，D-007），机器卡永不跨页断裂。
    """

    items: list[DaemonMachineRead]
    total: int
    limit: int
    offset: int


# ── Heartbeat ───────────────────────────────────────────────────────────────


# [DEPRECATED] 旧 per-runtime heartbeat body（runtime_id 版本），已被 router.py 内联的
# per-daemon DaemonHeartbeatRequest（daemon_local_id 版本，design §5.4 / D-006）取代，
# 不再被任何端点使用。保留仅为历史参考，勿复用。
# 2026-07-04-daemon-version-management 核实（R-01 命名冲突，生效版在 router.py:152）。
class DaemonHeartbeatRequest(BaseModel):
    """[DEPRECATED] 旧 per-runtime heartbeat body，已被 per-daemon 版本取代。"""

    runtime_id: uuid.UUID


class DaemonHeartbeatResponse(BaseModel):
    """Response body for HTTP heartbeat."""

    runtime_id: uuid.UUID
    status: str
    pending_operations: dict | None = None
    # 2026-06-29-runtime-allowed-roots-config task-03：daemon 心跳拉取同步本地 config
    allowed_roots: list[str] = Field(default_factory=list)


# ── Lease claim ─────────────────────────────────────────────────────────────


class LeaseClaimRequest(BaseModel):
    """Request body for claiming a task lease."""

    runtime_id: uuid.UUID


class LeaseClaimResponse(BaseModel):
    """Response body for a successful lease claim."""

    lease_id: uuid.UUID
    claim_token: str
    payload: dict  # execution context
    lease_expires_at: datetime | None  # None for interactive leases (no expiry)


# ── Lease lifecycle ─────────────────────────────────────────────────────────


class LeaseStartRequest(BaseModel):
    """Request body for marking a lease as started."""

    claim_token: str


class LeaseStartResponse(BaseModel):
    """Response body for lease start."""

    lease_id: uuid.UUID
    status: str


class LeaseHeartbeatRequest(BaseModel):
    """Request body for lease heartbeat."""

    claim_token: str


class LeaseHeartbeatResponse(BaseModel):
    """Response body for lease heartbeat."""

    lease_id: uuid.UUID
    status: str


class LeaseCompleteRequest(BaseModel):
    """Request body for lease completion."""

    claim_token: str
    result: dict  # {status, patch?, stats?}


class LeaseCompleteResponse(BaseModel):
    """Response body for lease completion."""

    lease_id: uuid.UUID
    status: str


# ── Lease messages ──────────────────────────────────────────────────────────


class LeaseMessagesRequest(BaseModel):
    """Request body for submitting agent messages for a lease.

    2026-06-24-daemon-network-resilience task-19（FR-08 / D-001@v2）：每条 message dict
    可选携带 ``dedup_key``（daemon ResilienceService 注入到 message 顶层），run_sync
    submit_messages 据此幂等去重（task-21）。无类型约束（list[dict]），dedup_key 缺失
    时当 None → 不约束（旧 daemon 兼容）。
    """

    claim_token: str
    agent_run_id: uuid.UUID
    messages: list[dict]


class LeaseMessagesResponse(BaseModel):
    """Response body for lease messages submission."""

    accepted: bool
    count: int


# ── Lease read ──────────────────────────────────────────────────────────────


class DaemonTaskLeaseRead(BaseModel):
    """Response body for lease info."""

    id: uuid.UUID
    runtime_id: uuid.UUID | None
    agent_run_id: uuid.UUID | None
    status: str | None
    claimed_at: datetime | None
    lease_expires_at: datetime | None
    attempt_number: int | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Lease sync ──────────────────────────────────────────────────────────────


class LeaseSyncRequest(BaseModel):
    """Request body for syncing AgentRun status from daemon."""

    claim_token: str
    status: str  # running, completed, failed, killed
    error: str | None = None


class LeaseSyncResponse(BaseModel):
    """Response body for lease status sync."""

    agent_run_id: uuid.UUID | None
    status: str


# ── list-dir (WS RPC forwarding, design §7.2 / task-04) ──────────────────────


class DirEntry(BaseModel):
    """A single directory entry returned by the daemon list_dir RPC."""

    name: str
    type: Literal["dir", "file"]


class ListDirRequest(BaseModel):
    """Request body for POST /runtimes/{runtime_id}/list-dir."""

    path: str = Field(min_length=1, description="daemon 客户端机器上的绝对路径")


class ListDirResponse(BaseModel):
    """Response body for POST /runtimes/{runtime_id}/list-dir."""

    entries: list[DirEntry]


class ListRootsResponse(BaseModel):
    """POST /runtimes/{runtime_id}/list-roots 响应：daemon 主机磁盘根锚点列表。"""

    roots: list[str]


# ── Runtime usage stats (FR-03 / D-002@v1) ─────────────────────────────────
# GET /api/daemon/runtimes/usage?window=1d|7d|30d 的响应 schema。
# ts 粒度由 service 层 date_trunc 决定:1d→hour 桶(24 点),7d/30d→day 桶(D-002@v1)。


class RuntimeUsageWindow(enum.StrEnum):
    """时间窗选项(FR-03 / D-002@v1)。"""

    DAY1 = "1d"
    DAY7 = "7d"
    DAY30 = "30d"


# 给 service 层类型注解用(Literal 比 Enum 更轻,内部函数签名用 Literal)。
RuntimeUsageWindowLiteral = Literal["1d", "7d", "30d"]


class RuntimeUsageSummaryRead(BaseModel):
    """单 runtime 在时间窗内的 token/cache/cost 聚合总量。

    聚合后已 COALESCE 归 0,字段非可选(FR-05 NULL 兼容在 SUM(COALESCE(...,0)) 处理)。
    """

    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_creation_tokens: int
    total_cost_usd: float


class RuntimeUsagePointRead(BaseModel):
    """时间桶点(1d 小时桶 / 7d·30d 日桶,D-002@v1)。

    ts 来自 PG ``date_trunc('hour'/'day', created_at)``,为 aware datetime。
    """

    ts: datetime
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_creation_tokens: int
    total_cost_usd: float


class RuntimeUsageRead(BaseModel):
    """单 runtime 的用量记录(summary 总量 + daily 时间序列)。"""

    runtime_id: str
    summary: RuntimeUsageSummaryRead
    daily: list[RuntimeUsagePointRead]


class RuntimeUsageListResponse(BaseModel):
    """GET /api/daemon/runtimes/usage 顶层响应(design §7)。"""

    window: str
    runtimes: list[RuntimeUsageRead]


# ── Change-write task queue (task-09, FR-08 / D-004@v1) ─────────────────────
# daemon-client workspace 的 change 代写任务队列回执：daemon 轮询
# GET /runtimes/{rid}/pending-change-writes → claim(token)→ 本地写 → complete 回执。
# 复用 lease claim/complete 风格，token 轮转 + status pending→claimed→done/failed。


class ChangeWritePendingItem(BaseModel):
    """GET pending-change-writes 返回的单条待处理 change-write。"""

    # task-09 蓝图称 task_id，对齐 lease 术语；底层即 DaemonChangeWrite.id（表无
    # 独立 task_id 列，design §7.5 payload 只含 change_key+files）。
    task_id: uuid.UUID
    change_key: str
    workspace_id: uuid.UUID
    files: list
    created_at: datetime
    # create=新变更代写 / edit=现有文件手动编辑（2026-07-02-change-detail-file-tree-editor D-001）
    kind: str = "create"


class ChangeWriteClaimResponse(BaseModel):
    """POST .../change-writes/{id}/claim 回执：daemon 凭 claim_token 调 complete。"""

    task_id: uuid.UUID
    claim_token: str
    change_key: str
    files: list
    kind: str = "create"


class ChangeWriteCompleteRequest(BaseModel):
    """POST .../change-writes/{id}/complete 请求体。"""

    claim_token: str
    ok: bool
    # 回执写后的实际文件路径清单（可选，落库时回写 files）
    files: list | None = None
    error: str | None = None
