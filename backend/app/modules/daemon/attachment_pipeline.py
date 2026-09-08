"""session / group 附件校验与装配共享核心（task-11 轻重构⑤，design §5 Wave 2）。

收敛对象（三份校验 + 四份装配的同构子段）：

- 校验「归属查询 + 存在性/数量判定 + 入参序保序」：session inject
  ``_validate_inject_attachment_rows``、session create ``validate_create_
  attachments``、group ``_validate_group_attachments`` 三份重复实现；
- 装配「多模态 gate 判定」「MinIO 读组装」：session ``_resolve_inject_gate`` /
  ``_assemble_inject_attachment_payload`` / ``assemble_create_attachments``
  尾段、group ``_assemble_group_inject_attachments`` 四处对 ``resolve_
  session_gate`` / ``assemble_inject_attachments`` 的同形调用。

保留在各调用点的差异（无法无损单源化，属各链路语义）：

- 错误族与 details：session inject 缺失/跨用户 → ``DaemonSessionNotFound``
  404 资源隐藏（details 带 session_id）；session create 同类不同 details
  （reason=attachment_not_found）；group → ``GroupChatInvalid`` 400 群错误族
  （群消息整体拒绝，无逐会话资源语义）。经 ``not_found_error`` /
  ``invalid_count_error`` 工厂回调留在调用点，核心只保证判定顺序与阈值；
- 引擎门控位置：session 侧发送前 ProviderCaps multimodal 门控
  （``DaemonSessionAttachmentsUnsupported``）；group 侧门控下沉到逐成员触发
  时判定（成员引擎各异）。

上限单源：图/文数量上限统一取 ``session_attachment.service`` 的
``MAX_IMAGES_PER_MESSAGE`` / ``MAX_FILES_PER_MESSAGE``（group 侧原口径；
session 侧原硬编码 5 与之相等，判定与错误文案逐字不变）。

patch 兼容（D-007）：``SessionAttachment`` / ``assemble_inject_attachments``
/ ``resolve_session_gate`` / ``SessionAttachmentStorage`` /
``get_storage_backend`` 一律函数内延迟 import（与收敛前各处一致，patch
源模块属性照常拦截——如 patch.object(att_svc, "assemble_inject_attachments")）。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError


async def validate_owned_attachments(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    attachment_ids: list[uuid.UUID],
    not_found_error: Callable[[], AppError],
    invalid_count_error: Callable[[int, int], AppError],
) -> list:
    """归属查询 + 存在性/数量校验 + 保序（session inject/create + group 共享核心）。

    判定顺序与收敛前三处逐一相同：①按 id + user_id 查附件行（缺失/跨用户
    归一报错，不泄露存在性差异）；②图/文各自上限 + 类型合法（非 image/file
    计入「类型非法」）；③按入参顺序去重返回（payload/标记行按用户勾选顺序
    稳定）。错误抛出经工厂回调由调用点构造（错误族/details 各链路各异）。
    """
    from app.modules.session_attachment.model import SessionAttachment
    from app.modules.session_attachment.service import (
        MAX_FILES_PER_MESSAGE,
        MAX_IMAGES_PER_MESSAGE,
    )

    rows = (
        (
            await db.execute(
                select(SessionAttachment).where(
                    SessionAttachment.id.in_(attachment_ids),
                    SessionAttachment.user_id == user_id,
                )
            )
        )
        .scalars()
        .all()
    )
    # 缺失/跨用户归一报错（资源隐藏语义细节由调用点工厂决定）。
    if len(rows) != len(set(attachment_ids)):
        raise not_found_error()
    image_n = sum(1 for r in rows if r.kind == "image")
    file_n = sum(1 for r in rows if r.kind == "file")
    if (
        image_n > MAX_IMAGES_PER_MESSAGE
        or file_n > MAX_FILES_PER_MESSAGE
        or (image_n + file_n) != len(rows)
    ):
        raise invalid_count_error(image_n, file_n)
    # 保留入参顺序（payload/标记行/摘要行按用户勾选顺序稳定）。
    by_id = {r.id: r for r in rows}
    return [by_id[i] for i in dict.fromkeys(attachment_ids) if i in by_id]


async def resolve_multimodal_gate(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_llm_provider_id: uuid.UUID | None,
    agent_kind: str,
) -> bool:
    """多模态 gate 判定（D-9）→ ``supports_multimodal`` 标量。

    session ``_resolve_inject_gate``（gate 基准=本轮生效供应商）与 group
    ``_assemble_group_inject_attachments``（基准=成员六要素，属主=群主）共享；
    基准口径的计算留在各调用点。
    """
    from app.modules.session_attachment.capability import resolve_session_gate

    gate = await resolve_session_gate(
        db,
        user_id=user_id,
        session_llm_provider_id=session_llm_provider_id,
        agent_kind=agent_kind,
    )
    return gate.supports_multimodal


async def assemble_attachments(rows: list, *, supports_multimodal: bool) -> list[dict]:
    """附件行 → SESSION_INJECT payload attachments 列表（D-4 闸门/降级路由）。

    内部经对象存储读字节（MinIO）——调用只应出现在取锁前预组装段、commit 后
    段或锁内 gate 漂移竞态兜底（单聊 P1 二审 / FR-05 补遗口径，两链路同款）。
    """
    from app.modules.session_attachment.service import assemble_inject_attachments
    from app.modules.session_attachment.storage import SessionAttachmentStorage
    from app.modules.storage.factory import get_storage_backend

    return await assemble_inject_attachments(
        rows,
        supports_multimodal=supports_multimodal,
        storage=SessionAttachmentStorage(get_storage_backend()),
    )
