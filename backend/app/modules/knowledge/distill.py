"""Knowledge distill dispatch service (change 2026-09-17-knowledge-precipitation
task-07 + D-009 续接分流 + D-010 闭环增强 + D-008 取数通道/回流指引/体量护栏）。

蒸馏派发（FR-01/FR-03，D-002@v1：派发 agent 会话、后端不直调 LLM）——从平台
选会话记录 / 已归档变更 / 快速修复日志，按 ``mode`` 分流执行（D-009）：

- **mode=resume（仅 source_type=session）**：原会话续接——已结束会话先
  ``reopen_session``（SDK resume 保留完整对话历史 + prompt cache），再
  ``inject_session(prompt=build_distill_prompt(...))`` 下发提炼指令；进行中
  会话跳过 reopen 直接 inject。一举化解 R-08 洞一（原会话读自己，无需取数
  通道）。降级守卫（自动落 fresh 并在任务条记降级原因）：provider 无 resume
  能力（get_provider_caps()["resume"]=False）/ 会话状态不可 reopen
  （suspended 等）/ 非会话来源请求 resume（change、quick 强制 fresh）。
- **mode=fresh**（默认）：复用 ``create_session`` 完整链路（D-010③：
  runtime_id 钉机器优先于 provider，agent_profile_id/model 透传，title 由
  prompt 首行「提炼」前缀承担），AgentSession.origin 落档
  DISTILL_SESSION_ORIGIN（D-010④，常规会话列表默认排除）。daemon 离线时
  create_session 自身已把 session/run/lease 三元组收敛 failed 并抛
  DaemonRuntimeOffline / NoOnlineDaemonError——本服务捕获后补建
  failed/no_online_daemon 蒸馏任务条（R-05：任务创建成功且失败态立即可查）。

**D-008（R-08 三洞修复，2026-09-17 末增量）**：

- **洞一（fresh 会话源取数通道）**：对话内容在后端 ``agent_run_logs`` 表，
  fresh 蒸馏会话的 agent 读不到 DB。取数通道 = **附件通道**（调查结论）：
  dispatch 时把会话全部 run 日志导出为 Markdown（``_export_session_transcript``），
  经 ``SessionAttachmentService.upload`` 建附件（kind=file，
  ``text/markdown``），随 create_session ``attachment_ids`` 下发——daemon 侧
  ``deliver=disk`` 落盘 ``{cwd}/attachments/{sha256}.md`` 并在消息尾追加
  「附件已落盘」路径清单（``turn-control.ts``），prompt 指读该文件。附件
  引擎门控（``provider_caps.multimodal``，仅 claude/pi）→ 非多模态引擎
  fresh 会话源在 dispatch 预检 422（引导 resume 模式）。
- **洞二（产出回流指引）**：全局 ``settings.spec_transport`` 默认 ``tar``
  （config.py:271，daemon-client 单一路径）——交互会话启动时 daemon 把平台
  spec bundle pull 到 ``~/.sillyhub/daemon/specs/{ws_id}``（三策略统一落点：
  platform-managed 拉 bundle / repo-mirrored 首拷 / repo-native junction），
  会话结束 ``onSessionEnd → postSpecSync`` 增量回传整树；``knowledge/``
  不在 ``UPLOAD_EXCLUDE_TOP_BASE`` 排除集内 → agent 在该树写
  ``knowledge/proposed/*.md`` 天然回流。故 prompt 的 propose 命令统一带
  ``--spec-dir ~/.sillyhub/daemon/specs/{ws_id}``（CLI 实测：``knowledge
  propose`` 认 ``--spec-dir``；``--spec-root`` 被其静默忽略会回退 cwd，不可用），
  change/quick 来源的读取路径同样改指该树。
- **洞三（体量护栏）**：fresh 会话源三重护栏——dispatch 预检
  ``turn_count > DISTILL_MAX_SESSION_TURNS`` → 422（引导 resume/换小会话）；
  导出渲染层单条内容截断 + 行数上限保最早；导出总字节超
  ``DISTILL_EXPORT_MAX_BYTES`` → 422（对齐附件 20MB 单文件上限）。
  quick/change 来源为文件树条目，不涉及。


两种路径成功后都把实际执行的 AgentSession 首 run 落档为 knowledge-distill
任务条（metadata_ 合并 kind/source_*/mode/agent_session_id，缺 run 时补建
跟踪 run；AgentRunWorkspace 关联幂等建立）——list_tasks 口径不变
（AgentRunWorkspace 关联 + metadata_.kind 过滤）。

- 源校验只读复用既有服务：会话源 ``SessionService.get_agent_session``
  （不存在沿 DaemonSessionNotFound 404 语义）且 ``turn_count > 0`` 否则 422；
  变更源 ``ChangeService.get_by_key``（不存在沿 ChangeNotFound 404 语义）且
  ``status == "archived"`` 否则 422；快速修复源（D-010②）校验
  ``<spec_root>/quicklog/<ql-id>.md`` 存在否则 422（ql 为文件树条目，新
  agent 直接读，无 R-08 洞一取数问题）。
- 生命周期契约（design）：蒸馏无独立状态机，任务条 status 以所落档 AgentRun
  为准；续接/新建会话内部的 run/lease/upsync 事件全部复用既有链路。
"""

from __future__ import annotations

import asyncio
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, SpecWorkspaceNotFound, WorkspaceNotFound
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.agent.provider_caps import get_provider_caps
from app.modules.auth.model import User
from app.modules.daemon.schema import DISTILL_SESSION_ORIGIN
from app.modules.knowledge.schema import DistillTaskRead
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import AgentRunWorkspace, Workspace

if TYPE_CHECKING:  # 仅为 _upload_distill_source 返回类型注解（延迟求值，防循环 import）
    from collections.abc import Sequence

    # ql-20260918-006（mypy 债）：SessionAttachmentService.upload 回 AttachmentRead
    # DTO（非 ORM 行），dispatch 只取 id/name 两属性。
    from app.modules.session_attachment.schema import AttachmentRead

log = get_logger(__name__)

#: metadata_.kind 固定值——list_tasks 按 it 过滤 knowledge-distill 类任务。
DISTILL_RUN_KIND = "knowledge-distill"

#: metadata_.mode 固定值（resume 被降级守卫改写后落 "fresh"）。
MODE_RESUME = "resume"
MODE_FRESH = "fresh"

#: 降级原因码（DistillTaskRead.degraded_reason / metadata_.degraded_reason）。
DEGRADE_NOT_SESSION = "resume_only_for_session_source"
DEGRADE_PROVIDER_NO_RESUME = "provider_no_resume"
DEGRADE_STATUS_NOT_REOPENABLE = "session_status_not_reopenable"

# ── D-008 洞三：体量护栏常量（fresh 会话源导出通道专用）──────────────────────
#
# turn 预检阈值：超过则 fresh 导出前 422（导出附件撑不起也嚼不完，引导 resume
# ——原会话续接由引擎 SDK 自己管理超长历史与压缩，不走平台导出）。
DISTILL_MAX_SESSION_TURNS = 2000

#: 导出日志行上限（保最早，对齐 daemon 会话导出「保最早」方向；比导出档
#: 20000 紧——蒸馏源只需对话正文，50KB×5000 已是附件上限量级）。
DISTILL_EXPORT_ROW_LIMIT = 5000

#: 单条消息内容截断（字符 ≈ 8KB；防单条巨型 tool 输出淹没对话主线）。
DISTILL_EXPORT_MESSAGE_CHARS = 8 * 1024

#: 导出总字节上限（19MB，留余量低于附件单文件 20MB 上限 MAX_FILE_BYTES；
#: 超限 422 而非截断——截到一半的对话蒸馏价值存疑，引导 resume/换小会话）。
DISTILL_EXPORT_MAX_BYTES = 19 * 1024 * 1024


class DistillSourceInvalid(AppError):
    """蒸馏源不满足派发条件（无记录会话 / 未归档变更 / ql 不存在 / 非法引用）。"""

    code = "HTTP_422_DISTILL_SOURCE_INVALID"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY


# ── prompt 模板（R-05 固化，不随请求拼装自由文本之外的逻辑）──────────────────


def build_distill_prompt(
    source_type: Literal["session", "change", "quick"],
    source_ref: str | list[str],
    focus: str | None,
    *,
    for_resume: bool = False,
    export_name: str | None = None,
    spec_dir: str | None = None,
) -> str:
    """按 source_type 分会话/变更/快速修复三式，内嵌 source_ref 与可选 focus。

    指令固化 ``sillyspec knowledge propose --title --category --body`` 用法
    （R-05：防 agent 产出不合规格的候选文件）。``for_resume=True``（D-009）时
    来源改写为「本会话本身的完整对话记录」——续接会话读自己，无需取数通道。

    D-008 扩展：

    - ``export_name``（fresh 会话源必传）：洞一取数通道——对话记录经
      ``_export_session_transcript`` 导出为附件 ``export_name`` 随消息下发，
      daemon 落盘 ``{cwd}/attachments/{sha256}.md`` 并在消息尾追加「附件已
      落盘」路径清单；prompt 指读该文件（agent 用 grep/分片增量啃），不再
      指裸 session_id（DB 指针 agent 不可读）。
    - ``spec_dir``（洞二回流指引，dispatch 全来源/全模式传入）：daemon 本地
      平台同步规范树路径（``~/.sillyhub/daemon/specs/{ws_id}``）。propose
      命令带 ``--spec-dir``（CLI 实测 ``knowledge propose`` 只认 ``--spec-dir``，
      ``--spec-root`` 被静默忽略回退 cwd）；change/quick 的来源读取路径同指
      该树（platform-managed 下 cwd 无 .sillyspec）。``None`` 时回落旧行文
      （无工作区上下文的直调/测试，零回归）。
    """
    if source_type == "session":
        if for_resume:
            source_line = "来源即本会话本身的完整对话记录（你是原会话的续接，已持有全部上下文），请回顾本会话全过程进行提炼。"
        else:
            if not export_name:
                raise ValueError(
                    "fresh 会话源 prompt 必须携带导出附件名 export_name（D-008 洞一取数通道）"
                )
            source_line = (
                f"来源是平台会话记录的导出文件（来源会话 session_id：{source_ref}，仅作背景参考）。"
                f"该会话的完整对话记录已导出为附件「{export_name}」，随本消息落盘到你的工作目录 attachments/ 下"
                "（消息末尾「附件已落盘」清单给出了确切路径，形如 attachments/<sha256>.md）。"
                "请读取该文件获得完整对话记录；文件较大时先用 wc -l 看规模、用 grep 定位关键词，再分段阅读。"
            )
    elif source_type == "quick":
        refs = source_ref if isinstance(source_ref, list) else [source_ref]
        base = spec_dir if spec_dir else ".sillyspec"
        paths = "\n".join(f"- {base}/quicklog/{ref}.md" for ref in refs)
        source_line = (
            "来源是快速修复日志（quicklog）条目，共 "
            f"{len(refs)} 条，请逐一读取以下文件：\n{paths}\n"
            "聚焦每次修复的问题现象、根因与解法。"
        )
    else:
        if spec_dir:
            source_line = (
                f"来源是已归档的变更（change_key：{source_ref}），其文档位于平台同步目录 "
                f"{spec_dir}/changes/archive/{source_ref}/ 下，请读取该目录下的设计文档、任务卡与产出记录。"
            )
        else:
            source_line = f"来源是已归档的变更（change_key：{source_ref}），请读取该变更目录下的设计文档、任务卡与产出记录。"
    focus_line = f"\n本次提炼关注点（用户指定）：{focus}\n" if focus else "\n"
    if spec_dir:
        propose_cmd = (
            'sillyspec knowledge propose --title "<条目标题>" '
            "--category <conventions|patterns|known-issues|uncategorized> "
            f'--body "<Markdown 正文>" --spec-dir {spec_dir}'
        )
        spec_note = (
            f"\n必须携带 --spec-dir {spec_dir}：该路径是平台同步的规范树"
            "（会话结束自动上行回流平台知识库，无需你手动同步）；不带该参数会落到"
            "你当前工作目录的 .sillyspec，不一定参与平台同步，产物可能无法回流。\n"
        )
    else:
        propose_cmd = (
            'sillyspec knowledge propose --title "<条目标题>" '
            "--category <conventions|patterns|known-issues|uncategorized> "
            '--body "<Markdown 正文>"'
        )
        spec_note = ""
    return (
        "你是知识沉淀助手，负责把平台的记录资产提炼成可长期复用的知识条目。\n"
        f"\n{source_line}\n"
        "\n提炼要求：\n"
        "1. 只保留值得长期复用的知识：踩坑与解法、可复用模式、平台约定与契约；忽略过程性描述与一次性信息。\n"
        "2. 每条知识独立成条，标题概括问题本身，正文用 Markdown 写清「问题、解法、证据（文件/提交）、适用条件」。\n"
        f"{focus_line}"
        "\n落盘方式（必须逐字遵守，不许改用其它写文件方式）：\n"
        "对每条提炼出的知识，执行：\n"
        f"{propose_cmd}\n"
        f"{spec_note}"
        "\n完成后简要汇报提炼出的候选知识清单即可，不要修改知识库之外的任何文件。"
    )


# ── D-008 洞一：会话日志导出（fresh 模式取数通道）─────────────────────────────


def _clip_message(text: str) -> str:
    """洞三：单条消息内容截断（字符级 ≈8KB，防单条巨型 tool 输出淹没主线）。"""
    if len(text) <= DISTILL_EXPORT_MESSAGE_CHARS:
        return text
    return (
        text[:DISTILL_EXPORT_MESSAGE_CHARS]
        + f"\n\n[…本条超长，已截断保留前 {DISTILL_EXPORT_MESSAGE_CHARS} 字符，"
        f"原文共 {len(text)} 字符…]"
    )


def _render_transcript_markdown(
    session_id: uuid.UUID,
    logs: Sequence[AgentRunLog],
    *,
    total_rows: int,
) -> str:
    """会话对话日志 → 蒸馏源 Markdown（agent 消费精简版）。

    与 daemon 会话导出 chat 档（``daemon/session/service/export.py`` 的
    ``_render_chat_markdown``）同构：只取 ``user_input`` + ``stdout`` 两
    channel、stdout 经同款噪声排除、按 run 切轮、子代理归因。差异：蒸馏源
    面向 agent（省毫秒时间戳/会话元信息头），并叠加洞三护栏——单条截断
    （``_clip_message``）与行数超限尾注（保最早）。噪声排除直接 import 导出
    模块的 ``_assistant_text_from_stdout``（与前端 session-log-assembler
    同源对齐的单一实现，复制会产生第三份漂移源）。
    """
    from app.modules.daemon.session.service.export import _assistant_text_from_stdout

    lines = [
        "# 会话对话记录导出（知识蒸馏源）",
        "",
        f"- 来源会话 session_id：{session_id}",
        f"- 收录条目：共 {total_rows} 行原始日志中的 {len(logs)} 行"
        "（user_input + stdout 对话正文，工具调用等过程日志按会话导出同款噪声规则排除）",
        f"- 超过 {DISTILL_EXPORT_MESSAGE_CHARS} 字符的单条内容已截断",
        "",
    ]
    current_run_id: uuid.UUID | None = None
    turn_index = 0
    current_subagent_key: tuple[str | None, str | None] | None = None
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
            current_subagent_key = None
            lines.extend(["", f"## 第 {turn_index} 轮", ""])
        is_subagent = bool(row.subagent_type) and (row.depth or 0) > 0
        if is_subagent:
            sub_key = (row.parent_tool_use_id, row.subagent_type)
            if sub_key != current_subagent_key:
                current_subagent_key = sub_key
                lines.extend([f"> ── 子代理回合：{row.subagent_type}（depth={row.depth}）──", ""])
            speaker = f"子代理·{row.subagent_type}"
        else:
            current_subagent_key = None
            speaker = "用户" if row.channel == "user_input" else "助手"
        lines.extend([f"**{speaker}**：{_clip_message(text)}", ""])

    if total_rows > len(logs):
        lines.extend(
            [
                "---",
                "",
                (
                    f"> 注：日志行数超过导出上限（{DISTILL_EXPORT_ROW_LIMIT} 行），"
                    f"已保留最早的 {len(logs)} 行，丢弃 {total_rows - len(logs)} 行。"
                ),
                "",
            ]
        )
    return "\n".join(lines)


async def _export_session_transcript(db: AsyncSession, session_id: uuid.UUID) -> tuple[str, int]:
    """洞一：聚合会话全部 run 日志 → ``(Markdown, 总行数)``。

    聚合口径与 daemon 会话导出（``export.py`` ``_fetch_export_runs_logs``）
    同源：跨 run 聚合键只用 ``AgentRun.agent_session_id``（resume 语义的
    ``AgentRun.session_id`` 是 read_model 明确标注的坑）；排序锚 = 每 run
    最早日志时间 coalesce started_at（跨 run 稳定时序），升序 + limit 保最早
    （与导出档方向一致——蒸馏也需要从头读任务背景）。洞三护栏分工：行数
    上限在本层（保最早），总字节上限由 dispatch 上传前预检（422）。
    """
    session_run_ids = select(AgentRun.id).where(AgentRun.agent_session_id == session_id)
    total_rows = int(
        (
            await db.execute(
                select(func.count())
                .select_from(AgentRunLog)
                .where(AgentRunLog.run_id.in_(session_run_ids))
            )
        ).scalar()
        or 0
    )
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
    logs = list(
        (
            await db.execute(
                select(AgentRunLog)
                .select_from(AgentRunLog)
                .join(run_anchor, run_anchor.c.run_id == AgentRunLog.run_id)
                .order_by(
                    run_anchor.c.anchor_ts.asc(),
                    AgentRunLog.timestamp.asc(),
                    AgentRunLog.id.asc(),
                )
                .limit(DISTILL_EXPORT_ROW_LIMIT)
            )
        )
        .scalars()
        .all()
    )
    markdown = _render_transcript_markdown(session_id, logs, total_rows=total_rows)
    return markdown, total_rows


async def _upload_distill_source(
    db: AsyncSession,
    user_id: uuid.UUID,
    source_session_id: uuid.UUID,
    data: bytes,
) -> AttachmentRead:
    """导出 Markdown → 文件中心附件（洞一取数通道的落盘点）。

    kind=file + text/markdown → inject 组装走 ``deliver=disk`` 路线（非多模态
    媒体），daemon 落盘 ``{cwd}/attachments/{sha256}.md`` 并在消息尾追加路径
    清单（``turn-control.ts``）。上传自身受 20MB 单文件上限（413）保护，正常
    流程到不了那——dispatch 在此之前已按 ``DISTILL_EXPORT_MAX_BYTES`` 预检。
    模块级函数 = 测试延迟绑定 patch 点（与 ``_create_session`` 同惯例）。
    """
    from app.modules.session_attachment.service import SessionAttachmentService
    from app.modules.session_attachment.storage import SessionAttachmentStorage
    from app.modules.storage.factory import get_storage_backend

    return await SessionAttachmentService(
        db, SessionAttachmentStorage(get_storage_backend())
    ).upload(
        user_id=user_id,
        kind="file",
        name=f"distill-source-{str(source_session_id)[:8]}.md",
        media_type="text/markdown",
        data=data,
    )


async def _cleanup_distill_attachment(db: AsyncSession, attachment_id: uuid.UUID) -> None:
    """ql-20260918-006（M5）：fresh 派发失败分支回收导出附件草稿行。

    上传先于 create_session（洞一取数通道），引擎不支持 / 离线两失败分支此前
    不清理，附件行成存储孤儿（对象回收是 D-5 accepted risk——内容寻址可能共享，
    本处至少即时回收草稿行，对齐附件删除端点「只删行」语义；已绑定 session 的
    行属于会话审计轨迹不动）。best-effort：回收失败仅记日志，不改变失败分支
    既有语义（422 / failed 任务条）。
    """
    from app.modules.session_attachment.model import SessionAttachment

    try:
        row = (
            await db.execute(select(SessionAttachment).where(SessionAttachment.id == attachment_id))
        ).scalar_one_or_none()
        if row is not None and row.session_id is None:
            await db.delete(row)
            await db.commit()
    except Exception:
        await db.rollback()
        log.warning(
            "knowledge_distill_attachment_cleanup_failed",
            attachment_id=str(attachment_id),
        )


# ── Service ───────────────────────────────────────────────────────────────────


class DistillDispatchService:
    """知识蒸馏派发：dispatch（源校验 + mode 分流执行）与 list_tasks。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def dispatch(
        self,
        workspace_id: uuid.UUID,
        user: User,
        *,
        source_type: Literal["session", "change", "quick"],
        source_ref: str | list[str],
        focus: str | None = None,
        mode: Literal["resume", "fresh"] = MODE_FRESH,
        runtime_id: str | None = None,
        agent_type: str | None = None,
        agent_profile_id: str | None = None,
        model: str | None = None,
    ) -> DistillTaskRead:
        """源校验后按 mode 分流执行（resume 续接 / fresh 新建蒸馏会话）。

        返回 DistillTaskRead（任务条 status 以落档 AgentRun 为准；daemon 离线
        时 fresh 路径补建 failed/no_online_daemon 任务条，失败态立即可查）。
        """
        refs = source_ref if isinstance(source_ref, list) else [source_ref]

        workspace = await self._session.get(Workspace, workspace_id)
        if workspace is None:
            raise WorkspaceNotFound(
                "工作区不存在，请刷新后重试。",
                details={"workspace_id": str(workspace_id)},
            )
        spec_ws = await self._get_spec_workspace(workspace_id)
        # 提前取原始值：create_session 失败路径会 rollback 请求级 session，
        # ORM 行属性过期后再访问会触发 MissingGreenlet（异步懒加载禁区）。
        spec_strategy = spec_ws.strategy
        spec_profile_version = spec_ws.profile_version
        # D-008：session 源校验后保留行引用（fresh 导出护栏要用 turn_count）。
        source_session = await self._validate_source(workspace_id, user, source_type, refs, spec_ws)

        # ── mode 分流（D-009）：降级守卫先行，改写 resolved_mode 并记原因 ──
        resolved_mode = mode
        degraded_reason: str | None = None
        resume_session_id: uuid.UUID | None = None
        resume_inject_only = False
        if mode == MODE_RESUME:
            if source_type != "session":
                resolved_mode, degraded_reason = MODE_FRESH, DEGRADE_NOT_SESSION
            else:
                plan = await self._plan_resume(uuid.UUID(refs[0]), user)
                if plan == "degrade_provider":
                    resolved_mode, degraded_reason = MODE_FRESH, DEGRADE_PROVIDER_NO_RESUME
                elif plan == "degrade_status":
                    resolved_mode, degraded_reason = MODE_FRESH, DEGRADE_STATUS_NOT_REOPENABLE
                elif plan == "inject":
                    resume_inject_only = True
                    resume_session_id = uuid.UUID(refs[0])
                else:  # "reopen"
                    resume_session_id = uuid.UUID(refs[0])

        # ── D-008 洞二：spec_dir 回流指引（全来源/全模式统一）─────────────
        # resolve_prompt_spec_root 恒返回 daemon 本地约定路径
        # ~/.sillyhub/daemon/specs/{ws_id}（tar 传输默认，daemon 交互会话启动
        # pull / 结束 postSpecSync 整树双向；knowledge/ 不在排除集 → propose
        # 产物天然回流）。延迟 import：context_builder 依赖面广，防循环。
        from app.core.config import get_settings
        from app.modules.agent.context_builder import resolve_prompt_spec_root

        spec_dir = resolve_prompt_spec_root(str(workspace_id), get_settings())

        # ── D-008 洞一+洞三：fresh 会话源导出附件 + 体量护栏预检 ────────────
        export_name: str | None = None
        fresh_attachment_ids: list[uuid.UUID] | None = None
        if source_type == "session" and resolved_mode == MODE_FRESH:
            assert source_session is not None  # _validate_source 会话源必返
            # 护栏①：turn 预检（洞三）——导出附件撑不起也嚼不完，引导 resume
            # （引擎 SDK 自己管理超长历史与压缩，不走平台导出通道）。
            if source_session.turn_count > DISTILL_MAX_SESSION_TURNS:
                raise DistillSourceInvalid(
                    f"该会话轮数过多（{source_session.turn_count} 轮，单次蒸馏上限 "
                    f"{DISTILL_MAX_SESSION_TURNS} 轮），请改用原会话续接（mode=resume）"
                    "模式，或挑选体量更小的会话。",
                    details={
                        "source_type": source_type,
                        "source_ref": refs[0],
                        "turn_count": source_session.turn_count,
                        "max_turns": DISTILL_MAX_SESSION_TURNS,
                    },
                )
            # 护栏②：附件引擎门控——附件通道仅多模态引擎（claude/pi）可用；
            # 此处预检显式 agent_type/工作区缺省引擎，runtime_id 钉定派生的
            # 引擎由 create_session 附件校验兜底（except 转 422 见下）。
            fresh_provider = agent_type or workspace.default_agent or "claude"
            if not get_provider_caps(fresh_provider)["multimodal"]:
                raise DistillSourceInvalid(
                    f"引擎「{fresh_provider}」不支持会话附件，无法通过附件下发对话记录，"
                    "请改用原会话续接（mode=resume）模式，或选择支持附件的引擎（如 Claude）。",
                    details={
                        "source_type": source_type,
                        "source_ref": refs[0],
                        "provider": fresh_provider,
                    },
                )
            # 取数通道：导出 + 上传（护栏③：总字节超限 422）。
            transcript, _total_rows = await _export_session_transcript(
                self._session, source_session.id
            )
            data = transcript.encode("utf-8")
            if len(data) > DISTILL_EXPORT_MAX_BYTES:
                raise DistillSourceInvalid(
                    f"会话记录导出超过单次蒸馏上限（{DISTILL_EXPORT_MAX_BYTES // (1024 * 1024)}MB），"
                    "请改用原会话续接（mode=resume）模式，或挑选体量更小的会话。",
                    details={
                        "source_type": source_type,
                        "source_ref": refs[0],
                        "export_bytes": len(data),
                        "limit_bytes": DISTILL_EXPORT_MAX_BYTES,
                    },
                )
            attachment = await _upload_distill_source(
                self._session, user.id, source_session.id, data
            )
            export_name = attachment.name
            fresh_attachment_ids = [attachment.id]

        prompt = build_distill_prompt(
            source_type,
            source_ref if source_type == "quick" else refs[0],
            focus,
            for_resume=(resolved_mode == MODE_RESUME),
            export_name=export_name,
            spec_dir=spec_dir,
        )

        log.info(
            "knowledge_distill_dispatch",
            workspace_id=str(workspace_id),
            source_type=source_type,
            source_ref=refs if len(refs) > 1 else refs[0],
            mode=resolved_mode,
            degraded_reason=degraded_reason,
        )

        base_meta: dict = {
            "kind": DISTILL_RUN_KIND,
            "source_type": source_type,
            "source_ref": source_ref if source_type == "quick" else refs[0],
            "focus": focus,
            "mode": resolved_mode,
        }
        if degraded_reason is not None:
            base_meta["degraded_reason"] = degraded_reason

        # ── 执行：resume 续接 / fresh 新建 ────────────────────────────────
        if resolved_mode == MODE_RESUME:
            assert resume_session_id is not None
            svc = self._session_service()
            if not resume_inject_only:
                await svc.reopen_session(resume_session_id, user.id)
            try:
                result = await svc.inject_session(resume_session_id, user.id, prompt=prompt)
            except DaemonSessionNotActive as exc:
                # reconnecting 恢复窗口重试（ql-20260918-001）：reconnecting ∈
                # ACTIVE 使 plan 判 inject，但 inject 硬校验仅放行 active——恢复
                # 中会话一次点击报「not active (status=reconnecting)」需二连点。
                # 窗口内轮询等 daemon 恢复（reconnecting→active 通常秒级）后重试
                # inject；超窗仍卡住说明恢复停滞（daemon 离线等），语义化引导
                # 而非裸抛（此时降级 fresh 也无意义——daemon 不在线同样失败）。
                session = await svc.get_agent_session(resume_session_id, user.id)
                if session is not None and session.status == "reconnecting":
                    log.info(
                        "knowledge_distill_resume_reconnect_wait",
                        session_id=str(resume_session_id),
                    )
                    if await self._wait_session_reconnect(svc, resume_session_id, user.id):
                        result = await svc.inject_session(resume_session_id, user.id, prompt=prompt)
                    else:
                        raise DistillSourceInvalid(
                            "原会话正在恢复中（daemon 重连较慢），请稍等片刻重试，"
                            "或改用「新建 agent」模式派发。",
                            details={
                                "source_type": source_type,
                                "source_ref": refs[0],
                                "session_status": "reconnecting",
                            },
                        ) from exc
                else:
                    raise
            run = await self._mark_task_run(
                workspace_id,
                base_meta,
                spec_strategy,
                spec_profile_version,
                agent_run=result.agent_run,
                agent_session=result.agent_session,
            )
            return _to_task_read(run)

        # fresh：prompt 首行带「提炼」前缀（D-010③ title 载体）；provider/model
        # 取请求显式值，缺省回落 workspace.default_agent/default_model（对齐
        # 旧 bootstrap 路径兜底，零回归）。会话源另带导出附件（D-008 洞一：
        # attachment_ids → daemon deliver=disk 落盘 {cwd}/attachments/）。
        fresh_prompt = "【提炼】请执行以下知识沉淀任务。\n\n" + prompt
        svc = self._session_service()
        try:
            result = await _create_session(
                svc,
                user.id,
                provider=agent_type or workspace.default_agent or "claude",
                prompt=fresh_prompt,
                model=model if model is not None else workspace.default_model,
                workspace_id=workspace_id,
                runtime_id=runtime_id,
                agent_profile_id=agent_profile_id,
                origin=DISTILL_SESSION_ORIGIN,
                attachment_ids=fresh_attachment_ids,
            )
        except DaemonSessionAttachmentsUnsupported as exc:
            # D-008 护栏②兜底：runtime_id 钉定派生的引擎非多模态（dispatch 预检
            # 只覆盖显式 agent_type / 工作区缺省引擎）——create_session 附件
            # 校验先于任何写库（_resolve_create_inputs），无半成品，转蒸馏源
            # 422 语义并给 resume 引导。
            log.warning(
                "knowledge_distill_attachments_unsupported",
                workspace_id=str(workspace_id),
                source_type=source_type,
                error=str(exc),
            )
            # ql-20260918-006（M5）：导出附件已上传，失败即回收草稿行
            for attachment_id in fresh_attachment_ids or []:
                await _cleanup_distill_attachment(self._session, attachment_id)
            raise DistillSourceInvalid(
                "所选运行时引擎不支持会话附件，无法通过附件下发对话记录，"
                "请改用原会话续接（mode=resume）模式，或选择支持附件的引擎（如 Claude）。",
                details={"source_type": source_type, "source_ref": refs[0]},
            ) from exc
        except (DaemonRuntimeOffline, NoOnlineDaemonError) as exc:
            # R-05：create_session 已把 session/run/lease 收敛 failed；补建
            # 蒸馏任务条（failed/no_online_daemon）使失败态立即可查。
            log.warning(
                "knowledge_distill_no_online_daemon",
                workspace_id=str(workspace_id),
                source_type=source_type,
                error=str(exc),
            )
            # ql-20260918-006（M5）：导出附件已上传，失败即回收草稿行
            for attachment_id in fresh_attachment_ids or []:
                await _cleanup_distill_attachment(self._session, attachment_id)
            run = await self._new_tracking_run(
                workspace_id,
                base_meta,
                spec_strategy=spec_strategy,
                spec_profile_version=spec_profile_version,
                status="failed",
                error_code="no_online_daemon",
            )
            return _to_task_read(run)
        run = await self._mark_task_run(
            workspace_id,
            base_meta,
            spec_strategy,
            spec_profile_version,
            agent_run=result.agent_run,
            agent_session=result.agent_session,
        )
        return _to_task_read(run)

    async def list_tasks(self, workspace_id: uuid.UUID) -> list[DistillTaskRead]:
        """该工作区的 knowledge-distill 类任务，按 created_at 倒序。

        过滤口径 = AgentRunWorkspace 关联 + ``metadata_.kind == knowledge-distill``
        （其它 AgentRun 不混入）；source_type/source_ref/mode/agent_session_id/
        merged_to/degraded_reason 自 metadata_ 投影。
        """
        stmt = (
            select(AgentRun)
            .join(
                AgentRunWorkspace,
                AgentRunWorkspace.agent_run_id == AgentRun.id,
            )
            .where(AgentRunWorkspace.workspace_id == workspace_id)
            .order_by(AgentRun.created_at.desc())
        )
        runs = list((await self._session.execute(stmt)).scalars().all())
        return [
            _to_task_read(run)
            for run in runs
            if (run.metadata_ or {}).get("kind") == DISTILL_RUN_KIND
        ]

    # ── 内部 ──────────────────────────────────────────────────────────────

    def _session_service(self):
        """SessionService 实例（lazy import 对齐 _validate_source 先例）。"""
        from app.modules.daemon.session.service import SessionService

        return SessionService(self._session)

    async def _plan_resume(
        self,
        session_id: uuid.UUID,
        user: User,
    ) -> Literal["reopen", "inject", "degrade_provider", "degrade_status"]:
        """续接前置规划（D-009 降级守卫）：返回执行计划或降级决定。

        - provider 无 resume 能力 → degrade_provider（自动降级 fresh）；
        - 进行中会话（pending/active/reconnecting）→ inject（直接发，不 reopen）；
        - 已结束/失败（可 reopen）→ reopen；
        - 其余状态（suspended 等）→ degrade_status（自动降级 fresh）。
        """
        from app.modules.daemon.session.service import ACTIVE_SESSION_STATUSES

        agent_session = await self._session_service().get_agent_session(session_id, user.id)
        if not get_provider_caps(agent_session.provider)["resume"]:
            return "degrade_provider"
        if agent_session.status in ACTIVE_SESSION_STATUSES:
            return "inject"
        if agent_session.status in ("ended", "failed"):
            return "reopen"
        return "degrade_status"

    async def _wait_session_reconnect(
        self,
        svc,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        attempts: int = 5,
        interval_sec: float = 2.0,
    ) -> bool:
        """reconnecting 恢复窗口轮询（ql-20260918-001）。

        等会话翻回 active（daemon 重连恢复通常秒级；RECONNECTING_RETRY_WINDOW
        分钟级，此处只等 10s 常态窗口）。翻回 active → True（调用方重试
        inject）；窗口内变终态（ended/failed 等）或一直 reconnecting → False。
        """
        for _ in range(attempts):
            await asyncio.sleep(interval_sec)
            session = await svc.get_agent_session(session_id, user_id)
            if session is None:
                return False
            if session.status == "active":
                return True
            if session.status != "reconnecting":
                return False
        return False

    async def _mark_task_run(
        self,
        workspace_id: uuid.UUID,
        base_meta: dict,
        spec_strategy: str,
        spec_profile_version: str,
        *,
        agent_run: AgentRun | None,
        agent_session,
    ) -> AgentRun:
        """把实际执行的会话首 run 落档为蒸馏任务条（幂等）。

        优先复用会话真实 run（status 随会话执行如实推进）；无 run（排队等
        边缘形态）时补建跟踪 run（status=running）。metadata_ 合并写入
        （保留既有键如 auto_resume_of），AgentRunWorkspace 关联 find-or-create。
        """
        meta = dict(base_meta)
        meta["agent_session_id"] = str(agent_session.id)
        if agent_run is None:
            return await self._new_tracking_run(
                workspace_id,
                meta,
                spec_strategy=spec_strategy,
                spec_profile_version=spec_profile_version,
                status="running",
            )
        merged = dict(agent_run.metadata_ or {})
        merged.update(meta)
        agent_run.metadata_ = merged
        self._session.add(agent_run)
        link = (
            (
                await self._session.execute(
                    select(AgentRunWorkspace).where(
                        AgentRunWorkspace.agent_run_id == agent_run.id,
                        AgentRunWorkspace.workspace_id == workspace_id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if link is None:
            self._session.add(
                AgentRunWorkspace(agent_run_id=agent_run.id, workspace_id=workspace_id)
            )
        await self._session.commit()
        await self._session.refresh(agent_run)
        return agent_run

    async def _new_tracking_run(
        self,
        workspace_id: uuid.UUID,
        meta: dict,
        *,
        spec_strategy: str,
        spec_profile_version: str,
        status: str,
        error_code: str | None = None,
    ) -> AgentRun:
        """无会话 run 可用时补建的蒸馏跟踪 AgentRun（离线失败/排队边缘形态）。

        独立 DB session 落库（旧后台派发任务同款）——create_session 失败路径
        可能已 rollback/污染请求级 session，复用有风险；任务条只需 INSERT，
        不自增竞态面。
        """
        from app.core.db import get_session_factory

        factory = get_session_factory()
        async with factory() as session:
            run = AgentRun(
                id=uuid.uuid4(),
                task_id=None,
                lease_id=None,
                agent_type="claude_code",
                provider="claude",
                model=None,
                status=status,
                error_code=error_code,
                spec_strategy=spec_strategy,
                profile_version=spec_profile_version,
                metadata_=meta,
                finished_at=datetime.now(UTC) if status == "failed" else None,
                exit_code=1 if status == "failed" else None,
                output_redacted="no online daemon" if error_code else None,
            )
            session.add(run)
            await session.commit()
            await session.refresh(run)
            session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=workspace_id))
            await session.commit()
        # expire_on_commit=False（app/core/db.py）——出 session 后属性可读。
        return run

    async def _validate_source(
        self,
        workspace_id: uuid.UUID,
        user: User,
        source_type: Literal["session", "change", "quick"],
        refs: list[str],
        spec_ws: SpecWorkspace,
    ) -> AgentSession | None:
        """源校验（只读复用既有服务，不改其签名）。

        不存在的会话/变更沿既有 404 语义（DaemonSessionNotFound /
        ChangeNotFound）；存在但不满足条件（无记录会话 / 未归档变更 / ql 文件
        缺失）→ 422。session/change 仅支持单条来源；quick 支持多条（D-010②）。

        D-008：session 源返回 ``AgentSession`` 行（dispatch 的 fresh 导出护栏
        读 turn_count）；其余来源返回 None。
        """
        if source_type == "session":
            if len(refs) != 1:
                raise DistillSourceInvalid(
                    "会话来源仅支持单条，请从会话列表选择一个会话。",
                    details={"source_type": source_type, "source_ref": refs},
                )
            try:
                session_id = uuid.UUID(refs[0])
            except ValueError as exc:
                raise DistillSourceInvalid(
                    "会话引用不合法，请从会话列表选择。",
                    details={"source_type": source_type, "source_ref": refs[0]},
                ) from exc
            from app.modules.daemon.session.service import SessionService

            agent_session = await SessionService(self._session).get_agent_session(
                session_id, user.id
            )
            if agent_session.turn_count <= 0:
                raise DistillSourceInvalid(
                    "该会话还没有对话记录，无内容可提炼。",
                    details={"source_type": source_type, "source_ref": refs[0]},
                )
            return agent_session
        elif source_type == "change":
            if len(refs) != 1:
                raise DistillSourceInvalid(
                    "变更来源仅支持单条，请选择一个已归档变更。",
                    details={"source_type": source_type, "source_ref": refs},
                )
            from app.modules.change.service import ChangeService

            change = await ChangeService(self._session).get_by_key(workspace_id, refs[0])
            if change.status != "archived":
                raise DistillSourceInvalid(
                    "仅已归档（archived）变更支持提炼，请先完成归档。",
                    details={
                        "source_type": source_type,
                        "source_ref": refs[0],
                        "status": change.status,
                    },
                )
            return None
        elif source_type == "quick":
            # ql-20260918-006（M4）：ref 白名单校验先于存在性检查——ref 会原样
            # 拼进给 agent 的读取路径（build_distill_prompt），"../" 形态可把读取
            # 路径指到 quicklog 目录外（存在性检查 (dir / f"{ref}.md") 对 .. 不
            # 设防）。合法形态 = ql-id 风格：字母数字开头，仅含 字母数字/./_/-。
            for ref in refs:
                if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", ref):
                    raise DistillSourceInvalid(
                        f"快速修复日志引用 '{ref}' 不合法（仅允许字母数字开头的"
                        " 字母数字/./_/- 组合），请从快速修复列表选择。",
                        details={"source_type": source_type, "source_ref": ref},
                    )
            # D-010②：ql 是 spec 树文件条目（<spec_root>/quicklog/<ql-id>.md），
            # 逐条校验存在性；缺失任一条即 422（与 parser 读取口径同根）。
            quicklog_dir = Path(spec_ws.spec_root) / "quicklog"
            for ref in refs:
                if not (quicklog_dir / f"{ref}.md").is_file():
                    raise DistillSourceInvalid(
                        f"快速修复日志 '{ref}' 不存在，请从快速修复列表选择。",
                        details={"source_type": source_type, "source_ref": ref},
                    )
            return None
        else:  # schema Literal 已约束；service 层兜底防直调绕过。
            raise DistillSourceInvalid(
                "来源类型仅支持 session / change / quick。",
                details={"source_type": source_type},
            )

    async def _get_spec_workspace(self, workspace_id: uuid.UUID) -> SpecWorkspace:
        stmt = select(SpecWorkspace).where(
            SpecWorkspace.workspace_id == workspace_id,
        )
        result = (await self._session.execute(stmt)).scalars().first()
        if result is None:
            raise SpecWorkspaceNotFound(
                "未找到该工作区对应的 spec 工作区。",
                details={"workspace_id": str(workspace_id)},
            )
        return result


def _to_task_read(run: AgentRun) -> DistillTaskRead:
    """AgentRun + metadata_ → DistillTaskRead 投影。"""
    meta = run.metadata_ or {}
    raw_ref = meta.get("source_ref", "")
    raw_session = meta.get("agent_session_id")
    return DistillTaskRead(
        agent_run_id=run.id,
        source_type=str(meta.get("source_type", "")),
        source_ref=",".join(raw_ref) if isinstance(raw_ref, list) else str(raw_ref),
        status=run.status,
        created_at=run.created_at,
        mode=str(meta.get("mode", MODE_FRESH)),
        agent_session_id=uuid.UUID(raw_session) if raw_session else None,
        merged_to=meta.get("merged_to"),
        degraded_reason=meta.get("degraded_reason"),
    )


# ── 延迟解析符号（对齐 create.py 的 ``_svc.`` 延迟解析惯例，便测试 patch）──────
# create_session 模块函数与离线异常在模块尾部绑定，monkeypatch 点即本模块属性。
# DaemonSessionAttachmentsUnsupported：runtime_id 派生引擎非多模态的附件门控
# 兜底（D-008 护栏②兜底分支）。
from app.modules.agent.placement import NoOnlineDaemonError  # noqa: E402
from app.modules.daemon.runtime.service import DaemonRuntimeOffline  # noqa: E402
from app.modules.daemon.session.service.create import (  # noqa: E402
    create_session as _create_session,
)
from app.modules.daemon.session.service.errors import (  # noqa: E402
    DaemonSessionAttachmentsUnsupported,
    DaemonSessionNotActive,
)
