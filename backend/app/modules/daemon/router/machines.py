"""machine（daemon_instance）级端点（task-07 拆分）。

8 个 /machines 端点 + GET /instances（机器级聚合视图 / mutation / WS 指令推送）。
机器读模型装配（``_build_machine_read`` 等）与 WithPending 响应模型在
runtimes.py（与 /runtimes/page 共用，避免循环 import），本模块经其导入。
"""

from __future__ import annotations

import re
import uuid
from typing import Annotated, Literal

from fastapi import Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from app.core.auth_deps import get_current_principal
from app.modules.auth.model import User
from app.modules.daemon.router import RuntimeAdminUser, SessionDep, router
from app.modules.daemon.router.runtimes import (
    DaemonMachineListResponseWithPending,
    _build_machine_read,
    _shared_machine_view,
)
from app.modules.daemon.router.version import get_daemon_latest_version
from app.modules.daemon.schema import (
    DaemonInstanceProviderItem,
    DaemonInstanceRead,
    DaemonMachineRead,
    DaemonMachineUpdate,
)
from app.modules.daemon.service import DaemonService

# ── Machine-level endpoints (2026-07-07-daemon-machine-runtime-hierarchy task-03) ──
# design §5.1/§5.2/§5.3：机器级聚合视图与 mutation，全部 RuntimeAdminUser 权限
# + 机器归属校验（D-001）。/machines 为独立固定前缀，不与 /runtimes/{runtime_id}
# 动态段冲突（design §5.1）。


@router.get(
    "/machines",
    response_model=DaemonMachineListResponseWithPending,
)
async def list_machines(
    session: SessionDep,
    user: RuntimeAdminUser,
    q: str | None = Query(default=None, max_length=200),
    status: str | None = Query(default=None, max_length=20),
    provider: str | None = Query(default=None, max_length=50),
    user_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> DaemonMachineListResponseWithPending:
    """平台管理员分页查看全部 owner 的 daemon 机器（design §5.1 / FR-1）。

    普通账号仅见自己的机器（service 层强制 ``actor == user_id``，请求 ``user_id`` 被忽略）。
    ``list_machines`` 内部已先 ``cleanup_stale_runtimes`` 收敛 stale 状态，router 不重复调。
    2026-08-28-daemon-agent-share task-07：附加 shared_to_me 共享区块（design §5
    Phase 2.2）——独立成块不混入 items，无授权数据时空列表（零行为变化）。
    2026-08-29-daemon-selfupdate-safety task-06：items 透出机器级 pending_update
    （FR-04 / D-004@v1，_build_machine_read 组装，无 pending 时 null）。
    """
    svc = DaemonService(session)
    rows, runtimes_by_instance, total, shared = await svc.list_machines(
        actor_user_id=user.id,
        is_platform_admin=user.is_platform_admin,
        q=q,
        status=status,
        provider=provider,
        user_id=user_id,
        limit=limit,
        offset=offset,
    )
    items = [
        _build_machine_read(inst, owner, runtimes_by_instance.get(inst.id, []))
        for inst, owner in rows
    ]
    return DaemonMachineListResponseWithPending(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        shared_to_me=[_shared_machine_view(row) for row in shared],
    )


@router.patch(
    "/machines/{instance_id}",
    response_model=DaemonMachineRead,
)
async def update_machine(
    instance_id: uuid.UUID,
    data: DaemonMachineUpdate,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonMachineRead:
    """PATCH machine display_alias（design §5.2 / D-001 / FR-2）。

    省略 display_alias = 不变；显式 null/空白 = 清空（与 runtime 级 PATCH 语义一致）。
    0-runtime 机器亦可改（直写 daemon_instances）。归属校验/404 由 service
    ``_get_owned_instance`` 完成（越权 403 / 不存在 404）。
    """
    from sqlmodel import col as _col

    from app.modules.daemon.model import DaemonRuntime

    svc = DaemonService(session)
    instance = await svc.update_machine_alias(
        instance_id,
        user.id,
        display_alias=data.display_alias,
        display_alias_set="display_alias" in data.model_fields_set,
        is_platform_admin=user.is_platform_admin,
    )
    # update_machine_alias 只返回 instance，机器卡需重新聚合 owner+runtimes。
    owner = await session.get(User, instance.user_id)
    runtimes = list(
        (
            await session.execute(
                select(DaemonRuntime)
                .where(_col(DaemonRuntime.daemon_instance_id) == instance.id)
                .order_by(_col(DaemonRuntime.provider))
            )
        )
        .scalars()
        .all()
    )
    return _build_machine_read(instance, owner, runtimes)


@router.post(
    "/machines/{instance_id}/self-update",
)
async def trigger_machine_self_update(
    instance_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> dict[str, str | bool]:
    """推送 daemon 自更新指令到指定机器（admin，design §5.3 / FR-3）。

    机器级直接以 ``instance_id`` 作 ``daemon_id`` 路由 WS（ws_hub 第一参数即
    daemon_id，task-06），复用既有 ``daemon:self_update`` 消息，不引入新事件 type
    （design §14）。先 ``_get_owned_instance`` 做归属校验（403/404），离线或 WS 发送
    失败 → 504 ``DaemonRuntimeOffline``（与 runtime 级 self-update 同款）。
    """
    svc = DaemonService(session)
    await svc._get_owned_instance(instance_id, user.id, is_platform_admin=user.is_platform_admin)

    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    latest = get_daemon_latest_version()
    hub = get_daemon_ws_hub()
    sent = await hub.send_self_update(instance_id, version=latest)
    if not sent:
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline

        raise DaemonRuntimeOffline(
            "目标机器当前离线或消息下发失败，请确认守护进程在线后重试。",
            details={"daemon_instance_id": str(instance_id)},
        )
    return {"sent": True, "latest_version": latest}


@router.post(
    "/machines/{instance_id}/cleanup",
)
async def trigger_machine_cleanup(
    instance_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> dict[str, bool]:
    """推送 daemon 本地缓存清理指令到指定机器（admin）。

    daemon 按 cleanup.ts 黑名单删除 specs 缓存 / Claude 会话日志 / 备份 / 日志文件，
    未列入清理目标的内容（config.json、locks/、workspaces/、outbox/、runs/ 等）一律
    保留。fire-and-forget 模式。
    """
    svc = DaemonService(session)
    await svc._get_owned_instance(instance_id, user.id, is_platform_admin=user.is_platform_admin)

    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    sent = await hub.send_cleanup(instance_id)
    if not sent:
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline

        raise DaemonRuntimeOffline(
            "目标机器当前离线或消息下发失败，请确认守护进程在线后重试。",
            details={"daemon_instance_id": str(instance_id)},
        )
    return {"sent": True}


@router.post(
    "/machines/{instance_id}/sillyspec-update",
)
async def trigger_machine_sillyspec_update(
    instance_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> dict[str, bool]:
    """推送 sillyspec 升级指令到指定机器（admin，2026-08-31-machine-sillyspec-version FR-02）.

    机器级直接以 ``instance_id`` 作 ``daemon_id`` 路由 WS，发送
    ``daemon:sillyspec_update``（fire-and-forget，无回执，同 CLEANUP 语义）；
    daemon 收到后调 sillyspec-manager 执行本机 npm 升级，状态机经心跳
    sillyspec_update 字段回传（不走本消息）。先 ``_get_owned_instance`` 做归属
    校验（越权/不存在 404），离线或 WS 发送失败 → 504 ``DaemonRuntimeOffline``
    （与机器级 self-update/cleanup 同款文案与 details 结构）。

    刻意不返回 ``latest_version``：npm latest 由 daemon 自行探测并经心跳
    sillyspec_latest_version 上报，backend 不代查（design §接口定义）。
    """
    svc = DaemonService(session)
    await svc._get_owned_instance(instance_id, user.id, is_platform_admin=user.is_platform_admin)

    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    sent = await hub.send_sillyspec_update(instance_id)
    if not sent:
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline

        raise DaemonRuntimeOffline(
            "目标机器当前离线或消息下发失败，请确认守护进程在线后重试。",
            details={"daemon_instance_id": str(instance_id)},
        )
    return {"sent": True}


class MachineSillySpecResolveRequest(BaseModel):
    """Body for POST /machines/{instance_id}/sillyspec-resolve（task-02 / FR-02）。

    ``strategy`` 用 Literal 限定 keep_local / take_platform（非法值 422）；
    ``change`` 走白名单正则（首字符字母数字，其余字母数字/./-/_，长度 1-128）
    且显式拒绝含 ``..``（防路径穿越；daemon 侧 CLI ``assertSafeChangeName``
    SEC-05 双保险，backend 只做格式校验不查存在性——机器才是事实源）。
    """

    change: str
    strategy: Literal["keep_local", "take_platform"]
    workspace_id: uuid.UUID

    @field_validator("change")
    @classmethod
    def _validate_change(cls, v: str) -> str:
        if ".." in v or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", v) is None:
            raise ValueError(
                "change 仅允许字母数字与 . _ - 组成（长度 1-128，首字符须为字母数字，"
                "且不得包含 ..）。"
            )
        return v


@router.post(
    "/machines/{instance_id}/sillyspec-resolve",
)
async def trigger_machine_sillyspec_resolve(
    instance_id: uuid.UUID,
    data: MachineSillySpecResolveRequest,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> dict[str, bool]:
    """推送 sillyspec 冲突裁决指令到指定机器（admin，task-02 / FR-02 / D-001@v1）。

    机器级直接以 ``instance_id`` 作 ``daemon_id`` 路由 WS，发送
    ``daemon:sillyspec_resolve``（fire-and-forget，无回执，同 SILLYSPEC_UPDATE
    语义，不排队不落库）；daemon 收到后调本机 sillyspec CLI 执行裁决（strategy
    下划线字面量 → --keep-local / --take-platform flag 的映射归 daemon 侧单点），
    结果经心跳 sillyspec_command_result 字段回传（终态窗口内，不走本消息）。
    先 ``_get_owned_instance`` 做归属校验（越权/不存在 404，普通用户非本机防
    存在性泄漏，owner 与平台管理员放行），离线或 WS 发送失败 → 504
    ``DaemonRuntimeOffline``（与机器级 sillyspec-update 先例同款文案与 details）。

    2026-09-09-conflict-root-workspace-scoping task-04（FR-01/FR-05）：请求体
    必填 ``workspace_id`` 随 payload 透传（daemon 按工作区映射取根，未命中
    workspace_root_unknown 不回退单槽位）；另校验当前用户是该 workspace 成员
    （写操作防越权，复用 compare 侧 ``ensure_workspace_member`` 同一权限集合，
    action=「对」文案动作词）。
    """
    svc = DaemonService(session)
    await svc._get_owned_instance(instance_id, user.id, is_platform_admin=user.is_platform_admin)

    from app.modules.daemon.sillyspec_compare import SillySpecCompareService

    await SillySpecCompareService(session).ensure_workspace_member(
        user.id, data.workspace_id, action="对"
    )

    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    sent = await hub.send_sillyspec_resolve(
        instance_id, data.change, data.strategy, data.workspace_id
    )
    if not sent:
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline

        raise DaemonRuntimeOffline(
            "目标机器当前离线或消息下发失败，请确认守护进程在线后重试。",
            details={"daemon_instance_id": str(instance_id)},
        )
    return {"sent": True}


@router.post(
    "/machines/{instance_id}/sillyspec-ghost-cleanup",
)
async def trigger_machine_sillyspec_ghost_cleanup(
    instance_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> dict[str, bool]:
    """推送 sillyspec ghost 清理指令到指定机器（admin，task-02 / FR-03 / D-001@v1）。

    机器级直接以 ``instance_id`` 作 ``daemon_id`` 路由 WS，发送
    ``daemon:sillyspec_ghost_cleanup``（fire-and-forget，无回执，同 SILLYSPEC_UPDATE
    语义，不排队不落库）；daemon 收到后调本机 sillyspec CLI 清理 ghost 行并
    platform sync 收敛，结果经心跳 sillyspec_command_result 字段回传（终态窗口
    内，不走本消息）。权限/归属校验与 504 结构与 sillyspec-resolve 同款
    （RuntimeAdminUser + ``_get_owned_instance``，owner 与平台管理员放行）。
    """
    svc = DaemonService(session)
    await svc._get_owned_instance(instance_id, user.id, is_platform_admin=user.is_platform_admin)

    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    sent = await hub.send_sillyspec_ghost_cleanup(instance_id)
    if not sent:
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline

        raise DaemonRuntimeOffline(
            "目标机器当前离线或消息下发失败，请确认守护进程在线后重试。",
            details={"daemon_instance_id": str(instance_id)},
        )
    return {"sent": True}


@router.delete(
    "/machines/{instance_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_machine(
    instance_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> None:
    """删除机器条目（daemon_instance 级物理删除，ql-20260829-006-6a9e）。

    守卫链在 service ``delete_machine``：归属 404 / 心跳新鲜 409（daemon 在跑时
    删除会产生僵尸心跳，须先停止）/ 工作区绑定与共享授权 409（RESTRICT 前置）/
    借用审计红线 409 / in-flight lease+change_write 409。通过后物理删，CASCADE
    清该机全部 runtimes 及其会话/任务记录；daemon 之后重新启动会以同一
    daemon_local_id 重建（与 runtime 级删除同款复活语义）。
    """
    svc = DaemonService(session)
    await svc.delete_machine(instance_id, user.id, is_platform_admin=user.is_platform_admin)


@router.get(
    "/instances",
    response_model=list[DaemonInstanceRead],
)
async def list_daemon_instances(
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> list[DaemonInstanceRead]:
    """List online daemon instances for the current user (task-10 / FR-09).

    Used by workspace-daemon-switcher to show available daemons.
    Returns each daemon instance with its enabled provider runtimes so the
    frontend can render provider badges without extra round-trips.
    """
    svc = DaemonService(session)
    await svc.cleanup_stale_runtimes()
    instances = await svc.list_instances(user.id)

    # B2（性能，N+1 规避）：原循环每实例单独查 runtimes（+ 每次重 import RuntimeService），
    # 改成一次 IN 查询按 daemon_instance_id 分组。对齐 list_machines 的 runtimes_by_instance。
    from app.modules.daemon.runtime.service import RuntimeService

    rt_svc = RuntimeService(session)
    runtimes_by_instance = await rt_svc._get_runtimes_by_instances([inst.id for inst in instances])
    reads: list[DaemonInstanceRead] = []
    for inst in instances:
        # task-07：分组值改 list[tuple[runtime, instance]]；此处只用 runtime 字段
        # （instance 与外层 inst 同源，不重复取），解构忽略 instance。
        provider_rows = runtimes_by_instance.get(inst.id, [])
        reads.append(
            DaemonInstanceRead(
                id=inst.id,
                hostname=inst.hostname,
                display_alias=inst.display_alias,
                status=inst.status or "online",
                providers=[
                    DaemonInstanceProviderItem(
                        provider=r.provider or "",
                        status=r.status or "unknown",
                        version=r.version,
                    )
                    for r, _instance in provider_rows
                ],
            )
        )
    return reads


# ── 冲突对比（2026-09-07-conflict-diff-compare task-04 / FR-06~09 / D-001@v1）──
# design §7.2 SillySpecConflictCompareResponse 族：编排与 diff 计算在
# sillyspec_compare.py（service 层），此处只落响应 DTO 与参数校验/权限/组装。


class SillySpecConflictDiffRow(BaseModel):
    """spec-tree 比对的对齐行（design §7.2 files[].diff_rows[] 单项）。

    ``type`` = equal（双侧同）/ delete（本地删，platform_* 为 null）/ insert
    （平台增，local_* 为 null）；replace 段在 service 侧展开为相邻 delete+insert。
    lineno 双侧各自从 1 起。
    """

    type: Literal["equal", "delete", "insert"]
    local_lineno: int | None = None
    local_text: str | None = None
    platform_lineno: int | None = None
    platform_text: str | None = None


class SillySpecConflictCompareFile(BaseModel):
    """spec-tree 比对的单文件结果（design §7.2 files[] 单项）。

    ``status`` 四分类（Grill B4）：modified / local_only（本地有平台缺失或读取
    被拒）/ platform_only / identical；双侧均缺失的路径不进本清单（计数在顶层
    ``dropped_paths``）。本地 truncated/binary 无 content 的文件 ``diff_rows``
    为空（不出全 insert 的失真信号）；单文件 diff 超 5000 行截断置
    ``diff_truncated``。
    """

    path: str
    status: Literal["modified", "local_only", "platform_only", "identical"]
    local_mtime: str | None = None
    platform_mtime: str | None = None
    local_truncated: bool = False
    local_missing: bool = False
    diff_rows: list[SillySpecConflictDiffRow] = Field(default_factory=list)
    diff_truncated: bool = False
    binary: bool = False


class SillySpecConflictProgressRow(BaseModel):
    """progress 比对行（design §7.2 progress_rows[] 单项，D-003@v1 对比表）。

    字段白名单六项（当前阶段/阶段标签/步骤进度/最近活跃/ql_id/ghost），缺失侧
    显式「—」；``differ`` 由两侧展示值不等判定。
    """

    label: str
    local_value: str
    platform_value: str
    differ: bool


class SillySpecConflictCompareResponse(BaseModel):
    """GET /machines/{id}/sillyspec-conflicts/{change}/compare 响应（design §7.2）。

    kind=spec-tree → ``files`` 非空 ``progress_rows`` 空；kind=progress 反之。
    ``response_truncated``：整响应超 2MB 时按文件倒序丢 diff_rows 后置 True。
    ``ql_id``/时间字段为字符串原样透传（daemon 机器本地钟，跨机比较仅辅助）。
    """

    change: str
    kind: Literal["spec-tree", "progress"]
    ql_id: str | None = None
    conflict_created_at: str | None = None
    local_updated_at: str | None = None
    platform_updated_at: str | None = None
    response_truncated: bool = False
    dropped_paths: int = 0
    files: list[SillySpecConflictCompareFile] = Field(default_factory=list)
    progress_rows: list[SillySpecConflictProgressRow] = Field(default_factory=list)


def _validate_sillyspec_change_segment(change: str) -> str:
    """compare 路径段 ``change`` 白名单（复用 resolve ``_validate_change`` 同款正则）。

    GET 的路径参数不进 Body 模型，此处手动校验（422 早于任何 RPC 外呼）：
    首字符字母数字、其余 ``[A-Za-z0-9._-]``、长度 1-128，且显式拒 ``..``
    （正则可过但语义是穿越，resolve 端点同款双保险）。
    """
    if ".." in change or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", change) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "change 仅允许字母数字与 . _ - 组成（长度 1-128，首字符须为字母数字，"
                "且不得包含 ..）。"
            ),
        )
    return change


@router.get(
    "/machines/{instance_id}/sillyspec-conflicts/{change}/compare",
    response_model=SillySpecConflictCompareResponse,
)
async def compare_machine_sillyspec_conflict(
    instance_id: uuid.UUID,
    change: str,
    session: SessionDep,
    user: RuntimeAdminUser,
    kind: Literal["spec-tree", "progress"] = Query(description="冲突类型（心跳 type 字段）"),
    workspace_id: uuid.UUID = Query(description="平台侧 spec_root/progress 定位用工作区"),
) -> SillySpecConflictCompareResponse:
    """拉取单条 sillyspec 冲突的双侧对比（admin，task-04 / FR-06~09 / D-001@v1）.

    权限同裁决端点（RuntimeAdminUser + ``_get_owned_instance`` 越权 404），
    另校验当前用户是 ``workspace_id`` 成员（平台侧内容按工作区定位，Grill B1：
    compare 数据与裁决同一权限集合）。RPC 腿走请求/响应式
    ``sillyspec_conflict_snapshot``（explorer 先例，区别于一写即忘的裁决通道），
    显式 15s 超时；机器离线/超时 → 504 既有异常形态原样上抛。编排/diff 计算在
    ``sillyspec_compare.SillySpecCompareService``（service 层），本端点只做
    校验/权限/响应组装。
    """
    _validate_sillyspec_change_segment(change)

    svc = DaemonService(session)
    await svc._get_owned_instance(instance_id, user.id, is_platform_admin=user.is_platform_admin)

    from app.modules.daemon.sillyspec_compare import SillySpecCompareService

    payload = await SillySpecCompareService(session).compare(
        instance_id=instance_id,
        user_id=user.id,
        change=change,
        kind=kind,
        workspace_id=workspace_id,
    )
    return SillySpecConflictCompareResponse.model_validate(payload)
