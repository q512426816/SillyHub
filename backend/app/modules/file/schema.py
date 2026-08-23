"""file 模块 Pydantic DTO。

平台级文件中心的请求/响应模型。统一 ``model_config = {"from_attributes": True}``
以便直接从 ORM ``File`` 映射。

设计依据：design.md §D-004/D-008 + tasks/task-04.md（provides FileUploadResp/FileMetaResp）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel as PydanticModel
from pydantic import Field


class FileUploadResp(PydanticModel):
    """上传成功响应（task-04 provides）。"""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    original_name: str
    mime_type: str
    size: int
    description: str | None = None


class FileMetaResp(PydanticModel):
    """文件元数据响应（task-04 provides；batch-meta 回显用）。

    description / created_at 为 agent-file-upload-mcp task-01 扩展
    （design §7.1 list 工具 / §8 D-006@v2）：旧数据 description 为 NULL。
    """

    model_config = {"from_attributes": True}

    id: uuid.UUID
    original_name: str
    mime_type: str
    size: int
    owner_type: str
    owner_id: uuid.UUID | None = None
    description: str | None = None
    created_at: datetime


class BatchMetaRequest(PydanticModel):
    """批量元数据请求（按 id 列表查 FileMetaResp）。"""

    ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
