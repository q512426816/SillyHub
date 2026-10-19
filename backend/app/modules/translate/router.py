"""POST /api/translate/thinking 端点（change 2026-10-19-thinking-zh-translate）。

鉴权：``require_permission_any(Permission.TASK_RUN_AGENT)``——思考内容的可见
面即该权限（daemon 会话 logs 读侧同款，daemon/router/__init__.py:119），
无 workspace 维度。

fail-soft 契约（对齐 vector-search 的 model_ready）：引擎缺席/总闸关闭 →
200 + ``engine_ready=false`` + 原文透传，不抛 5xx。限额（items ≤16 /
单条 ≤20000 / 总量 ≤80000）由 schema.py 的 pydantic 约束给 422。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.auth_deps import require_permission_any
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.translate.schema import TranslateRequest, TranslateResponse
from app.modules.translate.service import translate_items

router = APIRouter(tags=["translate"])


@router.post("/translate/thinking", response_model=TranslateResponse)
async def translate_thinking(
    body: TranslateRequest,
    user: Annotated[User, Depends(require_permission_any(Permission.TASK_RUN_AGENT))],
) -> TranslateResponse:
    """思考内容批量离线翻译（en→zh）；语义与降级见模块 docstring 与 service.py。"""
    out = await translate_items(body.items, target=body.target)
    return TranslateResponse(
        ok=True,
        engine_ready=out["engine_ready"],
        reason=out["reason"],
        items=out["items"],
    )
