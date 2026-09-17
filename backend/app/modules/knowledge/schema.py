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

    ``source_ref``：会话源为 session_id（UUID 字符串）；变更源为 change_key。
    """

    source_type: Literal["session", "change"]
    source_ref: str = Field(min_length=1, max_length=200)
    focus: str | None = Field(default=None, max_length=2000)


class DistillTaskRead(BaseModel):
    """蒸馏任务条（AgentRun 与 metadata_ 投影；dispatch 响应复用同形状）。"""

    agent_run_id: uuid.UUID
    source_type: str
    source_ref: str
    status: str
    created_at: datetime
