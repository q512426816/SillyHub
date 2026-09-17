"""Pydantic DTOs for the knowledge and quicklog APIs."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class KnowledgeEntry(BaseModel):
    """A single knowledge file entry."""

    # "top" | "decisions" | "generated" | "proposed"（design 记作 KnowledgeEntryRead
    # 的读侧条目 DTO；change 2026-09-17-knowledge-precipitation task-01 只增不删）。
    zone: str
    filename: str
    path: str
    title: str | None = None
    content: str | None = None
    last_modified_at: datetime | None = None


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


class KnowledgeMergeResult(BaseModel):
    """merge 执行结果（两段式合并终态）。"""

    merged: bool
    target_file: str
    section_title: str
    index_line: str
    section_appended: bool
    index_updated: bool


# ── 蒸馏派发 DTO（change 2026-09-17-knowledge-precipitation task-07 / D-002@v1）─


class DistillDispatchIn(BaseModel):
    """POST /knowledge/distill 请求体（派发蒸馏任务）。

    ``source_ref``：会话源为 session_id（UUID 字符串，单条）；变更源为
    change_key（单条）；快速修复源为 ql 自然键短码（ql-YYYYMMDD-NNN-后缀），
    单条 ql 体量小故来源**多选**（list[str]，D-010②）。
    ``mode``：会话源可选 ``resume``（原会话续接，D-009——进行中直接 inject、
    已结束 reopen+inject，引擎/状态不满足自动降级 fresh 并记降级原因）；
    ``fresh`` 为默认（零回归），change/quick 强制走 fresh。
    fresh 配置字段（D-010③，复用 create_session 双入口）：
    ``runtime_id`` 钉机器（优先于 ``agent_type``/provider）、``agent_type``
    （provider）、``agent_profile_id``、``model``。
    """

    source_type: Literal["session", "change", "quick"]
    source_ref: str | list[str] = Field(min_length=1, max_length=200)
    focus: str | None = Field(default=None, max_length=2000)
    mode: Literal["resume", "fresh"] = "fresh"
    runtime_id: str | None = None
    agent_type: str | None = None
    agent_profile_id: str | None = None
    model: str | None = None

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
