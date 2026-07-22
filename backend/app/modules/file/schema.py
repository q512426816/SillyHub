"""file 模块 Pydantic DTO。

平台级文件中心的请求/响应模型。统一 ``model_config = {"from_attributes": True}``
以便直接从 ORM ``File`` 映射。

设计依据：design.md §D-004/D-008 + tasks/task-04.md（provides FileUploadResp/FileMetaResp）。
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel as PydanticModel
from pydantic import Field


class FileUploadResp(PydanticModel):
    """上传成功响应（task-04 provides）。"""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    original_name: str
    mime_type: str
    size: int


class FileMetaResp(PydanticModel):
    """文件元数据响应（task-04 provides；batch-meta 回显用）。"""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    original_name: str
    mime_type: str
    size: int
    owner_type: str
    owner_id: uuid.UUID | None = None


class BatchMetaRequest(PydanticModel):
    """批量元数据请求（按 id 列表查 FileMetaResp）。"""

    ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
