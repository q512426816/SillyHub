"""session 导出端点（2026-09-14-session-export task-03 / FR-01 / FR-03 / D-001@v1）。

POST /sessions/export：body ``SessionExportRequest``（session_ids 1~50 + tier 双档
Literal），鉴权闸门 ``TaskRunAgentUser``（task:run_agent，与 detail / runs / logs /
usage 同一道闸门，对齐 session_insights.get_session_usage 的权限闸门注释惯例）；
附件存储经 ``_make_storage`` 依赖注入（照 session_attachment/router.py 同名
provider 形态在本模块自建，full 档取附件本体用）。

端点职责严格收窄：ids 去重保序（design 注明归端点层）→ facade 一行转发 →
按 ``SessionExportResult`` 组 Response（media_type + RFC5987 Content-Disposition）。
渲染 / 权限 / 截断 / 413 全在 task-02 服务层（session/service/export.py）——
本端点零导出业务逻辑。错误映射走既有体系：``DaemonSessionNotFound``(404) 与
``SessionExportTooLarge``(413) 均为 AppError 子类，经 main.py
``register_exception_handlers`` 的全局 handler 按 ``http_status`` 自动映射，
无需手写。

挂载顺序（R-01）：固定路径 ``/sessions/export`` 必须注册在参数路由
``/sessions/{session_id}``（get_session_detail）之前——否则 "export" 会被当作
{session_id} 匹配（ppm export-excel 同类坑已登记知识库）。本模块只声明路由，
实际前置由包 ``__init__`` 的 ``_ENDPOINT_ORDER`` 有序表保证（fail-fast 断言）。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from fastapi.responses import Response

from app.modules.daemon.router import SessionDep, TaskRunAgentUser, router
from app.modules.daemon.schema import SessionExportRequest
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service.export import _rfc5987_filename
from app.modules.session_attachment.storage import SessionAttachmentStorage
from app.modules.storage.factory import get_storage_backend


def _make_storage() -> SessionAttachmentStorage:
    """附件存储 provider（照 session_attachment/router.py 依赖形态自建）。"""
    return SessionAttachmentStorage(get_storage_backend())


@router.post("/sessions/export")
async def export_sessions(
    payload: SessionExportRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
    storage: Annotated[SessionAttachmentStorage, Depends(_make_storage)],
) -> Response:
    """导出选中的会话（chat=Markdown 对话 / full=JSON+附件 zip；FR-01 / FR-02）。

    响应矩阵由服务层决定（``SessionExportResult``）：chat×单会话 =
    ``text/markdown`` 单 .md；chat×多会话 与 full×任一 = ``application/zip``。
    下载文件名走 RFC 5987（``_rfc5987_filename`` 返回完整头值，含
    ``attachment;`` 前缀与 ASCII 回退，中文文件名浏览器优先解码 filename*）。

    权限逐会话对齐详情端点口径（owner + 软删 404 → 群参与者探测，任一不可
    访问整包 404 不做部分成功）；跨用户 / 已软删 / 群非成员均 404 不泄露
    存在性，full 档附件总量超 512MB 返回 413 提示分批导出——两者均经全局
    AppError handler 自动映射，端点不捕获。
    """
    svc = DaemonService(session)
    # ids 去重保序（design：归端点层；服务层收原生参数不做二次去重）。
    session_ids = list(dict.fromkeys(payload.session_ids))
    result = await svc.export_sessions(
        user.id,
        session_ids=session_ids,
        tier=payload.tier,
        storage=storage,
    )
    return Response(
        content=result.payload,
        media_type=result.media_type,
        headers={"Content-Disposition": _rfc5987_filename(result.filename)},
    )
