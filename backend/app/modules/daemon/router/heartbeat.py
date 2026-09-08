"""daemon per-daemon HTTP 心跳端点 + DaemonHeartbeat* 模型族（task-07 拆分）。

POST /heartbeat 合并上报 daemon_local_id + 各 provider 状态 + sillyspec 状态机
快照；全部内联 DTO（宁宽勿断的心跳保活通道契约）随端点同迁。openapi 的
schema 名不因换文件而变（pydantic 模型名即 schema 名）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import Depends
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.auth_deps import get_current_principal
from app.modules.auth.model import User
from app.modules.daemon.router import SessionDep, router

# ── Per-daemon heartbeat DTO（inline，task-07）─────────────────────────────────
# design §5.4 / §9.1：daemon 单条心跳合并上报 daemon_local_id + 各 provider 状态。
# 原 schema.py 内的 runtime_id 版本已被 per-daemon 契约取代；DTO 内联在此避免
# 触碰 schema.py（task-05 的 allowed_path，非 task-07）。WS breaking（D-007）：
# daemon_local_id 必填，旧 daemon per-provider body 会被 pydantic 拒成 422。


class DaemonHeartbeatProviderItem(BaseModel):
    """单个 provider 心跳上报项（per-daemon heartbeat body 内 ``providers[]``）。"""

    provider: str = Field(min_length=1, max_length=50)
    status: str = Field(default="online", max_length=20)


class DaemonHeartbeatPendingUpdate(BaseModel):
    """心跳 pending_update 载荷（task-06 / FR-04 / D-004@v1 / design S4）。

    daemon 推迟自升级期间（忙推迟 / disk_change 复查等待）每轮心跳携带；语义同
    daemon 侧 pending-update.json 的三字段投影（task-05，``since`` 不上报——backend
    首落库时盖 ``since=now``，daemon 侧值无意义）。reason 当前取值
    ``server_command`` / ``disk_change``（design §5）；此处不收紧成 Literal——收紧
    会让未来新增 reason 的整条心跳 422（心跳是保活通道，宁宽勿断）。
    """

    reason: str = Field(min_length=1, max_length=50)
    current_version: str = Field(min_length=1, max_length=100)
    target_version: str = Field(min_length=1, max_length=100)


class DaemonHeartbeatSillySpecUpdate(BaseModel):
    """心跳 sillyspec_update 载荷（2026-08-31-machine-sillyspec-version FR-05）.

    daemon 的 sillyspec 升级状态机投影（design §接口定义）：state 当前取值
    ``running`` / ``deferred`` / ``success`` / ``failed`` / ``up_to_date``
    （ql-20260904-019：手动指令已最新的明确反馈终态），trigger 取值
    ``server_command`` / ``auto``；``since`` 不上报——backend 首落库时盖
    ``since=now``（同 pending_update 先例），同内容重放保留原 since。
    state/trigger 均不收紧成 Literal——收紧会让未来新增取值的整条心跳 422
    （心跳是保活通道，宁宽勿断，DaemonHeartbeatPendingUpdate.reason 同决策）；
    error 在服务层截断至 200 字符后落库。
    """

    state: str | None = Field(default=None, max_length=50)
    trigger: str | None = Field(default=None, max_length=50)
    from_version: str | None = Field(default=None, max_length=50)
    to_version: str | None = Field(default=None, max_length=50)
    error: str | None = Field(default=None, max_length=200)


class DaemonHeartbeatSillySpecChangeSteps(BaseModel):
    """心跳 sillyspec_status.changes[].steps（design §4 envelope steps 投影）。

    ``{total, completed}`` 全可选宽松形态——steps 结构若在 envelope 侧演进，
    不应让整条心跳 422（心跳是保活通道，宁宽勿断）。
    """

    total: int | None = None
    completed: int | None = None


class DaemonHeartbeatSillySpecChange(BaseModel):
    """心跳 sillyspec_status.changes[] 单项（design §4 摘要投影）.

    envelope 变更行六字段投影（``stages``/``readable``/``command`` 不透传，
    design §4）；``last_active`` 为 ISO8601 字符串原样透传（不收紧成 datetime——
    daemon 侧格式演进不应 422 整条心跳，前端自行解析展示）。
    """

    name: str | None = None
    ghost: bool | None = None
    current_stage: str | None = None
    stage_label: str | None = None
    last_active: str | None = None
    steps: DaemonHeartbeatSillySpecChangeSteps | None = None


class DaemonHeartbeatSillySpecConflict(BaseModel):
    """心跳 sillyspec_status.pending_conflicts[] 单项（design §4）.

    ``type`` 当前取值 ``spec-tree`` / ``progress``——不收紧成 Literal
    （DaemonHeartbeatSillySpecUpdate.state 同决策：收紧会让未来新增取值的整条
    心跳 422）。

    2026-09-07-conflict-diff-compare task-04（design §7.3）：新增可选 ``ql_id``
    （QUICKLOG 块头编号，如 ``ql-20260907-006-2972``）——daemon 侧对 ``quick-*``
    名冲突 best-effort 读 guard.json 补报，普通变更/读不到 → None。宽松可选
    （零改写透传语义不变）：旧 daemon 不上报不影响心跳落库。
    """

    change: str | None = None
    created_at: str | None = None
    type: str | None = None
    ql_id: str | None = None


class DaemonHeartbeatSillySpecStatus(BaseModel):
    """心跳 sillyspec_status 载荷（2026-09-02-changes-overview-card FR-05 / Grill B1）.

    daemon 周期采集 ``progress show --json`` envelope 的摘要投影（design §4）：
    envelope 全量或超 32KB 预算的计数降级版（截断/降级在 daemon 侧执行，backend
    原样落库）。全字段宽松可选——与 DaemonHeartbeatSillySpecUpdate 同理（心跳是
    保活通道，字段缺失或类型演进均不应 422）：不收紧 Literal、不加 max_length，
    时间字段为 ISO8601 字符串原样承载。
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


class DaemonHeartbeatSillySpecCommandResult(BaseModel):
    """心跳 sillyspec_command_result 载荷（2026-09-04-conflict-resolve-entry FR-05）.

    daemon 侧 sillyspec 命令执行器（resolve / ghost_cleanup）的最新结果槽投影
    （design §7 心跳结果字段）：action 当前取值 ``resolve`` / ``ghost_cleanup``，
    strategy 取值 ``keep_local`` / ``take_platform``，state 取值 ``success`` /
    ``failed``——均不收紧成 Literal（DaemonHeartbeatSillySpecUpdate.state 同
    决策：收紧会让未来新增取值的整条心跳 422，心跳是保活通道宁宽勿断）；全字段
    宽松可选，不加 max_length，``executed_at`` 为 ISO8601 字符串原样承载（机器
    本地钟，跨机比较仅作辅助——X-18）；``error`` 已在 daemon 侧截断 ≤200 字。
    携带语义两态（D-004@v1）：终态窗口内每跳携带对象（latest-wins 只留最新一条，
    R-07），窗口过期后键即不出现——backend 侧 None=置 NULL 清除，daemon 无需
    也不得发送显式 null（X-04 修订）。
    """

    action: str | None = None
    change: str | None = None
    strategy: str | None = None
    state: str | None = None
    exit_code: int | None = None
    error: str | None = None
    executed_at: str | None = None


class DaemonHeartbeatSpecCacheItem(BaseModel):
    """心跳 ``spec_cache[]`` 单项（ql-20260907-010：spec 拉取工作区级化）.

    daemon 上报本机已有的 spec 缓存（``~/.sillyhub/daemon/specs/{ws}``）版本，
    backend 在响应 ``spec_versions`` 里回服务器权威 ``spec_workspaces.spec_version``，
    daemon 据此对「版本落后且无活跃会话」的工作区后台预取——把全量 bundle 下载
    挪出会话创建关键路径（实机 47MB 树 / ~0.4MB/s 链路下创建被拖 40s+）。
    """

    workspace_id: uuid.UUID
    spec_version: int = Field(ge=0)


class DaemonHeartbeatRequest(BaseModel):
    """Per-daemon 心跳请求体（design §5.4 / §9.1 / D-006）。

    daemon 周期上报其 ``daemon_local_id``（=daemon_instances.id）+ 各 provider 的
    当前 status。backend 刷新 daemon_instances.last_heartbeat_at + 各 runtime.status。
    2026-07-04-daemon-version-management：同时上报 daemon_version/daemon_build_id
    （D-002，register + heartbeat 都带），backend 刷新 instance.version/build_id。
    """

    daemon_local_id: uuid.UUID = Field(description="daemon 本地 uuid（daemon_instances.id）")
    daemon_version: str | None = Field(default=None, max_length=50)
    daemon_build_id: str | None = Field(default=None, max_length=50)
    # daemon 进程启动时间（2026-08-05-daemon-start-time D-002@v1）。
    # 心跳携带用于 daemon 重启后 started_at 刷新（process 重启时间变）。
    # Optional 兼容旧 daemon（不上报则保留原值 / NULL）。
    started_at: datetime | None = Field(default=None)
    # 推迟自升级期间心跳透传的 pending 状态（task-06 / FR-04 / D-004@v1）。
    # ⚠ 语义刻意与上方兄弟字段（daemon_version/build_id/started_at「非 None 才
    # 覆盖」）相反：None 即清除（daemon_instances.pending_update 置 NULL）。pydantic
    # 请求模型中「缺省不携带」与「显式 null」不可区分，本字段就采用 None=清除——
    # 单机单 daemon 无新旧进程交错，升级执行/取消路径靠「无字段」显式清除才收敛
    # （design S4 / D-004@v1，勿被「对齐兄弟字段」误改）。
    pending_update: DaemonHeartbeatPendingUpdate | None = Field(default=None)
    # 本机 sillyspec 工具版本（2026-08-31-machine-sillyspec-version FR-05 / D-002@v1）。
    # ⚠ 与上方兄弟字段（daemon_version 等「非 None 才覆盖」）**同语义**：缺省/显式
    # null 不可区分且均=保留（旧 daemon 不上报不影响新值；清除路径走 register 直写
    # null——本机卸载后重启）。latest 同款。
    sillyspec_version: str | None = Field(default=None, max_length=50)
    sillyspec_latest_version: str | None = Field(default=None, max_length=50)
    # sillyspec 升级状态机快照（FR-05）——语义同 pending_update（与本组兄弟字段
    # 反向）：None 即清除置 NULL，非 None 时 upsert（首写盖 since，同内容保留原
    # since，D-002@v1 锚定，详见服务层注释）。
    sillyspec_update: DaemonHeartbeatSillySpecUpdate | None = Field(default=None)
    # sillyspec 全局进度总览快照（2026-09-02-changes-overview-card FR-05 /
    # Grill B1）——语义同 sillyspec_update（None=清除）：该键为 null/缺省即置
    # NULL（daemon 侧 CLI 能力缺失上报 null 清除；采集瞬态失败保留上次快照上报
    # 不清除，三态矩阵 design §5）。旧 daemon 无该键心跳照常通过（default=None，
    # NFR-01）。
    sillyspec_status: DaemonHeartbeatSillySpecStatus | None = Field(default=None)
    # sillyspec 命令执行结果槽（2026-09-04-conflict-resolve-entry FR-05 /
    # D-004@v1）——语义同 sillyspec_update / sillyspec_status（None=清除）：键不
    # 出现即置 NULL（daemon 终态窗口过期后停发该键，无需显式 null，X-04 两态）；
    # 对象=整包直写（latest-wins，daemon 只保留最新一条，R-07）。旧 daemon 无该
    # 键心跳照常通过（default=None，兼容）。
    sillyspec_command_result: DaemonHeartbeatSillySpecCommandResult | None = Field(default=None)
    providers: list[DaemonHeartbeatProviderItem] = Field(default_factory=list)
    # ql-20260907-010：daemon 本机 spec 缓存清单（workspace_id + 本地版本）——
    # backend 响应 spec_versions 回权威版本供 daemon 判定后台预取。缺省（旧
    # daemon）= 空列表，响应 spec_versions 恒 {}，零破坏。
    spec_cache: list[DaemonHeartbeatSpecCacheItem] = Field(default_factory=list)


class DaemonHeartbeatRuntimePolicy(BaseModel):
    """心跳响应内单个 runtime 的 per-runtime allowed_roots。"""

    runtime_id: uuid.UUID
    allowed_roots: list[str]


class DaemonHeartbeatResponse(BaseModel):
    """Per-daemon 心跳响应体。

    2026-07-06-allowed-roots-per-runtime：返 per-runtime allowed_roots map
    （runtimes: [{runtime_id, allowed_roots}]），daemon _syncAllowedRoots per-runtime 同步。
    2026-08-29-daemon-platform-resilience task-04：新增 ``pending_controls``——
    该 daemon 全部 runtime 名下 pending 控制指令计数（design A1/A2 对账触发
    约定字段名；daemon 心跳循环见 >0 即补拉控制指令）。
    """

    daemon_instance_id: uuid.UUID
    status: str
    runtimes: list[DaemonHeartbeatRuntimePolicy] = Field(default_factory=list)
    pending_controls: int = 0
    # ql-20260907-010：请求 spec_cache 各工作区的服务器权威 spec_version
    # （键 = workspace_id 字符串；请求未携带 / 服务器无该工作区行 → 键缺席）。
    # daemon 据此判定「本地落后 → 后台预取」。恒为 dict（旧 daemon 收到 {}）。
    spec_versions: dict[str, int] = Field(default_factory=dict)


@router.post(
    "/heartbeat",
    response_model=DaemonHeartbeatResponse,
)
async def daemon_heartbeat(
    data: DaemonHeartbeatRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> DaemonHeartbeatResponse:
    """Per-daemon HTTP 心跳（design §5.4 / §9.1 / D-006）。

    daemon 单条心跳合并上报 ``daemon_local_id`` + 各 provider 状态。backend 刷新
    ``daemon_instances.last_heartbeat_at`` + 各 ``daemon_runtimes.status``。
    ``heartbeat_ack`` 经 WS 下发到该 daemon 连接（task-06 通路），本 HTTP 响应只
    回 ``{daemon_instance_id, status, allowed_roots}``（allowed_roots 从 daemon
    实体读，已上提到 daemon_instances，design §4.2）。

    WS breaking（D-007）：旧 daemon 按 per-provider body 上报（无 daemon_local_id）
    → pydantic 校验 daemon_local_id 必填失败 → 422 拒绝，要求同步升级。
    2026-08-29-daemon-selfupdate-safety task-06：心跳携带可选 pending_update 时
    upsert daemon_instances.pending_update（同内容保留原 since）；无该字段置 NULL
    清除（D-004@v1，语义与兄弟字段反向，详见 DTO/服务层注释）。
    """
    # task-06 / FR-04：DaemonService.heartbeat_daemon facade（app/modules/daemon/
    # service.py）无 pending_update 透传参数，而该文件不在本卡 allowed_path——
    # 心跳端点直调 RuntimeService（本函数下方 pending_controls 统计同款直调先例）。
    from app.modules.daemon.runtime.service import RuntimeService

    instance = await RuntimeService(session).heartbeat_daemon(
        data.daemon_local_id,
        providers=[item.model_dump() for item in data.providers],
        daemon_version=data.daemon_version,
        daemon_build_id=data.daemon_build_id,
        started_at=data.started_at,
        # task-06 / D-004@v1：pending_update None=清除（与兄弟字段反向，DTO 字段
        # 注释已锚定）。model_dump 后交服务层 upsert（dict 契约同 providers 先例）。
        pending_update=(
            data.pending_update.model_dump() if data.pending_update is not None else None
        ),
        # 2026-08-31-machine-sillyspec-version FR-05 / D-002@v1：version/latest 走
        # 兄弟字段语义（None=保留，服务层判空）；sillyspec_update 走 pending 语义
        # （None=清除置 NULL）。model_dump 后交服务层 upsert（dict 契约同
        # providers/pending_update 先例）。
        sillyspec_version=data.sillyspec_version,
        sillyspec_latest_version=data.sillyspec_latest_version,
        sillyspec_update=(
            data.sillyspec_update.model_dump() if data.sillyspec_update is not None else None
        ),
        # 2026-09-02-changes-overview-card task-03 / FR-05（Grill B1）：进度总览
        # 快照走 sillyspec_update 同款语义（None=清除置 NULL——daemon 侧 CLI 能力
        # 缺失上报 null；采集瞬态失败则保留上次快照上报，三态矩阵 design §5）。
        # model_dump 后交服务层 dict 整包直写（progress 快照非状态机，无 since/
        # upsert 概念，dict 契约同 providers/pending_update 先例）。
        sillyspec_status=(
            data.sillyspec_status.model_dump() if data.sillyspec_status is not None else None
        ),
        # 2026-09-04-conflict-resolve-entry task-03 / FR-05（D-004@v1）：命令结果
        # 槽走 sillyspec_update 同款语义（None=清除置 NULL——daemon 终态窗口过期
        # 后停发该键，无「保持旧值」三态分支，X-04）。model_dump 后交服务层 dict
        # 整包直写（latest-wins 结果槽非状态机，无 since/upsert，dict 契约同
        # providers/pending_update 先例）。
        sillyspec_command_result=(
            data.sillyspec_command_result.model_dump()
            if data.sillyspec_command_result is not None
            else None
        ),
        # task-03（security-audit-remediation / FR-12）：心跳归属校验——
        # instance.user_id 必须等于当前认证 user，不匹配 404（owner-only）。
        actor_user_id=user.id,
    )
    # ql-20260706-005：col 属 sqlmodel（非 sqlalchemy 顶层），误从 sqlalchemy
    # 导入会 ImportError → heartbeat 端点 500 → daemon 拿不到 per-runtime
    # allowed_roots → CC 配的可写目录全 deny。与 service.py:13 用法对齐。
    from sqlmodel import col as _col

    from app.modules.daemon.model import DaemonRuntime

    rt_rows = (
        (
            await session.execute(
                select(DaemonRuntime).where(_col(DaemonRuntime.daemon_instance_id) == instance.id)
            )
        )
        .scalars()
        .all()
    )
    # task-04（design A1/A2）：pending 控制指令计数（该 daemon 全部 runtime 的
    # pending 行，一次聚合查询）——daemon 据此触发控制指令补拉对账。
    # （RuntimeService 已在函数上方 import，task-06 起心跳本体也走它。）
    pending_controls = await RuntimeService(session).count_pending_control_commands(instance.id)
    # ql-20260907-010：spec 缓存版本对答——请求携带 spec_cache 时按 workspace_id
    # 批查 spec_workspaces 权威版本（一次 IN 查询；缺行的工作区键缺席，daemon 视
    # 为「服务器无此工作区缓存语义」不预取）。纯读，不触碰心跳其余语义。
    spec_versions: dict[str, int] = {}
    if data.spec_cache:
        from app.modules.spec_workspace.model import SpecWorkspace

        ws_rows = (
            await session.execute(
                select(
                    SpecWorkspace.workspace_id,
                    SpecWorkspace.spec_version,
                ).where(
                    _col(SpecWorkspace.workspace_id).in_(
                        [item.workspace_id for item in data.spec_cache]
                    )
                )
            )
        ).all()
        spec_versions = {str(row.workspace_id): int(row.spec_version or 0) for row in ws_rows}
    return DaemonHeartbeatResponse(
        daemon_instance_id=instance.id,
        status=instance.status or "online",
        runtimes=[
            DaemonHeartbeatRuntimePolicy(
                runtime_id=rt.id,
                allowed_roots=list(rt.allowed_roots or []),
            )
            for rt in rt_rows
        ],
        pending_controls=pending_controls,
        spec_versions=spec_versions,
    )
