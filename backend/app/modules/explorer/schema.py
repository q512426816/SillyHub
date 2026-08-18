"""Pydantic schemas for the workspace explorer module.

字段键与 daemon ``explorer_*`` RPC result 的 snake_case 契约逐字对齐
（design §7.1）；HTTP 响应模型由 service 层严格校验 daemon 返回后组装
（缺字段 = provider 契约缺口，显式 502 上报，禁止默认值掩盖）。

设计依据：``.sillyspec/changes/2026-08-18-workspace-file-browser/design.md``
§6 / §7.1 / §7.2。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

ExplorerEntryType = Literal["dir", "file"]


class ExplorerEntry(BaseModel):
    """目录项（``explorer_list_dir`` result.entries 元素）。"""

    name: str
    type: ExplorerEntryType
    size: int
    mtime: str


class ExplorerTreeResponse(BaseModel):
    """GET /api/workspaces/{wid}/explorer/tree 响应（懒加载逐层，空 path = 根）。"""

    entries: list[ExplorerEntry]


class ExplorerFileResponse(BaseModel):
    """GET /api/workspaces/{wid}/explorer/file 响应（encoding=utf8）。

    ``binary=true`` 时 content 为 daemon 兜底的 base64（utf8 解码失败不报错，
    design §7.1）；``truncated=true`` 表示超 10MB 上限先截断再传输。
    """

    name: str
    size: int
    mtime: str
    binary: bool
    truncated: bool
    content: str


class ExplorerSearchMatch(BaseModel):
    """搜索命中项（``explorer_search`` result.matches 元素，path 相对 root）。"""

    path: str
    name: str
    type: ExplorerEntryType


class ExplorerSearchResponse(BaseModel):
    """GET /api/workspaces/{wid}/explorer/search 响应（按文件名全树搜索）。"""

    matches: list[ExplorerSearchMatch]
    truncated: bool
