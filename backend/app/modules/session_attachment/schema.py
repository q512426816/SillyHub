"""session_attachment schema——上传/读取 DTO（task-03）。

AttachmentRead 不外泄 object_key 与 sha256（存储内部细节；ETag 由 content
端点自行携带）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

AttachmentKind = Literal["image", "file"]


class AttachmentRead(BaseModel):
    """上传/附件行读取 DTO（design §5.1；consumed by task-04/11）。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: AttachmentKind
    media_type: str
    bytes: int
    name: str
    width: int | None = None
    height: int | None = None
    created_at: datetime
