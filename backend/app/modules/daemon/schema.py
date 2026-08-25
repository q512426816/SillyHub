"""Pydantic schemas for daemon endpoints."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

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
    # ql-20260817-003：会话属主（前端消息时间线据此判断「我」；列表本就 user 隔离）。
    user_id: uuid.UUID | None = None
    workspace_id: uuid.UUID | None
    # 2026-07-11-unify-runtime-session-dialog / FR-08: 首条 user_input 摘要前 30 字，
    # 由 router 层注入（非 ORM 字段）；FR-05 deleted_at 软删时间戳（ORM 直接映射）。
    title: str | None = None
    deleted_at: datetime | None = None
    # 2026-08-24：会话归档时间戳（archived_at）。NULL = 可见；非 NULL = 已归档。
    archived_at: datetime | None = None
    # 当前运行 run（attach 恢复 currentRunId，启用打断按钮；非 ORM 字段，router 注入）
    current_run_id: uuid.UUID | None = None
    # 2026-08-05-daemon-kill-channel-unify task-13 / FR-04 / design §5 Phase4：
    # lease 处于 terminating 态的时间戳（cancel_lease 写入、daemon 回传统态后清空）。
    # 非 ORM 字段——AgentSession 本身没有该列，由 router 经 session.lease_id 关联
    # 查 DaemonTaskLease.terminating_at 注入。默认 None 守护 brownfield（无 lease /
    # lease.terminating_at 为空 → None），让前端据此显示「终止中…」而非立刻「已停止」。
    terminating_at: datetime | None = None
    # ── 会话配置三列（2026-08-14-sessions-portal task-02 / FR-04 / D-008@v1） ──
    # 对应 AgentSession ORM 三列（task-01）：显式绑定的档案/供应商 FK + 冻结的
    # 配置快照 JSON（profile_name/provider_name/model/engine/machine_name/
    # agent_name，design §5 Grill C-12），供前端列表 chips 直显免二次查询。
    # from_attributes 直接映射；默认 None 守护列缺失/未写入的旧行。
    agent_profile_id: uuid.UUID | None = None
    llm_provider_id: uuid.UUID | None = None
    config_snapshot: dict | None = None
    # 2026-08-23-sessions-workspace-hub task-01 / FR-05 / D-108@v2：属主用户名
    # （门户列表显示会话归属）。非 ORM 列——由 router 层批量查 users.username
    # 注入（照 OwnerRead + 本端点 terminating_at 的批量注入先例，避免 N+1）；
    # 属主用户行缺失 / username 未回填的旧数据一律走默认 None（brownfield 不崩）。
    owner_name: str | None = None
    # 2026-08-23-agent-activity-sessions task-05（design §3.3.2/§3.3.4 / FR-03）：
    # 会话来源列（task-03 落列）——'chat'（平台对话会话，存量行为）|
    # 'tool_report'（CLI 工具上报聚合的「本地 Agent 会话」，前端据此渲染 🧾
    # 「本地 Agent」徽标 + 纯日志主体）。from_attributes 直接映射（列表/详情
    # 同一映射路径自动下发）；默认 'chat' 守护列缺失的旧行。
    origin: str = "chat"
    # 2026-08-26-subsession-portal-grouping（P3 / design §4.A）：会话树归属两列
    # （P1 迁移 20260825210000 落列）——parent_session_id 非空即分身子会话（门户
    # 列表据此折叠进父行附属组）；tree_depth 0=主控/普通、1=分身、2=孙（P2）。
    # from_attributes 直接映射，零查询改动；默认值守护映射前的旧响应。
    parent_session_id: uuid.UUID | None = None
    tree_depth: int = 0

    model_config = {"from_attributes": True}


class AgentSessionListResponse(BaseModel):
    items: list[AgentSessionRead]
    total: int
    limit: int
    offset: int


# ── Interactive session create / inject request DTO（2026-08-14-sessions-portal
# task-02 / FR-01 / D-010@v1 / D-011@v1）─────────────────────────────────────
# 从 router.py inline 定义（原 :1573/:1591）迁为具名模型，openapi 产出具名 schema
# 供前端 pnpm gen:types（task-17）。校验语义完整继承 inline 版：prompt
# min/max_length、provider Literal（值非空时仍只收 claude/codex）。

# 交互式会话 provider 枚举（与原 router inline 版一致；Literal 校验保留）。
InteractiveProviderLiteral = Literal["claude", "codex"]

# ── 预会话团队任务块（2026-08-24-session-team-mission-context task-07 / design
# §5.E1/§7 / FR-05/06）─────────────────────────────────────────────────────────
# SessionCreateRequest.team_mission 的内嵌块。六字段形态**逐字对齐**下方
# TeamMissionTriggerRequest（schema.py:713-730，list[dict]/dict/UUID 口径，不
# 新造 WorkerPresetItem 等类），新增第七字段 orchestrator_workspace_id（主
# agent 工作区 ∈ scope；null=当前会话默认）。scope/项目维度校验走 trigger
# 端点同款共享函数（router.validate_team_mission_block）。


class TeamMissionCreateBlock(BaseModel):
    """``SessionCreateRequest.team_mission`` 内嵌块（design §5.E1/§7）。

    - ``objective`` 可空——create 路径为空时用首句 prompt 回填（task-09）；
    - 其余五字段与 TeamMissionTriggerRequest 同名同 annotation 同约束（上限
      /ge=0/UUID 口径逐字一致），校验复用共享函数（单一实现无复制粘贴）；
    - ``orchestrator_workspace_id`` 本卡只透传不校验语义——∈ scope 与
      (W, 创建者) binding 钉定归 create 消费侧（task-09）。
    """

    objective: str | None = Field(default=None, max_length=8000)
    scope_workspace_ids: list[uuid.UUID] | None = Field(default=None, max_length=20)
    project_id: uuid.UUID | None = None
    budget_usd: float | None = Field(default=None, ge=0)
    worker_preset: list[dict] | None = Field(default=None, max_length=20)
    main_agent_config: dict | None = None
    orchestrator_workspace_id: uuid.UUID | None = None


class PageContextCreateBlock(BaseModel):
    """``SessionCreateRequest.page_context`` 内嵌块（2026-08-25-unified-floating-session / FR-5 / D-005）。

    悬浮会话入口的页面上下文通道：客户端只允许声明「页面类型枚举 + 键」，
    前导文本的全部数据由服务端生成（DB 回查 / 注册表 Lookup，防客户端伪造
    注入——自由文本字段一律不收）。三类：
    - ``ppm_project``：PPM 项目详情页（task-01），需 ``project_id``（服务端
      回查 PpmProjectMaintenance 注入项目数据）；
    - ``generic_page``：通用页面（task-09），需 ``route_key``——后端
      ``PAGE_ROUTE_LABELS`` 注册表 Lookup 出页面中文名注入；未注册 key →
      静默不注入（枚举语义，零自由文本）；
    - ``workspace``：工作区详情页（task-10，用户实测反馈"工作区页只注入
      笼统标签不知道是哪个"），需 ``workspace_id``——服务端回查 Workspace
      注入名称/类型/路径。
    """

    page_key: Literal["ppm_project", "generic_page", "workspace"]
    project_id: uuid.UUID | None = None
    route_key: str | None = Field(default=None, max_length=60, pattern=r"^[a-z0-9][a-z0-9_:-]*$")
    workspace_id: uuid.UUID | None = None
    # 用户反馈⑧：工作区详情子页面键（WORKSPACE_TAB_LABELS 注册表 Lookup；
    # 缺省 None → workspace_detail 总览说明书）。
    tab_key: str | None = Field(default=None, max_length=60, pattern=r"^[a-z0-9][a-z0-9_:-]*$")

    @model_validator(mode="after")
    def _require_kind_specific_field(self) -> "PageContextCreateBlock":
        if self.page_key == "ppm_project" and self.project_id is None:
            raise ValueError("project_id is required when page_key is ppm_project")
        if self.page_key == "generic_page" and not self.route_key:
            raise ValueError("route_key is required when page_key is generic_page")
        if self.page_key == "workspace" and self.workspace_id is None:
            raise ValueError("workspace_id is required when page_key is workspace")
        return self


class SessionCreateRequest(BaseModel):
    """POST /api/daemon/sessions 请求体（FR-01 / design §5 Wave1）。

    双入口：``runtime_id``（新会话门户页，指定机器+智能体，优先）与 ``provider``
    （/runtimes 弹窗旧路径，零回归保留）二选一，都未传 → 422。
    ``model`` 字段已移除（design §5：由档案/默认派生，继承 D-005/D-004@v2）——
    pydantic 默认忽略多余字段，旧前端继续上送 model 不会 422，仅不再生效。
    ``agent_profile_id``/``llm_provider_id`` 由 service 层解析（task-03），
    本 DTO 只透传 str（llm_provider_id 空串/"none" 语义=切回本机默认，task-05）。
    """

    prompt: str = Field(min_length=1, max_length=8000)
    # 新页面双入口：指定 runtime（优先于 provider；解析归 task-03）。
    runtime_id: str | None = None
    # /runtimes 弹窗旧路径（D-002 零回归）：值非空时仍只收 claude/codex。
    provider: InteractiveProviderLiteral | None = None
    agent_profile_id: str | None = None
    llm_provider_id: str | None = None
    # 新页面默认更安全的对话模式（design §5）；现有前端弹窗均显式传 true，不受影响。
    manual_approval: bool = True
    ask_user_only: bool = True
    change_id: uuid.UUID | None = None
    workspace_id: uuid.UUID | None = None
    # task-08（2026-08-25-session-spec-binding / FR-04 / FR-06）：快速修复短码
    # quicklog_id——ql_id 字符串（``ql-YYYYMMDD-NNN-后缀``，非 UUID，D-001@v1
    # 自然键）。携带时创建落库点补写 quicklog_session_links（bind_session_to_
    # quicklog savepoint best-effort，失败不阻断 201）；max_length=128 对齐
    # QuicklogSessionLink.ql_id 列宽。不做条目存在性校验（无 FK，条目行后到
    # 合法，D-001@v1）。缺省 None 零分支进入（零回归，不影响二选一校验）。
    quicklog_id: str | None = Field(default=None, max_length=128)
    # 预会话团队任务块（design §5.E1 / FR-05/06）：缺省 None——不带 team_mission
    # 的旧请求体校验行为逐字节不变（不影响下方 runtime_id/provider 二选一）；
    # 消费（预建 mission / orchestrator_workspace_id ∈ scope 校验）归 create
    # 路径（task-09）。
    team_mission: TeamMissionCreateBlock | None = None
    # 悬浮会话页面上下文（FR-5 / D-005）：缺省 None 零回归；数据服务端回查。
    page_context: PageContextCreateBlock | None = None

    @model_validator(mode="after")
    def _require_runtime_or_provider(self) -> SessionCreateRequest:
        # design §5「与 provider 二选一，优先 runtime_id」：两者都缺 → 422，
        # 防止 provider=None 落到 NOT NULL 的 agent_sessions.provider 列。
        if not self.runtime_id and not self.provider:
            raise ValueError("either runtime_id or provider must be provided")
        return self


class SessionInjectRequest(BaseModel):
    """POST /api/daemon/sessions/{id}/inject 请求体（FR-02 / design §5 Wave1）。

    ``agent_profile_id`` 非空且 ≠ 会话当前档案 → 切档案；``llm_provider_id``
    非空且 ≠ 当前 → 切供应商（空串/"none" 语义=切回本机默认）。切换校验与
    SESSION_SWITCH_CONFIG 下发归 task-05，本 DTO 只透传。

    ql-20260817-010：**静默切换**——携带切换字段时 prompt 可为空串（切换轮
    不产生用户消息与模型回应，daemon 只 reload 配置）；纯追问（无切换字段）
    仍要求非空 prompt。

    2026-08-20-session-multimodal-attachments task-05：``attachment_ids`` 附件
    引用（上传端点产出的 SessionAttachment id）；**D-7 豁免**——附件非空时
    prompt 可为空（看图说话）；上限 10 = 图片 5 + 文件 5（逐 kind 校验归
    service，DTO 层总量兜底）。
    """

    prompt: str = Field(default="", max_length=8000)
    agent_profile_id: str | None = None
    llm_provider_id: str | None = None
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)
    # ql-20260825-004：每轮注入携带当前页面上下文——客户端传页面类型枚举+键，
    # 服务端回查注入【页面上下文】前导（复用 create 路径 build_page_context_preamble）。
    page_context: PageContextCreateBlock | None = None

    @model_validator(mode="after")
    def _require_prompt_or_switch(self) -> "SessionInjectRequest":
        if (
            not self.prompt.strip()
            and self.agent_profile_id is None
            and self.llm_provider_id is None
            and not self.attachment_ids
        ):
            raise ValueError("prompt is required when no config switch is requested")
        return self


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
    mode: str | None = None
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
    # daemon 进程启动时间（2026-08-05-daemon-start-time D-002@v1）。
    # daemon 启动时一次性上报，backend 写 daemon_instances.started_at。
    # Optional 兼容旧 daemon（不上报则 NULL）。
    started_at: datetime | None = Field(default=None)
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
    # daemon 进程启动时间（2026-08-05-daemon-start-time D-002@v1），JOIN
    # daemon_instances.started_at 带出。default None 兼容不 JOIN 的端点 / 旧 daemon。
    started_at: datetime | None = None
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
    """Request body for syncing AgentRun status from daemon.

    2026-08-25 会话审查 P1：``status`` 收紧为 Literal 枚举（原裸 ``str`` 任意
    字符串可落库）。取值集与 service 处理分支一一对应（running / completed /
    failed / killed）；daemon 侧唯一上报点 task-runner.ts 心跳 cancel 检测只发
    ``'killed'``，枚举全集兼容既有合法路径，非法值由 Pydantic 直接 422。
    """

    claim_token: str
    status: Literal["running", "completed", "failed", "killed"]
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


class ChangeWriteProgressRequest(BaseModel):
    """PATCH .../change-writes/{id}/progress 请求体（FR-05/FR-06，ql-20260813-spec-sync-visibility）。

    daemon spec-sync 执行中上报同步进度计数。D-004 单一写者：本端点写 files_total/
    files_processed，complete_change_write 不碰计数列。仅更新传入的非 None 字段。
    """

    claim_token: str
    files_total: int | None = None
    files_processed: int | None = None


# ── Session team mission（2026-08-22-team-session-unify task-03 / design §7）──
# 会话内团队能力的触发/列表契约：POST /api/daemon/sessions/{id}/team-mission
# 预建 mission（scope 冻结快照 + objective 空落占位），GET .../team-missions 供
# 前端 TeamTaskBlock 轮询。DTO 不含 anchor_workspace_id——anchor 由服务端按
# scope 派生（backend-code 优先，对齐旧项目端点口径）。


class TeamMissionTriggerRequest(BaseModel):
    """POST /api/daemon/sessions/{session_id}/team-mission 请求体（design §7）。

    - ``objective`` 可空：空则落库占位 ``SESSION_OBJECTIVE_PLACEHOLDER``
      （orchestrator.py），首条 inject 后回填（CC-09）；
    - ``scope_workspace_ids`` 可空：None=会话绑定工作区；会话无工作区且未传
      → 422（CC-10 同款语义）；上限 20 对齐 mission_schema.py 既有口径；
    - ``project_id`` 项目维度（仅项目经理/超管可建，scope ⊆ 项目关联工作区）；
    - ``worker_preset`` / ``main_agent_config`` 沿用 mission_schema.py:30-37 既有
      形态（list[dict] / dict）与上限。
    """

    objective: str | None = Field(default=None, max_length=8000)
    scope_workspace_ids: list[uuid.UUID] | None = Field(default=None, max_length=20)
    project_id: uuid.UUID | None = None
    budget_usd: float | None = Field(default=None, ge=0)
    worker_preset: list[dict] | None = Field(default=None, max_length=20)
    main_agent_config: dict | None = None


class TeamWorkspaceRef(BaseModel):
    """TeamMissionSummary.scope_workspaces 单项——scope 工作区 id+名称。

    ql-20260825-003：范围徽标名称化（前端只拿 id 时回落 #<id8> 原始徽标）。
    name 查无 Workspace 行时为 None（前端回落 id 徽标）。
    """

    id: str
    name: str | None = None


class TeamMissionWorkerSummary(BaseModel):
    """TeamMissionSummary.workers 单项——分身行（双形态）概要。

    - 存量 batch 形态：分身 run（role != orchestrator）逐行，``run_id`` = run id；
    - 新形态（task-13 / design §5.E，2026-08-25-team-subsession-governance）：
      分身**子会话**行——``sub_session_id`` = 子会话 id（定名避开与
      ``AgentSession.agent_session_id``（SDK 字符串 id）同名异义，Grill P2⑨）；
      ``run_id`` = 首 run id、``first_run_id`` = 首 run id（design §6 实现级
      备注：供 ``get_worker_result`` 连续消费）、role/objective 取首 run 双标记、
      status 按 ``is_worker_complete`` / ``mission_derive_status`` 口径映射；
    - 存量形态两新字段恒 None（存量响应字段零变化，FR-08/FR-09）；
    - ``sub_workers_count``（2026-08-26-team-subsession-recursion task-08 /
      design §5.E）：一层分身的**孙后代折叠计数**——router 按
      ``mission_worker_sessions_tree`` 全树枚举的 parent 关系聚合该分身在树中
      的后代数（含孙及更深，脏数据截断内）。展示保持一层直查（workers 行不
      展开孙层明细，门户分组等 UI 留 P3）；仅**有后代**的一层分身行填值，
      存量 batch 行 / 无孙分身保持默认 None（FR-08 存量零变化）。
    """

    run_id: uuid.UUID
    role: str | None = None
    status: str
    objective: str | None = None
    workspace_id: str | None = None
    sub_session_id: uuid.UUID | None = None
    first_run_id: uuid.UUID | None = None
    sub_workers_count: int | None = None
    # UX 走查 ③（2026-08-26 前端易用性修复）：运行中分身的最新动作预览——
    # 该子会话最新一条日志行的截断摘要（agent_run_logs 经 agent_runs.
    # agent_session_id join，批量一次查询），让用户不点进浮层就能看到
    # "正在干什么"。仅 running 行填值；completed/failed/存量 batch 行 None。
    latest_action: str | None = None


class TeamMissionSummary(BaseModel):
    """触发/列表共用响应（design §7）。

    ``status`` 为扩展后 derive_status 派生值（含 awaiting_input 档，会话维度
    入参）；``workers`` 为分身行——子会话形态行（含 sub_session_id）∪ 存量
    batch 分身 run（role != orchestrator，主控轮 D-009 不进；task-13 双形态）；
    ``scope_workspace_ids`` 为落库冻结快照（NULL 缺省回落 [anchor]）；
    ``scope_workspaces`` 为 id+名称 enriched 视图（ql-20260825-003）。
    """

    mission_id: uuid.UUID
    status: str  # planning|running|awaiting_input|done|degraded|failed|cancelled
    objective: str | None
    scope_workspace_ids: list[str]
    scope_workspaces: list[TeamWorkspaceRef] = Field(default_factory=list)
    budget_usd: float | None
    workers: list[TeamMissionWorkerSummary] = Field(default_factory=list)


# ── Plan / bash / agent_task SSE 事件与 plan 响应 DTO ─────────────────────────
# （2026-08-24-platform-session-feedback-fix task-01 / design §接口定义）
# daemon 经 HTTP 上报、后端转 Redis pub/sub（agent_session:{id} 频道）推前端
# 的实时事件契约，外加前端 plan 响应请求体（task-02 plan-response 端点复用）。
# 事件不落库（design §数据模型：无新增持久化表，历史回放依赖 AgentRunLog 流）。


class PlanSummary(BaseModel):
    """PlanModeEnteredEvent.summary——plan 模式计划概要。"""

    objective: str
    tasks: list[str]
    design_snippet: str | None = None


class PlanModeEnteredEvent(BaseModel):
    """``plan_mode_entered`` 事件——Agent 进入 plan 模式请求确认（FR-01）。

    前端收到后渲染 PlanApprovalCard，会话进入 plan_pending 态。
    """

    event: Literal["plan_mode_entered"] = "plan_mode_entered"
    session_id: uuid.UUID
    run_id: uuid.UUID
    summary: PlanSummary
    requested_at: str  # ISO 8601 UTC


class BashStatusEvent(BaseModel):
    """``bash_status`` 事件——Bash 命令开始/结束状态（FR-02）。

    running 时前端渲染/更新 BashProgressCard，completed/failed 携带
    exit_code / elapsed_ms 收尾。
    """

    event: Literal["bash_status"] = "bash_status"
    session_id: uuid.UUID
    run_id: uuid.UUID
    command: str
    status: Literal["running", "completed", "failed"]
    exit_code: int | None = None
    elapsed_ms: int | None = None


class BashChunkEvent(BaseModel):
    """``bash_chunk`` 事件——Bash 命令实时输出块（FR-02）。

    发布侧（run_sync publish_bash_chunk_event）做 100ms 节流与 8KB 单条
    截断，DTO 本身不限制 content 长度。
    """

    event: Literal["bash_chunk"] = "bash_chunk"
    session_id: uuid.UUID
    run_id: uuid.UUID
    command: str
    channel: Literal["stdout", "stderr"]
    content: str
    is_final: bool = False


class AgentTaskStatusEvent(BaseModel):
    """``agent_task_status`` 事件——Agent 任务粒度状态（FR-03）。"""

    event: Literal["agent_task_status"] = "agent_task_status"
    session_id: uuid.UUID
    run_id: uuid.UUID
    task_id: str
    task_name: str
    status: Literal["running", "completed", "failed"]
    progress: int | None = None
    message: str | None = None


class PlanResponseDecision(enum.StrEnum):
    """plan 响应决策（前端 → 后端，design §接口定义）。

    py312 StrEnum（ruff UP042）：成员即 str（``PlanResponseDecision.revise ==
    "revise"``），替代 ``(str, enum.Enum)`` 双继承，序列化行为不变。
    """

    confirm = "confirm"
    revise = "revise"
    cancel = "cancel"


class PlanResponseRequest(BaseModel):
    """plan 响应请求体（task-02 ``plan-response`` 端点复用）。

    decision 为 revise / cancel 时 feedback 必填且非空白。
    """

    session_id: uuid.UUID
    run_id: uuid.UUID
    decision: PlanResponseDecision
    feedback: str | None = None  # revise/cancel 时必填

    @model_validator(mode="after")
    def _validate_feedback_required(self) -> "PlanResponseRequest":
        """revise / cancel 必须携带非空白 feedback（design §接口定义）。"""
        if self.decision in (PlanResponseDecision.revise, PlanResponseDecision.cancel) and (
            not self.feedback or not self.feedback.strip()
        ):
            raise ValueError("decision 为 revise/cancel 时 feedback 必填且不可为空白")
        return self
