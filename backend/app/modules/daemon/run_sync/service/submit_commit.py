"""submit_messages 收尾簇（task-10 拆分）：分段撤销 / 冷启动反查 / 持久化发布。

_revoke_committed_partials（跨调用同 segmentId partial 撤销）/ _resolve_
dispatch_run_id（tool_use_id → 派发 run 冷启动反查；为平衡 submit_steps
行数自解析段移入本文件，D-008 口径报告项）/ _submit_finalize（AgentRun
状态同步 + 词元写回 + session pin + sillyspec 绑定 + commit + PublishIntent
构造与返回）。D-007：log 经 ``_rsvc.log`` 保持原模块 logger 身份。
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

import app.modules.daemon.run_sync.service as _rsvc
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.change.binding import bind_session_to_change, extract_spec_bindings

from .publish import PublishIntent, SubmittedMessages

if TYPE_CHECKING:
    from .submit_steps import _SubmitState


async def _revoke_committed_partials(svc, agent_run_id: uuid.UUID, segment_id: str) -> int:
    """task-14 / FR-02：跨 submit_messages 调用撤销已 commit 的同 segmentId partial 行。

    partial（半截）与 override 信号常分两次 submit_messages 到达——partial 在先前
    调用已 commit 落库，本调用局部 ``flushed_partials`` 查不到、且对象已 persisted
    无法 expunge。此处按 segment_id 把已落库的 partial 行 select 出来再
    ``session.delete``（ORM 级，正确同步 identity map；非 bulk delete，避免同 session
    跨调用脏对象），让 DB 只剩完整行。complete 行 segment_id=NULL 不被命中（仅 partial
    行写 segment_id）。

    返回删除行数（观测用）。本方法只标记 DELETE、不 commit，随 submit_messages 事务提交。
    """
    rows = (
        (
            await svc._session.execute(
                select(AgentRunLog).where(
                    AgentRunLog.run_id == agent_run_id,
                    AgentRunLog.segment_id == segment_id,
                )
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        await svc._session.delete(row)
    if rows:
        _rsvc.log.info(
            "daemon_messages_override_deleted_committed_partial",
            agent_run_id=str(agent_run_id),
            segment_id=segment_id,
            deleted=len(rows),
        )
    return len(rows)


async def _resolve_dispatch_run_id(
    svc,
    agent_session_id: uuid.UUID,
    tool_use_id: str,
) -> uuid.UUID | None:
    """task-06 / FR-05：冷启动反查 tool_use_id 的派发 run_id。

    进程级 LRU 未命中时（进程重启 / 容量逐出 / 首次上报）从 agent_run_logs
    反查：同 agent_session_id 的 run 集合中，channel='tool_call' 且 content
    JSON 含该 tool_use_id 的**最早**一行的 run_id。取最早是因为派发 tool_use
    在时间上先于任何子代理回显，可防子代理输出里偶现同 id 串的误配。查询走
    既有索引两步最小化：先 ix_agent_runs_agent_session_id 取同 session 的
    run id 列表，再 run_id IN + channel 过滤（ix_agent_run_logs_run）定位。
    查不到（极端：派发 run 日志已被清理）返回 None，调用方保持当前 run_id
    兜底不抛错（design §5 P2.2 / N4 历史行不迁移）。
    """
    try:
        # 第一步：同 session 的 run id 列表（索引命中，避免 agent_run_logs 全表扫）。
        run_ids = (
            (
                await svc._session.execute(
                    select(AgentRun.id).where(AgentRun.agent_session_id == agent_session_id)
                )
            )
            .scalars()
            .all()
        )
        if not run_ids:
            return None
        # 第二步：这些 run 的 tool_call 行中定位 content 含该 tool_use_id 的行。
        dispatch_run_id = (
            (
                await svc._session.execute(
                    select(AgentRunLog.run_id)
                    .where(
                        AgentRunLog.run_id.in_(run_ids),
                        AgentRunLog.channel == "tool_call",
                        # LIKE 模式给 id 带双引号，匹配 JSON 字符串值
                        # （"tool_use_id":"toolu_xxx"，interactive 与 batch 两路
                        # 径的 tc_content 均含该键）；toolu id 字符集为字母
                        # 数字下划线，不含 LIKE 通配符，无需转义。
                        AgentRunLog.content_redacted.like(f'%"{tool_use_id}"%'),
                    )
                    .order_by(AgentRunLog.timestamp.asc())
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
    except Exception:
        # 未命中路径不抛错（task-06 验收）：查询异常视作未找到，调用方兜底。
        _rsvc.log.debug(
            "daemon_messages_parent_dispatch_lookup_error",
            agent_session_id=str(agent_session_id),
            tool_use_id=tool_use_id,
        )
        return None
    return dispatch_run_id


async def _submit_finalize(svc, st: _SubmitState) -> SubmittedMessages:
    """submit_messages 尾段（task-10 自方法体搬移，状态经 st 显式传参）。

    AgentRun 状态同步（pending→running 原子推进）+ 实时词元写回 +
    session_id 双写回 + sillyspec 命令绑定 + commit（IntegrityError
    幂等回滚）+ PublishIntent 标量构造返回。语义与拆分前逐字节一致。
    """
    # Sync AgentRun status: pending -> running on first messages
    # task-06：st.agent_run 已在落库循环前 get（归位需要 agent_session_id），此处
    # 复用同一对象（identity map），无额外查询。
    agent_run_status: str | None = None
    if st.agent_run is not None:
        agent_run_status = st.agent_run.status
        if st.agent_run.status == "pending":
            # 原子条件 UPDATE：只在 DB 当前仍为 pending 时推进 running。
            # submit_messages 与 close_interactive_run 并发时，迟到的协程可能
            # 持有旧快照（仍读到 pending），直接 ORM 内存写 status=running 会
            # 覆盖 close 已 commit 的 completed 终态（lost update → run 卡
            # running，前端一直"等待本轮完成"）。WHERE status='pending' 让已进入
            # 终态的 run 不被覆盖；rowcount=0 即已被别处推进，跳过本协程激活。
            activated = await svc._session.execute(
                update(AgentRun)
                .where(AgentRun.id == st.agent_run_id, AgentRun.status == "pending")
                .values(status="running", started_at=st.now)
            )
            if activated.rowcount:
                st.agent_run.status = "running"
                st.agent_run.started_at = st.now
                agent_run_status = "running"
                svc._session.add(st.agent_run)
                _rsvc.log.info(
                    "daemon_messages_agent_run_activated",
                    agent_run_id=str(st.agent_run_id),
                    lease_id=str(st.lease_id),
                )
        # ql-20260616-004：实时 token 写回。仅在数值增大时覆盖（防御乱序），
        # 让前端 5s 轮询拿到中间过程的累积 token，不必等 result 事件汇总。
        if st.latest_input_tokens is not None and (
            st.agent_run.input_tokens is None or st.latest_input_tokens > st.agent_run.input_tokens
        ):
            st.agent_run.input_tokens = st.latest_input_tokens
            svc._session.add(st.agent_run)
        if st.latest_output_tokens is not None and (
            st.agent_run.output_tokens is None
            or st.latest_output_tokens > st.agent_run.output_tokens
        ):
            st.agent_run.output_tokens = st.latest_output_tokens
            svc._session.add(st.agent_run)
        # task-07：cache 词元实时写回（仅增不减，对齐上面 input/output max
        # 守卫）。前端 5s 轮询即可拿到累积 cache，不必等 result 事件汇总。
        if st.latest_cache_read_tokens is not None and (
            st.agent_run.cache_read_tokens is None
            or st.latest_cache_read_tokens > st.agent_run.cache_read_tokens
        ):
            st.agent_run.cache_read_tokens = st.latest_cache_read_tokens
            svc._session.add(st.agent_run)
        if st.latest_cache_creation_tokens is not None and (
            st.agent_run.cache_creation_tokens is None
            or st.latest_cache_creation_tokens > st.agent_run.cache_creation_tokens
        ):
            st.agent_run.cache_creation_tokens = st.latest_cache_creation_tokens
            svc._session.add(st.agent_run)
        # task-05 / FR-01 / design §7 守卫差异：ctx_tokens 实时写回——
        # last-write-wins 直接赋值（瞬时量可上可下），刻意不做上面
        # input/output/cache_* 的仅增不减守卫。close_interactive_run 终态
        # 不触碰该列（SDK result 无 per-call 拆分，保留实时最后写入值）。
        if st.latest_ctx_tokens is not None:
            st.agent_run.ctx_tokens = st.latest_ctx_tokens
            svc._session.add(st.agent_run)
        # ql-20260617-001：session_id 实时写回（首次拿到就填，complete_lease 仍可覆盖）。
        if st.latest_session_id and not st.agent_run.session_id:
            st.agent_run.session_id = st.latest_session_id
            svc._session.add(st.agent_run)
        # 2026-08-21-session-reopen-resume task-01 / DS-1 / FR-01：增量回填
        # AgentSession.agent_session_id（SDK resume key，reopen 硬依赖该列）。
        # 与上面 AgentRun.session_id 的「仅空时写」（D-001@v1）语义刻意不同 ——
        # 会话列做**最新值覆盖**：fork/reload 后 SDK 换新 id，旧 key resume 会
        # 回到分叉前历史，语义错误。守卫：仅 interactive run（agent_session_id
        # 会话 FK 非空）；batch run 该 FK 为 None，不触碰 agent_sessions 表。
        # 并发语义：最终一致（以最后到达消息为准），乱序迟到的旧 id 短暂回退
        # 由同会话下一次上报自愈（design DS-1 审查修订，不加去重复杂度）。
        # 事务：与消息落库走同一 commit()（含 IntegrityError 幂等回滚分支）。
        if st.latest_session_id and st.agent_run.agent_session_id is not None:
            # task-05 注：AgentSession 已提到模块顶部 import（下方 sillyspec
            # 绑定块也要用）；此处原局部 import 会把名字变函数局部作用域，
            # 导致绑定块引用 UnboundLocalError，故移除。
            session_row = await svc._session.get(AgentSession, st.agent_run.agent_session_id)
            # get 返回 None（理论不应发生：会话行在 create_session 的 commit 后
            # 必然已存在）静默跳过；值相同不写（避免无谓 dirty）。
            if session_row is not None and session_row.agent_session_id != st.latest_session_id:
                session_row.agent_session_id = st.latest_session_id
                svc._session.add(session_row)

        # 2026-08-25-session-spec-binding task-05 / FR-01 / D-003@v1：sillyspec
        # 命令自动绑定——落库循环收集的命令经 run 二跳定位平台会话
        # （AgentRun.agent_session_id → AgentSession.workspace_id）后，走
        # change/binding 公共入口落 change_session_links（design §5 W2.1 /
        # §7.5 生命周期契约表第 1 行；禁止在 run_sync 重复实现 placeholder /
        # default 守卫 / savepoint）。守卫（X-002）：agent_session_id 为 None
        # （batch run 无会话 / 会话被删 FK 置空）、会话行不存在或会话无
        # workspace_id → 静默跳过全部绑定，消息照常入库。绑定全程 best-effort：
        # bind 函数自带 savepoint + log.warning 不抛（task-02 契约），外层再兜
        # try/except，任何异常不阻断 AgentRunLog 落库与 SubmittedMessages 返回；
        # 不自行 commit，跟随本方法末尾既有 commit 事务边界。
        if st.sillyspec_commands and st.agent_run.agent_session_id is not None:
            binding_session_row = await svc._session.get(
                AgentSession, st.agent_run.agent_session_id
            )
            if binding_session_row is not None and binding_session_row.workspace_id is not None:
                for sillyspec_command in st.sillyspec_commands:
                    # extract_spec_bindings 解析规则：quick 子命令 / 非 run 子
                    # 命令无产出（D-004），--change default 解析层跳过 + bind
                    # 函数内兜底双保险（D-005@v2）。
                    for spec_binding in extract_spec_bindings(sillyspec_command):
                        try:
                            await bind_session_to_change(
                                svc._session,
                                binding_session_row.workspace_id,
                                spec_binding.change_key,
                                binding_session_row.id,
                            )
                        except Exception as exc:
                            # 外层兜底：bind 自身已 best-effort，此处仅防御
                            # 意外（如 ORM 状态异常），绑定失败不影响消息入库。
                            _rsvc.log.warning(
                                "daemon_messages_spec_bind_failed",
                                agent_run_id=str(st.agent_run_id),
                                change_key=spec_binding.change_key,
                                error=str(exc),
                            )

    # QueuePool 修复 3：commit 前从 st.agent_run 提取 publish 所需标量。commit()
    # 后 SQLAlchemy 默认 expire_on_commit 会令 ORM 属性失效，再读会触发 lazy
    # reload 重新占用 DB 连接——违背"publish 移出 session 生命周期"的目的。
    # 提前取好，PublishIntent 只含标量，publish 时完全不碰 session/连接。
    publish_input_tokens = st.agent_run.input_tokens if st.agent_run is not None else None
    publish_output_tokens = st.agent_run.output_tokens if st.agent_run is not None else None
    # ql-cache：prompt cache 词元同步提取（对齐 input/output），供 publish 实时透传。
    publish_cache_read_tokens = st.agent_run.cache_read_tokens if st.agent_run is not None else None
    publish_cache_creation_tokens = (
        st.agent_run.cache_creation_tokens if st.agent_run is not None else None
    )
    # task-05 / FR-01：ctx_tokens 同步提取（对齐 input/output），供 publish
    # 实时透传（run channel summary + session channel tokens 事件）。
    publish_ctx_tokens = st.agent_run.ctx_tokens if st.agent_run is not None else None
    publish_session_id = st.agent_run.agent_session_id if st.agent_run is not None else None

    if st.count > 0 or (st.agent_run is not None and agent_run_status == "running"):
        # QueuePool 修复 2：dedup 竞态下 (run_id, dedup_key) 唯一约束冲突会令
        # session 中毒（事务未结束、连接不归还 → QueuePool 耗尽）。捕获
        # IntegrityError → rollback，视为幂等成功：daemon ResilienceService 会
        # 重试/outbox 补发，前端实时流容忍丢失/重复。继续用已构造的
        # st.published_logs 走 publish（st.count 不变）。
        try:
            await svc._session.commit()
        except IntegrityError:
            await svc._session.rollback()
            _rsvc.log.warning(
                "daemon_messages_commit_integrity_conflict",
                lease_id=str(st.lease_id),
                agent_run_id=str(st.agent_run_id),
                count=st.count,
            )

    _rsvc.log.info(
        "daemon_messages_submitted",
        lease_id=str(st.lease_id),
        agent_run_id=str(st.agent_run_id),
        count=st.count,
        agent_run_status=agent_run_status,
    )
    # QueuePool 修复 3：不再在持有 session 的 service 内 publish。返回纯标量
    # PublishIntent，router 在 session commit/归还连接后调用
    # publish_submitted_messages 执行 Redis pub/sub（Redis 卡死不再拖垮连接池）。
    return SubmittedMessages(
        st.count,
        st.published_logs,
        PublishIntent(
            agent_run_id=st.agent_run_id,
            lease_id=st.lease_id,
            count=st.count,
            published_logs=st.published_logs,
            agent_run_status=agent_run_status,
            input_tokens=publish_input_tokens,
            output_tokens=publish_output_tokens,
            cache_read_tokens=publish_cache_read_tokens,
            cache_creation_tokens=publish_cache_creation_tokens,
            ctx_tokens=publish_ctx_tokens,
            agent_session_id=publish_session_id,
            timestamp_iso=st.now.isoformat().replace("+00:00", "Z"),
            # task-05：群桥接标量快照（事务内已解析的群上下文 + 最后投影行 id）。
            # 非群场景 group_id=None → publish_submitted_messages 群分支零进入。
            group_id=st.group_bridge.group_id if st.group_bridge is not None else None,
            member_id=st.group_bridge.member_id if st.group_bridge is not None else None,
            member_name=st.group_bridge.member_name if st.group_bridge is not None else None,
            member_session_id=(
                st.group_bridge.member_session_id if st.group_bridge is not None else None
            ),
            projection_log_id=st.last_projection_log_id,
            # quick 影子直聊：直聊投影模式 + [[GROUP]] 段事件（群分支消费）。
            shadow_direct=st.group_bridge.shadow_direct if st.group_bridge is not None else False,
            group_projection_events=st.group_projection_events,
        ),
    )
