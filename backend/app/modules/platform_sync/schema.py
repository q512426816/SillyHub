"""platform_sync 请求/响应 Pydantic v2 模型。

裸六表用 ``dict[str, Any]`` 透传（NG-6：不强类型化 ``serializeForSync`` 六表，
避免与客户端六表演进耦合）。``ConflictResponse`` 对齐契约 §4.4，
``ChangeListItem`` 对齐契约 §5。

Change 2026-08-11-change-progress-projection task-07：新增三模型支撑 workspace-scoped
token 签发端点（design §7）—— ``PlatformSyncTokenCreateResponse`` / ``ResolveByRootPathRequest``
/ ``ResolveByRootPathResponse``。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, RootModel, model_validator

from app.modules.spec_workspace.schema import FileOp


class ConflictResponse(BaseModel):
    """POST progress 409 冲突响应（契约 §4.4）。

    ``platform_progress`` 必须是平台当前完整 ``latest_progress`` 六表 JSON，
    客户端 ``resolve --take-platform`` 据此 import（契约硬要求）。
    """

    conflict: bool = True
    platform_progress: dict[str, Any]
    last_pushed_at: str | None = None


class ChangeListItem(BaseModel):
    """GET /changes 轻量列表项（契约 §5，裸数组形态 D-007）。"""

    name: str
    current_stage: str | None = None
    last_pushed_at: str | None = None
    last_pusher: str | None = None


class ProgressSyncOk(BaseModel):
    """POST progress 200 成功响应（契约 §4.3，客户端不读 body，任意 2xx 即可）。"""

    ok: bool = True


class ChangeApprovalResponse(BaseModel):
    """GET /changes/{name}/approval 响应——给 sillyspec CLI execute 审批门控用。

    CLI ``sync.js checkApproval``（execute 启动时调）读 ``status``：
    ``rejected``/``pending`` 阻断 execute，其他（``approved``）放行
    （command.js:1071-1080）。当前后端无审批策略/数据 → 所有 change 默认 ``approved``
    放行（ql-20260812-001-6eb8 修 CLI 因 404 误判 pending 卡死）。
    """

    status: str = Field(default="approved", description="审批状态：approved/pending/rejected")
    reason: str | None = None


# ── Change 2026-08-11-change-progress-projection task-07：workspace-scoped token 签发 ──


class PlatformSyncTokenCreateRequest(BaseModel):
    """POST /workspaces/{wid}/platform-sync-tokens 签发请求（design §7）。"""

    name: str = Field(min_length=1, max_length=100, description="人类可读标签")


class PlatformSyncTokenCreateResponse(BaseModel):
    """POST 签发 201 响应——**唯一**携带明文 token 的地方（仅此一次返回，R-06）。

    明文字段 ``token`` 语义独立（不可重复获取），单独建模让"明文只出现一次"契约显眼。
    """

    id: uuid.UUID
    workspace_id: uuid.UUID
    key_prefix: str = Field(description="明文 token 的可视前缀（前 12 字符），供 UI 展示")
    token: str = Field(description="明文 token，仅本次响应返回，此后不可恢复（请立即保存）")
    name: str
    created_at: datetime


class ResolveByRootPathRequest(BaseModel):
    """POST /workspaces/resolve-by-root-path 请求（design §7，connect 换发 body）。"""

    root_path: str = Field(min_length=1, description="本地项目根目录绝对路径")


class ResolveByRootPathResponse(BaseModel):
    """POST resolve-by-root-path 200 响应（design §7）：反查到的 workspace + 换发 token。"""

    workspace_id: uuid.UUID
    token: str = Field(description="workspace-scoped 明文 token（shpsync_ 前缀），仅本次返回")


# ── Change 2026-08-14-platform-sync-docs-approval task-02（D-004@v1：body 照 CLI sync.js 字面）──

#: 四件套白名单（sillyspec sync.js DOCUMENT_FILES 字面）。
DOCUMENT_FILES: frozenset[str] = frozenset(
    {"proposal.md", "design.md", "requirements.md", "tasks.md"}
)


class DocumentsSyncRequest(RootModel[dict[str, str]]):
    """POST /changes/{name}/documents 请求——**裸**扁平 map（顶层即文件名）。

    CLI ``sync.js syncDocuments``（:442-497）把存在的四件套文件读成扁平 map
    直接 ``JSON.stringify(documents)`` 整体 POST——顶层就是 ``{"proposal.md": "全文"}``，
    **不包 documents 键**（task-05 测试实证抓到包装偏差后修正）。RootModel 直接
    映射裸 map。键限白名单、值必须 str；空 map / 白名单外键 / 值非 str → 422。
    """

    @model_validator(mode="after")
    def _validate_whitelist(self) -> "DocumentsSyncRequest":
        if not self.root:
            raise ValueError("documents 不能为空 map（至少一个四件套文件）")
        invalid = set(self.root) - DOCUMENT_FILES
        if invalid:
            raise ValueError(f"documents 键不在四件套白名单内: {sorted(invalid)}")
        return self


class DocumentsSyncOk(BaseModel):
    """POST documents 200 响应（CLI 不读 body，任意 2xx 即可，synced 供人工核对）。"""

    synced: int = Field(description="本次落库的文档数")
    change_name: str


class ApprovalSubmitRequest(BaseModel):
    """POST /changes/{name}/approval 请求。

    decision 过去式（``"approved"``/``"rejected"``）——CLI ``sync.js _submitApproval``
    （:961-963）字面：rejected 分支带 reason，approved 分支**整个不含 reason 键**，
    故 reason 必须 optional（default None，Grill UB-3）。
    """

    decision: Literal["approved", "rejected"]
    reason: str | None = None


class ApprovalSubmitOk(BaseModel):
    """POST approval 200 响应（CLI fetchJson 读到即成功，字段供人工核对）。"""

    status: str = Field(default="ok")
    decision: Literal["approved", "rejected"]
    change_name: str


class QuicklogEntryPushRequest(BaseModel):
    """POST /quicklog-entries 请求（CLI quicklog.js 推送，design §5.2 / FR-02）。

    payload=条目结构化 JSON（QuicklogEntryDTO，snake_case 字段对齐 CLI 落盘形态）。
    **不含也不接受 workspace 字段**——workspace 一律由 shpsync_ token 派生
    （auth.py G6/D-004@v1 通道），body 出现 workspace 键会被 extra 忽略（model_config
    forbid 会 422，取 ignore 保证宽松——CLI 字段演进不破推送）。
    ql_id 必填（幂等 upsert 复合键之一）；其余字段宽松（best-effort 推送语义）。
    """

    model_config = {"extra": "ignore"}

    ql_id: str = Field(min_length=1, max_length=128)
    timestamp: str | None = None
    title: str | None = None
    status: str | None = None
    status_note: str | None = None
    author_raw: str | None = None
    linked_changes: list[str] = Field(default_factory=list)
    files: list[dict[str, Any]] = Field(default_factory=list)
    body_sections: dict[str, str] = Field(default_factory=dict)
    raw_block: str | None = None


class QuicklogPushOk(BaseModel):
    """POST /quicklog-entries 200 响应（CLI best-effort，任意 2xx 即可）。"""

    status: str = Field(default="ok")
    ql_id: str


# ── Change 2026-08-17-spec-file-incremental-sync task-01（design §7）──


class SpecManifestFileEntry(BaseModel):
    """GET /changes/-/spec-manifest 单文件清单项（design §7）。

    对齐 ``spec_file_manifest`` 行三字段：``hash``=内容 SHA-256 hex（CLI 与本地
    walk 结果 diff）、``version``=文件级版本（增量 op 的乐观锁基线）、``exists``=
    服务器侧软删标志（false → CLI 下发 delete 对齐）。
    """

    hash: str = Field(description="文件内容 SHA-256 hex")
    version: int = Field(description="文件级版本号（apply_ops 每次成功 op +1）")
    exists: bool = Field(description="false=服务器侧已软删（spec-backups 区）")


class SpecManifestResponse(BaseModel):
    """GET /changes/-/spec-manifest 200 响应：服务器权威清单全量 map（design §5.2/§7）。

    CLI ``spec-sync.js`` 以此为锚 diff 本地 ``.sillyspec/`` 算增量 ops
    （D-004@v1 CLI 无本地缓存，清单即基线）。无清单行（旧 tar 全量同步后失效 /
    全新 workspace）→ 空 ``files``，CLI 走 R-07 兜底全量重算。
    """

    files: dict[str, SpecManifestFileEntry] = Field(default_factory=dict)


# ── Change 2026-08-17-spec-file-incremental-sync task-02（design §5.2/§7）──


class SpecSyncRequest(BaseModel):
    """POST /changes/-/spec-sync 请求（design §7，复用 spec_workspace FileOp）。

    ``ops`` 即 CLI ``spec-sync.js`` 以 spec-manifest 为锚 diff 出的增量操作数组
    （add/update/delete/rename，每文件带 ``base_version`` 乐观锁基准）。与 daemon
    用的 ``SpecIncrementalSyncRequest`` 同构但**不含 ``change_dirs``**——CLI 直跑
    场景由 ``apply_ops`` 扫 ops 路径 ``changes/`` 前缀兜底触发 reparse（行为等价，
    design §5.2）。
    """

    ops: list[FileOp]


class SpecSyncResponse(BaseModel):
    """POST /changes/-/spec-sync 响应（design §7，对齐 SpecIncrementalSyncResponse 语义）。

    conflict 恒伴随 200（不改 HTTP 状态码）：``conflict=True`` 时
    ``server_versions`` 携带服务器当前版本，CLI 侧 console.warn 提示人工拍板、
    不阻塞（design §5.4/§5.5）。
    """

    ok: bool
    new_versions: dict[str, int]
    conflict: bool = False
    server_versions: dict[str, int] | None = None


# ── Change 2026-08-23-platform-agent-log-ingest task-02（design §3.2 API 契约）──


class AgentLogEntry(BaseModel):
    """POST /agent-logs 单条日志元信息（协议 docs/platform-agent-log-protocol.md §1）。

    必填仅 ``harness`` + ``log_path``（复合幂等键之二维），其余 optional；字符串字段
    ``max_length`` 与 ORM 列宽对齐——超长在 Pydantic 层先行 422（防 PG 超长 500，
    X-08），其中 ``log_path`` 上限 1024 与列宽逐字一致。``extra=ignore`` 宽松吞掉
    CLI schema 升版的未知字段（D-002：静默丢弃不 422，字段演进靠加列）。
    """

    model_config = {"extra": "ignore"}

    harness: str = Field(min_length=1, max_length=32)
    log_path: str = Field(min_length=1, max_length=1024)
    format: str | None = Field(default=None, max_length=64)
    session_id: str | None = Field(default=None, max_length=128)
    originator: str | None = Field(default=None, max_length=128)
    detected_via: str | None = Field(default=None, max_length=64)
    agent_cwd: str | None = Field(default=None, max_length=1024)
    exists: bool | None = None
    size_bytes: int | None = Field(default=None, ge=0)
    mtime_ms: float | None = None
    # 以下两个时间字段为 CLI ISO 8601 UTC 原文（D-003，字典序 = 时间序）。
    first_seen_at: str | None = Field(default=None, max_length=64)
    last_seen_at: str | None = Field(default=None, max_length=64)
    # CLI 侧累计调用次数（CLI 留底文件是计数权威，D-005）。
    invocations: int | None = Field(default=None, ge=0)
    # 只含 flag 名，不含参数值（协议 §7）。
    last_command: str | None = Field(default=None, max_length=255)
    # ── 2026-08-23-agent-activity-sessions task-04（design §3.3.2 / D-009 entry 级 ctx）──
    # 检出/更新该 entry 的那次 run 的归属 ctx（change 名或 quick 会话短码），随 entry
    # 持久化——CLI 全量重推时未被本次 run 触及的存量 entry 保留原 ctx；服务端按
    # ``(harness, coalesce(change_key, quick_id, ''))`` 分组归属（互斥：CLI quick 优先）。
    change_key: str | None = Field(default=None, max_length=128)
    quick_id: str | None = Field(default=None, max_length=128)


class AgentLogPushRequest(BaseModel):
    """POST /agent-logs 请求（CLI ``sillyspec run`` 入口 best-effort 批量推送，协议 §1）。

    **不声明 workspace_id 字段**——body 里出现的值被 extra=ignore 吞掉，workspace
    一律由 shpsync_ token 派生（token 派生唯一权威，协议 §1「不信任 body 里的
    workspace_id」）。``entries`` 1..50 条防滥用；同请求内同 log_path 重复条目由
    service 层去重取后者（design §3.2）。

    2026-08-23-agent-activity-sessions task-04（design §3.3.2）：增 body 级
    ``hub_session_id``——daemon 派发时经 env ``SILLYHUB_SESSION_ID`` 注入的平台会话
    id（run 所属会话唯一，故 body 级而非 entry 级，D-008）；服务端校验 workspace
    归属，未命中/跨 ws 静默降级（D-005 best-effort）。
    """

    model_config = {"extra": "ignore"}

    schema_version: int = 1
    pushed_at: str | None = Field(default=None, max_length=64)
    agent_cwd: str | None = Field(default=None, max_length=1024)
    scan_run_id: str | None = Field(default=None, max_length=128)
    hub_session_id: uuid.UUID | None = None
    entries: list[AgentLogEntry] = Field(min_length=1, max_length=50)


class AgentLogPushOk(BaseModel):
    """POST /agent-logs 200 响应（CLI best-effort 不读 body，任意 2xx 即成功）。"""

    ok: bool = True
    upserted: int = Field(description="本次落库的日志行数（同请求去重后）")


class AgentLogListItem(BaseModel):
    """GET /agent-logs 列表项——design §3.1 全列 snake_case 原样（X-06）。

    ``from_attributes`` 支持 ORM 行直接 ``model_validate``（router 层零手工映射）；
    字段即 ``platform_agent_logs`` 表全列（无 payload JSON，D-002）。
    """

    model_config = {"from_attributes": True}

    id: uuid.UUID
    workspace_id: uuid.UUID
    log_path: str
    harness: str
    format: str | None = None
    session_id: str | None = None
    originator: str | None = None
    detected_via: str | None = None
    agent_cwd: str | None = None
    exists: bool
    size_bytes: int | None = None
    mtime_ms: float | None = None
    first_seen_at: str | None = None
    last_seen_at: str | None = None
    invocations: int | None = None
    last_command: str | None = None
    scan_run_id: str | None = None
    pushed_at: str | None = None
    # 2026-08-23-agent-activity-sessions task-04（design §3.3.2 / FR-04）：所属平台
    # 会话（hub 关联或 tool_report 聚合写入）；NULL = 未归属（存量行不回填，R-03）。
    agent_session_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class AgentLogListResponse(BaseModel):
    """GET /agent-logs 200 响应（按 last_seen_at DESC NULLS LAST 排序，design §3.2）。"""

    items: list[AgentLogListItem] = Field(default_factory=list)


# ── 2026-08-23-agent-activity-sessions task-05（design §3.3.5 内容查看端点）──


class AgentLogContentResponse(BaseModel):
    """GET /agent-logs/{entry_id}/content 200 响应。

    daemon 侧 ``host_fs.read_file`` 整文件 utf8 读（无上限），后端按字节截断
    **尾部** 262144 字节后返回（防大文件撑爆响应；尾部 = 最新内容，回解
    ``errors="ignore"`` 防多字节字符被切出现乱码开头）。``size_bytes`` 是
    daemon 读到的文件总字节数（截断前权威值，不回退用 entry.size_bytes 旧元
    信息）。读即弃不落库（task-05 constraints）。
    """

    content: str = Field(description="日志内容尾部文本（最多 262144 字节 UTF-8）")
    truncated: bool = Field(description="原始内容是否超过 262144 字节被截断")
    size_bytes: int = Field(description="daemon 侧读到的文件总字节数（截断前）")
