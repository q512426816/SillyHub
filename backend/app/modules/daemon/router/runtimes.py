"""runtime 管理端点 + 共享机器读模型装配层（task-07 拆分）。

11 个 runtime 端点（usage/page 列表、{runtime_id} CRUD、allowed-roots 策略推送、
self-update、offline、全局列表）。``_derive_policy_version`` 定义于此、经包
``__init__`` 重导出，调用点经 ``_router`` 延迟解析（test_allowed_roots_policy_push
setattr 拦截，D-007）。
Machine*Read 模型族 + WithPending 子类 + ``_runtime_read`` / ``_build_machine_read``
/ ``_shared_machine_view`` 装配 helper 就近放本域（machines.py 端点经本模块取用，
避免 runtimes↔machines 循环 import）。
同形状保序对：/runtimes/usage 与 /runtimes/page 先于 /runtimes/{runtime_id}。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Query, status
from pydantic import BaseModel

import app.modules.daemon.router as _router
from app.core.auth_deps import get_current_principal
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.daemon.grants.queries import SharedMachineRow
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.daemon.router import RuntimeAdminUser, SessionDep, router
from app.modules.daemon.router.heartbeat import (
    DaemonHeartbeatSillySpecChange,
    DaemonHeartbeatSillySpecConflict,
)
from app.modules.daemon.router.version import get_daemon_latest_version
from app.modules.daemon.schema import (
    DaemonMachineListResponse,
    DaemonMachineRead,
    DaemonRuntimeAllowedRootsUpdate,
    DaemonRuntimeListResponse,
    DaemonRuntimeRead,
    DaemonRuntimeUpdate,
    OwnerRead,
    RuntimeUsageListResponse,
    RuntimeUsageWindow,
    SharedMachineRuntimeView,
    SharedMachineView,
)
from app.modules.daemon.service import DaemonRuntimeNotFound, DaemonService

log = get_logger("app.modules.daemon.router")

# ── Runtime usage stats (FR-03 / D-002·003·004) ──────────────────────────────
# 静态路径 /runtimes/usage 必须声明在动态 /runtimes/{runtime_id} 之前：FastAPI 按声明
# 顺序匹配，否则 "usage" 会被 {runtime_id} 捕获，再 UUID parse 失败 -> 422。
# 聚合在 service 层(task-08)，router 仅做参数校验 + DTO 封装；window Enum 边界非法值
# 由 FastAPI 自动返回 422。


@router.get(
    "/runtimes/usage",
    response_model=RuntimeUsageListResponse,
)
async def get_runtimes_usage(
    session: SessionDep,
    user: RuntimeAdminUser,
    window: RuntimeUsageWindow = Query(
        RuntimeUsageWindow.DAY7,
        description="时间窗：1d(本地自然日 today 00:00，按小时) / 7d / 30d(按日)",
    ),
) -> RuntimeUsageListResponse:
    """批量返回全部 runtime 在指定时间窗内的 token/cache/cost 用量(FR-03)。

    聚合在 service 层用单条 LEFT JOIN+COALESCE SQL 去重(D-003@v2,task-08)；
    分组粒度 1d→hour / 7d·30d→day(D-002@v1)；起点 1d=本地自然日 today 00:00(D-004@v1)。
    空窗 / 无 runtime 正常返回 200 ``{"window":..., "runtimes":[]}``。
    """
    from app.modules.daemon.runtime.service import RuntimeService

    svc = RuntimeService(session)
    runtimes = await svc.get_runtimes_usage(window.value)
    log.info("runtimes_usage_served", window=window.value, count=len(runtimes))
    return RuntimeUsageListResponse(window=window.value, runtimes=runtimes)


def _derive_policy_version(updated_at: datetime | None) -> int:
    """Derive a monotonic policy ``version`` from a runtime's ``updated_at``.

    task-08 / D-004：daemon uses this to drop stale/reordered
    ``policy_update`` pushes (only accept when incoming version > local).
    Epoch millis keeps second-level writes distinct and is monotonic across
    successive DB writes (``update_allowed_roots`` bumps ``updated_at`` each
    call). A missing ``updated_at`` falls back to wall-clock now so the push
    still carries a sensible, forward-only value.
    """
    ts = updated_at if updated_at is not None else datetime.now(UTC)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return int(ts.timestamp() * 1000)


# ── 机器视图 pending_update 透出 DTO（inline，task-06 / FR-04 / D-004@v1）──────
# schema.py 的 DaemonMachineRead / DaemonRuntimeRead 无 pending_update 字段；本
# 变更不动 schema.py（task 边界），照 task-07 heartbeat DTO 内联先例在 router 内
# 扩展（子类化仅加一个 nullable 字段，其余字段/校验全继承）。openapi.json 再导出
# 与三端 gen:types 归 task-08。经基础 response_model 序列化时子类实例的多余字段
# 会被 FastAPI 丢弃（TypeAdapter 按声明类型 dump），故其他仍返回基础 Read 的端点
# 响应 shape 零变化。


class MachinePendingUpdateRead(BaseModel):
    """机器视图 pending_update 嵌套（design S4 / M11）。

    即 daemon_instances.pending_update JSON 列原样透出：三上报字段 + backend 首落
    库时盖的 ``since``（同内容重放心跳保留原 since，不退化成最后心跳时间）。
    NULL（无待升级）→ 机器视图字段为 null。
    """

    reason: str
    current_version: str
    target_version: str
    since: datetime


class MachineSillySpecUpdateRead(BaseModel):
    """机器视图 sillyspec_update 嵌套（2026-08-31-machine-sillyspec-version FR-05）。

    即 daemon_instances.sillyspec_update JSON 列原样透出（design §接口定义）：
    daemon 侧 sillyspec-manager 状态机投影五字段（state 取值 running/deferred/
    success/failed，trigger 取值 server_command/auto）+ backend 首落库时盖的
    ``since``（同内容重放心跳保留原 since，MachinePendingUpdateRead 同款语义）。
    NULL（无升级进行中 / 终态展示窗口已过）→ 机器视图字段为 null。

    五上报字段全 nullable 对齐 daemon 上报形态：running/deferred 可无 to_version、
    非 failed 无 error（success 必带 to_version 由 daemon 侧保证，后端不收紧）。
    """

    state: str | None = None
    trigger: str | None = None
    from_version: str | None = None
    to_version: str | None = None
    error: str | None = None
    since: datetime | None = None


class MachineSillySpecStatusRead(BaseModel):
    """机器视图 sillyspec_status 嵌套（2026-09-02-changes-overview-card FR-05）。

    即 daemon_instances.sillyspec_status JSON 列宽松透出（design §4 摘要）：
    daemon 侧采集的 ``progress show --json`` envelope 摘要（计数 + changes[] +
    pending_conflicts[]）。与 sillyspec_update 不同，backend 不补任何字段（无
    since 注入），落库形态=上报形态，故嵌套项直接复用心跳 DTO 的
    DaemonHeartbeatSillySpecChange / DaemonHeartbeatSillySpecConflict /
    DaemonHeartbeatSillySpecChangeSteps（同形零转换，免三胞胎模型漂移）。
    NULL（总览不可用——sillyspec 未安装或版本过低）→ 机器视图字段为 null。
    时间字段（generated_at/last_active/created_at）为 ISO8601 字符串原样透传。
    """

    ok: bool | None = None
    errors_count: int | None = None
    warnings_count: int | None = None
    generated_at: str | None = None
    active_changes: int | None = None
    healthy_count: int | None = None
    ghost_count: int | None = None
    conflict_count: int | None = None
    # 冲突按 type 计数映射（如 {"spec-tree": 2, "progress": 9}）——对齐 daemon 侧
    # SillySpecStatusSummary.conflict_types（Record<string, number>）产出形态。
    # （task-04 复核修正：原 list[str] 收 dict 会 422 整条心跳——保活通道不可断。）
    conflict_types: dict[str, int] | None = None
    changes: list[DaemonHeartbeatSillySpecChange] | None = None
    pending_conflicts: list[DaemonHeartbeatSillySpecConflict] | None = None


class MachineSillySpecCommandResultRead(BaseModel):
    """机器视图 sillyspec_command_result 嵌套（2026-09-04-conflict-resolve-entry FR-05）。

    即 daemon_instances.sillyspec_command_result JSON 列宽松透出（design §7）：
    daemon 侧 sillyspec 命令执行器的最新结果槽（action/change/strategy/state/
    exit_code/error/executed_at）。与 sillyspec_status 同款零转换——backend 不补
    字段，落库形态=上报形态（七字段全宽松可选，与心跳 DTO 同形免三胞胎模型漂移）。
    NULL（终态展示窗口已过期 / register 恒清）→ 机器视图字段为 null；executed_at
    为机器本地钟 ISO8601 字符串原样透传（跨机比较仅作辅助——X-18）。
    """

    action: str | None = None
    change: str | None = None
    strategy: str | None = None
    state: str | None = None
    exit_code: int | None = None
    error: str | None = None
    executed_at: str | None = None


class DaemonMachineReadWithPending(DaemonMachineRead):
    """DaemonMachineRead + 机器级 pending_update + sillyspec 三字段（GET /machines 透出用）。

    2026-08-31-machine-sillyspec-version task-03 / FR-05：sillyspec_version /
    sillyspec_latest_version / sillyspec_update 三字段就近跟随 pending_update 走
    router 内子类扩展（MachinePendingUpdateRead 现状就近原则，schema.py 基类保持
    零改动——本组字段是同一读视图契约 MachineSillySpecView，拆两处放置会割裂）。
    """

    pending_update: MachinePendingUpdateRead | None = None
    sillyspec_version: str | None = None
    sillyspec_latest_version: str | None = None
    sillyspec_update: MachineSillySpecUpdateRead | None = None
    # 2026-09-02-changes-overview-card task-01 / FR-05：进度总览快照就近跟随
    # sillyspec 三字段同款子类扩展；组装接线（_build_machine_read 逐字段构造）
    # 归 task-03，本卡仅定义读取模型进 OpenAPI（供 task-05 gen:types）。
    sillyspec_status: MachineSillySpecStatusRead | None = None
    # 2026-09-04-conflict-resolve-entry task-03 / FR-05：命令结果槽同款子类扩展
    # 跟随 sillyspec 四字段（组装接线在 _build_machine_read 逐字段构造，供前端
    # PlatformSyncSection 回显与 task-02 端点共享读视图）。
    sillyspec_command_result: MachineSillySpecCommandResultRead | None = None


class DaemonMachineListResponseWithPending(DaemonMachineListResponse):
    """GET /machines 响应（items 换 pending_update 扩展视图）。"""

    items: list[DaemonMachineReadWithPending]


class DaemonRuntimeReadWithPending(DaemonRuntimeRead):
    """DaemonRuntimeRead + 机器级 pending_update（/runtimes/page 透出用）。"""

    pending_update: MachinePendingUpdateRead | None = None


class DaemonRuntimeListResponseWithPending(DaemonRuntimeListResponse):
    """GET /runtimes/page 响应（items 换 pending_update 扩展视图）。"""

    items: list[DaemonRuntimeReadWithPending]


def _runtime_read(
    runtime: object,
    owner: object | None = None,
    instance: object | None = None,
) -> DaemonRuntimeRead:
    """Build DaemonRuntimeRead, attaching nested OwnerRead when an owner user
    row is available (task-04 / D-006@v1)。2026-07-04-daemon-version-management：
    instance 非空时填 daemon_version/daemon_build_id（JOIN daemon_instances 带出）。

    task-06（FR-04 / D-004@v1）：instance 非空时同款注入机器级 pending_update。
    返回类型升级为 WithPending 子类——仍返回基础 DaemonRuntimeRead 的端点经
    response_model 序列化时该字段被丢弃（shape 零变化），仅 /runtimes/page
    （WithPending 响应模型）透出。"""
    read = DaemonRuntimeReadWithPending.model_validate(runtime)
    update: dict[str, object] = {}
    if owner is not None:
        update["owner"] = OwnerRead(
            user_id=getattr(owner, "id", None),
            email=getattr(owner, "email", None),
            display_name=getattr(owner, "display_name", None),
        )
    if instance is not None:
        update["daemon_version"] = getattr(instance, "version", None)
        update["daemon_build_id"] = getattr(instance, "build_id", None)
        # pending_update JSON 原样转嵌套 Read（dict→model 校验，since ISO→datetime）。
        raw_pending = getattr(instance, "pending_update", None)
        update["pending_update"] = (
            MachinePendingUpdateRead.model_validate(raw_pending)
            if raw_pending is not None
            else None
        )
    if not update:
        return read
    return read.model_copy(update=update)


def _build_machine_read(
    instance: DaemonInstance,
    owner: User | None,
    runtimes: list[DaemonRuntime],
) -> DaemonMachineReadWithPending:
    """把 (instance, owner, runtimes) ORM 组装成机器视图（design §5.1）。

    纯组装函数（不做 SQL）：GET /machines 与 PATCH /machines/{id} 共用。runtime 卡
    复用 _runtime_read 填充 owner/instance；machine 卡再聚合 runtime_count /
    online_runtime_count（design §4.1 机器级聚合字段）。0-runtime 机器传 ``[]`` 正常。

    task-06（FR-04 / D-004@v1）：返回 WithPending 子类——instance.pending_update
    （JSON，含 since）透出到机器视图；PATCH /machines/{id} 仍声明基础
    response_model（DaemonMachineRead），该字段经基础适配器序列化被丢弃，
    仅 GET /machines（WithPending 响应模型）透出。

    2026-08-31-machine-sillyspec-version task-03 / FR-05：同款透出 sillyspec 三字段
    （sillyspec_version / sillyspec_latest_version / sillyspec_update 嵌套），
    显式逐字段构造（见函数体注释）。
    """
    runtime_reads = [_runtime_read(r, owner, instance) for r in runtimes]
    # 直接构造（不走 model_validate(instance)）：runtime_count/online_runtime_count
    # 是派生字段（design §5.1），daemon_instance ORM 无此二属性，model_validate 会在
    # model_copy 填值前抛 ValidationError（task-04 测试捕获）。显式传全部字段。
    return DaemonMachineReadWithPending(
        id=instance.id,
        hostname=instance.hostname,
        display_alias=instance.display_alias,
        os=instance.os,
        arch=instance.arch,
        status=instance.status,
        last_heartbeat_at=instance.last_heartbeat_at,
        version=instance.version,
        build_id=instance.build_id,
        # 2026-08-05-daemon-start-time D-002@v1：进程启动时间，直接读 instance.started_at
        # （task-03 已加该字段，timezone=True nullable）。旧 daemon / 未上报 → None。
        started_at=instance.started_at,
        # task-06 / FR-04：心跳 upsert 落库的 pending JSON 原样透出（含 since）；
        # dict→嵌套 Read 校验；NULL（无待升级）→ None。
        pending_update=(
            MachinePendingUpdateRead.model_validate(instance.pending_update)
            if instance.pending_update is not None
            else None
        ),
        # 2026-08-31-machine-sillyspec-version task-03 / FR-05：sillyspec 三字段显式
        # 构造——本函数逐字段构造不走 model_validate，漏传即静默丢字段（Design Grill
        # F2）。version/latest 直读列；update JSON dict→嵌套 Read 校验（since
        # ISO→datetime），NULL（无升级）→ None。
        sillyspec_version=instance.sillyspec_version,
        sillyspec_latest_version=instance.sillyspec_latest_version,
        sillyspec_update=(
            MachineSillySpecUpdateRead.model_validate(instance.sillyspec_update)
            if instance.sillyspec_update is not None
            else None
        ),
        # 2026-09-02-changes-overview-card task-03 / FR-05：sillyspec_status 同款
        # 显式构造（Design Grill F2 教训——本函数逐字段构造不走 model_validate，
        # 漏传即静默丢字段）。JSON dict→宽松同形 Read 校验（零转换投影）；
        # NULL（总览不可用——未安装/版本过低）→ None。
        sillyspec_status=(
            MachineSillySpecStatusRead.model_validate(instance.sillyspec_status)
            if instance.sillyspec_status is not None
            else None
        ),
        # 2026-09-04-conflict-resolve-entry task-03 / FR-05：command_result 同款
        # 显式构造（Design Grill F2 教训——本函数逐字段构造不走 model_validate，
        # 漏传即静默丢字段）。JSON dict→宽松同形 Read 校验（零转换投影）；
        # NULL（终态窗口过期 / register 恒清）→ None。
        sillyspec_command_result=(
            MachineSillySpecCommandResultRead.model_validate(instance.sillyspec_command_result)
            if instance.sillyspec_command_result is not None
            else None
        ),
        created_at=instance.created_at,
        owner=OwnerRead(
            user_id=owner.id,
            email=owner.email,
            display_name=owner.display_name,
        )
        if owner is not None
        else None,
        runtime_count=len(runtimes),
        online_runtime_count=sum(1 for r in runtimes if r.status == "online"),
        runtimes=runtime_reads,
    )


def _shared_machine_view(row: SharedMachineRow) -> SharedMachineView:
    """把 grants.queries.SharedMachineRow 组装成 SharedMachineView（task-13）。

    ``runtimes`` 明细行是 NamedTuple——pydantic v2 不接受 tuple 形态直接
    validate 进嵌套 model（非 dict/实例），须逐行 ``_asdict()`` 显式构造。
    五个机器级字段沿用 ``_asdict()`` 整体展开（既有 task-07 装配方式）。
    """
    return SharedMachineView(
        **{
            **row._asdict(),
            "runtimes": [SharedMachineRuntimeView(**rt._asdict()) for rt in row.runtimes],
        }
    )


# ── Runtime admin global list (task-04 / FR-01/04 / D-005@v1) ────────────────
# 固定路径 /runtimes/page 必须声明在动态 /runtimes/{runtime_id} 之前，否则
# "page" 会被 {runtime_id} 捕获再 UUID parse 失败 → 422（与 /runtimes/usage 同款约束）。


@router.get(
    "/runtimes/page",
    response_model=DaemonRuntimeListResponseWithPending,
)
async def list_runtimes_page(
    session: SessionDep,
    user: RuntimeAdminUser,
    q: str | None = Query(default=None, max_length=200),
    type_filter: str | None = Query(default=None, alias="type", max_length=50),
    status_filter: str | None = Query(default=None, alias="status", max_length=20),
    user_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=12, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> DaemonRuntimeListResponseWithPending:
    """平台管理员分页查看全部 owner 的 runtime；普通账号只见自己 (FR-01/02/04).

    2026-08-28-daemon-agent-share task-07：附加 shared_to_me 共享区块（design §5
    Phase 2.2）——独立成块不混入 items，无授权数据时空列表（零行为变化）。
    2026-08-29-daemon-selfupdate-safety task-06：items 透出机器级 pending_update
    （FR-04 / D-004@v1，_runtime_read 注入，无 pending 时 null）。
    """
    svc = DaemonService(session)
    await svc.cleanup_stale_runtimes()
    rows, total, shared = await svc.list_runtimes_page(
        actor_user_id=user.id,
        is_platform_admin=user.is_platform_admin,
        q=q,
        type_filter=type_filter,
        status_filter=status_filter,
        user_id=user_id,
        limit=limit,
        offset=offset,
    )
    return DaemonRuntimeListResponseWithPending(
        items=[_runtime_read(runtime, owner, instance) for runtime, owner, instance in rows],
        total=total,
        limit=limit,
        offset=offset,
        shared_to_me=[_shared_machine_view(row) for row in shared],
    )


@router.patch(
    "/runtimes/{runtime_id}",
    response_model=DaemonRuntimeRead,
)
async def update_runtime(
    runtime_id: uuid.UUID,
    data: DaemonRuntimeUpdate,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """PATCH runtime display_alias (task-04 / FR-03 / D-002@v1).

    省略 display_alias = 不变；显式 null/空白 = 清空；字符串 = 更新（strip）。
    """
    svc = DaemonService(session)
    runtime, instance = await svc.update_runtime(
        runtime_id,
        user.id,
        display_alias=data.display_alias,
        display_alias_set="display_alias" in data.model_fields_set,
        is_platform_admin=user.is_platform_admin,
    )
    # task-08：service 返回 (runtime, instance) tuple，经 _runtime_read 填
    # daemon_version/daemon_build_id（D-004@v1 / FR-01）。instance=None（迁移期
    # daemon_instance_id IS NULL）→ 两字段 null，向后兼容旧 daemon。
    return _runtime_read(runtime, None, instance)


@router.put(
    "/runtimes/{runtime_id}/allowed-roots",
    response_model=DaemonRuntimeRead,
)
async def update_runtime_allowed_roots(
    runtime_id: uuid.UUID,
    data: DaemonRuntimeAllowedRootsUpdate,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """PUT runtime allowed_roots sandbox (2026-06-29-runtime-allowed-roots-config task-02).

    admin 配置 daemon 可访问目录（多路径，绝对路径或 ~ 开头）。

    task-08 / design §5.3：DB 写入成功后 best-effort 推送 ``policy_update`` 到在线
    daemon（sub-second 热更新）。推送失败（runtime 离线 / 通道异常）不阻断 PUT
    响应——daemon 在下一次心跳拉取全量 resync 兜底（R-07）。``version`` 从更新后
    runtime 的 ``updated_at`` 派生为 epoch 毫秒，单调递增，供 daemon 丢弃乱序旧推送。
    """
    svc = DaemonService(session)
    try:
        runtime = await svc.update_allowed_roots(
            runtime_id,
            user.id,
            allowed_roots=data.allowed_roots,
            is_platform_admin=user.is_platform_admin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    # 2026-07-06-allowed-roots-per-runtime：PUT 写 runtime.allowed_roots +
    # bump runtime.updated_at（design §3，per-runtime 隔离，不再写 instance）。
    # WS 路由键仍按 daemon_instance.id（design §5.3）；version + roots 都从 runtime
    # 读（写入实际发生在 runtime 行）。instance 仅用于 daemon_id 路由 + 后续
    # _runtime_read 填 daemon_version/build_id。
    from app.modules.daemon.model import DaemonInstance

    instance = (
        await session.get(DaemonInstance, runtime.daemon_instance_id)
        if runtime.daemon_instance_id is not None
        else None
    )

    # task-08：best-effort WS push（daemon 离线不阻断 PUT，心跳兜底 R-07）。
    # version 派生自 runtime.updated_at（service update_allowed_roots 实际 bump 的
    # 行，epoch 毫秒，单调）。roots 亦从 runtime 读（per-runtime 隔离）。
    version = _router._derive_policy_version(runtime.updated_at)
    roots_to_push = list(runtime.allowed_roots or [])
    # 无关联 daemon_instance（迁移过渡 / 测试 fixture）→ daemon_id 退化为 runtime.id。
    daemon_id = instance.id if instance is not None else runtime.id

    # Lazy import（与 list_dir / self_update 一致）：ws_hub 单例经
    # get_daemon_ws_hub 取，测试 per-test patch 不会被模块顶部 import 绑死。
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    try:
        hub = get_daemon_ws_hub()
        # ws_hub 按 daemon_id 路由（task-06 / design §5.3）；payload 内仍带 runtime_id
        # 标识 provider 会话，由 send_policy_update 注入。
        await hub.send_policy_update(
            daemon_id,
            roots_to_push,
            version,
            payload_runtime_id=runtime.id,
        )
    except Exception:
        log.warning(
            "allowed_roots_policy_push_failed",
            runtime_id=str(runtime.id),
            daemon_id=str(daemon_id),
            version=version,
            exc_info=True,
        )
    # 用 _runtime_read 填充 instance.allowed_roots（否则前端拿到 default [~/.sillyhub]）
    return _runtime_read(runtime, instance=instance)


@router.post(
    "/runtimes/{runtime_id}/self-update",
)
async def trigger_daemon_self_update(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> dict[str, str | bool]:
    """推送 daemon 自更新指令到指定 runtime（admin）。

    通过 WS 发送 `daemon:self_update`，daemon 收到后下载最新 bundle 替换并退出重启。
    返回 `{"sent": bool, "latest_version": str}`。
    """
    from app.modules.daemon.model import DaemonRuntime
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    latest = get_daemon_latest_version()
    hub = get_daemon_ws_hub()
    # task-06: ws_hub 按 daemon_instance_id 路由；runtime_id → daemon_id。
    # 迁移窗口 runtime.daemon_instance_id IS NULL → 回退 runtime_id（兼容旧数据）。
    runtime = await session.get(DaemonRuntime, runtime_id)
    daemon_id = (runtime.daemon_instance_id if runtime else None) or runtime_id
    sent = await hub.send_self_update(daemon_id, version=latest)
    if not sent:
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline

        raise DaemonRuntimeOffline(
            "目标 runtime 当前离线或消息下发失败，请确认守护进程在线后重试。",
            details={"runtime_id": str(runtime_id)},
        )
    return {"sent": True, "latest_version": latest}


@router.get(
    "/runtimes/{runtime_id}",
    response_model=DaemonRuntimeRead,
)
async def get_runtime(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """Get daemon runtime info by ID."""
    svc = DaemonService(session)
    result = await svc.get_runtime(runtime_id, user.id, is_platform_admin=user.is_platform_admin)
    if result is None:
        raise DaemonRuntimeNotFound(
            "指定的 runtime 不存在或无权访问。",
            details={"runtime_id": str(runtime_id)},
        )
    runtime, instance = result
    # task-08：service 返回 (runtime, instance) tuple，经 _runtime_read 填
    # daemon_version/daemon_build_id（D-004@v1 / FR-01）。
    return _runtime_read(runtime, None, instance)


@router.post(
    "/runtimes/{runtime_id}/disable",
    response_model=DaemonRuntimeRead,
)
async def disable_runtime(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """Disable a daemon runtime for placement without deleting it."""
    svc = DaemonService(session)
    runtime = await svc.disable_runtime(
        runtime_id, user.id, is_platform_admin=user.is_platform_admin
    )
    # task-08：service 仅返 DaemonRuntime（disable/enable/mark_offline 未在 task-07
    # 改签名），此处回查 instance 填 daemon_version/daemon_build_id（D-004@v1 / FR-01）。
    # instance=None（迁移期 daemon_instance_id IS NULL）→ 两字段 null，兼容旧 daemon。
    instance = (
        await session.get(DaemonInstance, runtime.daemon_instance_id)
        if runtime.daemon_instance_id is not None
        else None
    )
    return _runtime_read(runtime, None, instance)


@router.post(
    "/runtimes/{runtime_id}/enable",
    response_model=DaemonRuntimeRead,
)
async def enable_runtime(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """Enable a daemon runtime, restoring online only when heartbeat is fresh."""
    svc = DaemonService(session)
    runtime = await svc.enable_runtime(
        runtime_id, user.id, is_platform_admin=user.is_platform_admin
    )
    # task-08：service 仅返 DaemonRuntime，回查 instance 填版本字段（D-004@v1 / FR-01）。
    instance = (
        await session.get(DaemonInstance, runtime.daemon_instance_id)
        if runtime.daemon_instance_id is not None
        else None
    )
    return _runtime_read(runtime, None, instance)


@router.delete(
    "/runtimes/{runtime_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_runtime(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> None:
    """Delete a daemon runtime and its bound leases/sessions (ql-20260621-012).

    Physical delete; DB ``ondelete=CASCADE`` clears ``daemon_task_leases`` and
    ``agent_sessions`` bound to this runtime. The daemon re-registers as a new
    runtime on next heartbeat.
    """
    svc = DaemonService(session)
    await svc.delete_runtime(runtime_id, user.id, is_platform_admin=user.is_platform_admin)


@router.post(
    "/runtimes/{runtime_id}/offline",
    response_model=DaemonRuntimeRead,
)
async def mark_runtime_offline(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> DaemonRuntimeRead:
    """Mark a daemon runtime offline during graceful daemon shutdown."""
    svc = DaemonService(session)
    runtime = await svc.mark_offline(runtime_id, user.id)
    # task-08：service 仅返 DaemonRuntime，回查 instance 填版本字段（D-004@v1 / FR-01）。
    instance = (
        await session.get(DaemonInstance, runtime.daemon_instance_id)
        if runtime.daemon_instance_id is not None
        else None
    )
    return _runtime_read(runtime, None, instance)


@router.get(
    "/runtimes",
    response_model=list[DaemonRuntimeRead],
)
async def list_runtimes(
    session: SessionDep,
    user: RuntimeAdminUser,
) -> list[DaemonRuntimeRead]:
    """List all daemon runtimes for the current user."""
    svc = DaemonService(session)
    await svc.cleanup_stale_runtimes()
    runtimes = await svc.list_runtimes(user.id)
    # task-08：service 返回 list[tuple[runtime, instance]]，经 _runtime_read 填
    # daemon_version/daemon_build_id（D-004@v1 / FR-01）。
    return [_runtime_read(runtime, None, instance) for runtime, instance in runtimes]
