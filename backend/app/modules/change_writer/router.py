"""HTTP routes for change writer.

task-07（2026-08-14-change-center-conversation-driven）：create / proxy-create /
documents/generate / documents/batch-generate / execute 五个端点已随前端「新建变更」
表单下线删除（design D-001@v1 / Grill F-5，无调用方）。本 router 保留空壳供
``main.py`` 的 ``include_router`` 挂载，避免 dangling import。
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(
    prefix="/workspaces/{workspace_id}",
    tags=["change_writer"],
)
