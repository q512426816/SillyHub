"""SDK 消息展开管线（task-10 拆分自 run_sync/service.py 模块级 helper 簇）。

_extract_sdk_messages（旧轨 Claude SDK 原始 message 展开，1:1 对齐 daemon
task-runner ``_eventToMessages``）/ _persist_agent_event（新轨 AgentEvent v2
展开，产物与旧轨同款 flat record）/ _channel_from_event_type（event_type →
channel 映射）+ tool_result 截断常量 + (agent_session_id, tool_use_id) → 派发
run_id 进程级 LRU（task-06 跨轮归位两级供给的热路径半段）。纯函数层：无
Redis / DB session 依赖，方法体自原模块逐字节搬移（change
2026-09-07-arch-large-file-split design §5 Wave 2）。
"""

from __future__ import annotations

import json
import uuid
from collections import OrderedDict
from datetime import UTC, datetime

from app.modules.agent.tool_kind import classify_tool_kind

# ql-20260709-001：tool_result 命令输出截断上限（原 3000 → 100000）。
# 3000 字符会砍掉 scan / 构建 / 测试命令输出的关键尾部（含大量长路径行，
# 如 sillyspec scan 一次输出 59 行），用户在前端只能看到前几行、后面全丢。
# 100000（约 2000 行）覆盖绝大多数命令输出；超长追加中文标注保留原始长度
# 信息。daemon task-runner.ts 的 batch 路径同步对齐（原同样 3000 截断）。
TOOL_RESULT_MAX_CHARS = 100_000


# ── task-06 / FR-05 / D-003@v1：submit_messages 跨轮归位（后台子代理） ─────────
# 后台子代理的日志行（带 parent_tool_use_id）经同 session 的**后续 run** 上报，
# 若按上报 run 落库，前端子代理目录按「派发 tool_use → 子代理行」聚合时找不到
# 行（孤儿 stub）。submit_messages 落库时把这类行的 run_id 归写**派发 run**
# （派发 tool_use 行所在的 run，design §5 Phase 2 P2.2）。tool_use_id → 派发
# run_id 的映射两级供给：进程级 LRU（热路径零查询）+ 冷启动反查 agent_run_logs
# （_resolve_dispatch_run_id）。只改写入归因，不改 AgentRun/AgentSession 状态机，
# 历史行不迁移（N4）。

# LRU 容量 1024（task-06 契约）：长会话多轮派发的 tool_use 映射上限，防膨胀。
_TOOL_USE_RUN_LRU_CAPACITY = 1024


class _ToolUseRunLRU:
    """(agent_session_id, tool_use_id) → 派发 run_id 的进程级 LRU。

    - 手写 OrderedDict 而非 functools.lru_cache：lru_cache 会把 None 返回值也
      缓存（等价负缓存），冷启动反查失败一次后会被永久短路，违背「派发行迟到
      时后续上报仍可归位」的语义；本类只在反查成功时写入。
    - asyncio 单线程事件循环内读-判-写无 await 穿插，天然原子，无需锁（对齐
      下方 _bash_chunk_last_publish 的并发口径）。
    """

    def __init__(self, capacity: int = _TOOL_USE_RUN_LRU_CAPACITY) -> None:
        self._capacity = capacity
        self._data: OrderedDict[tuple[uuid.UUID, str], uuid.UUID] = OrderedDict()

    def get(self, key: tuple[uuid.UUID, str]) -> uuid.UUID | None:
        """查映射：命中移到 MRU 端并返回 run_id；未命中返回 None（不写负缓存）。"""
        run_id = self._data.get(key)
        if run_id is not None:
            self._data.move_to_end(key)
        return run_id

    def put(self, key: tuple[uuid.UUID, str], run_id: uuid.UUID) -> None:
        """写映射并维持容量上限（超出淘汰最老条目）。"""
        self._data[key] = run_id
        self._data.move_to_end(key)
        while len(self._data) > self._capacity:
            self._data.popitem(last=False)

    def clear(self) -> None:
        """清空缓存（测试隔离用，task-08 单测在用例间清态）。"""
        self._data.clear()


# 进程级单例：跨 submit_messages 调用、跨 run 共享（同会话第二轮起命中热路径）。
_tool_use_run_lru = _ToolUseRunLRU()


# ---------------------------------------------------------------------------
# Helpers (随 submit_messages 迁入，design §10 R2：私有辅助随主方法归位)
# ---------------------------------------------------------------------------


def _extract_sdk_messages(msg: dict) -> list[dict]:
    """Expand a raw SDK driver message (interactive mode) into one or more flat
    log messages ``{event_type, content, channel, ...}``.

    ql-006：interactive session（SDK driver）的 ``onTurnMessage`` 把 *原始* SDK
    message 直接发给后端，形状为 ``{type:"assistant"|"user", message:{role,
    content:[ContentBlock]}}``。与 batch mode 不同（task-runner ``_eventToMessages``
    已把每个 content block 拆成 [ASSISTANT]/[THINKING]/[TOOL_USE]/[TOOL_RESULT]
    行），interactive mode 把整块 block 数组交给后端。旧实现只拼 ``type=="text"``
    的 blocks，丢弃 thinking/tool_use/tool_result，导致 ``agent_run_logs`` 只有纯
    文本 stdout，前端 ToolCallCard / thinking 面板永不渲染。

    本函数 1:1 复现 ``sillyhub-daemon/dist/task-runner.js`` 的 ``_eventToMessages``
    （L980-1126）规则，让 interactive-mode 日志与 batch-mode 字节兼容：

      assistant.content:
        - ``text``       → 1× ``[ASSISTANT] <text>`` (stdout)
        - ``thinking``   → 1× ``[THINKING] <text[:20000]>`` (stdout)
        - ``tool_use``   → 2×: ``[TOOL_USE] <name>: <args>`` (stdout)
                           + ``{tool,args,timestamp,status,success}`` (tool_call)
      user.content:
        - ``tool_result`` → 1× ``[TOOL_RESULT] <content[:100000]>`` (stdout，超长追加截断标注)

    usage / session_id（真实 SDK 形态在 ``message.usage``，daemon 也可能透传到顶层）
    只注入到产出的*第一条* flat record，避免同一 SDK message 的多个 sibling block
    重复累加 usage。返回 ``[]`` 表示不可识别的形状（调用方视作跳过）。
    """
    sdk_type = msg.get("type")
    inner = msg.get("message")
    if not isinstance(sdk_type, str) or not isinstance(inner, dict):
        return []
    blocks = inner.get("content")
    if not isinstance(blocks, list):
        return []

    # Carried fields injected onto the FIRST produced record only.
    base: dict = {}
    inner_usage = inner.get("usage")
    if isinstance(inner_usage, dict):
        base["usage"] = inner_usage
    top_usage = msg.get("usage")
    if isinstance(top_usage, dict) and "usage" not in base:
        base["usage"] = top_usage
    session_id = msg.get("session_id") or inner.get("session_id")
    if isinstance(session_id, str) and session_id:
        base["session_id"] = session_id

    out: list[dict] = []
    stamped = False

    def stamp(rec: dict) -> dict:
        nonlocal stamped
        if not stamped and base:
            rec.update(base)
            stamped = True
        return rec

    # task-12 / D-002@v1 / FR-07 FR-08：thinking segmentId 去重 —— 完整 message
    # 展开时给每个 thinking block 标记 segmentId，让上层 submit_messages 能识别
    # "同 segment 的 partial 已 flush"并跳过重复行。
    # quick-9f86d2c3（会话 e87622aa）：格式从 ``${msg.id}:${block_index}`` 对齐为
    # daemon partial 的 task-13 格式 ``${parent}:${mid}:${type}``（type=text/thinking）——
    # 旧格式与 daemon partial（main:<mid>:text）永不匹配，submit_messages 判定 1/2
    # 与 _revoke_committed_partials 全部空转（partial 行永久滞留 DB 的根因之一）。
    # parent 前缀与 block type 与 daemon _resolveSegmentId / _extractCompletedSegments
    # 逐段对齐（同 message 多个同 type block 共享 segmentId——对齐 daemon 语义）。
    inner_msg_id = inner.get("id")
    msg_id = inner_msg_id if isinstance(inner_msg_id, str) and inner_msg_id else "unknown"
    _raw_parent = msg.get("parent_tool_use_id")
    parent_key = _raw_parent if isinstance(_raw_parent, str) and _raw_parent else "main"

    for b in blocks:
        if not isinstance(b, dict):
            continue
        btype = b.get("type")

        if btype == "text":
            text = str(b.get("text", "") or "")
            if text:
                out.append(
                    stamp(
                        {
                            "event_type": "text",
                            "content": f"[ASSISTANT] {text}",
                            "channel": "stdout",
                            # task-08：完整 assistant 文本行标记 segmentId + isComplete，
                            # 让 submit_messages 识别 [ASSISTANT_OVERRIDE] 信号后丢弃/回退
                            # 同 segment 的 assistant partial（对齐 thinking :1847-1866）。
                            # assistant 文本不带 thinking:True（仅 thinking block 才打该
                            # 标记），让 daemon 端 / submit_messages 能区分两类 segment。
                            "metadata": {
                                "segmentId": f"{parent_key}:{msg_id}:text",
                                "isComplete": True,
                            },
                        }
                    )
                )

        elif btype == "thinking":
            text = str(b.get("thinking", b.get("text", "")) or "")
            if text:
                preview = text[:20000] + ("..." if len(text) > 20000 else "")
                out.append(
                    stamp(
                        {
                            "event_type": "text",
                            "content": f"[THINKING] {preview}",
                            "channel": "stdout",
                            # task-12：完整 thinking 行标记 segmentId + isComplete，
                            # 让 submit_messages 单次调用内丢弃同 segment 的 partial。
                            "metadata": {
                                "thinking": True,
                                "segmentId": f"{parent_key}:{msg_id}:thinking",
                                "isComplete": True,
                            },
                        }
                    )
                )

        elif btype == "tool_use":
            name = str(b.get("name", "") or "unknown") or "unknown"
            raw_input = b.get("input")
            input_obj = raw_input if isinstance(raw_input, dict) else {}
            # task-13 / D-002@v1：提取 tool_use_id（SDK tool_use block 的 id，toolu_xxx）。
            # Anthropic API 标准 assistant message content block 在 type=tool_use 时带
            # id 字段（如 "toolu_01abc..."）。仅非空字符串才采用；缺失 → ""
            # （退化，前端 normalize 回退 ±3 窗口，task-14 范围）。
            raw_id = b.get("id")
            tool_use_id = raw_id if isinstance(raw_id, str) and raw_id else ""
            # stdout text line：command 优先，否则整体 JSON（对齐 task-runner L1068-1083）
            cmd = str(input_obj.get("command", "") or "")
            if cmd:
                args_line = cmd
            else:
                try:
                    args_line = json.dumps(input_obj)
                except (TypeError, ValueError):
                    args_line = ""
            stdout_content = f"[TOOL_USE] {name}: {args_line}"[:20000]
            out.append(
                stamp(
                    {
                        "event_type": "tool_use",
                        "content": stdout_content,
                        "channel": "stdout",
                    }
                )
            )
            # 第二条：tool_call channel 的 JSON，前端 parseToolCallContent 渲染
            # ToolCallCard（对齐 task-runner.js L1091-1115 的 tc_content 格式）。
            # task-13：补 tool_use_id 字段（snake_case，对齐 Anthropic API 命名 +
            # task-runner 一致），让前端 normalize 全局配对（task-14）。
            ts = datetime.now(UTC).isoformat().replace("+00:00", "Z")
            tc_payload: dict = {
                "tool": name,
                "args": input_obj,
                "timestamp": ts,
                "status": "allowed",
                "success": True,
            }
            # tool_use_id 仅非空时携带（省略 vs null 均可让前端 hasOwnProperty 判断
            # "无 id" 分支）。用条件注入省略字段，退化路径保持原形状。
            if tool_use_id:
                tc_payload["tool_use_id"] = tool_use_id
            try:
                tc_json = json.dumps(tc_payload)
            except (TypeError, ValueError):
                tc_payload["args"] = {}
                tc_json = json.dumps(tc_payload)
            # 2026-07-05-agent-log-type-tags task-04 / FR-04：interactive 路径
            # tool_use 打标。从 SDK block 的 name + input 调 classify_tool_kind（task-02）
            # 识别，结果挂到 tool_call JSON 那条 flat record 顶层 tool_kind 字段（与
            # event_type/content/channel 同级），后续 submit_messages 落库 +
            # publish payload 都从 msg.get("tool_kind") 取（FR-05/06）。
            # 配对的 stdout [TOOL_USE] 文本行不带 tool_kind（design §5 Phase 2）。
            # 防御：classify_tool_kind 在 bash + args.command 非 str（list/dict）
            # 时 "sillyspec" in cmd 会抛 TypeError，包 try/except 静默退 None。
            try:
                tool_kind = classify_tool_kind(name, input_obj)
            except Exception:
                tool_kind = None
            # ql-20260706-002：tool_use_id 挂到 flat record *顶层*（不止 tc_payload
            # JSON 内），让 submit_messages 登记 tool_use_id → tool_kind 缓存，供配对
            # 的 tool_result 行继承（d751a871 根因：命令输出 [TOOL_RESULT] 漏 tool_kind
            # 致前端 SillySpec 筛选看不到 sillyspec 的 ✅ Step 进度）。tool_use_id 仅
            # 非空时携带（与 tc_payload 内字段同步，退化路径保持原形状）。
            tc_record: dict = {
                "event_type": "tool_use",
                "content": tc_json,
                "channel": "tool_call",
                "tool_kind": tool_kind,
            }
            if tool_use_id:
                tc_record["tool_use_id"] = tool_use_id
            out.append(tc_record)

        elif btype == "tool_result":
            # tool_result content 可能是 str 或 [{type:"text",text:...}] blocks
            raw = b.get("content")
            if isinstance(raw, list):
                parts = []
                for rb in raw:
                    if isinstance(rb, dict):
                        parts.append(str(rb.get("text", "")))
                    else:
                        parts.append(str(rb))
                text = "".join(parts)
            else:
                text = str(raw or "")
            # ql-20260706-002：tool_result block 自带 tool_use_id（Anthropic API 标准，
            # user message content 里 {type:"tool_result", tool_use_id:"toolu_xxx", ...}），
            # 提取挂到 flat record 顶层，让 submit_messages 回查 tool_use→tool_kind 缓存
            # 继承配对命令调用的 tool_kind（d751a871 根因修复）。
            raw_tuid = b.get("tool_use_id")
            result_tool_use_id = raw_tuid if isinstance(raw_tuid, str) and raw_tuid else ""
            if text:
                # ql-20260709-001：放宽截断上限（3000→TOOL_RESULT_MAX_CHARS），
                # 超长追加中文标注，保留"已截断 + 原始长度"信息供前端展示。
                if len(text) > TOOL_RESULT_MAX_CHARS:
                    body = (
                        text[:TOOL_RESULT_MAX_CHARS]
                        + f"\n...(输出过长，已截断，共 {len(text)} 字符)"
                    )
                else:
                    body = text
                rec: dict = {
                    "event_type": "tool_result",
                    "content": f"[TOOL_RESULT] {body}",
                    "channel": "stdout",
                }
                if result_tool_use_id:
                    rec["tool_use_id"] = result_tool_use_id
                # ql-20260824-020：Edit 真实文件行号透传。SDK 把 Edit 结果放在
                # ``msg.tool_use_result.structuredPatch``（hunks 带 oldStart/newStart
                # 文件内行号），原实现只读 content 丢弃该字段。此处读出来序列化成
                # ``edit_patch`` JSON 挂到 flat record 顶层，供前端 Edit 展开渲染
                # 带文件内真实行号的 diff（缺则前端回退 LCS 自算）。仅 Edit（有
                # structuredPatch）才附加，Bash/Read 等零变化。
                tur = msg.get("tool_use_result")
                if isinstance(tur, dict):
                    patch = tur.get("structuredPatch")
                    if isinstance(patch, list) and patch:
                        try:
                            rec["edit_patch"] = json.dumps(patch, ensure_ascii=False)
                        except (TypeError, ValueError):
                            pass
                out.append(stamp(rec))

    # 2026-06-28-daemon-subagent-transcript task-08 / D-008@v1（Grill X-001）：
    # 归属字段（parent_tool_use_id/subagent_type/depth）从 msg 顶层读，注入到*每条*
    # flat record——归属是 message 级属性，同一 SDK message 的所有 content block
    # （text/thinking/tool_use/tool_result）同属一个子代理，每行 log 都要带归属
    # （否则同 message 展开多行归属不一致：thinking 行有归属、紧随 text 行 NULL）。
    # 与 usage/session_id 区分：后者是 message 级聚合量，仍走 stamp() 仅首条避免重复
    # 累加；归属不经 stamp，循环后统一写入每条。主 agent（parent=null）→ attribution
    # 空 → 不注入 → 落库三列 NULL（brownfield 兼容，design §9）。
    attribution: dict = {}
    _raw_ptui = msg.get("parent_tool_use_id")
    if isinstance(_raw_ptui, str) and _raw_ptui:
        attribution["parent_tool_use_id"] = _raw_ptui
    _raw_st = msg.get("subagent_type")
    if isinstance(_raw_st, str) and _raw_st:
        attribution["subagent_type"] = _raw_st
    _raw_depth = msg.get("depth")
    if isinstance(_raw_depth, int) and not isinstance(_raw_depth, bool):
        attribution["depth"] = _raw_depth
    if attribution:
        for _rec in out:
            _rec.update(attribution)

    return out


def _persist_agent_event(msg: dict, ev: dict) -> list[dict]:
    """AgentEvent v2（新轨）→ 旧轨同款 flat log record 列表（task-07 / FR-03）。

    2026-09-03-agent-provider-abstraction / D-001@v1 双轨：新轨消息形态
    ``{"kind": "agent_event", "event": {...AgentEvent v2...}, "dedup_key"?}``
    （task-01 wire 契约，daemon 归一化器 task-03 产出、task-09 接线）。本函数把
    事件展开成与旧轨**同款**的 flat record ``{event_type, content, channel, ...}``
    交回 submit_messages 既有落库循环消费——dedup_key 幂等 / partial+override
    撤回链（_revoke_committed_partials + quick-0e56260f 标记行 + stale 信封）/
    跨轮归位（task-06）/ 群投影 / sillyspec 绑定 / usage 累计 / session pin
    全部复用现机制，不旁路自建 AgentRunLog（双轨产物逐字段对齐，design §5.1
    backend 接收 / R-06 反分叉）。_extract_sdk_messages 是旧轨的 Claude SDK
    形状展开（一行不改）；本函数是新轨的 AgentEvent 形状展开。

    文本行合成与 _extract_sdk_messages 逐字对齐（未升级前端渲染依赖文本协议，
    task 卡验收「前缀拼装逐字一致」；新轨 AgentEvent.content 为归一化器原文
    不带前缀——旧轨 partial 前缀由 daemon 拼、完整行前缀由 backend 拼，新轨
    统一由 backend 拼）：

    - text        → ``[ASSISTANT] <content>``（stdout，无截断）
    - thinking    → ``[THINKING] <content[:20000]+...>``（stdout；截断与现状一致
                    且幂等——daemon 归一化器已按同规则截断，重复应用结果不变）
    - tool_use    → 双写：``[TOOL_USE] <name>: <args>``（stdout，整行 [:20000]，
                    command 优先否则 args JSON）+ tc_payload JSON（tool_call 通道）
    - tool_result → ``[TOOL_RESULT] <content>``（stdout；截断归 daemon 归一化器
                    所有——backend 重复截断会改写中文标注的原始长度计数，且最终
                    落库/发布都被循环内 [:50000] 封顶）
    - error       → stderr 通道原文（无前缀）
    - status / turn_result / complete → 不生成文本行：status 会话信号走 daemon 侧
      onSessionEvent 不经 submitMessages；session_started 的 session_id 与任意型
      事件的 usage（D-003@v1 实时语义，含 partial）经空 content record 提取
      （落库循环对空 content 只提取聚合量不落行）。

    结构化列：tool_kind 复用 classify_tool_kind（tool_kind.py 单源映射；daemon
    已识别值 ev.metadata.tool_kind 优先）；parent_tool_use_id / subagent_type /
    depth / tool_use_id / edit_patch 直填 flat record 键；segmentId+isPartial 走
    旧轨 metadata 惯例（落库循环据此写 segment_id 列 / 撤回判定）。归属是
    message 级属性注入**每条** record（对齐 _extract_sdk_messages attribution
    尾注；主 agent depth=0 也落——现 daemon 对每条消息无条件挂 depth）。
    usage / session_id 是聚合量仅注入**首条**（对齐 stamp()，防 sibling 重复累加）。

    override（D-004@v1）：ev.override:true + segment_id = 携带完整内容的替换事件
    → 按完整行展开（is_partial 失效），撤回交给落库循环的完整行自撤链
    （quick-9f86d2c3「backend 完整行落库时 _revoke_committed_partials 自撤为准，
    不依赖 daemon override 事件」口径——module-impact 已知问题）。

    dedup_key：消息顶层透传到首条 record（tool_use 双行的第二条不携带，避免
    同 run 内 (run_id, dedup_key) 部分唯一索引自撞被同调用去重误丢）。
    ``_agent_event`` 私有键携带完整事件 JSON，落库循环写
    ``metadata_['agent_event']`` + published_logs / session_payload SSE 透传。
    """
    etype = ev.get("type")
    etype = etype if isinstance(etype, str) else ""
    content = ev.get("content")
    content = content if isinstance(content, str) else ""

    # 归属三列（message 级）：注入每条 flat record（见 docstring）。
    attribution: dict = {}
    _raw_ptui = ev.get("parent_tool_use_id")
    if isinstance(_raw_ptui, str) and _raw_ptui:
        attribution["parent_tool_use_id"] = _raw_ptui
    _raw_st = ev.get("subagent_type")
    if isinstance(_raw_st, str) and _raw_st:
        attribution["subagent_type"] = _raw_st
    _raw_depth = ev.get("depth")
    if isinstance(_raw_depth, int) and not isinstance(_raw_depth, bool):
        attribution["depth"] = _raw_depth

    # usage / session_id（message 级聚合量）：仅注入首条 record（对齐 stamp()）。
    carried: dict = {}
    _usage = ev.get("usage")
    if isinstance(_usage, dict):
        carried["usage"] = _usage
    _sid = ev.get("session_id")
    if isinstance(_sid, str) and _sid:
        carried["session_id"] = _sid

    out: list[dict] = []
    stamped = False

    def stamp(rec: dict) -> dict:
        nonlocal stamped
        if not stamped and carried:
            rec.update(carried)
            stamped = True
        return rec

    seg = ev.get("segment_id")
    seg = seg if isinstance(seg, str) and seg else None
    # override 事件按完整行展开（见 docstring D-004@v1 段）。
    is_partial = bool(ev.get("is_partial")) and not bool(ev.get("override"))

    def with_segment(rec: dict, *, thinking: bool = False) -> dict:
        """partial/complete 行的 segment 惯例（旧轨 metadata 形状，落库循环消费）。"""
        if seg is not None:
            meta: dict = {"segmentId": seg}
            if thinking:
                meta["thinking"] = True
            if is_partial:
                meta["isPartial"] = True
            rec["metadata"] = meta
        return rec

    call_id = ev.get("call_id")
    call_id = call_id if isinstance(call_id, str) and call_id else ""
    ev_metadata = ev.get("metadata")
    ev_metadata = ev_metadata if isinstance(ev_metadata, dict) else {}

    if etype == "text":
        if content:
            out.append(
                stamp(
                    with_segment(
                        {
                            "event_type": "text",
                            "content": f"[ASSISTANT] {content}",
                            "channel": "stdout",
                        }
                    )
                )
            )

    elif etype == "thinking":
        if content:
            preview = content[:20000] + ("..." if len(content) > 20000 else "")
            out.append(
                stamp(
                    with_segment(
                        {
                            "event_type": "text",
                            "content": f"[THINKING] {preview}",
                            "channel": "stdout",
                        },
                        thinking=True,
                    )
                )
            )

    elif etype == "tool_use":
        name = ev.get("tool_name")
        name = name if isinstance(name, str) and name else "unknown"
        # args 来源：ev.metadata.tool_input（结构化优先）或 content（归一化器
        # JSON 序列化的 args 原文）。行组成对齐 _extract_sdk_messages：
        # command 优先展示，否则整体 args JSON。
        raw_input = ev_metadata.get("tool_input")
        input_obj = raw_input if isinstance(raw_input, dict) else None
        if input_obj is None:
            try:
                parsed = json.loads(content) if content else None
            except (TypeError, ValueError):
                parsed = None
            input_obj = parsed if isinstance(parsed, dict) else {}
        cmd = str(input_obj.get("command", "") or "")
        if cmd:
            args_line = cmd
        elif content:
            args_line = content
        else:
            try:
                args_line = json.dumps(input_obj)
            except (TypeError, ValueError):
                args_line = ""
        out.append(
            stamp(
                {
                    "event_type": "tool_use",
                    "content": f"[TOOL_USE] {name}: {args_line}"[:20000],
                    "channel": "stdout",
                }
            )
        )
        # 第二条：tool_call 通道 JSON（前端 ToolCallCard），tc_payload 形状与
        # _extract_sdk_messages（对齐 task-runner）逐字一致；stdout 文本行不带
        # tool_kind（design §5 Phase 2：DB 列层面只 tool_call 行有值）。
        ts = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        tc_payload: dict = {
            "tool": name,
            "args": input_obj,
            "timestamp": ts,
            "status": "allowed",
            "success": True,
        }
        if call_id:
            tc_payload["tool_use_id"] = call_id
        try:
            tc_json = json.dumps(tc_payload)
        except (TypeError, ValueError):
            tc_payload["args"] = {}
            tc_json = json.dumps(tc_payload)
        # tool_kind：daemon 归一化器已识别（ev.metadata.tool_kind）优先，缺则
        # backend 复用 classify_tool_kind 兜底（同一映射单源，不重写）。
        tool_kind = ev_metadata.get("tool_kind")
        if not (isinstance(tool_kind, str) and tool_kind):
            try:
                tool_kind = classify_tool_kind(name, input_obj)
            except Exception:
                tool_kind = None
        tc_record: dict = {
            "event_type": "tool_use",
            "content": tc_json,
            "channel": "tool_call",
            "tool_kind": tool_kind,
        }
        if call_id:
            tc_record["tool_use_id"] = call_id
        out.append(tc_record)

    elif etype == "tool_result":
        if content:
            rec: dict = {
                "event_type": "tool_result",
                "content": f"[TOOL_RESULT] {content}",
                "channel": "stdout",
            }
            if call_id:
                rec["tool_use_id"] = call_id
            edit_patch = ev.get("edit_patch")
            if isinstance(edit_patch, str) and edit_patch:
                rec["edit_patch"] = edit_patch
            out.append(stamp(rec))

    elif etype == "error" and content:
        out.append(stamp({"event_type": "error", "content": content, "channel": "stderr"}))

    # status / turn_result / complete 及未知 type（防御）：无文本行（见 docstring）。

    # 空 content + 携带 usage/session_id（usage-only 事件，task-03 对齐旧轨空
    # content 行；status/session_started 的 session pin 也走此路径）：产出一条空
    # record 让落库循环提取聚合量后跳过落行（无行化）。
    if not out and carried:
        out.append(stamp({"event_type": etype or "text", "content": "", "channel": "stdout"}))

    # 归属注入每条（对齐 _extract_sdk_messages attribution 尾注）。
    if attribution:
        for _rec in out:
            _rec.update(attribution)

    # dedup_key：消息顶层透传（首条；见 docstring）。
    dedup_key = msg.get("dedup_key")
    if out and dedup_key is not None:
        out[0]["dedup_key"] = str(dedup_key)

    # 完整事件 JSON（私有键）：落库循环写 metadata_['agent_event'] + SSE 透传。
    for _rec in out:
        _rec["_agent_event"] = ev

    return out


def _channel_from_event_type(event_type: str) -> str:
    """Map daemon AgentEvent type to AgentRunLog channel.

    ql-20260616-003：daemon 的 _eventToMessage 不发 channel 字段（只发 event_type），
    后端按事件类型补全 channel，让前端 SSE 实时流能正确渲染 TOOL/WARN/INFO 徽章。

    Args:
        event_type: daemon AgentEvent.type，5 种取值之一
            （text / tool_use / tool_result / error / complete）。

    Returns:
        AgentRunLog channel：tool_call / stderr / stdout 之一。
    """
    if event_type in ("tool_use", "tool_result"):
        return "tool_call"
    if event_type == "error":
        return "stderr"
    return "stdout"
