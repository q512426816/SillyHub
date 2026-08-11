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
from typing import Any

from pydantic import BaseModel, Field


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
