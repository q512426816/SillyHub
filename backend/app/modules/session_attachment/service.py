"""session_attachment service——上传校验与落存储（task-03，FR-1/FR-3/FR-8）。

流程：读全量字节 → 按 kind 校验（图片 PIL verify=真实 magic + 宽高；大小白名单
模块级常量）→ ``SessionAttachmentStorage.store_bytes``（内容寻址，同哈希复用
对象）→ 建草稿行（session_id NULL，design §10）→ AttachmentRead。

限制常量供 task-05 inject 聚合校验复用（backend 权威侧；前端同源预检）。
"""

from __future__ import annotations

import io
import re
import uuid
from pathlib import PurePosixPath, PureWindowsPath

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.modules.session_attachment.model import SessionAttachment
from app.modules.session_attachment.schema import AttachmentKind, AttachmentRead
from app.modules.session_attachment.storage import SessionAttachmentStorage

# ── 限制常量（design §2；FR-8 backend 权威侧，task-05 复用）────────────────
IMAGE_MEDIA_TYPES: frozenset[str] = frozenset(
    {"image/png", "image/jpeg", "image/webp", "image/gif"}
)
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 单张 ≤5MB
MAX_FILE_BYTES = 20 * 1024 * 1024  # 单份 ≤20MB
MAX_IMAGES_PER_MESSAGE = 5
MAX_FILES_PER_MESSAGE = 5
MAX_ATTACHMENTS_PER_MESSAGE = MAX_IMAGES_PER_MESSAGE + MAX_FILES_PER_MESSAGE


class SessionAttachmentTooLarge(AppError):
    code = "HTTP_413_SESSION_ATTACHMENT_TOO_LARGE"
    http_status = 413


class SessionAttachmentUnsupported(AppError):
    code = "HTTP_415_SESSION_ATTACHMENT_UNSUPPORTED"
    http_status = 415


def _strip_path(name: str) -> str:
    """剥本地路径只留文件名（Windows/POSIX 双形态）。"""
    for path_type in (PureWindowsPath, PurePosixPath):
        candidate = path_type(name).name
        if candidate:
            name = candidate
    return (name or "unnamed")[:255]


class SessionAttachmentService:
    def __init__(self, session: AsyncSession, storage: SessionAttachmentStorage) -> None:
        self._session = session
        self._storage = storage

    async def upload(
        self,
        *,
        user_id: uuid.UUID,
        kind: AttachmentKind,
        name: str,
        media_type: str,
        data: bytes,
    ) -> AttachmentRead:
        """校验 + 落存储 + 建草稿行（design §5.1）。"""
        name = _strip_path(name)
        size = len(data)
        width: int | None = None
        height: int | None = None

        if kind == "image":
            if size > MAX_IMAGE_BYTES:
                raise SessionAttachmentTooLarge(
                    f"图片超过单张上限 {MAX_IMAGE_BYTES // (1024 * 1024)}MB。",
                    details={"bytes": size, "limit": MAX_IMAGE_BYTES},
                )
            # PIL verify 即 magic 真实性校验：声明 png 实为 exe 之类在此被拒（415）。
            try:
                from PIL import Image

                with Image.open(io.BytesIO(data)) as img:
                    img.verify()
                with Image.open(io.BytesIO(data)) as img:
                    width, height = img.size
                    real_mime = Image.MIME.get(img.format or "")
            except Exception as exc:
                raise SessionAttachmentUnsupported(
                    "图片内容无法解析（格式非法）。",
                    details={"name": name},
                ) from exc
            if real_mime not in IMAGE_MEDIA_TYPES:
                raise SessionAttachmentUnsupported(
                    f"图片格式不支持（{real_mime or 'unknown'}）。",
                    details={"media_type": real_mime},
                )
            media_type = real_mime
        else:
            if size > MAX_FILE_BYTES:
                raise SessionAttachmentTooLarge(
                    f"文件超过单份上限 {MAX_FILE_BYTES // (1024 * 1024)}MB。",
                    details={"bytes": size, "limit": MAX_FILE_BYTES},
                )

        object_key, sha256 = await self._storage.store_bytes(
            user_id=user_id, data=data, media_type=media_type, name=name
        )
        row = SessionAttachment(
            user_id=user_id,
            session_id=None,  # 草稿（design §10）：发送时由 inject 回填
            kind=kind,
            media_type=media_type,
            bytes=size,
            name=name,
            object_key=object_key,
            sha256=sha256,
            width=width,
            height=height,
        )
        self._session.add(row)
        await self._session.commit()
        await self._session.refresh(row)
        return AttachmentRead.model_validate(row)


# ── task-06：inject 附件组装（D-3/D-4/D-9）──────────────────────────────────

# D-4 帧闸门：payload 内联 base64 总量上限（8MB；超限全部附件整体切回拉）。
MAX_INLINE_ATTACHMENTS_BYTES = 8 * 1024 * 1024

# 多模态直读的媒体类型：图片全系 + PDF（DocumentBlock）。
_MULTIMODAL_MEDIA_PREFIXES = ("image/",)
_MULTIMODAL_MEDIA_EXACT = {"application/pdf"}


def _is_multimodal_media(media_type: str) -> bool:
    return media_type in _MULTIMODAL_MEDIA_EXACT or media_type.startswith(
        _MULTIMODAL_MEDIA_PREFIXES
    )


def attachment_marker_line(row: SessionAttachment) -> str:
    """D-3 标记行：[附件:id|kind|name]（kind 取 DB 原始值，供前端回显缩略图）。"""
    return f"[附件:{row.id}|{row.kind}|{row.name}]"


# ── 会话展示标题剥离（2026-10-28-change-detail-sessions-source-fix）─────────
# 完整标记行（与 attachment_marker_line 同格式权威）：uuid 前缀口径对齐
# daemon/session/service/auto_resume.py（宁可多拦：任何 [附件:<uuid36>| 前缀行）。
_ATTACHMENT_MARKER_LINE_RE = re.compile(
    r"^\[附件:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{12}\|"
)
# name 段贪婪到行尾 ]（name 可含 |，文件名合法字符）；仅完整标记行可提取。
_ATTACHMENT_MARKER_NAME_RE = re.compile(
    r"^\[附件:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{12}\|[^|]*\|(.+)\]$"
)


def session_display_title(content: str | None) -> str | None:
    """首条 user_input 原文 → 会话展示标题（change/agent/daemon 三端点同源消费）。

    - 无任何附件标记行：``content[:30]``（与旧口径逐字节一致，零回归——含换行
      原样保留，不做 strip）；
    - 含标记行：剥全部标记行后取首个非空文本行（strip 后）前 30 字；以
      ``[附件:`` 开头但不完整的行是 substr 截断残骸，同样丢弃；
    - 纯附件（剥离后无剩余文本）：回退首个附件的 name 段（如 IMG_2038.png）；
    - 空文本 / 全部丢弃：None（调用方回退既有 id 前 8 位展示）。
    """
    if not content:
        return None
    has_marker = False
    first_attachment_name: str | None = None
    text_line: str | None = None
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if _ATTACHMENT_MARKER_LINE_RE.match(stripped):
            has_marker = True
            if first_attachment_name is None:
                name_match = _ATTACHMENT_MARKER_NAME_RE.match(stripped)
                if name_match:
                    first_attachment_name = name_match.group(1)
            continue
        if stripped.startswith("[附件:"):
            # 截断残骸（substr 窗口内 uuid/闭合 ] 未写全）——无信息量，丢弃。
            has_marker = True
            continue
        if text_line is None:
            text_line = stripped
    if not has_marker:
        return content[:30] or None
    if text_line is not None:
        return text_line[:30]
    return (first_attachment_name or "")[:30] or None


async def assemble_inject_attachments(
    rows: list[SessionAttachment],
    *,
    supports_multimodal: bool,
    storage: SessionAttachmentStorage,
) -> list[dict]:
    """已校验附件行 → SESSION_INJECT payload attachments 列表（snake_case）。

    消费判别口径（design §4.3，与 task-07/09 对齐）：payload 显式 ``deliver``
    字段承载 backend 决策，daemon 不做媒体类型推断——

    - deliver=block + data → 内联多模态块（image/* → ImageBlock、
      application/pdf → DocumentBlock），daemon 直转；
    - deliver=block 无 data（D-4 帧闸门超限回拉）→ daemon 经 content 端点
      拉取后仍转多模态块；
    - deliver=disk → 落盘 cwd/attachments/（原生文件 + D-9 降级的图片/PDF；
      media_type 保留原值供前端回显缩略图）。
    """
    # 第一遍：分类决定意图（多模态块 or 落盘）。块候选 = gate 支持 && 媒体
    # 类型可直读（图片系 / PDF；PDF 的 DB kind 为 file，按 media_type 归入）。
    block_pairs: list[tuple[SessionAttachment, bytes]] = []
    disk_rows: list[SessionAttachment] = []
    for row in rows:
        wants_block = supports_multimodal and _is_multimodal_media(row.media_type)
        if wants_block:
            data = await storage.read_bytes(row.object_key)
            block_pairs.append((row, data))
        else:
            # 原生文件落盘；D-9 降级（不支持多模态的图片/PDF）同走落盘链路。
            disk_rows.append(row)

    # D-4 闸门：内联总量（base64 后）超限 → 块候选整体切回拉（不带 data）。
    inline_b64_total = sum(len(b) for _, b in block_pairs) * 4 // 3
    pulled_back = inline_b64_total > MAX_INLINE_ATTACHMENTS_BYTES

    payloads: list[dict] = []
    for row, data in block_pairs:
        payloads.append(
            {
                "id": str(row.id),
                "kind": row.kind,
                "media_type": row.media_type,
                "name": row.name,
                "bytes": row.bytes,
                "deliver": "block",
                **({} if pulled_back else {"data": _b64encode(data)}),
                "object_key": row.object_key,
            }
        )
    for row in disk_rows:
        payloads.append(
            {
                "id": str(row.id),
                "kind": row.kind,
                "media_type": row.media_type,
                "name": row.name,
                "bytes": row.bytes,
                "deliver": "disk",
                "object_key": row.object_key,
            }
        )
    return payloads


def _b64encode(data: bytes) -> str:
    import base64

    return base64.b64encode(data).decode("ascii")
