"""Pydantic DTOs for the knowledge and quicklog APIs."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class KnowledgeEntry(BaseModel):
    """A single knowledge file entry."""

    # "top" | "decisions" | "generated" | "proposed" | "fr"（design 记作
    # KnowledgeEntryRead 的读侧条目 DTO；change 2026-09-17-knowledge-precipitation
    # task-01 只增不删）。
    zone: str
    filename: str
    path: str
    title: str | None = None
    content: str | None = None
    last_modified_at: datetime | None = None
    # 文件级使用计数（锚点前缀=本文件的命中次数和）。task-01（2026-09-20-
    # knowledge-effect-panel）先加字段默认 None（DTO 契约先行），task-03 由
    # list 透传真实聚合值；前端文件级 🔥 徽标数据源。
    use_count: int | None = None


class KnowledgeList(BaseModel):
    items: list[KnowledgeEntry]
    total: int


class QuicklogEntry(BaseModel):
    """A single quicklog file entry."""

    filename: str
    path: str
    title: str | None = None
    content: str | None = None
    last_modified_at: datetime | None = None


class QuicklogList(BaseModel):
    items: list[QuicklogEntry]
    total: int


# ── 写侧 DTO（change 2026-09-17-knowledge-precipitation task-04 / D-005@v1）────
#
# 全部写操作由 KnowledgeWriterService 构造 FileOp 走 SpecWorkspaceService.apply_ops
# 单写者语义落盘 knowledge/ 子树（行版本乐观锁 + spec_version bump + 30 天备份区）。


class KnowledgeProposeIn(BaseModel):
    """POST /knowledge/propose 请求体（手工录入候选）。"""

    title: str = Field(min_length=1, max_length=200)
    category: str = Field(default="uncategorized", max_length=50)
    body: str = ""
    tags: list[str] = Field(default_factory=list)


class KnowledgeUpdateIn(BaseModel):
    """PATCH /knowledge/entries/{filename} 请求体（整文件正文替换）。"""

    content: str


class KnowledgeMergeIn(BaseModel):
    """合并请求体（preview-merge / merge 共用）。

    ``target_file`` 限定三类 INDEX 映射文件（known-issues.md / patterns.md /
    conventions.md，D-007@v1）；``keywords`` 由审核人在表单人工填写（不做自动
    派生，design 约束），用于生成 INDEX.md 路由行 ``- 关键词|关键词 → [标题](…)``。
    """

    target_file: str = Field(min_length=1, max_length=200)
    section_title: str = Field(min_length=1, max_length=200)
    keywords: list[str] = Field(min_length=1)

    @field_validator("keywords")
    @classmethod
    def _keywords_clean(cls, v: list[str]) -> list[str]:
        # 滤空与含「→」/换行的废值（对齐 CLI knowledge-classify.js resolveKeywords），
        # 全部为废值时视为未提供（422）——路由行格式不允许空关键词。
        cleaned = [k.strip() for k in v if k and k.strip() and "→" not in k and "\n" not in k]
        if not cleaned:
            raise ValueError("keywords 不能为空")
        return cleaned


class MergePreviewOut(BaseModel):
    """合并预览（dry-run，不落盘）：将追加的段落文本与 INDEX 路由行。

    ``section_skipped`` / ``index_line_skipped``：dupRe 幂等守卫命中（目标已含
    同名 ``##`` 小节 / INDEX 已含同锚点路由行）时对应动作将被跳过。
    """

    section_text: str
    index_line: str
    section_skipped: bool = False
    index_line_skipped: bool = False
    # ql-20260918-007：目标文件不存在——合并将自动新建（update op 无 manifest 行
    # 按新建落 v1）。蒸馏型新 workspace 无三标准文件时合并不再 404。
    target_will_create: bool = False


class KnowledgeMergeResult(BaseModel):
    """merge 执行结果（两段式合并终态）。"""

    merged: bool
    target_file: str
    section_title: str
    index_line: str
    section_appended: bool
    index_updated: bool


# ── 蒸馏派发 DTO（change 2026-09-17-knowledge-precipitation task-07 / D-002@v1）─


class DistillQuickEntryOut(BaseModel):
    """GET /knowledge/distill/quick-entries 单条 ql 条目（quick-2dba0118 三修之一）。

    quicklog 真实形态是单文件多条目（QUICKLOG-*.md 内 ``## <ql-id> | 日期 | 标题``
    节），蒸馏 quick 源的多选单位是**条目**而非文件——本 DTO 投影 parser.
    parse_quick_entries 的条目级视图（弹层选择器数据源 + dispatch 源校验同根）。
    """

    ref: str
    title: str
    date: str


class DistillQuickEntryList(BaseModel):
    """GET /knowledge/distill/quick-entries 响应（最新在前，按 ref 倒序）。"""

    items: list[DistillQuickEntryOut]


class DistillDispatchIn(BaseModel):
    """POST /knowledge/distill 请求体（派发蒸馏任务）。

    ``source_ref``：会话源为 session_id（UUID 字符串，单条）；变更源为
    change_key（单条）；快速修复源为 ql 自然键短码（ql-YYYYMMDD-NNN-后缀），
    单条 ql 体量小故来源**多选**（list[str]，D-010②）——注意 quicklog 是单文件
    多条目形态，ref 指向 QUICKLOG-*.md 内的 ``## <ql-id>`` 节而非独立文件
    （quick-2dba0118 校验/指引同步改为条目级）。
    ``mode``：会话源可选 ``resume``（原会话续接，D-009——进行中直接 inject、
    已结束 reopen+inject，引擎/状态不满足自动降级 fresh 并记降级原因）；
    ``fresh`` 为默认（零回归），change/quick 强制走 fresh。
    fresh 配置字段（D-010③，复用 create_session 双入口）：
    ``runtime_id`` 钉机器（优先于 ``agent_type``/provider）、``agent_type``
    （provider）、``agent_profile_id``、``model``；quick-2dba0118 补
    ``llm_provider_id``（会话级 LLM 供应商，None=不指定回落本机/工作区默认，
    「和会话新建一样」——透传 create_session 写 lease metadata）。
    """

    source_type: Literal["session", "change", "quick"]
    source_ref: str | list[str] = Field(min_length=1, max_length=200)
    focus: str | None = Field(default=None, max_length=2000)
    mode: Literal["resume", "fresh"] = "fresh"
    runtime_id: str | None = None
    agent_type: str | None = None
    agent_profile_id: str | None = None
    model: str | None = None
    llm_provider_id: uuid.UUID | None = None

    @field_validator("source_ref")
    @classmethod
    def _source_ref_clean(cls, v: str | list[str]) -> str | list[str]:
        # 单串形态去空白；list 形态逐条去空白并滤空（全空视为未提供 422）。
        if isinstance(v, str):
            cleaned = v.strip()
            if not cleaned:
                raise ValueError("source_ref 不能为空")
            return cleaned
        cleaned_list = [item.strip() for item in v if item and item.strip()]
        if not cleaned_list:
            raise ValueError("source_ref 不能为空")
        return cleaned_list


class DistillTaskRead(BaseModel):
    """蒸馏任务条（AgentRun 与 metadata_ 投影；dispatch 响应复用同形状）。

    ``agent_session_id``：蒸馏实际执行的 AgentSession（D-009/D-010——resume
    为续接的原会话、fresh 为 create_session 新建的蒸馏会话），供知识库侧
    跳转；后台离线兜底失败时无会话为 null。
    ``merged_to``：合并后知识点位置（``目标文件#小节标题`` 双键，D-010①
    反链，防锚点漂移）；未合并=null。
    ``mode``：实际执行形态（resume 请求被降级守卫改写时为 ``fresh``）。
    ``degraded_reason``：resume 降级原因（未降级=null）。
    """

    agent_run_id: uuid.UUID
    source_type: str
    source_ref: str
    status: str
    created_at: datetime
    mode: str = "fresh"
    agent_session_id: uuid.UUID | None = None
    merged_to: str | None = None
    degraded_reason: str | None = None


# ── hits 接收 + 运营指标 DTO（2026-09-20-knowledge-effect-panel task-01）────────
#
# daemon 把各端本地 ``.sillyspec/.runtime/knowledge-hits.jsonl`` 增量上行到
# POST /knowledge/hits/batch（行 hash 幂等去重）；GET /knowledge/stats 出四指标
# + 使用率榜 + 文件级计数（实时聚合，不物化）。


#: 单行 jsonl 体积上限（bytes 语义按字符数近似校验，防 daemon 端读坏文件整行灌入）。
HITS_LINE_MAX_CHARS = 100 * 1024
#: 单批行数上限（R-06 分批协议：每批 ≤2000 行多次上报）。
HITS_BATCH_MAX_LINES = 2000


class HitsBatchIn(BaseModel):
    """POST /knowledge/hits/batch 请求体。

    ``lines``：原始 jsonl 行数组（逐行 json.loads + sha256 幂等，**不做**预先
    解包——行级原样转发保证多端 line_hash 一致）；``daemon_local_id``：daemon
    实例 id，原样落库不 FK（数据层留归属，design 非目标「按人视图」后续用）。
    """

    daemon_local_id: str | None = Field(default=None, max_length=64)
    lines: list[str]

    @field_validator("lines")
    @classmethod
    def _lines_bounded(cls, v: list[str]) -> list[str]:
        if len(v) > HITS_BATCH_MAX_LINES:
            raise ValueError(f"单批最多 {HITS_BATCH_MAX_LINES} 行（分批上报）")
        for line in v:
            if len(line) > HITS_LINE_MAX_CHARS:
                raise ValueError("单行超过 100KB 上限")
        return v


class HitsBatchOut(BaseModel):
    """batch 接收结果计数。

    ``ingested``：新落库行数；``skipped_bad``：json.loads 解析失败的坏行数；
    ``duplicates``：撞 (workspace_id, line_hash) 唯一约束跳过的行数（含同批
    重复与重报）。
    """

    ingested: int
    skipped_bad: int
    duplicates: int


class CoverageTrendPoint(BaseModel):
    """覆盖率趋势单点：week=周末 ISO 日期；pct=该时点覆盖率（分子按
    occurred_at<=周末重算，分母恒为当前条目总数——「覆盖长出来」口径）。"""

    week: str
    pct: float


class CoverageOut(BaseModel):
    used_entries: int
    total_entries: int
    trend: list[CoverageTrendPoint]


class DeadEntryOut(BaseModel):
    """死条目（90 天零命中或从未命中；锚点形态输出可定位）。"""

    anchor: str
    last_hit_at: datetime | None = None


class DensityTrendPoint(BaseModel):
    """密度趋势单点：该周窗口内每任务注入锚点数。"""

    week: str
    per_task_avg: float


class DensityOut(BaseModel):
    """每任务命中密度：总注入锚点数（inject 行 matched_anchors 长度和）÷ 任务数
    （inject 行 change_name 去重；fr-inject 行不进分母仅其锚点计数——口径注记）。"""

    per_task_avg: float
    trend: list[DensityTrendPoint]


class FreshnessOut(BaseModel):
    """新知识生效速度：近 30 天新增条目数（条目首见=frontmatter created_at 优先/
    hits 首见兜底）与其中已被命中数。"""

    recent_new: int
    recent_used: int


class UsageBoardItem(BaseModel):
    """使用率榜单条（全量按 per_task 降序，前端 % 格式显示 D-008@v3）。

    ``per_task``：条目命中次数 ÷ 条目存在期任务数（条目首见后 inject 行
    change 去重；分母 0 视为 1 防炸）；``task_count``：命中过该锚点的去重任务数
    （inject+fr-inject 行）。
    """

    anchor: str
    per_task: float
    total: int
    task_count: int
    first_hit: datetime | None = None
    last_hit: datetime | None = None


class EntryCountItem(BaseModel):
    """文件级使用计数（锚点前缀文件名计数和，文件级 🔥 徽标数据源）。"""

    file: str
    count: int


class KnowledgeStatsOut(BaseModel):
    """GET /knowledge/stats 响应（四指标 + 使用率榜 + 文件级计数）。"""

    coverage: CoverageOut
    dead_entries: list[DeadEntryOut]
    density: DensityOut
    freshness: FreshnessOut
    usage_board: list[UsageBoardItem]
    entry_counts: list[EntryCountItem]
