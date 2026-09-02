"""群聊管理端点（2026-09-01-session-group-chat task-02/03/06，design §6.1/§5.4）。

路由挂载偏差说明（照 audit_router 先例）：design §6.1 表写 ``/api/group-chats``，
但本变更不动 ``app/main.py``（design §13 文件清单未含）——仿 change_write/
audit/grants 先例在 daemon router 静态区 include，复用其 ``/daemon`` prefix，
最终落地 ``/api/daemon/group-chats`` 系列端点（openapi.json 如实记录，前端
经 gen:types 消费实际路径）。

权限依赖照 daemon router 惯例：``TaskRunAgentUser``（TASK_RUN_AGENT）作统一
登录门；参与者/群主判定在 service 层（``_require_group_member`` 两段式 +
``_require_group_owner``）。群消息端点（POST /{group_id}/messages，design §4.1
实际挂本 router 与群管理同前缀）task-03 落地；typing（task-06）与 presence
在线集（群列表/详情 ``online_member_ids``，task-06）见文末分区。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission_any
from app.core.db import get_session
from app.modules.agent.schema import (
    GroupChatCreate,
    GroupChatRead,
    GroupChatUpdate,
    GroupMemberCreate,
    GroupMemberRead,
    GroupMemberUpdate,
)
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.daemon.group.service import (
    GroupChatService,
    GroupMessageSendRead,
    get_last_mention_previews,
    get_last_message_previews,
    get_online_member_ids,
)

# 自带 /group-chats prefix（空根路径 "" 在 FastAPI 需挂非空 prefix 才合法），
# 经 daemon router include 复用其 /daemon prefix → 最终 /api/daemon/group-chats。
router = APIRouter(prefix="/group-chats", tags=["daemon-group-chat"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
# daemon router 会话域同款权限门（照 /sessions 系列惯例）。
GroupChatUser = Annotated[User, Depends(require_permission_any(Permission.TASK_RUN_AGENT))]


class GroupChatListItemRead(GroupChatRead):
    """群列表项（design §6.1：成员摘要 + online_member_ids + 最后消息）。

    ``online_member_ids``（task-06 接通，design §5.4）：读 Redis
    ``group_presence:{群id}:*`` 活跃集（群 SSE 生成器循环 touch 续期，TTL
    60s）；Redis 不可用降级空数组。最后消息摘要 task-03 已接通
    （``get_last_message_previews``：最新 user_input/投影行首 60 字）。

    ``last_mention``（群聊体验 quick，2026-09-02）：最近 @请求用户的摘要
    （``get_last_mention_previews`` 扫描最近时间线，命中返回
    ``{content(截 60 字), ts, member_name}``，无 @ 为 None）。
    """

    online_member_ids: list[uuid.UUID] = []
    last_message: str | None = None
    last_mention: dict[str, str] | None = None


class GroupChatDetailRead(GroupChatRead):
    """群详情读体（task-06，design §5.4：成员面板在线绿点数据源）。

    ``GroupChatRead`` 在 agent/schema.py（非本卡 allowed_paths），扩展字段照
    ``GroupChatListItemRead`` 先例在 router 层落：``online_member_ids`` 与列表
    项同源（``get_online_member_ids``）。
    """

    online_member_ids: list[uuid.UUID] = []


class GroupMessageSendRequest(BaseModel):
    """``POST /group-chats/{id}/messages`` 写体（design §4.1；FR-05 补遗扩附件）。

    schema.py 不在本卡 allowed_paths——请求体随 router 落地（service 响应体在
    group/service.py，``GroupChatListItemRead`` 本文件先例）。

    附件口径照单聊 ``SessionInjectRequest``（2026-08-20-session-multimodal-
    attachments）：``attachment_ids`` 为上传端点（POST /daemon/session-
    attachments）产出的 SessionAttachment id 引用；**D-7 豁免**——附件非空时
    ``content`` 可空（看图说话）；上限 10 = 图片 5 + 文件 5（逐 kind 校验归
    service，DTO 层总量兜底）。
    """

    content: str = Field(
        default="", max_length=8000, description="消息原文（含 @提及）；携带附件时可空"
    )
    attachment_ids: list[uuid.UUID] = Field(
        default_factory=list, max_length=10, description="附件引用（SessionAttachment id）"
    )


class GroupTypingRequest(BaseModel):
    """``POST /group-chats/{id}/typing`` 写体（design §5.4 typing.ping）。

    前端 250ms 节流 + 本地 TTL 2.5s 自动过期；``preview`` 为输入框草稿预览
    （≤400 字——DTO 与服务端 ``_typing_payload`` 裁剪口径一致，服务端再裁
    一道双保险）。``typing=False`` 表示停止输入（发送/清空草稿时冲掉指示器）。
    """

    typing: bool = True
    preview: str | None = Field(default=None, max_length=400)


def _to_list_item(read: GroupChatRead) -> GroupChatListItemRead:
    item = GroupChatListItemRead.model_validate(
        read.model_dump(mode="json"),
    )
    return item


# ── 群 CRUD ──────────────────────────────────────────────────────────────────


@router.post("", response_model=GroupChatRead, status_code=status.HTTP_201_CREATED)
async def create_group_chat(
    payload: GroupChatCreate,
    session: SessionDep,
    user: GroupChatUser,
) -> GroupChatRead:
    """建群：群会话（kind='group'）+ 群行 + 初始成员（design §8 group.created）。"""
    return await GroupChatService(session).create_group(user, payload)


@router.get("", response_model=list[GroupChatListItemRead])
async def list_group_chats(
    session: SessionDep,
    user: GroupChatUser,
) -> list[GroupChatListItemRead]:
    """当前用户=群成员的群列表（含成员摘要 chips + 最后消息；design §6.1）。"""
    svc = GroupChatService(session)
    reads = await svc.list_groups(user)
    # task-03：最后消息摘要接通（群 id==会话 id 不变式，§3.2）。
    previews = await get_last_message_previews(session, [r.id for r in reads])
    # 群聊体验 quick（2026-09-02）：最近 @我 摘要（非成员群不会出现，双保险跳过）。
    mentions = await get_last_mention_previews(
        session, user_id=user.id, group_ids=[r.id for r in reads]
    )
    items = [_to_list_item(r) for r in reads]
    for item in items:
        item.last_message = previews.get(item.id)
        item.last_mention = mentions.get(item.id)
        # task-06（§5.4）：presence 在线集接通（Redis 不可用降级空数组）。
        item.online_member_ids = await get_online_member_ids(item.id)
    return items


@router.get("/{group_id}", response_model=GroupChatDetailRead)
async def get_group_chat(
    group_id: uuid.UUID,
    session: SessionDep,
    user: GroupChatUser,
) -> GroupChatDetailRead:
    """群详情：成员完整列表（六要素 + shadow_status + 在线绿点；design §6.1）。"""
    read = await GroupChatService(session).get_group(group_id, user)
    detail = GroupChatDetailRead.model_validate(read.model_dump(mode="json"))
    # task-06（§5.4）：成员面板 presence 消费（与列表项同源）。
    detail.online_member_ids = await get_online_member_ids(group_id)
    return detail


@router.patch("/{group_id}", response_model=GroupChatRead)
async def update_group_chat(
    group_id: uuid.UUID,
    payload: GroupChatUpdate,
    session: SessionDep,
    user: GroupChatUser,
) -> GroupChatRead:
    """改群名/agent_cross_mention/context_window 等设置（群主或 admin）。"""
    return await GroupChatService(session).update_group(group_id, user, payload)


@router.post("/{group_id}/end", response_model=GroupChatRead)
async def end_group_chat(
    group_id: uuid.UUID,
    session: SessionDep,
    user: GroupChatUser,
) -> GroupChatRead:
    """解散群：end 群会话 + 全部影子会话 + 影子队列清理（design §8 group.ended）。"""
    return await GroupChatService(session).end_group(group_id, user)


# ── 成员管理 ─────────────────────────────────────────────────────────────────


@router.post(
    "/{group_id}/members",
    response_model=GroupMemberRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_group_member(
    group_id: uuid.UUID,
    payload: GroupMemberCreate,
    session: SessionDep,
    user: GroupChatUser,
) -> GroupMemberRead:
    """加成员（用户邀请 / agent 六要素配置；群主或 admin）。"""
    return await GroupChatService(session).add_member(group_id, user, payload)


@router.patch("/{group_id}/members/{member_id}", response_model=GroupMemberRead)
async def update_group_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    payload: GroupMemberUpdate,
    session: SessionDep,
    user: GroupChatUser,
) -> GroupMemberRead:
    """改成员昵称 / agent 六要素（热切换执行在 task-04，本卡落库+同步快照）。"""
    return await GroupChatService(session).update_member(group_id, member_id, user, payload)


@router.delete(
    "/{group_id}/members/{member_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_group_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    session: SessionDep,
    user: GroupChatUser,
) -> None:
    """移除成员（用户 removed_at 置位；agent 额外 end 影子+队列清理）。"""
    await GroupChatService(session).remove_member(group_id, member_id, user)


@router.post(
    "/{group_id}/members/{member_id}/reset-memory",
    response_model=GroupMemberRead,
)
async def reset_group_member_memory(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    session: SessionDep,
    user: GroupChatUser,
) -> GroupMemberRead:
    """重置 agent 成员记忆：end 影子置 pending，下次触发懒重建（幂等）。"""
    return await GroupChatService(session).reset_member_memory(group_id, member_id, user)


# ── 群消息（task-03，design §4.1）────────────────────────────────────────────


@router.post("/{group_id}/messages", response_model=GroupMessageSendRead)
async def send_group_message(
    group_id: uuid.UUID,
    payload: GroupMessageSendRequest,
    session: SessionDep,
    user: GroupChatUser,
) -> GroupMessageSendRead:
    """发群消息：载体 run 落时间线 + @解析触发命中 agent 成员（design §4.1）。

    未 @ 消息仅落时间线（进群背景摘要）；@全体 广播全部 agent 成员；触发
    成员忙轮排队（满 5 → 409）。任意用户成员可发（§6.1）。附件随消息落
    user_input metadata 摘要并在触发成员时随注入下发（FR-05 补遗）。
    """
    return await GroupChatService(session).send_group_message(
        group_id,
        user,
        payload.content,
        attachment_ids=payload.attachment_ids or None,
    )


# ── typing（task-06，design §5.4）────────────────────────────────────────────


@router.post(
    "/{group_id}/typing",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def send_group_typing(
    group_id: uuid.UUID,
    payload: GroupTypingRequest,
    session: SessionDep,
    user: GroupChatUser,
) -> None:
    """typing 心跳：成员校验后直接 publish ``group_typing:{群id}``（§5.4）。

    节流由前端做（250ms 间隔）；**纯 ephemeral**——不落库、不进 AI 上下文、
    不进群背景摘要（Redis pub/sub 即发即忘）。任意用户成员可发（§6.1）。
    """
    await GroupChatService(session).publish_typing(
        group_id,
        user,
        typing=payload.typing,
        preview=payload.preview,
    )
