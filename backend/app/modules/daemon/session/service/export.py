"""会话导出服务（2026-09-14-session-export task-02 / FR-02 / FR-04 / FR-05）。

模块函数风格照 ``read_model.py`` 先例（第一参数 svc，复用 ``svc._session``
请求级 DB 会话），经 ``SessionService`` 类壳一行委托暴露（``__init__.py``；
facade/router 接线归 task-03）。两档产物（design §总体方案·后端设计）：

- **chat 档**：``user_input`` 行 + 经噪声排除的幸存 ``stdout`` 行 → Markdown
  （单会话直接 .md 响应，多会话 zip 内每会话一个 .md）；
- **full 档**：全量日志原字段 + runs 元数据 + 任务卡 + 附件清单与本体 →
  zip（每会话一目录 ``{标题}_{id前8}/full.json`` + ``attachments/``）。

关键口径（design 定死）：

- 权限逐会话对齐**详情端点**口径（owner + 软删 404 → ``get_group_accessible_session``
  群探测，任一不可访问整包 404，不做部分成功）；
- 每会话独立 **20000 行**上限**保最早**——自建 ``timestamp ASC + limit`` 变体，
  **绝不**复用 ``get_agent_session_logs`` 的「newest-N 再反转」语义（回放保最新、
  导出保最早，方向相反）；跨 run 聚合键只用 ``AgentRun.agent_session_id``
  （resume 语义的 ``AgentRun.session_id`` 是 read_model 明确标注的坑）；
- CPU 密集段（zip/json/md 序列化）经 ``anyio.to_thread.run_sync`` 包裹
  （照 ppm/common/export.py X-002 先例，daemon 域自建 helper 不 import ppm）；
- full 档附件元数据 ``bytes`` 预聚合 >512MB 抛 413（取流前预检，不产生半包
  浪费，R-09）；单附件读取失败降级清单 ``missing=true`` 继续，不整体 500（R-03）。
"""

from __future__ import annotations

import json
import re
import uuid
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from typing import Literal
from urllib.parse import quote

import anyio
from sqlalchemy import func, select
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.daemon.model import AgentSessionTask
from app.modules.session_attachment.model import SessionAttachment
from app.modules.session_attachment.storage import SessionAttachmentStorage

from .errors import DaemonSessionNotFound

log = get_logger(__name__)

# 每会话独立的导出行上限（design §行数上限：log 行 / 每会话独立 / 保最早，
# 不沿用回放 5000）。超限 truncated=true + dropped_rows，丢弃的是较晚行。
EXPORT_LOG_ROW_LIMIT = 20000

# full 档整包附件总量上限（R-09：50 会话 × 多附件可达 GB 级响应）。
EXPORT_ATTACHMENTS_TOTAL_BYTES_LIMIT = 512 * 1024 * 1024

# 任务卡快照上限（对齐 GET /sessions/{id}/tasks 的 _SESSION_TASKS_MAX=200 口径）。
_EXPORT_TASKS_MAX_ROWS = 200

# full JSON 产物版本号（design「版本化，便于未来演进」）。
_EXPORT_VERSION = 1

_TIER_LABELS: dict[str, str] = {"chat": "对话", "full": "完整信息"}

# zip 条目名/展示标题的空回退（design §zip 条目名）。
_UNTITLED_FALLBACK = "未命名会话"


class SessionExportTooLarge(AppError):
    """full 档整包附件总量超 512MB（R-09）——413 + 提示分批导出。"""

    code = "HTTP_413_SESSION_EXPORT_TOO_LARGE"
    http_status = 413


@dataclass(slots=True)
class SessionExportResult:
    """导出产物（task-03 router 据此回 Response：media_type + RFC5987 文件名 + 字节）。

    Attributes:
        media_type: ``text/markdown``（chat×单会话）或 ``application/zip``。
        filename: 原始 UTF-8 显示文件名——chat×单会话 = ``{sanitize(标题)}_{id前8}.md``
            （design §响应矩阵,与 zip 内条目基名同款）；其余（zip） =
            ``会话导出_{档位中文}_{时间戳}.zip``。Content-Disposition 头组装用
            ``_rfc5987_filename``。
        payload: 产物字节（md UTF-8 文本 / zip 归档）。
    """

    media_type: str
    filename: str
    payload: bytes


@dataclass(slots=True)
class _SessionExportBundle:
    """单会话导出数据包（权限/行数截断/任务/附件装配完成后的中间形态）。"""

    session: AgentSession
    runs: list[AgentRun]
    logs: list[AgentRunLog]
    tasks: list[AgentSessionTask]
    attachments: list[SessionAttachment]
    truncated: bool
    dropped_rows: int


# ── stdout 噪声排除（R-08：与前端 session-log-assembler.ts classifySessionLog
#    同源对齐的纯函数；判定用例锚 __tests__/session-log-assembler.test.ts，
#    两边改动时相互提示，防止语义漂移）────────────────────────────────────────

# 含 AskUserQuestion 的卡片协议行（前端 contains 判定，非前缀锚定）。
_ASK_USER_QUESTION_MARK = "AskUserQuestion"
# [TOOL_RESULT] User answered 形态（AskUserQuestion 的用户答复回显行）。
_TOOL_RESULT_USER_ANSWERED_RE = re.compile(r"^\[TOOL_RESULT\]\s*User answered")
# [(SYSTEM|RESULT)…] 前缀技术标记行（如 [SYSTEM:thinking_tokens] 48）。
_SYSTEM_RESULT_PREFIX_RE = re.compile(r"^\[(SYSTEM|RESULT)[^\]]*\]")
# override 撤回令箭行（必须在 [THINKING] 判定之前——见前端同类注释，
# [THINKING_OVERRIDE] 会被 [THINKING] 前缀正则误吞丢 _OVERRIDE 语义）。
_OVERRIDE_RE = re.compile(r"^\[(ASSISTANT_OVERRIDE|THINKING_OVERRIDE)\]\s+(\S+)")
# [TOOL_USE] stdout 文本行：与 channel=tool_call JSON 是同一工具的双发重复，
# tool_call JSON 为权威源，文本行丢弃（ql-20260730-003）。
_TOOL_USE_TEXT_RE = re.compile(r"^\[TOOL_USE\]\s?")
# [TOOL_RESULT] 通用文本行：归 tool_result 段不进正文（design：通用形态与
# User answered 形态全部排除）。
_TOOL_RESULT_TEXT_RE = re.compile(r"^\[TOOL_RESULT\]\s?")
# [TASK_*] 后台任务生命周期行（前缀 + 单行 JSON，task-11 契约）。
_TASK_LINE_RE = re.compile(r"^\[(TASK_STARTED|TASK_PROGRESS|TASK_NOTIFICATION)\]\s?")
# [THINKING] 前缀行：chat 档排除（属 full 档过程信息）。
_THINKING_PREFIX_RE = re.compile(r"^\[THINKING\]\s?")
# 技能装载注入行（ql-20260824-017：SKILL.md 全文以 assistant 文本块注入，
# 属技能协议载荷非用户答复）；仅 [ASSISTANT] 前缀形态，裸文本不误吞。
_SKILL_LOAD_RE = re.compile(
    r"^\[ASSISTANT\]\s*Base directory for this skill:",
    re.IGNORECASE,
)
_ASSISTANT_PREFIX_RE = re.compile(r"^\[ASSISTANT\]\s?")
# CLI 合成鉴权/网关错误行（ql-20260904-013 + ql-20260906-001 行首锚定收紧；
# 与前端 normalize.ts isAssistantApiErrorText 同口径）。
_CLI_SYNTHETIC_ERROR_RES: tuple[re.Pattern[str], ...] = (
    re.compile(r"^API\s*Error", re.IGNORECASE),
    re.compile(r"^Request\s+rejected", re.IGNORECASE),
    re.compile(r"^Not\s+logged\s+in", re.IGNORECASE),
    re.compile(r"^Please\s+run\s+/login", re.IGNORECASE),
)
# 幸存行剥 [ASSISTANT]/[THINKING]/[LOG:\w+] 发言方前缀（前端 reply 分支同款）。
_SPEAKER_PREFIX_RE = re.compile(r"^\[(ASSISTANT|THINKING|LOG:\w+)\]\s?")


def _is_task_lifecycle_line(trimmed: str) -> bool:
    """[TASK_*] 行是否为合法生命周期行（坏 JSON/非法 status 降级文本不排除）。

    照前端 parseTaskLine 容错语义（R-07）：前缀命中后载荷须可解析为 JSON 对象；
    TASK_NOTIFICATION 还须携带合法终态 status，否则整行降级普通文本行
    （宁进正文不丢内容）。
    """
    match = _TASK_LINE_RE.match(trimmed)
    if match is None:
        return False
    try:
        payload = json.loads(trimmed[match.end() :])
    except ValueError:
        return False
    if not isinstance(payload, dict):
        return False
    if match.group(1) in ("TASK_STARTED", "TASK_PROGRESS"):
        return True
    return payload.get("status") in ("completed", "failed", "stopped")


def _is_cli_synthetic_error_line(trimmed: str) -> bool:
    """CLI 合成鉴权/网关错误行判定（仅 [ASSISTANT] 前缀形态，codex 裸流不误吞）。"""
    match = _ASSISTANT_PREFIX_RE.match(trimmed)
    if match is None:
        return False
    body = trimmed[match.end() :].lstrip()
    return any(pattern.match(body) for pattern in _CLI_SYNTHETIC_ERROR_RES)


def _assistant_text_from_stdout(content: str) -> str | None:
    """stdout 行 → 助手正文（噪声排除纯函数，chat 档正文派生规则）。

    与前端 ``classifySessionLog``（session-log-assembler.ts:288-366）逐条同源：
    命中任一噪声形态返回 ``None``；幸存行剥 ``[ASSISTANT]``/``[LOG:\\w+]``
    前缀后作为助手正文返回（剥后为空同样返回 ``None``——不产空正文段）。

    排除清单（design §chat Markdown 组装）：空行 / 含 AskUserQuestion /
    [TOOL_RESULT]（通用 + User answered 形态）/ [(SYSTEM|RESULT)…] 前缀 /
    [TOOL_USE] 文本行（双发去重）/ 合法 [TASK_*] 生命周期行 / 技能装载载荷行 /
    CLI 合成鉴权与网关错误行 / [ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] 撤回
    标记行 / [THINKING] 前缀行（chat 档排除，属 full 档）。
    """
    trimmed = (content or "").strip()
    if not trimmed:
        return None
    if _ASK_USER_QUESTION_MARK in trimmed:
        return None
    if _TOOL_RESULT_USER_ANSWERED_RE.match(trimmed):
        return None
    if _SYSTEM_RESULT_PREFIX_RE.match(trimmed):
        return None
    if _OVERRIDE_RE.match(trimmed):
        return None
    if _TOOL_USE_TEXT_RE.match(trimmed):
        return None
    if _TOOL_RESULT_TEXT_RE.match(trimmed):
        return None
    if _is_task_lifecycle_line(trimmed):
        return None
    if _THINKING_PREFIX_RE.match(trimmed):
        return None
    if _SKILL_LOAD_RE.match(trimmed):
        return None
    if _is_cli_synthetic_error_line(trimmed):
        return None
    text = _SPEAKER_PREFIX_RE.sub("", trimmed, count=1)
    return text or None


# ── 文件名 helper（daemon 域自建，不 import ppm——design §响应矩阵）──────────

# zip 条目名非法字符：路径分隔/通配/引号/控制符等（Windows 与 POSIX 并集）。
_ILLEGAL_NAME_CHARS_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
# Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9；含带扩展名形态 CON.txt）。
_WINDOWS_RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)


def _sanitize_zip_name(name: str) -> str:
    """zip 条目名/展示标题 sanitize（R-05）。

    去非法字符与控制符 → 修剪结尾点/空格（Windows 资源管理器会剥离结尾点/空格
    造成半截名）→ Windows 保留设备名（按首个点前的 stem 判定，大小写不敏感）
    前缀下划线破坏保留语义 → 空/全非法回退「未命名会话」。
    """
    cleaned = _ILLEGAL_NAME_CHARS_RE.sub("", (name or "").strip()).rstrip(" .")
    stem = cleaned.split(".", 1)[0].strip().upper()
    if stem in _WINDOWS_RESERVED_NAMES:
        cleaned = f"_{cleaned}"
    return cleaned or _UNTITLED_FALLBACK


def _rfc5987_filename(filename: str) -> str:
    """组装 Content-Disposition 头值（RFC 5987 中文文件名，照 ppm 先例形态）。

    ``filename`` 为 latin-1 超集外的中文时不能直接内联——用
    ``filename*=UTF-8''<percent-encoded>`` 承载原文（主流浏览器优先解码），
    ``filename`` 作 ASCII 回退（旧浏览器/curl 可读但乱码）。task-03 router
    直接把返回值放进响应头。
    """
    ascii_fallback = filename.encode("ascii", "ignore").decode("ascii") or "download"
    encoded = quote(filename, safe="")
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded}"


def _timestamped_filename(label: str, ext: str) -> str:
    """「中文标签_YYYYMMDD_HHMMSS.ext」下载文件名（照 ppm timestamped_filename
    风格自建，本地时间；统一导出产物外层文件名）。"""
    return f"{label}_{datetime.now():%Y%m%d_%H%M%S}.{ext}"


# ── 渲染（CPU 密集，调用方经 anyio.to_thread 包裹）──────────────────────────


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _display_title(session: AgentSession) -> str:
    """展示标题：title 列为空（旧 chat 会话）回退「未命名会话」。"""
    title = (session.title or "").strip()
    return title or _UNTITLED_FALLBACK


def _member_name_of(row: AgentRunLog) -> str | None:
    """群聊行发言者前缀：从投影行 metadata_ 取 member_name（单聊行 NULL）。"""
    meta = row.metadata_
    if isinstance(meta, Mapping):
        name = meta.get("member_name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return None


def _render_chat_markdown(
    session: AgentSession,
    runs: Sequence[AgentRun],
    logs: Sequence[AgentRunLog],
    *,
    truncated: bool = False,
    dropped_rows: int = 0,
) -> str:
    """chat 档 Markdown 渲染（会话头 + 按 run 分轮的用户/助手文本）。

    正文派生规则（design §chat Markdown 组装）：``user_input`` 行=用户消息
    （附件标记行 ``[附件:名|类型]`` 原样保留；群聊行以 metadata_ 的
    member_name 作发言者前缀）；``stdout`` 行经 ``_assistant_text_from_stdout``
    噪声排除后为助手正文。``stderr``/``tool_call``/``pending_input``/``system``
    行不进 chat 档（full 档全保留）。logs 须为跨 run 稳定升序（导出查询
    保证），按 ``run_id`` 连续切段即「轮」。截断时文件尾标注 truncated 与
    丢弃行数（design §行数上限）。
    """
    lines: list[str] = [f"# {_display_title(session)}", ""]
    lines.append(f"- 供应商：{session.provider}")
    if session.runtime_id is not None:
        lines.append(f"- 运行时：{session.runtime_id}")
    lines.append(f"- 状态：{session.status}")
    lines.append(f"- 创建时间：{_iso(session.created_at) or '—'}")
    if session.last_active_at is not None:
        lines.append(f"- 最近活跃：{_iso(session.last_active_at)}")
    lines.append(f"- 轮数：{len(runs)}")

    current_run_id: uuid.UUID | None = None
    turn_index = 0
    for row in logs:
        if row.channel not in ("user_input", "stdout"):
            continue
        content = row.content_redacted or ""
        if row.channel == "user_input":
            text = content.strip()
        else:
            text = _assistant_text_from_stdout(content)
        if not text:
            continue
        if row.run_id != current_run_id:
            current_run_id = row.run_id
            turn_index += 1
            lines.extend(["", f"## 第 {turn_index} 轮", ""])
        speaker = _member_name_of(row) or ("用户" if row.channel == "user_input" else "助手")
        lines.extend([f"**{speaker}**：{text}", ""])

    if truncated:
        lines.extend(
            [
                "---",
                "",
                (
                    f"> 注：日志超过导出上限，已保留最早的 {EXPORT_LOG_ROW_LIMIT} 行，"
                    f"丢弃 {dropped_rows} 行（truncated: true）。"
                ),
                "",
            ]
        )
    return "\n".join(lines)


def _render_full_json(
    session: AgentSession,
    runs: Sequence[AgentRun],
    logs: Sequence[AgentRunLog],
    tasks: Sequence[AgentSessionTask],
    attachments_meta: Sequence[Mapping[str, object]],
    *,
    truncated: bool = False,
    dropped_rows: int = 0,
) -> dict:
    """full 档 JSON 渲染（design §接口定义 full JSON 顶层结构，export_version=1）。

    ``logs`` 为全字段原样导出（含 thinking/tool_call/edit_patch/metadata_）；
    ``tasks`` 为 agent_session_task 快照；``attachments_meta`` 为附件清单
    （含 zip_path 与 missing 标记，由附件取流降级结果装配）。
    """
    return {
        "export_version": _EXPORT_VERSION,
        "session": {
            "id": str(session.id),
            "title": _display_title(session),
            "runtime_id": str(session.runtime_id) if session.runtime_id is not None else None,
            "provider": session.provider,
            "status": session.status,
            "created_at": _iso(session.created_at),
            "last_active_at": _iso(session.last_active_at),
            "turn_count": session.turn_count,
            "config_snapshot": session.config_snapshot,
        },
        "runs": [
            {
                "id": str(run.id),
                "status": run.status,
                "model": run.model,
                "started_at": _iso(run.started_at),
                "finished_at": _iso(run.finished_at),
                "input_tokens": run.input_tokens,
                "output_tokens": run.output_tokens,
                "diff_summary": run.diff_summary,
                "error_code": run.error_code,
            }
            for run in runs
        ],
        "logs": [
            {
                "id": str(row.id),
                "run_id": str(row.run_id),
                "timestamp": _iso(row.timestamp),
                "channel": row.channel,
                "content_redacted": row.content_redacted,
                "tool_kind": row.tool_kind,
                "parent_tool_use_id": row.parent_tool_use_id,
                "subagent_type": row.subagent_type,
                "depth": row.depth,
                "edit_patch": row.edit_patch,
                "metadata": row.metadata_,
            }
            for row in logs
        ],
        "tasks": [
            {"task_name": task.task_name, "status": task.status, "summary": task.summary}
            for task in tasks
        ],
        "attachments": [dict(item) for item in attachments_meta],
        "truncated": truncated,
        "dropped_rows": dropped_rows,
    }


def _zip_entry_base(session: AgentSession) -> str:
    """zip 内会话目录/文件基名：sanitize 标题 + id 前 8 位防重名（Grill P2）。"""
    return f"{_sanitize_zip_name(_display_title(session))}_{str(session.id)[:8]}"


def _build_zip_entries(
    bundles: Sequence[_SessionExportBundle],
    tier: Literal["chat", "full"],
    attachment_blobs: Mapping[uuid.UUID, bytes],
) -> list[tuple[str, bytes]]:
    """zip 条目装配（同步 CPU 密集）：chat=每会话一个 .md；full=每会话一目录。

    full 档附件清单里的 ``zip_path`` 与实际写入条目一一对应
    （``{base}/attachments/{附件id}_{sanitize(原名)}``）；取流失败的附件
    不写条目、清单标 ``missing=true``（R-03 降级，整包继续）。
    """
    entries: list[tuple[str, bytes]] = []
    for bundle in bundles:
        base = _zip_entry_base(bundle.session)
        if tier == "chat":
            markdown = _render_chat_markdown(
                bundle.session,
                bundle.runs,
                bundle.logs,
                truncated=bundle.truncated,
                dropped_rows=bundle.dropped_rows,
            )
            entries.append((f"{base}.md", markdown.encode("utf-8")))
            continue
        attachments_meta: list[dict[str, object]] = []
        attachment_entries: list[tuple[str, bytes]] = []
        for att in bundle.attachments:
            blob = attachment_blobs.get(att.id)
            zip_path = f"{base}/attachments/{att.id}_{_sanitize_zip_name(att.name)}"
            if blob is not None:
                attachment_entries.append((zip_path, blob))
                missing = False
            else:
                missing = True
            attachments_meta.append(
                {
                    "id": str(att.id),
                    "name": att.name,
                    "kind": att.kind,
                    "media_type": att.media_type,
                    "bytes": att.bytes,
                    "zip_path": zip_path,
                    "missing": missing,
                }
            )
        full = _render_full_json(
            bundle.session,
            bundle.runs,
            bundle.logs,
            bundle.tasks,
            attachments_meta,
            truncated=bundle.truncated,
            dropped_rows=bundle.dropped_rows,
        )
        entries.append((f"{base}/full.json", json.dumps(full, ensure_ascii=False).encode("utf-8")))
        entries.extend(attachment_entries)
    return entries


def _zip_entries(entries: Sequence[tuple[str, bytes]]) -> bytes:
    """zip 归档序列化（同步 CPU 密集，DEFLATED 压缩）。"""
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries:
            archive.writestr(name, data)
    return buf.getvalue()


# ── 查询与权限（async；聚合键只用 AgentRun.agent_session_id）────────────────


async def _resolve_exportable_session(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
) -> AgentSession:
    """权限逐会话对齐详情端点口径（``get_agent_session``）。

    owner（``user_id`` 相等且软删 ``deleted_at IS NULL``——logs 端点的 owner
    探测不过滤软删，导出**选详情口径**软删 404）未命中再走
    ``get_group_accessible_session(allow_shadow_member_read=True)``（参与者/
    workspace admin/影子成员读，同 ``get_agent_session_logs`` 探测顺序）；
    仍不可访问抛 :class:`DaemonSessionNotFound`（404 不泄露存在性）。
    """
    owned = (
        await svc._session.execute(
            select(AgentSession).where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
                AgentSession.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if owned is not None:
        return owned
    from app.modules.daemon.group.service import get_group_accessible_session

    group_session = await get_group_accessible_session(
        svc._session,
        session_id=session_id,
        user_id=user_id,
        allow_shadow_member_read=True,
    )
    if group_session is not None and group_session.deleted_at is None:
        return group_session
    raise DaemonSessionNotFound(
        f"AgentSession '{session_id}' not found.",
        details={"session_id": str(session_id)},
    )


async def _fetch_export_runs_logs(
    svc,
    session_id: uuid.UUID,
) -> tuple[list[AgentRun], list[AgentRunLog], bool, int]:
    """会话级 runs + 导出日志（timestamp ASC + limit，**保最早** 20000 行）。

    join/权限骨架照 ``read_model.get_agent_session_logs``（跨 run 排序锚=每 run
    最早日志时间 coalesce started_at；run 内 timestamp/id 升序），但排序方向
    反转（asc + limit）——回放取最新 N 再反转，导出从对话头开始保最早
    （design 给 plan 的实现提示：不得复用 newest-N 语义）。返回
    (runs, logs, truncated, dropped_rows)；dropped_rows = 总行数 - 上限。
    """
    session_run_ids = select(AgentRun.id).where(AgentRun.agent_session_id == session_id)
    total_rows = int(
        (
            await svc._session.execute(
                select(func.count())
                .select_from(AgentRunLog)
                .where(AgentRunLog.run_id.in_(session_run_ids))
            )
        ).scalar()
        or 0
    )

    runs_stmt = (
        select(AgentRun)
        .where(AgentRun.agent_session_id == session_id)
        # nulls_last 消除 PG/SQLite 方言分叉（started_at nullable）。
        .order_by(col(AgentRun.started_at).asc().nulls_last(), AgentRun.id.asc())
    )
    runs = list((await svc._session.execute(runs_stmt)).scalars().all())

    min_ts_subq = (
        select(
            AgentRunLog.run_id.label("run_id"),
            func.min(AgentRunLog.timestamp).label("min_ts"),
        )
        .where(AgentRunLog.run_id.in_(session_run_ids))
        .group_by(AgentRunLog.run_id)
        .subquery()
    )
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
    logs_stmt = (
        select(AgentRunLog)
        .select_from(AgentRunLog)
        .join(run_anchor, run_anchor.c.run_id == AgentRunLog.run_id)
        .order_by(
            run_anchor.c.anchor_ts.asc(),
            AgentRunLog.timestamp.asc(),
            AgentRunLog.id.asc(),
        )
        .limit(EXPORT_LOG_ROW_LIMIT)
    )
    logs = list((await svc._session.execute(logs_stmt)).scalars().all())

    truncated = total_rows > EXPORT_LOG_ROW_LIMIT
    dropped_rows = max(0, total_rows - EXPORT_LOG_ROW_LIMIT)
    return runs, logs, truncated, dropped_rows


async def _fetch_export_tasks(svc, session_id: uuid.UUID) -> list[AgentSessionTask]:
    """任务卡快照（照 GET /sessions/{id}/tasks：updated_at desc 最近 200 条）。"""
    stmt = (
        select(AgentSessionTask)
        .where(AgentSessionTask.session_id == session_id)
        .order_by(AgentSessionTask.updated_at.desc())
        .limit(_EXPORT_TASKS_MAX_ROWS)
    )
    return list((await svc._session.execute(stmt)).scalars().all())


async def _fetch_export_attachments(
    svc,
    session_id: uuid.UUID,
) -> list[SessionAttachment]:
    """full 档附件元数据（session 维度已绑定行，创建时间升序稳定序）。"""
    stmt = (
        select(SessionAttachment)
        .where(SessionAttachment.session_id == session_id)
        .order_by(SessionAttachment.created_at.asc())
    )
    return list((await svc._session.execute(stmt)).scalars().all())


# ── 导出主入口（SessionService.export_sessions 类壳一行委托）────────────────


async def export_sessions(
    svc,
    user_id: uuid.UUID,
    *,
    session_ids: list[uuid.UUID],
    tier: Literal["chat", "full"],
    storage: SessionAttachmentStorage,
) -> SessionExportResult:
    """会话导出主入口（design §接口定义签名；收原生参数，不 import schema 模型）。

    流程：权限逐会话（任一不可访问整包 404，不做部分成功）→ 每会话装配
    runs/logs（20000 行保最早截断）+ full 档 tasks/attachments → 附件总量
    512MB 预检（取流前，超限 413）→ full 档逐附件取流（单件失败降级
    missing 继续）→ 渲染 + 打包（``anyio.to_thread`` 防 CPU 阻塞事件循环）。

    响应矩阵（design §响应矩阵）：chat×单会话 = ``text/markdown`` 单 .md；
    chat×多会话 与 full×任一 = ``application/zip``。下载文件名：chat×单会话 =
    ``{sanitize(标题)}_{id前8}.md``（design §响应矩阵）；zip（多会话/full） =
    ``会话导出_{档位中文}_{YYYYMMDD_HHMMSS}.zip``；zip 内条目名同为
    ``{sanitize(标题)}_{id前8}``（R-05 防非法字符/保留名/重名）。
    """
    # 1. 权限：逐会话详情口径探测（404 不泄露存在性）。
    sessions = [
        await _resolve_exportable_session(svc, session_id, user_id) for session_id in session_ids
    ]

    # 2. 数据装配（runs/logs 每会话独立 20000 行上限保最早）。
    bundles: list[_SessionExportBundle] = []
    total_attachment_bytes = 0
    for session in sessions:
        runs, logs, truncated, dropped_rows = await _fetch_export_runs_logs(svc, session.id)
        tasks: list[AgentSessionTask] = []
        attachments: list[SessionAttachment] = []
        if tier == "full":
            tasks = await _fetch_export_tasks(svc, session.id)
            attachments = await _fetch_export_attachments(svc, session.id)
            total_attachment_bytes += sum(att.bytes for att in attachments)
        bundles.append(
            _SessionExportBundle(
                session=session,
                runs=runs,
                logs=logs,
                tasks=tasks,
                attachments=attachments,
                truncated=truncated,
                dropped_rows=dropped_rows,
            )
        )

    # 3. 413 预检（元数据 bytes 预聚合，取流之前——不产生半包浪费，R-09）。
    if tier == "full" and total_attachment_bytes > EXPORT_ATTACHMENTS_TOTAL_BYTES_LIMIT:
        raise SessionExportTooLarge(
            "导出附件总量超过 512MB 上限，请减少单次导出的会话数量分批导出。",
            details={
                "total_bytes": total_attachment_bytes,
                "limit_bytes": EXPORT_ATTACHMENTS_TOTAL_BYTES_LIMIT,
            },
        )

    # 4. full 档附件取流：单件失败（对象丢失/存储异常）降级清单 missing=true
    #    继续，不整体 500（R-03）；async 读取留在事件循环，仅序列化进线程。
    attachment_blobs: dict[uuid.UUID, bytes] = {}
    if tier == "full":
        for bundle in bundles:
            for att in bundle.attachments:
                try:
                    attachment_blobs[att.id] = await storage.read_bytes(att.object_key)
                except Exception:
                    log.warning(
                        "session_export.attachment_read_failed",
                        attachment_id=str(att.id),
                        object_key=att.object_key,
                    )

    # 5. 渲染 + 打包（zip/json/md 序列化均为 CPU 密集，to_thread 包裹）。
    tier_label = _TIER_LABELS[tier]
    if tier == "chat" and len(bundles) == 1:
        bundle = bundles[0]

        def _render_single() -> str:
            return _render_chat_markdown(
                bundle.session,
                bundle.runs,
                bundle.logs,
                truncated=bundle.truncated,
                dropped_rows=bundle.dropped_rows,
            )

        markdown = await anyio.to_thread.run_sync(_render_single)
        return SessionExportResult(
            media_type="text/markdown",
            # design §响应矩阵：单会话 .md 用会话名（sanitize 标题 + id 前 8），
            # 与 zip 内条目基名同款；时间戳模式只用于 zip 外层文件名。
            filename=f"{_zip_entry_base(bundle.session)}.md",
            payload=markdown.encode("utf-8"),
        )

    entries = await anyio.to_thread.run_sync(_build_zip_entries, bundles, tier, attachment_blobs)
    payload = await anyio.to_thread.run_sync(_zip_entries, entries)
    return SessionExportResult(
        media_type="application/zip",
        filename=_timestamped_filename(f"会话导出_{tier_label}", "zip"),
        payload=payload,
    )
