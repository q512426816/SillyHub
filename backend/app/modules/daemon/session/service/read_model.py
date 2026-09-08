"""会话读模型：列表 / 详情 / 日志 / 用量（task-08 拆分，原 :6040-6288 + :6839-7159）。

6 个方法体下沉为模块函数（第一参数 svc），无 patch 面（纯读路径）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlmodel import col

from app.modules.agent.model import (
    AgentRun,
    AgentRunLog,
    AgentRunModelUsage,
    AgentSession,
)
from app.modules.change.model import ChangeSessionLink, QuicklogSessionLink
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.schema import SessionUsageModelItemRead, SessionUsageRead
from app.modules.ppm.common.session_binding import PpmItemKind, PpmItemSessionLink

from .errors import DaemonSessionNotFound


async def list_agent_sessions(
    svc,
    user_id: uuid.UUID,
    *,
    limit: int,
    offset: int,
    status_filter: str | None = None,
    runtime_id: uuid.UUID | None = None,
    machine_id: uuid.UUID | None = None,
    provider: str | None = None,
    q: str | None = None,
    # 2026-08-22-workspace-sessions-portal / D-003@v2：workspace/change 级
    # 门户复用全局列表做 scope 过滤（照 runtime_id 模式，可选零回归）。
    workspace_id: uuid.UUID | None = None,
    change_id: uuid.UUID | None = None,
    # 2026-08-25-session-spec-binding task-04 / FR-05：快速修复级关联筛选
    # （ql_id 为自然键短码 ``ql-YYYYMMDD-NNN-后缀``，非 UUID）。
    ql_id: str | None = None,
    # task-02（2026-08-28-session-ppm-task-binding / FR-05 / D-005@v1）：PPM
    # 条目级关联筛选（kind + item_id 成对，router 层已校验配对与 Literal）。
    ppm_item_kind: PpmItemKind | None = None,
    ppm_item_id: uuid.UUID | None = None,
    # 2026-08-24：会话归档过滤（False=未归档，True=已归档，None=不过滤——
    # ql-20260831-015 三态，HTTP 层「全部状态」用；service 默认 False 零回归）。
    archived: bool | None = False,
    # 2026-09-01-session-group-chat task-02 / design §5.3：会话形态过滤
    # （照 archived 三态先例）——默认 'chat'（存量口径），群/影子会话不
    # 泄漏进普通列表（群聊列表走新端点 GET /api/daemon/group-chats）；
    # None=不过滤（admin debug 等显式覆盖）。存量行迁移后 server_default
    # 'chat'，默认过滤对既有查询零行为变化。
    session_kind: str | None = "chat",
) -> tuple[list[AgentSession], int]:
    """Owner-scoped list of AgentSession with stable paging.

    D-005@v1: isolation is purely DB-level (``AgentSession.user_id``); no
    post-filter. Stable order ``coalesce(last_active_at, created_at) DESC,
    id DESC`` so paging never skips / repeats. ``status_filter`` (when given)
    must already be validated by the router to a known literal.

    task-06 / FR-02 / D-003@v1 过滤参数（全部可选，不传 = 现状查询，零回归）：

    - ``runtime_id``：``AgentSession.runtime_id`` 精确匹配。
    - ``machine_id``：经 ``daemon_runtimes.daemon_instance_id`` EXISTS 关联
      （runtime 缺失的旧会话不匹配任何 machine）。
    - ``provider``：``AgentSession.provider`` 精确匹配（router 层 Literal 校验）。
    - ``q``：内容模糊搜索。title 已是持久列（Grill P1-1 落列，rename 可
      写），但本参数按「会话存在 channel=user_input 且 content_redacted
      ilike q 的日志」EXISTS 过滤——即匹配首条/任一条用户输入内容，不
      匹配改过的 title 列（ISS-06：如实描述口径，不改查询行为）；
      ``%``/``_``/反斜杠 按字面转义，参数经 SQLAlchemy 绑定（防注入）。

    2026-08-22-workspace-sessions-portal / D-003@v2 新增（可选，零回归）：

    - ``workspace_id``：``AgentSession.workspace_id`` 冗余绑定列精确匹配
      （未绑定 workspace 的旧会话不匹配）。

    2026-08-25-session-spec-binding task-04 / FR-05 升级 + 新增（design
    §5.W3.3 / §9 兼容策略）：

    - ``change_id``：语义从「单 FK（``AgentSession.change_id``）精确匹配」
      扩大为「M:N 命中」——改为 ``AgentSession.id IN (change_session_links
      的 session_id WHERE change_id=传入值)`` 子查询。links 表是变更↔会话
      关联的唯一真相（D-002@v1），存量单 FK 已由迁移播种为 link 行，原
      命中集是新命中集的子集（参数名/类型不变，向后兼容）；含「仅 link
      无单 FK」的自动绑定会话。scope=change 门户查询形态仍为
      ``workspace_id`` + ``change_id`` 双传取交集。
    - ``ql_id``：快速修复短码（非 UUID），走 ``quicklog_session_links``
      按 (workspace_id, ql_id) 双条件子查询命中（D-001@v1：自然键无 FK）。
      workspace 限定防跨工作区同 ql_id 串扰（R-05）：``workspace_id`` 筛选
      参数非空时子查询同步收紧到该工作区；为空时按 ql_id 全工作区命中
      （列表本身 owner-scoped，串扰面已受限，design §5.W3.3 允许）。
      与其余筛选 AND 交集组合（``change_id`` + ``ql_id`` 同传即双关联交集）。

    2026-08-28-session-ppm-task-binding task-02 / FR-05 新增（可选，零回归）：

    - ``ppm_item_kind`` + ``ppm_item_id``：PPM 条目级关联筛选，走
      ``ppm_item_session_links`` (kind, item_id) 子查询命中（照 change_id
      分支模式）。``item_id`` 为 UUID 全局唯一，无跨工作区串扰，不叠
      workspace 条件；与其余筛选 AND 交集组合。成对约束由 router 层
      校验（只传其一 422），service 层双 None 时零分支进入。
    """
    from sqlalchemy import exists, func

    base_filters = [
        AgentSession.user_id == user_id,
        AgentSession.deleted_at.is_(None),  # FR-07 软删过滤
    ]
    # 2026-08-24：archived 过滤（False=未归档，True=已归档）。
    # ql-20260831-015：三态化——None=不过滤（全部，含已归档），供 HTTP 层
    # 「全部状态」视图用；service 层默认保持 False，内部调用（facade/测试）
    # 零回归。
    if archived is True:
        base_filters.append(AgentSession.archived_at.isnot(None))
    elif archived is False:
        base_filters.append(AgentSession.archived_at.is_(None))
    # 2026-09-01-session-group-chat task-02 / design §5.3：会话形态谓词
    # （ix_agent_sessions_session_kind 查询键；默认 'chat' 存量口径——
    # 群会话与 group_member 影子会话不进普通列表）。
    if session_kind is not None:
        base_filters.append(AgentSession.session_kind == session_kind)
    if status_filter is not None:
        base_filters.append(AgentSession.status == status_filter)
    if runtime_id is not None:
        base_filters.append(AgentSession.runtime_id == runtime_id)
    # 2026-08-22-workspace-sessions-portal / D-003@v2：scope 精确匹配过滤。
    if workspace_id is not None:
        base_filters.append(AgentSession.workspace_id == workspace_id)
    if change_id is not None:
        # 2026-08-25-session-spec-binding task-04 / D-002@v1 / design
        # §5.W3.3：change_id 从单 FK 精确匹配升级为 M:N 子查询命中——
        # links 表是变更↔会话关联的唯一真相，存量单 FK 已播种为 link 行
        # （§9：原命中集是新命中集的子集，参数名/类型不变向后兼容）。
        base_filters.append(
            AgentSession.id.in_(
                select(ChangeSessionLink.session_id).where(ChangeSessionLink.change_id == change_id)
            )
        )
    if ql_id is not None:
        # 2026-08-25-session-spec-binding task-04 / FR-05 / D-001@v1：按
        # links 表 (workspace_id, ql_id) 双条件命中，防跨工作区同 ql_id
        # 串扰（R-05）。workspace_id 筛选参数非空 → 收紧到该工作区；为空
        # → 按 ql_id 全工作区命中（owner-scoped 列表，串扰面已受限）。
        ql_filters = [QuicklogSessionLink.ql_id == ql_id]
        if workspace_id is not None:
            ql_filters.append(QuicklogSessionLink.workspace_id == workspace_id)
        base_filters.append(
            AgentSession.id.in_(select(QuicklogSessionLink.session_id).where(*ql_filters))
        )
    if ppm_item_kind is not None and ppm_item_id is not None:
        # task-02（2026-08-28-session-ppm-task-binding / FR-05 / D-005@v1）：
        # PPM 条目级关联筛选——照 change_id 分支模式走 ppm_item_session_links
        # 子查询命中。item_id 为 UUID 全局唯一（kind+item_id 定位唯一条目），
        # 无跨工作区串扰，不叠 workspace 条件（区别于 ql_id 双条件）。
        base_filters.append(
            AgentSession.id.in_(
                select(PpmItemSessionLink.session_id).where(
                    PpmItemSessionLink.kind == ppm_item_kind,
                    PpmItemSessionLink.item_id == ppm_item_id,
                )
            )
        )
    if machine_id is not None:
        base_filters.append(
            exists().where(
                DaemonRuntime.id == AgentSession.runtime_id,
                DaemonRuntime.daemon_instance_id == machine_id,
            )
        )
    if provider is not None:
        base_filters.append(AgentSession.provider == provider)
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        base_filters.append(
            exists().where(
                AgentRun.agent_session_id == AgentSession.id,
                AgentRunLog.run_id == AgentRun.id,
                AgentRunLog.channel == "user_input",
                AgentRunLog.content_redacted.ilike(f"%{escaped}%", escape="\\"),
            )
        )

    count_stmt = select(func.count()).select_from(AgentSession).where(*base_filters)
    total = int((await svc._session.execute(count_stmt)).scalar() or 0)

    # task-02（2026-09-07-session-pin-rename-scheduled-send / D-002@v1）：
    # 置顶优先排序——前置谓词 ``(pinned_at IS NULL) ASC``（IS NULL 为假=已置顶
    # → 0/false 排前，aiosqlite（0/1）与 PG（boolean ASC false 先）双方言
    # 同语义），多置顶之间按既有最近活跃续排（「多个置顶按最近活跃排」）；
    # 未置顶行维持既有序。pinned_at 全 NULL 的存量数据谓词恒真（值序退化为
    # 既有键），列表序与升级前一致（FR-07 / R-03）。仅动 order_by，不动
    # base_filters 与分页。
    order_key = func.coalesce(AgentSession.last_active_at, AgentSession.created_at)
    list_stmt = (
        select(AgentSession)
        .where(*base_filters)
        .order_by(
            AgentSession.pinned_at.is_(None).asc(),
            order_key.desc(),
            AgentSession.id.desc(),
        )
        .limit(limit)
        .offset(offset)
    )
    items = list((await svc._session.execute(list_stmt)).scalars().all())
    return items, total


async def get_agent_session(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> AgentSession:
    """Return a single owned AgentSession (task-06 / FR-2 / D-002@v1).

    Read-only single-read counterpart to :meth:`list_agent_sessions`.
    Ownership is enforced by the ``user_id`` filter so a missing OR
    cross-user session both surface as 404 without leaking existence
    (mirrors ``_get_owned_session_for_update`` minus the row lock — no
    write here, so FOR UPDATE would only add contention). Returns the ORM
    row; the router serializes it via ``AgentSessionRead`` (same mapping
    the list endpoint uses).

    2026-09-01-session-group-chat task-02 / design §5.3：群会话参与者制
    分支——首查未命中（非属主）时探测群形态（成员表命中 → workspace
    admin → 仍 404 不泄露存在性）；chat 热路径单 SQL 零改动。
    """
    stmt = select(AgentSession).where(
        AgentSession.id == session_id,
        AgentSession.user_id == user_id,
        AgentSession.deleted_at.is_(None),  # FR-07 软删视为不存在→404
    )
    session = (await svc._session.execute(stmt)).scalar_one_or_none()
    if session is None:
        from app.modules.daemon.group.service import get_group_accessible_session

        group_session = await get_group_accessible_session(
            svc._session,
            session_id=session_id,
            user_id=user_id,
            # 影子详情读对群普通成员放行（2026-09-02）：SessionPanel 本体挂在
            # 成员卡后普通成员 attach 轮询详情会 404 误报「会话恢复失败」——
            # 读路径与 logs 同口径放行（写路径不受影响）。
            allow_shadow_member_read=True,
        )
        if group_session is not None and group_session.deleted_at is None:
            return group_session
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    return session


async def _heal_agent_session_id_from_runs(svc, session: AgentSession) -> str | None:
    """ql-20260821-001：从会话历史 run 恢复 SDK resume key 并写回 session 行。

    历史版本的 SDK session id 只落到 run 级列 ``AgentRun.session_id``（daemon
    消息流写入的 claude session_id / codex thread id，与 daemon 侧
    ``state.agentSessionId`` 同源），session 级列从未回填。此处取该会话 runs
    中最新非空值——fork 场景各 turn 可能轮换 id，``created_at DESC`` 保证取到
    最新有效 key。命中即写 ``session.agent_session_id``（调用方事务内随
    reopen 转换一起 commit/rollback，不留半更新状态）；无任何 run 记录过
    session id 则返回 None（真不可恢复，D-004）。
    """
    stmt = (
        select(AgentRun.session_id)
        .where(
            AgentRun.agent_session_id == session.id,
            col(AgentRun.session_id).is_not(None),
            col(AgentRun.session_id) != "",
        )
        .order_by(AgentRun.created_at.desc())
        .limit(1)
    )
    healed = (await svc._session.execute(stmt)).scalar_one_or_none()
    if healed is None:
        return None
    session.agent_session_id = healed
    svc._session.add(session)
    return healed


async def get_agent_session_logs(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    limit: int = 5000,
    after: datetime | None = None,
    before: datetime | None = None,
    q: str | None = None,
) -> list[AgentRunLog]:
    """Return all AgentRunLog rows for an owned session, cross-run aggregate.

    ``after``（2026-08-24 会话审查 P4，对齐 run 级 ``?after=`` 先例）：增量
    游标——只返回 ``timestamp > after`` 的行，供前端断线重连/轮后对账增量
    拉取，替代全量重放（5000 行 × 50KB 的重连代价）。submit_messages 同批
    日志共用同一 timestamp，纯 timestamp 游标在批次内边界会漏同批后到行，
    调用方应回退 1-2s 重叠窗口并按 log_id 去重（前端已具备该去重）。

    群聊体验 quick（2026-09-02）分页/搜索扩展——三参可与 ``after`` 任意
    组合：

    - ``before``：向上加载游标——只返回 ``timestamp < before`` 的行（配合
      ``limit`` 取「游标之前的最新 N 条」实现向上翻页）；
    - ``q``：``content_redacted`` ILIKE %q% 内容过滤（会话内搜索，模式
      拼接口径同 change/service 搜索先例）；
    - ``limit``：**最新 N 条**语义——排序先 desc 取 N 再反转回升序返回
      （无 ``before`` = 全量中最新 N；有 ``before`` = 游标之前最新 N）。
      默认 5000 维持原全量行为（既有调用方与 gzip 逻辑零改动）。

    D-005@v1: aggregation key is ``AgentRun.agent_session_id`` (the 1:N FK
    to AgentSession), NEVER ``AgentRun.session_id`` (the claude resume id,
    different semantics). Ownership is verified DB-side
    (``session_id + user_id``); a missing or cross-user session raises
    DaemonSessionNotFound so existence does not leak.

    Ordering note: ``AgentRun`` has no ``created_at`` column, so cross-run
    order is anchored on each run's earliest log timestamp (then
    ``started_at`` then ``id``), and within a run logs are ordered by
    ``timestamp ASC, id ASC``. This is stable and lets the frontend
    delineate turns via ``run_id``.
    """
    from sqlalchemy import func

    # Ownership check (resource hiding — same not-found for missing/cross-user).
    # 2026-09-01-session-group-chat task-02 / design §5.3：群会话回放读
    # （刷新/重连聚合）参与者制分支——首查未命中时探测群形态（成员表
    # 命中 → workspace admin → 仍 404 不泄露存在性）；chat 零改动。
    # 群聊体验 quick（2026-09-02）：allow_shadow_member_read=True 额外放行
    # 影子会话（kind='group_member'）所在群的普通用户成员读日志（成员独立
    # 时间线视图）——仅本读路径开启，写路径（for_update）不受影响。
    owned = (
        await svc._session.execute(
            select(AgentSession.id).where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if owned is None:
        from app.modules.daemon.group.service import get_group_accessible_session

        group_session = await get_group_accessible_session(
            svc._session,
            session_id=session_id,
            user_id=user_id,
            allow_shadow_member_read=True,
        )
        if group_session is None:
            raise DaemonSessionNotFound(
                f"AgentSession '{session_id}' not found.",
                details={"session_id": str(session_id)},
            )

    # Per-run earliest log timestamp (for cross-run ordering anchor).
    # 第四批 code-quality：原 min_ts_subq 对整张 agent_run_logs（系统最大表）
    # GROUP BY 无 session 过滤，PG 必须先物化全表聚合再 JOIN，随日志增长线性
    # 恶化。收敛到当前 session 的 run 集（语义不变：外层 run_anchor 已 WHERE
    # agent_session_id == session_id，缩小聚合范围不改变最终结果集）。
    session_run_ids = select(AgentRun.id).where(AgentRun.agent_session_id == session_id)
    min_ts_subq = (
        select(
            AgentRunLog.run_id.label("run_id"),
            func.min(AgentRunLog.timestamp).label("min_ts"),
        )
        .where(AgentRunLog.run_id.in_(session_run_ids))
        .group_by(AgentRunLog.run_id)
        .subquery()
    )

    # Join: logs → runs (filtered by agent_session_id == session_id) → min_ts anchor.
    run_anchor = (
        select(
            AgentRun.id.label("run_id"),
            func.coalesce(min_ts_subq.c.min_ts, AgentRun.started_at).label("anchor_ts"),
        )
        .select_from(AgentRun)
        .outerjoin(min_ts_subq, min_ts_subq.c.run_id == AgentRun.id)
        .where(AgentRun.agent_session_id == session_id)
        .subquery()
    )

    stmt = (
        select(AgentRunLog)
        .select_from(AgentRunLog)
        .join(run_anchor, run_anchor.c.run_id == AgentRunLog.run_id)
    )
    if after is not None:
        stmt = stmt.where(AgentRunLog.timestamp > after)
    # 群聊体验 quick（2026-09-02）：向上加载游标（timestamp < before）与
    # 内容搜索（ILIKE %q%）。三过滤条件独立叠加，与 after 任意组合。
    if before is not None:
        stmt = stmt.where(AgentRunLog.timestamp < before)
    if q:
        stmt = stmt.where(AgentRunLog.content_redacted.ilike(f"%{q}%"))
    stmt = (
        stmt.order_by(
            run_anchor.c.anchor_ts.desc(),
            AgentRunLog.timestamp.desc(),
            AgentRunLog.id.desc(),
        )
        # 性能优化 Wave 2 / P3-3:加 limit 防止长会话(N runs × M logs)全量
        # 加载 TEXT 大列(content_redacted)。取**最新** N 条(anchor/timestamp/
        # id desc),再 reverse 还原正序展示(同 run 连续、跨 run 按起始序)——
        # 会话详情关心近期活动,超长会话丢弃的是早期而非最近;正常会话(<5000
        # 行)全量可见。
        .limit(limit)
    )
    rows = list((await svc._session.execute(stmt)).scalars().all())
    rows.reverse()
    return rows


async def get_session_usage(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> SessionUsageRead:
    """会话累计用量聚合：明细段为主 + 无明细 run 四维列兜底（2026-08-29-session-usage-stats
    task-01 / FR-01 / D-002@v1 / D-004@v1，端点归 task-02）。

    两段 SQL 聚合全部在 SQL 侧完成（JOIN/GROUP BY，不拉 run 行进内存——
    大会话防膨胀，design R-03）：

    1. 明细段（主源）：``agent_run_model_usage`` JOIN 本会话 ``agent_runs``，
       GROUP BY ``mu.model``，SUM 四维 token + ``api_requests``；
    2. 兜底段：本会话中**没有任何明细行**的 run（2026-08-29 之前的历史轮次；
       NOT EXISTS 反连接，防大会话 NOT IN 子查询膨胀），SUM ``agent_runs``
       四维 token 列——``ctx_tokens`` 是提示词大小快照列，**严禁**出现在 SUM
       （Grill P1）；按 ``COALESCE(run.model, '未记录')`` 归并，``api_requests``
       无来源按 0 计（诚实值，design R-01）。

    归属校验对齐 :meth:`get_agent_session`：``session_id + user_id`` DB 侧
    过滤 + 软删 ``deleted_at`` 视为不存在（FR-07 同口径），缺失/跨用户/已软删
    同抛 :class:`DaemonSessionNotFound`（404 不泄露存在性）。两段按 model 名
    dict 归并求和（兜底段按 run.model 命名可能与明细段同名——同名桶相加，
    不丢）；``by_model`` 按 input+output 总量降序、「未记录」桶恒末位
    （D-002@v1）；空会话返回全 0 totals + 空 ``by_model``。
    """
    from sqlalchemy import exists, func

    # Ownership check (resource hiding — same not-found for missing/cross-user;
    # 2026-08-30 审计⑥：软删会话同 404，对齐 runs/logs/detail 端点口径).
    owned = (
        await svc._session.execute(
            select(AgentSession.id).where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
                AgentSession.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if owned is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )

    # 兜底桶名（run.model 为 NULL 的历史轮次归此桶，恒排 by_model 末位）。
    unrecorded = "未记录"

    # ── 明细段（主源）：usage 明细 × 本会话 runs，GROUP BY model ──
    detail_stmt = (
        select(
            AgentRunModelUsage.model.label("model"),
            func.sum(AgentRunModelUsage.input_tokens).label("input_tokens"),
            func.sum(AgentRunModelUsage.output_tokens).label("output_tokens"),
            func.sum(AgentRunModelUsage.cache_read_tokens).label("cache_read_tokens"),
            func.sum(AgentRunModelUsage.cache_creation_tokens).label("cache_creation_tokens"),
            func.sum(AgentRunModelUsage.api_requests).label("api_requests"),
        )
        .join(AgentRun, AgentRunModelUsage.run_id == AgentRun.id)
        .where(AgentRun.agent_session_id == session_id)
        .group_by(AgentRunModelUsage.model)
    )
    detail_rows = (await svc._session.execute(detail_stmt)).mappings().all()

    # ── 兜底段：本会话中无任何明细行的 run，四维 token 列求和 ──
    # run 级 token 列 nullable（老数据）→ SUM(COALESCE(col, 0))；usage 明细
    # 列 NOT NULL 但统一 or-0 防御（对齐 runtime usage 装配先例）。
    bucket = func.coalesce(AgentRun.model, unrecorded)
    fallback_stmt = (
        select(
            bucket.label("model"),
            func.sum(func.coalesce(AgentRun.input_tokens, 0)).label("input_tokens"),
            func.sum(func.coalesce(AgentRun.output_tokens, 0)).label("output_tokens"),
            func.sum(func.coalesce(AgentRun.cache_read_tokens, 0)).label("cache_read_tokens"),
            func.sum(func.coalesce(AgentRun.cache_creation_tokens, 0)).label(
                "cache_creation_tokens"
            ),
        )
        .where(
            AgentRun.agent_session_id == session_id,
            # NOT EXISTS 反连接：等价 NOT IN (SELECT run_id ... WHERE run_id IN
            # 会话 runs)（design §接口定义），且无 IN 膨胀/NULL 陷阱。
            ~exists().where(AgentRunModelUsage.run_id == AgentRun.id),
        )
        .group_by(bucket)
    )
    fallback_rows = (await svc._session.execute(fallback_stmt)).mappings().all()

    # ── 合并：按 model 名 dict 归并求和（两段同名桶相加，不丢）──
    buckets: dict[str, SessionUsageModelItemRead] = {}

    def _merge(
        name: str,
        input_t: int,
        output_t: int,
        cache_r: int,
        cache_c: int,
        api_r: int,
    ) -> None:
        cur = buckets.get(name)
        if cur is None:
            buckets[name] = SessionUsageModelItemRead(
                model=name,
                input_tokens=input_t,
                output_tokens=output_t,
                cache_read_tokens=cache_r,
                cache_creation_tokens=cache_c,
                api_requests=api_r,
            )
            return
        cur.input_tokens += input_t
        cur.output_tokens += output_t
        cur.cache_read_tokens += cache_r
        cur.cache_creation_tokens += cache_c
        cur.api_requests += api_r

    for row in detail_rows:
        _merge(
            str(row["model"]),
            int(row["input_tokens"] or 0),
            int(row["output_tokens"] or 0),
            int(row["cache_read_tokens"] or 0),
            int(row["cache_creation_tokens"] or 0),
            int(row["api_requests"] or 0),
        )
    for row in fallback_rows:
        # 兜底桶 api_requests 恒 0（老 run 无调用次数字段，诚实值 R-01）。
        _merge(
            str(row["model"]),
            int(row["input_tokens"] or 0),
            int(row["output_tokens"] or 0),
            int(row["cache_read_tokens"] or 0),
            int(row["cache_creation_tokens"] or 0),
            0,
        )

    # by_model 排序：input+output 总量降序；「未记录」桶恒末位（即使总量最大）。
    by_model = sorted(
        buckets.values(),
        key=lambda item: (
            item.model == unrecorded,
            -(item.input_tokens + item.output_tokens),
        ),
    )
    totals = SessionUsageModelItemRead(
        model="totals",  # 占位（前端只读五指标，不消费 totals.model）
        input_tokens=sum(item.input_tokens for item in by_model),
        output_tokens=sum(item.output_tokens for item in by_model),
        cache_read_tokens=sum(item.cache_read_tokens for item in by_model),
        cache_creation_tokens=sum(item.cache_creation_tokens for item in by_model),
        api_requests=sum(item.api_requests for item in by_model),
    )
    return SessionUsageRead(totals=totals, by_model=by_model)


async def get_session_for_runtime_owner(
    svc,
    session_id: uuid.UUID,
    actor_user_id: uuid.UUID,
) -> AgentSession:
    """只读校验：目标 session 绑定的 runtime 归属 ``actor_user_id``（2026-08-25）。

    daemon 上行 5 端点越权修复（P1）：ready / plan-mode-entered /
    bash-status / bash-chunk / agent-task-status 原先只做
    ``get_current_principal``——任意已认证主体可向他人会话 mark_ready /
    向 ``agent_session:{id}`` 频道发布伪造事件。参照 end_session 的
    ``actor_runtime_owner_id`` 先例（ql-20260623-004：api-key owner =
    runtime owner，admin 共享 runtime 场景 creator≠owner，不能比对
    ``AgentSession.user_id``）：join ``daemon_runtimes`` 校验 runtime 归属。

    只读版 :meth:`_get_session_by_runtime_owner_for_update`（无 FOR UPDATE
    行锁，不阻塞并发收口事务）；缺失 / 跨 owner 一律 404，中文文案，
    不泄露存在性。
    """
    from app.modules.daemon.model import DaemonRuntime

    stmt = (
        select(AgentSession)
        .join(DaemonRuntime, AgentSession.runtime_id == DaemonRuntime.id)
        .where(
            AgentSession.id == session_id,
            DaemonRuntime.user_id == actor_user_id,
        )
    )
    agent_session = (await svc._session.execute(stmt)).scalar_one_or_none()
    if agent_session is None:
        raise DaemonSessionNotFound(
            "指定的会话不存在或无权访问。",
            details={"session_id": str(session_id)},
        )
    return agent_session
