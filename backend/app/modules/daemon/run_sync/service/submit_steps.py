"""submit_messages 解析 / 派发 / override 段分步函数（task-10 拆分）。

872 行单方法拆分：_submit_prepare（facade 验证 + 状态初始化 + flat 消息
解析 + dedup 预查 + 群桥接上下文）→ _submit_process_flat_messages（逐条
落库循环：override 信号回退 / usage 提取 / dedup / tool_kind / 跨轮归位 /
投影双写）→ submit_commit._submit_finalize（收尾）。共享可变状态收口在
_SubmitState（原方法局部变量显式传参，design §5「方法体下沉只做搬移 +
状态显式传参」）。D-007：log 经 ``_rsvc.log`` 保持原模块 logger 身份。
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

import app.modules.daemon.run_sync.service as _rsvc
from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.agent.tool_kind import classify_tool_kind

from .group_bridge import (
    _GroupBridgeContext,
    extract_group_broadcast_segments,
    is_group_projectable_reply,
)
from .publish import SubmittedMessages
from .sdk_pipeline import (
    _channel_from_event_type,
    _extract_sdk_messages,
    _persist_agent_event,
    _tool_use_run_lru,
)
from .submit_commit import _submit_finalize


@dataclass
class _SubmitState:
    """submit_messages 分步函数间的共享可变状态（原方法局部变量收口显式传参）。

    lease_id / agent_run_id 以外全部为原方法体内可变局部（含仅赋值一次的
    快照量）；driver 构造空态，prepare 初始化，process 逐条推进，finalize
    收尾读取。字段语义与拆分前同名局部变量一一对应。
    """

    lease_id: uuid.UUID
    agent_run_id: uuid.UUID
    now: datetime | None = None
    count: int = 0
    published_logs: list[dict] = field(default_factory=list)
    latest_input_tokens: int | None = None
    latest_output_tokens: int | None = None
    latest_cache_read_tokens: int | None = None
    latest_cache_creation_tokens: int | None = None
    latest_ctx_tokens: int | None = None
    latest_session_id: str | None = None
    existing_dedup_keys: set[str] = field(default_factory=set)
    completed_segments: set[str] = field(default_factory=set)
    flushed_partials: dict[str, AgentRunLog] = field(default_factory=dict)
    tool_kind_by_tool_use_id: dict[str, str] = field(default_factory=dict)
    sillyspec_commands: list[str] = field(default_factory=list)
    attribution_session_id: uuid.UUID | None = None
    group_bridge: _GroupBridgeContext | None = None
    last_projection_log_id: str | None = None
    group_projection_events: list[dict] = field(default_factory=list)
    cold_lookup_misses: set[tuple[uuid.UUID, str]] = field(default_factory=set)
    flat_messages: list[dict] = field(default_factory=list)
    agent_run: AgentRun | None = None


async def submit_messages(
    svc,
    lease_id: uuid.UUID,
    claim_token: str,
    agent_run_id: uuid.UUID,
    messages: list[dict],
) -> SubmittedMessages:
    """submit_messages 分步编排（task-10 拆分；公共签名与 docstring 见 RunSyncService 壳）。"""
    st = _SubmitState(lease_id=lease_id, agent_run_id=agent_run_id)
    await _submit_prepare(svc, st, claim_token=claim_token, messages=messages)
    await _submit_process_flat_messages(svc, st)
    return await _submit_finalize(svc, st)


async def _submit_prepare(svc, st: _SubmitState, *, claim_token: str, messages: list[dict]) -> None:
    """submit_messages 首段：facade 验证 + 状态初始化 + flat 解析 + 上下文解析。"""
    await svc._facade._get_lease_and_verify_token(st.lease_id, claim_token)

    st.now = datetime.now(UTC)
    st.count = 0
    st.published_logs = []
    # ql-20260617-001：daemon _eventToMessages 把 usage/session_id 透传到首条
    # message（task-runner.ts:1142-1155），但首条 message 总有 content（[ASSISTANT]/
    # [TOOL_USE]/[TOOL_RESULT] 等），所以「仅在 content 为空时提取 usage」的旧分支
    # 永远走不到。现在对所有 message 都提取 usage/session_id（取 max 防御乱序）。
    # ql-20260617-003 + ql-20260705-001：Claude CLI stream-json 的中间 assistant
    # 事件 usage 永远是 {0,0}（真实值只在最终 result 事件）。但 prompt cache 全
    # 命中时 result 事件的 input_tokens 也是合法的 0（真实输入在 cache_read）。
    # 旧 >0 守卫把合法 0 当噪声丢，致 AgentRun.input_tokens 永久 NULL；现接受 0，
    # 靠 max 累积 + 仅增不减写回（service.py:478-501）防御中间事件 0/0。
    st.latest_input_tokens = None
    st.latest_output_tokens = None
    # task-07 / FR-02：prompt cache 词元累积（同 input/output，取 max 防御
    # Claude 中间事件 usage=0/0 乱序）。daemon Wave1 task-01/02/03 已把
    # snake_case cache_read_tokens/cache_creation_tokens 写入 usage dict。
    st.latest_cache_read_tokens = None
    st.latest_cache_creation_tokens = None
    st.latest_session_id = None
    # task-05 / FR-01 / D-002@v1：ctx_tokens（最近一次 API 调用的提示词大小 =
    # input + cache_read + cache_creation，daemon 仅 main 桶 pendingUsage 携带）。
    # 瞬时量可上可下——批内最后出现值胜出直接赋值（last-write-wins），刻意
    # 不用 input/output 的 max 累积（design §7 守卫差异）。
    st.latest_ctx_tokens = None
    # ql-006：interactive session（SDK driver）的 onTurnMessage 发原始 SDK msg
    # （{type:"assistant"|"user", message:{content:[ContentBlock]}}），顶层无
    # content/event_type。旧代码只拼 text blocks、丢弃 thinking/tool_use/tool_result，
    # 导致 agent_run_logs 只有纯文本 stdout。这里先把每条 SDK msg 用
    # _extract_sdk_messages 展开成 0..N 条 flat {event_type, content, channel}
    # （对齐 task-runner _eventToMessages），再统一进入下面的写入循环。
    # batch mode（已 flat）原样透传，行为不变。
    st.flat_messages = []
    for msg in messages:
        # task-07（2026-09-03-agent-provider-abstraction / FR-03 / D-001@v1）：
        # AgentEvent v2 新轨分支。daemon 归一化器（task-03）经 submitMessages 上报
        # {"kind": "agent_event", "event": {...}, "dedup_key"?}（task-09 接线前本
        # 分支休眠）。分支必须在下方 flat 分类（event_type 判断）**之前**：新轨载荷
        # 顶层无 event_type/content，落进 _extract_sdk_messages 会被静默丢弃
        # （design §9 升级顺序：backend 先于 daemon 升级）。无 kind 键的旧形态
        # 消息零改动走原路径（兼容轨）。
        if isinstance(msg, dict) and msg.get("kind") == "agent_event":
            ev = msg.get("event")
            if isinstance(ev, dict):
                st.flat_messages.extend(_persist_agent_event(msg, ev))
            else:
                _rsvc.log.warning(
                    "daemon_messages_agent_event_invalid_payload",
                    lease_id=str(st.lease_id),
                    agent_run_id=str(st.agent_run_id),
                )
            continue
        event_type = msg.get("event_type") or ""
        content = msg.get("content", "")
        if event_type or content:
            st.flat_messages.append(msg)
            continue
        # 顶层无 event_type/content → 当作 SDK 原始格式展开
        st.flat_messages.extend(_extract_sdk_messages(msg))

    # task-21 / FR-08 / D-001@v2：dedup_key 幂等去重。daemon ResilienceService
    # 重试/outbox 补发会重复提交同一 (run_id, dedup_key)；此处查 DB 已存在的
    # dedup_key，写入循环跳过它们（等价 INSERT ON CONFLICT DO NOTHING，但 dialect
    # 无关——SQLite 测试 + PG 生产一致）。dedup_key 由 daemon 注入 message 顶层
    # （task-19），旧 daemon / 未注入路径无 dedup_key → None → 不约束（照常 append）。
    st.existing_dedup_keys = set()
    submitted_dedup_keys = {
        str(m["dedup_key"]) for m in st.flat_messages if m.get("dedup_key") is not None
    }
    if submitted_dedup_keys:
        existing_rows = await svc._session.execute(
            select(AgentRunLog.dedup_key).where(
                AgentRunLog.run_id == st.agent_run_id,
                AgentRunLog.dedup_key.in_(submitted_dedup_keys),
            )
        )
        st.existing_dedup_keys = {str(r[0]) for r in existing_rows.all() if r[0] is not None}
    # task-12 / D-002@v1 / FR-07 FR-08：本次 submit_messages 调用内"已完成"
    # thinking segment 集合。来源：(1) [THINKING_OVERRIDE] 信号声明的 segment；
    # (2) 完整 thinking 行（_extract_sdk_messages 产出 isComplete=true 的 record）
    # 落库后登记的 segment。同 segment 的 partial 到达时若已在集合内，跳过 INSERT
    # （丢弃重复）。跨调用去重交给前端 normalize 覆盖（task-14 范围，design §5.3
    # 修复1 简化方案 / 实现要求 6 优先简化）。
    st.completed_segments = set()
    # task-12：partial 先到、完整后到（daemon 真实流式顺序，最常见场景）——
    # 同 segment 的 partial 已 session.add 进 pending（未 commit），完整行到达
    # 时必须回退旧 partial（从 session 删除 + 从 st.published_logs 移除），让 DB /
    # SSE 只剩完整行（验收点："只落库完整行"）。AgentRunLog 无 metadata 列，无法
    # 软删标记；commit 前 pending 对象还在 identity map，session.delete 直接撤销
    # 即可，无额外 SQL 开销。
    st.flushed_partials = {}
    # ql-20260706-002：tool_use_id → tool_kind 缓存（tool_kind 跨消息继承）。
    # _extract_sdk_messages 的 tool_result 分支产出的 stdout 行无 tool_kind，但
    # 自带 tool_use_id（Anthropic API）；配对的 tool_use（同 id）在上一轮 assistant
    # message 已被 classify_tool_kind 打标。SDK 消息顺序恒为 assistant(tool_use)
    # → user(tool_result)，本循环按顺序处理：tool_use 行登记 id→kind，后续
    # tool_result 行回查补 kind。让 [TOOL_RESULT] 命令输出也带 tool_kind，前端
    # 第二层 SillySpec 筛选才能命中 sillyspec 的 ✅ Step 进度等（d751a871 根因）。
    # 缓存单次调用内有效；跨调用的 tool_result 查不到则保持 None（兼容不报错）。
    st.tool_kind_by_tool_use_id = {}
    # 2026-08-25-session-spec-binding task-05 / FR-01 / D-003@v1：落库循环中
    # 收集的 sillyspec 命令原文（tool_kind=sillyspec 且 channel=tool_call 的
    # 入库行），循环后经 run 二跳定位会话再走 change.binding 落绑定
    # （design §5 W2.1 / §7.5 生命周期契约表第 1 行）。仅 sillyspec 行触发
    # 收集（R-03 低频热路径），空列表时循环后零额外查询。
    st.sillyspec_commands = []
    # task-06 / FR-05 / D-003@v1：跨轮归位预处理。提前 get AgentRun（原在
    # 循环后状态同步处；identity map 复用，无额外查询），取 agent_session_id
    # 作归位映射的会话维度 key——后台子代理行经同 session 的后续 run 上报，
    # 归位映射必须按会话隔离。batch run（agent_session_id=None）无会话维度，
    # 跳过登记与归位（batch 无跨轮后台子代理场景，行为不变）。
    st.agent_run = await svc._session.get(AgentRun, st.agent_run_id)
    st.attribution_session_id = st.agent_run.agent_session_id if st.agent_run is not None else None
    # task-05（2026-09-01-session-group-chat / design §5.2）：群桥接投影上下文。
    # session_kind=='group_member' 精确判定（单聊/worker/quick-chat 解析为 None
    # 零进入）；解析失败 fail-open——消息照常落影子 run，不因桥接缺环阻塞上报。
    st.group_bridge = await svc._resolve_group_bridge_context(st.agent_run)
    # st.last_projection_log_id：本次调用最后一条投影行 id（PublishIntent 快照
    # 标量）。投影行仅由完整行抽 [[GROUP]] 段产生（partial 从不投影），无
    # 投影 partial 回退需求（影子行 partial 的 st.flushed_partials 机制照旧）。
    st.last_projection_log_id = None
    # quick 投影统一标记制（2026-09-02）：[[GROUP]] 转发段的群频道事件（每段
    # 一项，与投影行一一对应；timestamp 口径与 st.published_logs 同款 Z 后缀
    # ISO；@轮与直聊轮同款）。
    st.group_projection_events = []
    # 冷启动反查未命中集合（本次调用局部）：同一 parent_tool_use_id 的多行
    # 只查一次 DB；不做跨调用负缓存——派发行迟到时后续调用反查仍可成功
    # （design §5 P2.2），失败行保持当前 run_id 兜底。
    st.cold_lookup_misses = set()


async def _submit_process_flat_messages(svc, st: _SubmitState) -> None:
    """submit_messages 中段：逐条落库循环（override 回退 / usage / dedup /
    tool_kind / 跨轮归位 / 投影双写），方法体自原模块逐字节搬移。
    """
    for msg in st.flat_messages:
        # ql-20260616-003：daemon _eventToMessage 不发 channel/timestamp/log_id，
        # 后端按 event_type 映射 channel（text→stdout, tool_use/tool_result→tool_call,
        # error→stderr），避免前端 SSE 实时流出现 Invalid Date + channel 误判。
        event_type = msg.get("event_type") or ""
        content = msg.get("content", "")
        channel = msg.get("channel") or _channel_from_event_type(event_type)

        # task-12 / D-002@v1 / FR-07 FR-08：thinking 按 segmentId 去重。
        # daemon task-11 在 partial message 的 metadata 加 segmentId + isPartial，
        # 并在完整 message 到达后 emit [THINKING_OVERRIDE] <segmentId> 信号。
        # _extract_sdk_messages 完整 thinking 行带 metadata.segmentId + isComplete。
        # 这里解析 segmentId / 是否 partial，并识别 override 信号做单次调用内去重。
        metadata = msg.get("metadata") if isinstance(msg, dict) else None
        segment_id = metadata.get("segmentId") if isinstance(metadata, dict) else None
        is_partial = bool(metadata.get("isPartial")) if isinstance(metadata, dict) else False

        # 识别 [THINKING_OVERRIDE] <segmentId> 信号 —— daemon → backend 的"该
        # segment 已被完整 message 覆盖"通知。信号本身不落库（continue 跳过
        # INSERT + publish），仅把 segmentId 加入 st.completed_segments，让后续同
        # segment 的 partial 被丢弃。design §5.3 D1/D2 / task-11 契约。
        if isinstance(content, str) and content.startswith("[THINKING_OVERRIDE] ") and segment_id:
            st.completed_segments.add(segment_id)
            # 若同 segment 的 partial 已落库（罕见：override 早于 partial flush），
            # 一并回退，保持 DB 真相一致。
            stale = st.flushed_partials.pop(segment_id, None)
            if stale is not None:
                # 对象仅 session.add（pending，未 flush），用 expunge 撤销待插入
                # 即可（不会写库）。session.delete 要求对象已 persisted，会抛
                # InvalidRequestError。
                svc._session.expunge(stale)
                st.count -= 1
                st.published_logs = [p for p in st.published_logs if p["log_id"] != str(stale.id)]
            # task-14：跨 submit_messages 调用——partial 已在先前调用 commit 落库，
            # 本调用局部 st.flushed_partials 查不到、也无法 expunge（已 persisted）。按
            # segment_id DELETE 已 commit 的 partial（complete 行 segment_id=NULL 不受
            # 影响），让 DB 只剩完整行。
            # quick 投影统一标记制（2026-09-02）：partial 从不投影（完整行统一
            # 抽段），载体 run 无投影 partial 可回退——影子行回退照旧即可。
            await svc._revoke_committed_partials(st.agent_run_id, segment_id)
            # task-02 / FR-02 / D-003：override 撤回令箭从「截断不发」改为「publish
            # 到 SSE 但不落库」。前端收到 stale=True 信号后按 segmentId 精确撤回已渲染
            # 的半截，消除实时流「半截+全文」重复。INSERT 与 publish 已解耦（本方法
            # 返回纯标量 PublishIntent，router commit 后调 publish_submitted_messages
            # 真正 publish），故 override envelope 直接 append 到 st.published_logs 即复用
            # 现成两路 publish（st.agent_run channel + session channel），无需 helper。
            # envelope 不进 log_entry 构造、不 session.add → agent_run_logs 无 override
            # 行，历史回显保持干净（保留 task-14 override 不污染历史的设计）。
            # P2：必须补全 session_payload(:168) 直取的 4 个 key（log_id/channel/
            # content/timestamp），否则 publish_submitted_messages KeyError。
            st.published_logs.append(
                {
                    "log_id": None,
                    "channel": "stdout",
                    "content": content,
                    "timestamp": st.now.isoformat().replace("+00:00", "Z"),
                    # task-02：被撤回的 segmentId（取循环变量 segment_id，override
                    # 行 metadata.segmentId 即是目标 segment）。
                    "segment_id": segment_id,
                    "stale": True,
                    # 归属四字段走 .get() 容错（override 行无需归属，保留 None）。
                    "parent_tool_use_id": msg.get("parent_tool_use_id")
                    if isinstance(msg, dict)
                    else None,
                    "subagent_type": msg.get("subagent_type") if isinstance(msg, dict) else None,
                    "depth": msg.get("depth") if isinstance(msg, dict) else None,
                    "tool_kind": msg.get("tool_kind") if isinstance(msg, dict) else None,
                }
            )
            continue

        # task-08 / D-002@v1：识别 [ASSISTANT_OVERRIDE] <segmentId> 信号 —— daemon
        # task-05/06/07 在完整 assistant message 到达后 emit 该信号，通知"该 segment
        # 已被完整 message 覆盖"，让 backend 删同 segmentId 的 assistant partial
        # （对齐 [THINKING_OVERRIDE] :378-394 模板，消除 #35 双发）。信号本身不落库
        # （continue 跳过 INSERT + publish），仅把 segmentId 加入 st.completed_segments
        # 兜底后续乱序 late partial。daemon [ASSISTANT_OVERRIDE] metadata 不含
        # thinking:True（assistant 专属），segmentId 用 daemon 格式
        # （${prefix}:${mid}:${blockIndex}）与 daemon partial 行 metadata.segmentId
        # 一致，命中删除路径。
        if isinstance(content, str) and content.startswith("[ASSISTANT_OVERRIDE] ") and segment_id:
            st.completed_segments.add(segment_id)
            # 若同 segment 的 assistant partial 已 flush（pending 未 commit），回退
            # 保持 DB 真相一致。对齐 thinking 模板：用 expunge 撤销待插入
            # （session.delete 要求对象已 persisted，会抛 InvalidRequestError）。
            stale = st.flushed_partials.pop(segment_id, None)
            if stale is not None:
                svc._session.expunge(stale)
                st.count -= 1
                st.published_logs = [p for p in st.published_logs if p["log_id"] != str(stale.id)]
            # task-14：跨 submit_messages 调用——assistant partial 已在先前调用 commit
            # 落库（半截先到、完整+override 后到的真实流式顺序），本调用局部
            # st.flushed_partials 查不到。按 segment_id DELETE 已落库 partial，
            # 让 DB 只剩完整行（消除 #35 累积重复）。对齐 thinking override 同款 DELETE。
            # quick 投影统一标记制（2026-09-02）：载体 run 无投影 partial 可回退
            # （partial 从不投影），影子行回退照旧。
            await svc._revoke_committed_partials(st.agent_run_id, segment_id)
            # task-02 / FR-02 / D-003：override 撤回令箭 publish 到 SSE 但不落库（对齐
            # 上面 [THINKING_OVERRIDE] 分支的改法）。前端据 stale=True + segment_id
            # 撤回已渲染的 assistant 半截。envelope 直接 append st.published_logs 跳
            # INSERT / log_entry 构造（INSERT 与 publish 已解耦），复用现成两路 publish。
            # P2：补全 session_payload(:168) 直取的 4 个 key，否则 KeyError。
            st.published_logs.append(
                {
                    "log_id": None,
                    "channel": "stdout",
                    "content": content,
                    "timestamp": st.now.isoformat().replace("+00:00", "Z"),
                    "segment_id": segment_id,
                    "stale": True,
                    "parent_tool_use_id": msg.get("parent_tool_use_id")
                    if isinstance(msg, dict)
                    else None,
                    "subagent_type": msg.get("subagent_type") if isinstance(msg, dict) else None,
                    "depth": msg.get("depth") if isinstance(msg, dict) else None,
                    "tool_kind": msg.get("tool_kind") if isinstance(msg, dict) else None,
                }
            )
            continue

        # ql-20260617-001：usage / session_id 在每条 message 顶层（daemon 透传），
        # 与 content 是否为空无关，全部提取。
        usage = msg.get("usage")
        if isinstance(usage, dict):
            in_tok = usage.get("input_tokens")
            out_tok = usage.get("output_tokens")
            # task-07：prompt cache 词元（Claude cache_read/cache_creation；
            # codex/OpenAI 无 cache → None → 跳过）。对齐 input/output 的
            # max 累积（service.py:69-72 乱序防御注释）。
            cache_read_tok = usage.get("cache_read_tokens")
            cache_creation_tok = usage.get("cache_creation_tokens")
            # task-05 / FR-01：ctx_tokens——最近一次调用提示词大小（daemon
            # message_start 三分量求和，仅 main 桶注入）。last-write-wins：
            # 批内最后出现值胜出直接赋值（非 max）；缺键（老 daemon / 子桶
            # pendingUsage）→ isinstance 守卫不命中 → None 不写，天然兼容。
            ctx_tok = usage.get("ctx_tokens")
            # ql-20260705-001：接受 0（Claude prompt cache 全命中时 input_tokens
            # 合法为 0，真实输入在 cache_read_tokens）。旧 >0 守卫把合法 0 当噪声
            # 丢，致 AgentRun.input_tokens 永久 NULL。改由 max 累积 + 仅增不减写回
            # （service.py:478-501）防御中间事件 0/0 —— 0 不拉低已有非零值。
            if isinstance(in_tok, (int, float)):
                st.latest_input_tokens = max(st.latest_input_tokens or 0, int(in_tok))
            if isinstance(out_tok, (int, float)):
                st.latest_output_tokens = max(st.latest_output_tokens or 0, int(out_tok))
            if isinstance(cache_read_tok, (int, float)):
                st.latest_cache_read_tokens = max(
                    st.latest_cache_read_tokens or 0, int(cache_read_tok)
                )
            if isinstance(cache_creation_tok, (int, float)):
                st.latest_cache_creation_tokens = max(
                    st.latest_cache_creation_tokens or 0, int(cache_creation_tok)
                )
            if isinstance(ctx_tok, (int, float)):
                st.latest_ctx_tokens = int(ctx_tok)
        msg_session_id = msg.get("session_id")
        if isinstance(msg_session_id, str) and msg_session_id:
            st.latest_session_id = msg_session_id

        if not content:
            # 无 content 的 message（理论上 daemon 不产生）跳过日志写入，
            # 但 usage / session_id 已在上面提取。
            continue

        # task-12 去重判定 1：完整行到达时，若同 segment 的 partial 已落库，
        # 回退旧 partial（撤销 pending INSERT + 从 st.published_logs 移除），然后
        # 照常 INSERT 完整行。对应验收点"partial + 完整同 segment 时只落库完整
        # 行"。仅 thinking 完整行（is_partial=False 且有 segment_id）触发。
        # quick 投影统一标记制（2026-09-02）：投影 partial 不存在（partial
        # 从不投影），影子行回退照旧即可。
        if segment_id and not is_partial and segment_id in st.flushed_partials:
            stale = st.flushed_partials.pop(segment_id)
            # 对象仅 session.add（pending，未 commit），expunge 撤销待插入即可
            # （不写库）。session.delete 要求对象已 persisted 会抛错，故走 expunge。
            svc._session.expunge(stale)
            st.count -= 1
            st.published_logs = [p for p in st.published_logs if p["log_id"] != str(stale.id)]

        # task-12 去重判定 2：partial 到达时，若同 segment 已见完整行 / override
        # 信号（st.completed_segments 命中），直接跳过 INSERT + publish（late partial
        # 场景，乱序兜底）。
        if segment_id and is_partial and segment_id in st.completed_segments:
            continue

        # quick-0e56260f 去重判定 3（跨调用）：partial 到达时，若该 segment 的
        # 完整行已在先前调用处理过（override 标记行已 commit），跳过 INSERT +
        # publish——堵「完整行调用跑完 DELETE 后 partial 事务才提交」的并发
        # 竞态（会话 0ef651b6 实证：partial 03:30:45.437 开始处理、full
        # 03:30:45.580，full 的跨调用 DELETE 查不到未提交的 partial，擦肩留库），
        # 也拦 daemon 重试迟到的同 segmentId 窗口。
        if (
            segment_id
            and is_partial
            and await svc._override_marker_exists(st.agent_run_id, segment_id)
        ):
            continue

        # task-21 / FR-08：dedup_key 幂等——已存在的 (run_id, dedup_key) 跳过 INSERT
        # （daemon 重试/outbox 补发的重复消息）。无 dedup_key 的消息照常 append（NULL 不约束）。
        dedup_key = msg.get("dedup_key") if isinstance(msg, dict) else None
        if dedup_key is not None:
            dedup_key = str(dedup_key)
            if dedup_key in st.existing_dedup_keys:
                continue
            st.existing_dedup_keys.add(dedup_key)

        log_id = uuid.uuid4()
        # 2026-07-05-agent-log-type-tags task-04 / FR-05：batch 路径 tool_kind
        # 兜底落库。优先 msg.get("tool_kind")（新 daemon 已带，含 _extract_sdk_messages
        # 主路径打标值）；缺则仅对 channel=='tool_call' 行 JSON.parse(content)
        # 取 tool/args 调 classify_tool_kind 兜底（旧 daemon 无 tool_kind 字段时启用）。
        # stdout 文本行（[TOOL_USE]/[ASSISTANT]/...）不兜底（tool_kind=None），
        # design §5 Phase 2 明确：DB 列层面只 tool_call 行有值。
        # 防御：classify_tool_kind 在 bash + args.command 非 str 时会抛 TypeError
        # （Python 版未强转），JSON.parse 失败也会抛；统一 try/except 静默退 None，
        # 不阻塞落库（design §6 / R-08）。
        tool_kind = msg.get("tool_kind") if isinstance(msg, dict) else None
        if tool_kind is None and channel == "tool_call":
            try:
                parsed = json.loads(content) if isinstance(content, str) and content else {}
                if isinstance(parsed, dict):
                    tool_kind = classify_tool_kind(
                        parsed.get("tool"),
                        parsed.get("args") if isinstance(parsed.get("args"), dict) else None,
                    )
            except Exception:
                tool_kind = None
        else:
            # msg.get 优先命中（含 _extract_sdk_messages 注入值 + 新 daemon 直传）；
            # 显式归一 None，避免下游 publish 拿到非预期类型。
            tool_kind = tool_kind if isinstance(tool_kind, str) and tool_kind else None

        # 2026-08-25-session-spec-binding task-05 / FR-01 / D-003@v1：sillyspec
        # 命令收集（仅 tool_kind=sillyspec 且 channel=tool_call 的**入库**行
        # 触发——dedup 跳过 / override 信号行已在上方 continue，不进本分支，
        # R-03 禁全量消息扫描）。content 两路径同构：batch 为 daemon tc_content
        # JSON，interactive 为 _extract_sdk_messages 产出的 {"tool","args",...}
        # JSON，均取 json.loads(content)["args"]["command"]；解析失败 / 结构
        # 不符静默跳过（不抛错不落绑定）。同命令去重，减少循环后重复解析。
        if channel == "tool_call" and tool_kind == "sillyspec" and isinstance(content, str):
            try:
                parsed_call = json.loads(content)
                call_args = parsed_call.get("args") if isinstance(parsed_call, dict) else None
                raw_command = call_args.get("command") if isinstance(call_args, dict) else None
                if (
                    isinstance(raw_command, str)
                    and raw_command
                    and raw_command not in st.sillyspec_commands
                ):
                    st.sillyspec_commands.append(raw_command)
            except Exception:
                # JSON 解析失败等异常静默吞（与上方 classify_tool_kind 兜底同款
                # 防御口径），不影响落库主流程。
                pass

        # ql-20260706-002：tool_kind 跨消息继承——tool_result（命令输出 stdout 行）
        # 继承配对 tool_use（命令调用 tool_call 行）的 tool_kind。tool_use 行
        # （带 tool_kind + tool_use_id）登记 id→kind 缓存；tool_result 行（stdout，
        # 无 tool_kind）按自带 tool_use_id 回查补 kind。让 stdout 的 [TOOL_RESULT]
        # 行也带 tool_kind，前端第二层筛选命中 sillyspec 步骤进度等命令输出
        # （d751a871 根因）。batch mode 扁平 [TOOL_RESULT] 文本行无 tool_use_id
        # → msg.get 返回 None → 跳过，行为不变；tool_use_id 在缓存缺失时也跳过。
        _msg_tuid = msg.get("tool_use_id") if isinstance(msg, dict) else None
        if isinstance(_msg_tuid, str) and _msg_tuid:
            if event_type == "tool_use" and tool_kind:
                st.tool_kind_by_tool_use_id[_msg_tuid] = tool_kind
            elif event_type == "tool_result" and not tool_kind:
                _inherited = st.tool_kind_by_tool_use_id.get(_msg_tuid)
                if isinstance(_inherited, str) and _inherited:
                    tool_kind = _inherited

        # task-06 / FR-05 / D-003@v1：跨轮归位——带 parent_tool_use_id 的行
        # （后台子代理输出 / [TASK_*] 行，经同 session 后续 run 上报）run_id
        # 归写**派发 run**，消除前端孤儿 stub。两级映射：进程级 LRU → 冷启动
        # 反查 agent_run_logs；仍失败保持当前 run_id 兜底不抛错（design §5
        # P2.2）。batch run（st.attribution_session_id=None）/ 主 agent 行（无
        # parent）不经本分支，行为不变。
        parent_tuid = msg.get("parent_tool_use_id") if isinstance(msg, dict) else None
        effective_run_id = st.agent_run_id
        if isinstance(parent_tuid, str) and parent_tuid and st.attribution_session_id is not None:
            lru_key = (st.attribution_session_id, parent_tuid)
            dispatch_run_id = _tool_use_run_lru.get(lru_key)
            if dispatch_run_id is None and lru_key not in st.cold_lookup_misses:
                # LRU 未命中且本调用内未查过 → 冷启动反查；失败记入局部集合，
                # 同一 parent id 的后续行不再重复打 DB（一次 submit 常含多行）。
                dispatch_run_id = await svc._resolve_dispatch_run_id(
                    st.attribution_session_id, parent_tuid
                )
                if dispatch_run_id is not None:
                    _tool_use_run_lru.put(lru_key, dispatch_run_id)
                else:
                    st.cold_lookup_misses.add(lru_key)
                    _rsvc.log.debug(
                        "daemon_messages_parent_dispatch_lookup_miss",
                        agent_run_id=str(st.agent_run_id),
                        agent_session_id=str(st.attribution_session_id),
                        parent_tool_use_id=parent_tuid,
                    )
            if dispatch_run_id is not None:
                effective_run_id = dispatch_run_id

        # task-06 / FR-05：assistant tool_use 行（channel=tool_call 的 JSON 卡）
        # 落库时登记 (session_id, tool_use_id) → 本行 run_id，供后续 parent 行
        # 归位命中热路径。登记值用 effective_run_id（归位后的落库 run）而非
        # 上报 run——嵌套子代理（孙代）的 parent 是子代 tool_use，其行已归位
        # 到派发 run，孙代据此同样归位，两层语义一致。interactive 路径
        # tool_use_id 在 flat record 顶层；batch 路径（旧 daemon）仅在 content
        # JSON 内，兜底解析（解析失败静默跳过，不阻塞落库）。
        if channel == "tool_call" and st.attribution_session_id is not None:
            dispatch_reg_tuid = _msg_tuid if isinstance(_msg_tuid, str) and _msg_tuid else ""
            if not dispatch_reg_tuid and isinstance(content, str) and content:
                try:
                    parsed_reg = json.loads(content)
                    reg_val = (
                        parsed_reg.get("tool_use_id") if isinstance(parsed_reg, dict) else None
                    )
                    dispatch_reg_tuid = reg_val if isinstance(reg_val, str) and reg_val else ""
                except Exception:
                    dispatch_reg_tuid = ""
            if dispatch_reg_tuid:
                _tool_use_run_lru.put(
                    (st.attribution_session_id, dispatch_reg_tuid), effective_run_id
                )

        # task-07（2026-09-03-agent-provider-abstraction / FR-03）：新轨行的完整
        # AgentEvent JSON（_persist_agent_event 注入 flat record 的私有键），落
        # metadata_['agent_event'] 供前端 normalize 双轨结构化渲染 + SSE 透传。
        # 旧轨消息无该键 → None（metadata_ 列保持 NULL，零回归；群聊投影行是
        # 独立 INSERT 自带 metadata_，与本键互不覆盖，design §8）。
        agent_event_payload = msg.get("_agent_event") if isinstance(msg, dict) else None

        log_entry = AgentRunLog(
            id=log_id,
            run_id=effective_run_id,
            timestamp=st.now,
            channel=channel,
            # ql-20260626-001 放宽（原 5000 截断 agent 长答复/总结）
            content_redacted=content[:50000],
            dedup_key=dedup_key,
            # 2026-06-28-daemon-subagent-transcript task-09 / FR-07：归属三列。
            # daemon session-manager 注入 msg.depth（D-007）+ SDK 顶层
            # parent_tool_use_id/subagent_type，_extract_sdk_messages（task-08）透传到
            # 每条 flat record；此处读出落库。主 agent / 未升级 daemon → None
            # （brownfield，design §9）。msg 是 flat record（submit_messages 循环变量）。
            parent_tool_use_id=msg.get("parent_tool_use_id") if isinstance(msg, dict) else None,
            subagent_type=msg.get("subagent_type") if isinstance(msg, dict) else None,
            depth=msg.get("depth") if isinstance(msg, dict) else None,
            # task-04 / FR-04 FR-05：tool_kind 落库列（_extract_sdk_messages 主路径
            # 或 JSON.parse 兜底；stdout 行为 None）。
            tool_kind=tool_kind,
            # task-14 / FR-02：partial 行持久化 segment_id 供 override 跨调用 DELETE；
            # complete 行（is_partial=False）写 None，DELETE by segment_id 不误删完整行。
            segment_id=segment_id if is_partial else None,
            # ql-20260824-020：Edit structuredPatch JSON（_extract_sdk_messages 注入
            # flat record），落库供 REST 历史 + SSE 实时两路透传前端 diff 真实行号。
            edit_patch=msg.get("edit_patch") if isinstance(msg, dict) else None,
            # task-07：新轨 agent_event 行的结构化事件 JSON（见上方注释）。
            metadata_=(
                {"agent_event": agent_event_payload}
                if isinstance(agent_event_payload, dict)
                else None
            ),
        )
        svc._session.add(log_entry)
        st.count += 1
        st.published_logs.append(
            {
                "log_id": str(log_id),
                "channel": channel,
                "content": content[:50000],  # ql-20260626-001 同 DB 放宽
                "timestamp": st.now.isoformat().replace("+00:00", "Z"),
                # 2026-06-28-daemon-subagent-transcript task-09 / FR-08：归属三列
                # 透传到 SSE 实时流——run channel publish 整个 payload，session
                # channel（publish_submitted_messages）也取这三字段。让前端实时
                # 流（不经 DB 查询）也能渲染子代理归属，与 DB 查询路径一致。
                "parent_tool_use_id": log_entry.parent_tool_use_id,
                "subagent_type": log_entry.subagent_type,
                "depth": log_entry.depth,
                # 2026-07-05-agent-log-type-tags task-04 / FR-06 / R-08：tool_kind
                # 透传到 SSE 实时流（run channel）。前端实时日志行渲染工具徽标 +
                # 第二层筛选需此字段，DB 列与实时流保持一致。
                "tool_kind": log_entry.tool_kind,
                # task-01 / D-003 / FR-01：segment_id 透传到 SSE 实时流（run channel）。
                # **必须用 log_entry.segment_id**（complete 行为 None），切勿用循环顶部
                # 局部变量 segment_id（它取自 metadata.segmentId，complete 行也非 None，
                # 会让前端误判 complete 全文为半截触发错误撤回）。partial 行非空
                # "main:msg_xxx:N"，complete/其他行 None。前端据「非空」识别半截。
                "segment_id": log_entry.segment_id,
                # ql-20260824-020：edit_patch 透传到 SSE 实时流（run channel），
                # 与 DB 列一致；非 Edit 结果行为 None。
                "edit_patch": log_entry.edit_patch,
                # task-07（2026-09-03-agent-provider-abstraction / FR-03）：
                # AgentEvent 结构化事件透传到 SSE 实时流（run channel 整 payload
                # 直发；session channel 见 publish_submitted_messages）。
                # 旧轨行 / override 信封 / 标记行 None（.get() 容错，零影响）。
                "agent_event": agent_event_payload
                if isinstance(agent_event_payload, dict)
                else None,
            }
        )

        # task-05（design §5.2 改动点①）+ quick 投影统一标记制（2026-09-02）：
        # 群桥接双写投影行——影子行落库后同事务插投影行到群载体 run（仅本轮
        # run 自身的 assistant 文本段：effective_run_id!=agent_run_id 的后台子
        # 代理归位行属过程信息不投影；thinking/tool/stderr/系统行由
        # is_group_projectable_reply 过滤）。**@轮与直聊轮同款标记制**：完整
        # assistant 文本仅 [[GROUP]] 标记段投影（标记剥离只投内容、同轮多段
        # 各成一行保序；段外推理过程/工具细节只留影子会话）；partial 半截行
        # 不解析（标记可能被流式截断，完整行到达统一抽段，免半截投影+撤回
        # 抖动——partial 因此从不投影，投影行 segment_id 恒 None）。dedup_key
        # =None：同源多段共享 dedup_key 会撞载体 run 的 (run_id, dedup_key)
        # 部分唯一索引。@轮整轮无标记的「群里死寂」由 close_interactive_run
        # 的兜底行补齐（见 _emit_group_mention_projection_fallback）。
        if (
            st.group_bridge is not None
            and effective_run_id == st.agent_run_id
            and is_group_projectable_reply(channel, content)
            and not log_entry.segment_id
            and isinstance(content, str)
            # 2026-09-10-group-agent-direct-chat（D-007 硬驾驭）：拦截轮
            # 整轮不投影——[[GROUP]] 段也拦（collaborator/coordinator/
            # 直聊/成员私聊轮不经群时间线，硬拦截不依赖 prompt 自觉）；
            # converge 轮无 dm_target 放行（最终总结照标记投影进群）。
            and not st.group_bridge.projection_blocked
        ):
            for seg_idx, seg_text in enumerate(extract_group_broadcast_segments(content)):
                projection_row = svc._build_group_projection_row(
                    st.group_bridge,
                    source_row=log_entry,
                    dedup_key=None,
                    content_override=seg_text,
                    timestamp_override=st.now + timedelta(microseconds=seg_idx),
                )
                svc._session.add(projection_row)
                st.group_projection_events.append(
                    {
                        "log_id": str(projection_row.id),
                        "content": seg_text,
                        "timestamp": st.now.isoformat().replace("+00:00", "Z"),
                    }
                )
                st.last_projection_log_id = str(projection_row.id)

        # 登记本 segment 的状态：
        # - partial 行：记入 st.flushed_partials，等完整行到达时回退。
        # - 完整行：加入 st.completed_segments，让本调用内后到的同 segment partial
        #   被跳过（完整先到、partial 后到的乱序兜底）。
        if segment_id and is_partial:
            st.flushed_partials[segment_id] = log_entry
        elif segment_id and not is_partial:
            st.completed_segments.add(segment_id)
            # quick-9f86d2c3（会话 e87622aa）：完整行跨调用清理——interactive
            # 流式真实顺序是「partial 已在前次 submit_messages commit、完整行
            # 本次到达」，判定 1（同调用 expunge）够不到已 commit 行。按
            # segment_id DELETE 已落库 partial（complete 行 segment_id 恒 NULL
            # 不受影响），DB 收敛「只剩完整行」——轮后对账 / 断线重放不再把
            # 半截行复活成直播重复段（daemon override 信号生产环境未观测到
            # 到达，本清理不依赖它）。对齐 override 分支同款 DELETE。
            await svc._revoke_committed_partials(st.agent_run_id, segment_id)
            # quick 投影统一标记制（2026-09-02）：载体 run 无投影 partial 可
            # DELETE（partial 从不投影、投影行 segment_id 恒 None），下方合成
            # stale 令箭只发 run/session 频道（群频道零进入）。
            # quick-0e56260f（会话 0ef651b6）：backend 合成 override 撤回信号。
            # 动机：直播期 partial 窗口经 Redis 发布是 best-effort，部分窗口
            # 丢失后前端按到达顺序拼出「乱序胶水段」（非完整行前缀），全部
            # 前缀收编失效 → 重复段；且 daemon 信号生产从未到达（见已知问题）。
            # backend 在完整行落库点确知 segmentId，就地补发令箭：
            #   ① 落一行标记（content=override 令箭、segment_id=NULL 防 revoke
            #      误删）——跨调用竞态守护（见 _override_marker_exists）+ 完整行
            #      实时发布丢失时轮后对账重放补投，前端据令箭按段 id 任意位置
            #      撤回乱序胶水段（不依赖前缀判定）；
            #   ② st.published_logs 追加同形信封（stale=True），实时直播立即治愈。
            # 格式与 daemon 信号（task-07）逐字节一致，前端 OVERRIDE_RE /
            # 撤回链路零改动；标记行在历史回放被分类为 override 不渲染，
            # 「历史干净」语义保持（仅多一行不可见行）。不计入 st.count（st.count
            # 语义=内容消息数）。message.id 缺失的退化段（mid=unknown）跳过
            # ——daemon 退化 partial 用 runId:thinking 格式永不对齐，标记无用。
            if ":unknown:" not in segment_id:
                marker_thinking = isinstance(content, str) and content.startswith("[THINKING]")
                marker_content = svc._override_marker_content(segment_id, marker_thinking)
                marker_id = uuid.uuid4()
                svc._session.add(
                    AgentRunLog(
                        id=marker_id,
                        run_id=st.agent_run_id,
                        timestamp=st.now,
                        channel="stdout",
                        content_redacted=marker_content,
                        dedup_key=None,
                        parent_tool_use_id=msg.get("parent_tool_use_id")
                        if isinstance(msg, dict)
                        else None,
                        subagent_type=msg.get("subagent_type") if isinstance(msg, dict) else None,
                        depth=msg.get("depth") if isinstance(msg, dict) else None,
                        tool_kind=None,
                        segment_id=None,
                        edit_patch=None,
                    )
                )
                st.published_logs.append(
                    {
                        "log_id": str(marker_id),
                        "channel": "stdout",
                        "content": marker_content,
                        "timestamp": st.now.isoformat().replace("+00:00", "Z"),
                        "segment_id": segment_id,
                        "stale": True,
                        "parent_tool_use_id": msg.get("parent_tool_use_id")
                        if isinstance(msg, dict)
                        else None,
                        "subagent_type": msg.get("subagent_type")
                        if isinstance(msg, dict)
                        else None,
                        "depth": msg.get("depth") if isinstance(msg, dict) else None,
                        "tool_kind": None,
                    }
                )


def _override_marker_content(segment_id: str, thinking: bool) -> str:
    """quick-0e56260f：完整行落库时合成的 override 标记行/信封正文。

    格式与 daemon 信号（task-07）逐字节一致（``[ASSISTANT_OVERRIDE] <segmentId>``
    / ``[THINKING_OVERRIDE] <segmentId>``），前端 OVERRIDE_RE / 撤回链路零改动。
    """
    prefix = "THINKING" if thinking else "ASSISTANT"
    return f"[{prefix}_OVERRIDE] {segment_id}"


async def _override_marker_exists(svc, agent_run_id: uuid.UUID, segment_id: str) -> bool:
    """quick-0e56260f：该 segment 的完整行是否已处理（override 标记行已落库）。

    partial 行落库前的守护：完整行先到（HTTP 并发乱序 / daemon 重试迟到）时，
    该 segment 已被覆盖，partial 整行跳过（不 INSERT 不 publish）——堵住
    「完整行调用跑完 DELETE 后 partial 事务才提交」的竞态（会话 0ef651b6 实证：
    partial 03:30:45.437 开始处理、full 03:30:45.580，full 的跨调用 DELETE
    查不到未提交的 partial，擦肩留库）。标记行 segment_id=NULL（不会被
    _revoke_committed_partials 误删），以 content 精确匹配识别。
    """
    row = (
        await svc._session.execute(
            select(AgentRunLog.id).where(
                AgentRunLog.run_id == agent_run_id,
                AgentRunLog.content_redacted.in_(
                    [
                        svc._override_marker_content(segment_id, False),
                        svc._override_marker_content(segment_id, True),
                    ]
                ),
            )
        )
    ).scalar_one_or_none()
    return row is not None
