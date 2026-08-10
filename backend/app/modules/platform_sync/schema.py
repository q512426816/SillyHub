"""platform_sync 请求/响应 Pydantic v2 模型。

裸六表用 ``dict[str, Any]`` 透传（NG-6：不强类型化 ``serializeForSync`` 六表，
避免与客户端六表演进耦合）。``ConflictResponse`` 对齐契约 §4.4，
``ChangeListItem`` 对齐契约 §5。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


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
