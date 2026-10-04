"""takeover 服务——本地 Agent 会话（tool_report）分叉式接手（D-006@v1）。

2026-09-30-tool-report-activation-wrong-machine task-04/05（design Phase 2 /
FR-02~04 / D-002@v1 / D-004@v1 / D-005@v2）：

- ``resolve_takeover_machine``：原机四级钉定匹配（machineId 精确 → hostname →
  cwd ∈ allowed_roots 唯一 → 409 中文，MUST NOT 静默换机）。机器粒度=daemon_
  instance（一台 daemon 多 provider runtime 行算同一台机器，组内唯一性判定）；
- ``takeover_session``：校验（origin=tool_report、status=pending、属主）→ 匹配
  机器 → provider 行选择（handoff 显式重选校验 ∈ 原机支持集合，D-005@v2）→
  分档（harness ∈ 可 resume 集合 → native 档 lease 携带 resume_session_id；
  其余 → handoff 档经 daemon RPC 读原会话日志组装 ``build_handoff_prompt``
  交接文档注入首 prompt，读取失败降级普通新会话）→ 经 create_session 链落
  fork 形态新会话（fork 三件套，源会话零 run → fork_at_run_id /
  engine_fork_anchor 传 None——create 链既有参数全可空，首个 NULL 锚点形态）。

源会话红线（D-006）：任何路径不写 active/lease/runtime——本服务不触碰源会话
行（create_session 建的是新会话 B）。
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.modules.agent.model import AgentSession
from app.modules.agent.provider_caps import PROVIDER_CAPS
from app.modules.daemon.model import DaemonRuntime

# 可 resume harness 集合（D-004@v1：daemon caps.resume=True 且 platform_agent_
# logs.session_id 即引擎会话 id——claude-code transcript / codex rollout）。
# zcode 等无 adapter harness 不在此列（handoff 档，交接文档归 task-05）。
_RESUMABLE_HARNESS: frozenset[str] = frozenset({"claude-code", "codex"})


class ToolReportTakeoverInvalid(AppError):
    """takeover 请求不满足前置（非 tool_report 会话 / 已激活 / 非属主）。409。"""

    code = "HTTP_409_TOOL_REPORT_TAKEOVER_INVALID"
    http_status = 409


class ToolReportTakeoverNoMachine(AppError):
    """原机四级匹配无果（离线/未装 daemon/歧义）。409 中文含机器名，不静默换机。"""

    code = "HTTP_409_TOOL_REPORT_TAKEOVER_NO_MACHINE"
    http_status = 409


class ToolReportTakeoverProviderInvalid(AppError):
    """handoff 档显式重选引擎不属原机支持集合。422（D-005@v2）。"""

    code = "HTTP_422_TOOL_REPORT_TAKEOVER_PROVIDER_INVALID"
    http_status = 422


@dataclass
class TakeoverResult:
    """takeover 产物（router 映射 TakeoverResponse）。"""

    agent_session: AgentSession
    agent_run: Any
    lease_id: uuid.UUID
    tier: str  # 'native' | 'handoff'
    handoff_doc: bool  # handoff 档是否含交接文档（task-05 起可 False 降级；本卡桩恒 False）


def _norm_path(p: str) -> str:
    """路径归一比较（Windows 盘符大小写 + 反斜杠统一；纯比较用，不触盘）。"""
    s = p.strip().replace("\\", "/")
    if len(s) >= 2 and s[1] == ":":
        s = s[0].lower() + s[1:]
    return s.rstrip("/") or "/"


def _path_within(cwd: str, root: str) -> bool:
    """边界敏感前缀判定：cwd == root 或 cwd 以 root + '/' 开头。"""
    c, r = _norm_path(cwd), _norm_path(root)
    return c == r or c.startswith(r + "/")


async def _latest_reported_machine(
    db: AsyncSession, source: AgentSession
) -> tuple[str | None, str | None]:
    """会话上报机器身份（config_snapshot 优先，最新 entry 两列兜底）。"""
    snap = (source.config_snapshot or {}).get("latest_reported_machine")
    if isinstance(snap, dict) and (snap.get("machine_id") or snap.get("hostname")):
        return snap.get("machine_id"), snap.get("hostname")
    from app.modules.platform_sync.model import AgentSessionLogORM

    row = (
        await db.execute(
            select(
                AgentSessionLogORM.reported_machine_id,
                AgentSessionLogORM.reported_machine_name,
            )
            .where(col(AgentSessionLogORM.agent_session_id) == source.id)
            .order_by(col(AgentSessionLogORM.last_seen_at).desc().nulls_last())
            .limit(1)
        )
    ).first()
    if row is not None:
        return row[0], row[1]
    return None, None


async def _latest_agent_cwd(db: AsyncSession, source: AgentSession) -> str | None:
    """最新 entry 的 agent_cwd（tier3 回退源，协议 §4 口径）。

    主日志优先（log_path 排除 subagent 前缀，R-04 惯例——subagent 行 cwd 是
    worktree 副本路径，不代原会话工作目录）；agent_cwd 为空的行跳过。
    """
    from app.modules.platform_sync.model import AgentSessionLogORM

    rows = (
        await db.execute(
            select(
                AgentSessionLogORM.agent_cwd,
                AgentSessionLogORM.log_path,
            )
            .where(col(AgentSessionLogORM.agent_session_id) == source.id)
            .order_by(col(AgentSessionLogORM.last_seen_at).desc().nulls_last())
            .limit(50)
        )
    ).all()
    any_cwd = next((c for c, _p in rows if c), None)
    return next(
        (c for c, p in rows if c and "subagent" not in (p or "").lower()),
        any_cwd,
    )


async def resolve_takeover_machine(
    db: AsyncSession,
    source: AgentSession,
    *,
    user_id: uuid.UUID,
) -> tuple[list[DaemonRuntime], str]:
    """原机四级钉定匹配（D-002@v1）：返回 (命中机器在线 runtime 行, match_tier)。

    四级：

    1. ``machine_id``（metadata.machine_id，daemon 心跳同源值）精确命中；
    2. ``hostname``（reported_machine_name == runtime.name）命中；
    3. 存量无机器身份：``cwd ∈ runtime.allowed_roots`` 命中（cwd=会话行优先，
       空则回退最新 entry 的 ``agent_cwd``——建桶不写会话行 cwd，协议 §4）；
    4. 无命中/机器级歧义 → 409 中文（含机器名与"开机/装 daemon"指引）——
       宁拒不猜，不静默换机。

    ①②级身份可识别但目标机器离线（无在线 runtime 行）同样落入 4（机器名取
    身份值，文案可诊断）。

    机器粒度=``daemon_instance_id``（一台 daemon 多 provider runtime 行算同一台
    机器）——唯一性在机器级判定，组内多 provider 行合法（task-05 修正 task-04
    按行判定的同机多行误判歧义）。返回命中机器的全部在线 runtime 行。
    """
    candidates: list[DaemonRuntime] = list(
        (
            await db.execute(
                select(DaemonRuntime).where(
                    col(DaemonRuntime.user_id) == user_id,
                    col(DaemonRuntime.status) == "online",
                )
            )
        )
        .scalars()
        .all()
    )
    machine_id, hostname = await _latest_reported_machine(db, source)
    # tier3 匹配与诊断文案共用的有效 cwd：会话行优先；platform_sync 建桶/刷新
    # 不写会话行 cwd（恒空），空则回退最新 entry 的 agent_cwd（协议
    # docs/platform-agent-log-protocol.md §4）——旧 CLI 无 machine 块的存量
    # 会话靠该字段命中原机。
    cwd = source.cwd or (await _latest_agent_cwd(db, source)) or ""

    def _machine_names(rows: list[DaemonRuntime]) -> list[str]:
        """命中机器名去重保序（daemon_instance 分组，display 名=name，缺省 id 短码）。"""
        seen: set[object] = set()
        names: list[str] = []
        for rt in rows:
            key = rt.daemon_instance_id or rt.id
            if key in seen:
                continue
            seen.add(key)
            names.append(rt.name or str(rt.id)[:8])
        return names

    def _fail(
        reason_tier: str,
        candidates_rows: list[DaemonRuntime] | None = None,
    ) -> ToolReportTakeoverNoMachine:
        who = machine_id or hostname
        # 歧义场景（多机命中）：列出候选机器名让用户可诊断（清哪台配置/开哪台）。
        cand = _machine_names(candidates_rows) if candidates_rows else []
        if cand:
            msg = (
                f"该会话的工作目录被 {len(cand)} 台在线机器的白名单同时覆盖"
                f"（{'、'.join(cand)}），无法确定原机——请在产生该会话的机器上"
                "清理其它机器 daemon 配置里不该有的该路径（allowed_roots）后重试，"
                "或在该机器重跑一次 CLI 上报（携带机器身份）；不会换机执行。"
            )
        elif who:
            msg = (
                f"该会话产生于机器 {who}，当前没有可用的对应在线执行端"
                "——请在该机器上启动 daemon（sillyhub-daemon）后重试；"
                "不会换到其它机器执行。"
            )
        else:
            msg = (
                "该会话的历史上报未携带机器身份，且当前没有任何在线机器的"
                "工作目录白名单（allowed_roots）覆盖该会话目录"
                f"（{cwd or '未知'}）——请在产生该会话的机器上启动 daemon"
                "（并确认其 allowed_roots 含该目录）后重试；不会换到其它机器执行。"
            )
        return ToolReportTakeoverNoMachine(
            msg,
            details={
                "session_id": str(source.id),
                "machine_id": machine_id,
                "hostname": hostname,
                "machine_candidates": cand,
                "match_tier": reason_tier,
            },
        )

    def _pick_machine(rows: list[DaemonRuntime], tier: str) -> list[DaemonRuntime]:
        """机器级唯一性收敛：按 daemon_instance_id 分组后须恰好一组。"""
        groups = {rt.daemon_instance_id for rt in rows}
        if len(groups) == 1:
            return rows
        raise _fail(f"{tier}_ambiguous", candidates_rows=rows)

    # ── ① machine_id 精确（daemon 心跳 metadata 同源）──────────────────────
    if machine_id:
        hits = [
            rt for rt in candidates if ((rt.metadata_ or {}) or {}).get("machine_id") == machine_id
        ]
        if hits:
            return _pick_machine(hits, "machine_id"), "machine_id"

    # ── ② hostname 唯一命中（runtime.name = 上报 hostname）─────────────────
    if hostname:
        hits = [rt for rt in candidates if (rt.name or "") == hostname]
        if hits:
            return _pick_machine(hits, "hostname"), "hostname"

    # ── ③ 存量无机器身份：cwd ∈ allowed_roots 唯一命中（cwd 已含 entry 级
    #    agent_cwd 回退，见取值处注释）───────────────────────────────────────
    if cwd:
        hits = [
            rt
            for rt in candidates
            if any(_path_within(cwd, r) for r in (rt.allowed_roots or []) if r)
        ]
        if hits:
            return _pick_machine(hits, "allowed_roots"), "allowed_roots"

    raise _fail("no_match")


# 交接文档体积帽（D-004@v1；量级对齐 fork SEED_MAX_CHARS 惯例——模板节 +
# 最近对话在帽内组装，超帽截尾保留较早内容 + 显式截断声明行）。
HANDOFF_MAX_CHARS = 12000
_HANDOFF_TRUNCATED_NOTE = "\n……（交接文档超出长度上限，较早内容已截断）"

# 涉及文件/操作摘要提取的键组：path 类字段与命令字段（dict 形态直取键；
# 截断 JSON regex 兜底，值段 `(?:[^"\\]|\\.)*` 容忍转义序列）。
_TOOL_FILE_KEYS = ("path", "file_path", "filePath", "notebook_path")
_TOOL_COMMAND_KEYS = ("command",)


def _unescape_json_string(raw: str) -> str:
    """JSON 字符串值段的常见转义反转义（``\\\\`` 与 ``\\"``；占位防二次替换）。"""
    return raw.replace("\\\\", "\x00").replace('\\"', '"').replace("\x00", "\\")


def _tool_input_field(tool_input: Any, keys: tuple[str, ...]) -> str | None:
    """从 tool_use 的 tool_input 提取首个命中键的字符串值（涉及文件/操作摘要共用）。

    契约是 daemon 侧 JSON.stringify 的字符串摘要（首 2KB 截断）——完整 JSON 走
    json.loads；截断坏 JSON 用键名 regex 兜底（path/command 类键通常居入参前部，
    截断前已在串内）；dict 形态保留兼容（防御/测试）。无命中返回 None。
    """
    candidate: dict[str, Any] | None
    if isinstance(tool_input, str):
        if not tool_input.strip():
            return None
        try:
            parsed = json.loads(tool_input)
        except ValueError:
            alt = "|".join(re.escape(k) for k in keys)
            match = re.search(rf'"(?:{alt})"\s*:\s*"((?:[^"\\]|\\.)*)"', tool_input)
            if match is None:
                return None
            val = _unescape_json_string(match.group(1)).strip()
            return val or None
        candidate = parsed if isinstance(parsed, dict) else None
    elif isinstance(tool_input, dict):
        candidate = tool_input
    else:
        return None
    for key in keys:
        val = (candidate or {}).get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def build_handoff_prompt(
    *,
    harness: str,
    cwd: str,
    messages: list[dict[str, Any]],
    user_prompt: str,
    max_chars: int = HANDOFF_MAX_CHARS,
) -> str:
    """组装 handoff 档交接文档（纯函数，D-004@v1 / design Phase 2）。

    数据源=daemon ``read_agent_log_messages`` RPC 归一化消息（NormalizedLogMessage
    dict，kind 五值契约见 platform_sync/schema.py：user_input/reply/thinking/
    tool_use/tool_result）。确定性模板不调 LLM：

    - 会话元信息（harness/工作目录/消息条数）；
    - 最近对话（user_input 真人轮全文——sender=system_event 系统注入跳过、
      reply 截断 500 字/轮；thinking 推理噪声跳过；**保留较早内容**，超帽截尾 +
      截断声明行）；
    - 涉及文件（tool_use 段 tool_input 提取 path 类字段去重清单；契约是 JSON
      字符串摘要非 dict，截断坏 JSON 走 regex 兜底——2026-10-04 契约对齐修正，
      此前判 ``user``/``assistant`` + dict 恒不命中，真实日志只余工具名节）；
    - 最近操作（最近 8 条 tool_use 一行摘：path 类字段值/command 首段作摘要，
      折行压平截 120，无摘要纯工具名；is_error 只在 tool_result 段携带，按
      tool_use_id 回贴配对操作行）。

    末尾拼用户首条消息（分隔线隔开）——首 prompt=交接文档+用户消息。
    """
    talk_lines: list[str] = []
    files: list[str] = []
    ops: list[str] = []
    op_index_by_tool_use_id: dict[str, int] = {}
    for msg in messages:
        kind = str(msg.get("kind") or "")
        text = str(msg.get("text") or "").strip()
        tool_name = str(msg.get("tool_name") or "")
        if kind == "user_input":
            if text and msg.get("sender") != "system_event":
                talk_lines.append(f"用户：{text}")
        elif kind == "reply":
            if text:
                talk_lines.append(f"助手：{text[:500]}")
        elif kind == "tool_use":
            tool_input = msg.get("tool_input")
            file_path = _tool_input_field(tool_input, _TOOL_FILE_KEYS)
            if file_path:
                files.append(file_path)
            # 操作行摘要：path 类字段值优先（文件工具）、无则 command 首段
            # （Bash 类）；折行压平 + 截 120，无摘要维持纯工具名。
            detail = file_path or _tool_input_field(tool_input, _TOOL_COMMAND_KEYS)
            if detail:
                ops.append(f"- {tool_name}：{' '.join(detail.split())[:120]}")
            else:
                ops.append(f"- {tool_name}")
            tool_use_id = msg.get("tool_use_id")
            if isinstance(tool_use_id, str) and tool_use_id:
                op_index_by_tool_use_id[tool_use_id] = len(ops) - 1
        elif kind == "tool_result":
            # 失败标记回贴配对 tool_use 行（is_error 契约上只在 tool_result 段）。
            tool_use_id = msg.get("tool_use_id")
            if msg.get("is_error") and isinstance(tool_use_id, str):
                idx = op_index_by_tool_use_id.get(tool_use_id)
                if idx is not None and "（失败）" not in ops[idx]:
                    ops[idx] += "（失败）"
        # thinking 及未知 kind：跳过。
    # 涉及文件去重保序；最近操作取尾部 8 条。
    seen: set[str] = set()
    deduped_files: list[str] = []
    for f in files:
        if f not in seen:
            seen.add(f)
            deduped_files.append(f)
    files = deduped_files
    ops = ops[-8:]

    sections = [
        "【上下文交接文档】",
        "以下内容来自该机器上的本地会话日志自动转述（非引擎原生上下文）：",
        f"- 本地 harness：{harness or 'unknown'}",
        f"- 工作目录：{cwd or 'unknown'}",
        f"- 已归一化消息数：{len(messages)}",
    ]
    if files:
        sections.append("\n涉及文件（按出现序去重）：")
        sections.extend(f"- {f}" for f in files[:30])
    if ops:
        sections.append("\n最近操作：")
        sections.extend(ops)
    if talk_lines:
        sections.append("\n最近对话（用户轮全文、助手轮截断）：")
        sections.extend(talk_lines)
    sections.append("\n【交接结束】请基于以上背景继续协助用户。")
    doc = "\n".join(sections)

    if len(doc) > max_chars:
        doc = doc[: max_chars - len(_HANDOFF_TRUNCATED_NOTE)] + _HANDOFF_TRUNCATED_NOTE
    return f"{doc}\n\n———\n用户：{user_prompt}"


async def _build_handoff_first_prompt(
    db: AsyncSession,
    source: AgentSession,
    machine_rows: list[DaemonRuntime],
    *,
    harness: str,
    user_prompt: str,
) -> str | None:
    """经 daemon RPC 读原会话日志组装交接首 prompt；失败返回 None（降级）。

    数据源=会话最新**主**日志 entry（排除 subagent 前缀路径，R-04 主日志优先
    惯例）；daemon 定位=命中机器任一行 daemon_instance_id。RPC 复用
    platform_sync/router._send_agent_log_rpc（直连 ws rpc，错误映射既有）。
    任何异常（离线竞态/老 daemon method_not_found/解析失败）→ None，调用方
    handoff_doc=False 降级普通新会话（MUST NOT 阻塞接手，design R-01）。
    """
    from app.modules.platform_sync.model import AgentSessionLogORM
    from app.modules.platform_sync.router import _send_agent_log_rpc

    rows = (
        (
            await db.execute(
                select(AgentSessionLogORM)
                .where(col(AgentSessionLogORM.agent_session_id) == source.id)
                .order_by(col(AgentSessionLogORM.last_seen_at).desc().nulls_last())
            )
        )
        .scalars()
        .all()
    )
    entry = next((r for r in rows if "subagent" not in (r.log_path or "").lower()), None)
    daemon_id = next((rt.daemon_instance_id for rt in machine_rows if rt.daemon_instance_id), None)
    if entry is None or daemon_id is None:
        return None
    try:
        result = await _send_agent_log_rpc(
            entry,
            daemon_id,
            "read_agent_log_messages",
            {"path": entry.log_path, "format": entry.format or ""},
            unsupported_on_method_not_found=True,
        )
    except Exception:
        return None
    if not isinstance(result, dict) or result.get("status") != "parsed":
        return None
    messages = result.get("messages") or []
    if not isinstance(messages, list):
        return None
    # 会话行 cwd 恒空（platform_sync 建桶不写该列）——与 tier3 同口径回退所选
    # entry 的 agent_cwd，交接文档「工作目录」不再恒 unknown。
    effective_cwd = source.cwd or entry.agent_cwd or ""
    return build_handoff_prompt(
        harness=harness,
        cwd=effective_cwd,
        messages=[m for m in messages if isinstance(m, dict)],
        user_prompt=user_prompt,
    )


async def takeover_session(
    svc,
    user_id: uuid.UUID,
    *,
    session_id: uuid.UUID,
    prompt: str,
    provider: str | None = None,
    agent_profile_id: str | None = None,
    llm_provider_id: str | None = None,
) -> TakeoverResult:
    """未激活 tool_report 会话分叉式接手（D-006@v1，design Phase 2）。

    ``svc`` 收 DaemonService 或 SessionService（fork_session 同款收窄惯例）。
    分档（D-004@v1）：harness ∈ 可 resume 集合 → native（lease 携带
    resume_session_id 回原引擎会话）；其余 → handoff（D-005@v2：可重选引擎/
    档案，经 daemon RPC 读原会话日志组装交接文档注入首 prompt，读取失败降级
    普通新会话 handoff_doc=False，MUST NOT 阻塞接手）。
    """
    session_svc = getattr(svc, "_sess", None) if hasattr(svc, "_sess") else svc
    db = session_svc._session

    # ── 校验：存在 + 属主 + origin=tool_report + 未激活 ────────────────────
    source = (
        (
            await db.execute(
                select(AgentSession).where(
                    AgentSession.id == session_id,
                    AgentSession.user_id == user_id,
                    col(AgentSession.deleted_at).is_(None),
                )
            )
        )
        .scalars()
        .one_or_none()
    )
    if source is None:
        from .errors import DaemonSessionNotFound

        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    if (source.origin or "chat") != "tool_report":
        raise ToolReportTakeoverInvalid(
            "仅本地 Agent 会话（tool_report）支持接手。",
            details={"session_id": str(session_id), "origin": source.origin},
        )
    if source.status != "pending":
        raise ToolReportTakeoverInvalid(
            "该会话已激活过，请直接继续对话；存量钉死会话可用「重置为未激活」恢复。",
            details={"session_id": str(session_id), "status": source.status},
        )

    # ── 分档（D-004@v1）+ provider 默认（handoff 重选经下方原机集合校验）──
    harness = (source.config_snapshot or {}).get("harness") or ""
    tier = "native" if harness in _RESUMABLE_HARNESS else "handoff"
    effective_provider = (provider or source.provider or "").strip()
    # native 档引擎跟随源会话 harness（显式 provider 重选仅 handoff 档有效，
    # native 档传了也忽略——resume 原引擎会话不容换引擎）。
    if tier == "native":
        effective_provider = (source.provider or "").strip()

    resume_session_id: str | None = None
    if tier == "native":
        from app.modules.platform_sync.model import AgentSessionLogORM

        row = (
            await db.execute(
                select(AgentSessionLogORM.session_id)
                .where(
                    col(AgentSessionLogORM.agent_session_id) == source.id,
                    col(AgentSessionLogORM.session_id).is_not(None),
                )
                .order_by(col(AgentSessionLogORM.last_seen_at).desc().nulls_last())
                .limit(1)
            )
        ).first()
        # resume id 缺失不阻断（daemon 侧 resume 损伤有降级链）；None 走新会话。
        resume_session_id = row[0] if row is not None else None

    # ── 原机四级匹配（先于任何写库——匹配失败不落半成品）──────────────────
    machine_rows, _match_tier = await resolve_takeover_machine(db, source, user_id=user_id)

    # ── provider 行选择 + handoff 重选校验（D-005@v2 + 2026-09-30 用户裁决：
    #    候选对齐「新建会话 · 选择运行位置」的引擎白名单，仅可会话引擎——
    #    PROVIDER_CAPS 四键 claude/codex/pi/cursor，与前端 SESSION_SUPPORTED_
    #    PROVIDERS 同源语义；openclaw/opencode/kimi 等不可会话引擎不再入选）──
    # 原机在线可会话引擎 = 命中机器 runtime 行 provider ∩ 白名单；显式重选不在
    # 集合 → 422（"用户选错引擎"与"原机没有"分口径）；默认 provider 无行 →
    # 409 no_machine 语义（机器在线但没装可会话引擎）。
    session_capable = set(PROVIDER_CAPS)
    machine_providers = {rt.provider for rt in machine_rows if rt.provider in session_capable}
    provider_rows = [
        rt
        for rt in machine_rows
        if rt.provider == effective_provider and rt.provider in session_capable
    ]
    if not provider_rows:
        if provider and provider.strip() and provider.strip() != (source.provider or ""):
            if effective_provider not in session_capable:
                raise ToolReportTakeoverProviderInvalid(
                    f"所选引擎 '{effective_provider}' 不支持会话（可用：claude、"
                    "codex、pi、cursor），请重新选择。",
                    details={
                        "session_id": str(session_id),
                        "provider": effective_provider,
                        "session_capable": sorted(session_capable),
                    },
                )
            raise ToolReportTakeoverProviderInvalid(
                f"所选引擎 '{effective_provider}' 不在原机支持的可会话引擎集合"
                f"（{('、'.join(sorted(p for p in machine_providers if p))) or '空'}）"
                "内，请从原机可用引擎中选择。",
                details={
                    "session_id": str(session_id),
                    "provider": effective_provider,
                    "machine_providers": sorted(machine_providers),
                },
            )
        raise ToolReportTakeoverNoMachine(
            "该机器在线但没有可会话的引擎执行端（需要 Claude Code、Codex、PI 或"
            " Cursor 在线），请检查该机器 daemon 的引擎配置。",
            details={
                "session_id": str(session_id),
                "provider": effective_provider,
                "match_tier": _match_tier,
            },
        )
    runtime_id = provider_rows[0].id

    # ── handoff 档交接文档（D-004@v1；读取失败降级普通新会话不阻塞）────────
    first_prompt = prompt
    handoff_doc = False
    if tier == "handoff":
        doc_prompt = await _build_handoff_first_prompt(
            db,
            source,
            machine_rows,
            harness=harness,
            user_prompt=prompt,
        )
        if doc_prompt is not None:
            first_prompt = doc_prompt
            handoff_doc = True

    # ── 经 create 链建接手会话 B（fork 形态；源会话零 run → 锚点三参 None，
    #    create 链 fork 参数全可空——首个 NULL 锚点形态）。源会话零写。──────
    from .create import create_session as _create_session

    result = await _create_session(
        session_svc,
        user_id,
        provider=effective_provider,
        prompt=first_prompt,
        model=(source.config or {}).get("model"),
        workspace_id=source.workspace_id,
        agent_profile_id=agent_profile_id,
        llm_provider_id=llm_provider_id,
        origin="fork",
        fork_of_session_id=session_id,
        fork_at_run_id=None,
        engine_fork_anchor=None,
        fork_mode=None,
        resume_session_id=resume_session_id,
        runtime_id=str(runtime_id),
    )

    return TakeoverResult(
        agent_session=result.agent_session,
        agent_run=result.agent_run,
        lease_id=result.lease_id,
        tier=tier,
        handoff_doc=handoff_doc,
    )
