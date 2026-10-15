"""deploy_records response schemas."""

from __future__ import annotations

import uuid

from pydantic import BaseModel


class DeployRecordSummary(BaseModel):
    """一条部署发布记录的列表项（frontmatter 元数据投影）。

    ``deployed_at`` 为 skill 写入的 frontmatter 原文透传（约定
    ``YYYY-MM-DD HH:mm:ss`` 本地时间字符串），后端零解析——排序按字符串
    字典序，同格式下与时间序一致（design 接口定义写死规则）。
    """

    record_id: str
    workspace_id: uuid.UUID
    workspace_name: str
    file_name: str
    seq: int | None = None
    status: str
    deployed_at: str | None = None
    summary: str
    commit_from: str | None = None
    commit_to: str | None = None
    commits_count: int | None = None
    agent: str | None = None


class DeployRecordDetail(DeployRecordSummary):
    """单条记录详情：元数据 + md 正文原文（前端渲染用）。"""

    content: str
