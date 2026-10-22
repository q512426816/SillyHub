"""一次性运维脚本：从引擎原始会话 JSONL 回灌丢失的会话轮次。

背景（2026-10-22 生产事故）：会话 ``bbdbecc9-abea-46a3-b0d9-81c22a582675``
因 reparse 物理删除 4 个 change 行，``agent_runs.change_id`` 的
``ON DELETE CASCADE`` 把锚定在这些变更上的 13 轮 run 与日志级联物理删除；
``agent_sessions.turn_count`` 未回退，左栏显示 59 轮而时间线只剩 46 轮。

根因修复见 ``2026-10-22-change-delete-session-history-fix``（FK 改 SET NULL +
reparse 删前解绑）。本脚本负责**数据恢复**：从 daemon 机器上的 Claude Code
原始会话 JSONL（经 ``/api/agent-logs/{id}/messages`` 归一化导出）按 ``turn_id``
重建 ``agent_runs`` + ``agent_run_logs``。

用法（在 backend/ 目录，或容器内 /app）：

    uv run python scripts/restore_lost_session_turns.py \
        --session bbdbecc9-abea-46a3-b0d9-81c22a582675 \
        --jsonl /tmp/recovered_turns_10_22.jsonl \
        --turn-ids 10-22

    # 确认计划无误后加 --apply 真正写库
    uv run python scripts/restore_lost_session_turns.py ... --turn-ids 10-22 --apply

幂等：run id = uuid5(session_id, turn_id)，日志 dedup_key =
``restore:{turn}:{idx}:{seq}:{channel}``，重复执行只补缺不重复插入。

映射与线上 daemon 上报格式对齐（``_persist_agent_event``）：
``user_input``→``user_input``；``reply``→``stdout`` ``[ASSISTANT] …``；
``thinking``→``stdout`` ``[THINKING] …``；``tool_use``→``stdout``
``[TOOL_USE] …`` + ``tool_call`` JSON；``tool_result``→``stdout``
``[TOOL_RESULT] …``。回灌 run 的 ``change_id`` 恒为 NULL（历史轮不再被任何
change 删除波及），``metadata.restored_from`` 标记来源便于回收。
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import sys
import uuid
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# scripts/ 不是包：直接执行时 sys.path[0] 是 scripts 目录，`import app` 不可达
# （对齐 reset_agent_log_attribution.py 先例）。
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.agent.tool_kind import classify_tool_kind

# 独立进程只 import agent 模块时，AgentRun/AgentSession 外键指向的目标表
# （tasks / worktree_leases / changes / daemon_runtimes / daemon_task_leases /
# agent_profiles / tool_policies 等）不在 SQLAlchemy metadata，flush 排序会抛
# NoReferencedTableError（生产实测缺一个报一个，逐个补不可维护）。对齐
# migrations/env.py 的 eager import 清单全量注册——env.py 新增模型模块时此处
# 同步追加。SQLAlchemy 在 flush 时才解析 FK 目标表，故循环置于 import 之后即可。
_MODEL_MODULES: tuple[str, ...] = (
    "app.modules.admin.model",
    "app.modules.agent.model",
    "app.modules.agent.profile.model",
    "app.modules.auth.model",
    "app.modules.change.model",
    "app.modules.daemon.model",
    "app.modules.daemon.audit.model",
    "app.modules.daemon.grants.model",
    "app.modules.file.model",
    "app.modules.git_gateway.model",
    "app.modules.git_identity.model",
    "app.modules.incident.model",
    "app.modules.llm_provider.model",
    "app.modules.mcp_gateway.model",
    "app.modules.mcp_registry.model",
    "app.modules.notification.model",
    "app.modules.platform_sync.model",
    "app.modules.ppm.kanban.model",
    "app.modules.ppm.plan.model",
    "app.modules.ppm.problem.model",
    "app.modules.ppm.project.model",
    "app.modules.ppm.task.model",
    "app.modules.release.model",
    "app.modules.scan_docs.conflict_model",
    "app.modules.scan_docs.model",
    "app.modules.settings.model",
    "app.modules.skill_source.model",
    "app.modules.skills.model",
    "app.modules.spec_profile.model",
    "app.modules.spec_workspace.model",
    "app.modules.task.model",
    "app.modules.tool_gateway.model",
    "app.modules.tool_gateway.tool_policy",
    "app.modules.workflow.model",
    "app.modules.workspace.member_runtimes.model",
    "app.modules.workspace.model",
    "app.modules.worktree.model",
)
for _module_name in _MODEL_MODULES:
    importlib.import_module(_module_name)

RESTORE_MARKER = "agent-log-jsonl"
RESTORE_NAMESPACE = uuid.UUID("7f0b2f4e-5c1d-4a8e-9f3c-2b6a1d8e4c70")
CONTENT_MAX = 50_000
THINKING_MAX = 20_000


def parse_turn_ids(spec: str) -> set[int]:
    """解析 ``10-22`` / ``10,12,15`` / ``10-12,15`` 形态的轮次集合。"""
    turn_ids: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start, end = part.split("-", 1)
            first, last = int(start), int(end)
            if last < first:
                raise ValueError(f"轮次区间非法：{part}")
            turn_ids.update(range(first, last + 1))
        else:
            turn_ids.add(int(part))
    if not turn_ids:
        raise ValueError("--turn-ids 不能为空")
    return turn_ids


def load_messages(path: Path) -> list[dict[str, Any]]:
    """读取归一化 agent-log JSONL（每行一条消息），保持文件内既有顺序。"""
    messages: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as fh:
        for line_no, raw in enumerate(fh, 1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                item = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_no} JSON 解析失败：{exc}") from exc
            if isinstance(item, dict):
                messages.append(item)
    if not messages:
        raise ValueError(f"{path} 没有可用消息")
    return messages


def group_turns(
    messages: list[dict[str, Any]], turn_ids: set[int]
) -> dict[int, list[dict[str, Any]]]:
    """按 ``turn_id`` 分组并只保留目标轮次；文件顺序即轮内顺序。"""
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for message in messages:
        try:
            turn_id = int(message.get("turn_id"))
        except (TypeError, ValueError):
            continue
        if turn_id in turn_ids:
            grouped[turn_id].append(message)
    missing = sorted(turn_ids - grouped.keys())
    if missing:
        raise ValueError(f"JSONL 中缺少轮次：{missing}")
    return dict(grouped)


def _parse_ts(value: Any) -> datetime:
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
        except ValueError:
            pass
    return datetime.now(UTC)


def _json_args(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def _run_id_for(session_id: uuid.UUID, turn_id: int) -> uuid.UUID:
    return uuid.uuid5(RESTORE_NAMESPACE, f"{session_id}:restore:{turn_id}")


def _agent_event(
    *,
    event_type: str,
    content: str,
    seq: Any,
    ts: datetime,
    engine_session_id: str | None,
    tool_name: str | None = None,
    call_id: str | None = None,
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "event_type": event_type,
        "type": event_type,
        "content": content,
        "seq": seq if isinstance(seq, int) else None,
        "timestamp": ts.isoformat().replace("+00:00", "Z"),
        "session_id": engine_session_id,
        "depth": 0,
        "override": True,
        "metadata": {"restored": True},
    }
    if tool_name:
        event["tool_name"] = tool_name
    if call_id:
        event["call_id"] = call_id
    return event


def build_turn_rows(
    *,
    session_id: uuid.UUID,
    engine_session_id: str | None,
    turn_id: int,
    messages: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """纯函数：把一轮归一化消息映射为 run kwargs 与 log kwargs 列表。"""
    run_id = _run_id_for(session_id, turn_id)
    log_rows: list[dict[str, Any]] = []
    tool_kinds: dict[str, str] = {}
    timestamps: list[datetime] = []
    reply_count = 0

    for idx, message in enumerate(messages):
        kind = message.get("kind")
        ts = _parse_ts(message.get("ts"))
        timestamps.append(ts)
        seq = message.get("seq")
        text = message.get("text")
        text = text if isinstance(text, str) else ""
        tool_use_id = message.get("tool_use_id")
        tool_use_id = tool_use_id if isinstance(tool_use_id, str) else None
        dedup = f"restore:{turn_id}:{idx}:{seq}:{kind}"
        base = {
            "run_id": run_id,
            "timestamp": ts,
            "parent_tool_use_id": None,
            "subagent_type": None,
            "depth": 0,
            "segment_id": None,
        }

        if kind == "user_input":
            log_rows.append(
                {
                    **base,
                    "channel": "user_input",
                    "content_redacted": text[:CONTENT_MAX],
                    "dedup_key": dedup,
                    "tool_kind": None,
                    "edit_patch": None,
                    "metadata_": None,
                }
            )
            continue

        if kind == "reply":
            reply_count += 1
            log_rows.append(
                {
                    **base,
                    "channel": "stdout",
                    "content_redacted": ("[ASSISTANT] " + text)[:CONTENT_MAX],
                    "dedup_key": dedup,
                    "tool_kind": None,
                    "edit_patch": None,
                    "metadata_": {
                        "agent_event": _agent_event(
                            event_type="text",
                            content=text,
                            seq=seq,
                            ts=ts,
                            engine_session_id=engine_session_id,
                        )
                    },
                }
            )
            continue

        if kind == "thinking":
            log_rows.append(
                {
                    **base,
                    "channel": "stdout",
                    "content_redacted": ("[THINKING] " + text[:THINKING_MAX])[:CONTENT_MAX],
                    "dedup_key": dedup,
                    "tool_kind": None,
                    "edit_patch": None,
                    "metadata_": {
                        "agent_event": _agent_event(
                            event_type="thinking",
                            content=text[:THINKING_MAX],
                            seq=seq,
                            ts=ts,
                            engine_session_id=engine_session_id,
                        )
                    },
                }
            )
            continue

        if kind == "tool_use":
            name = message.get("tool_name")
            name = name if isinstance(name, str) and name else "tool"
            raw_input = message.get("tool_input")
            input_text = (
                raw_input
                if isinstance(raw_input, str)
                else json.dumps(raw_input, ensure_ascii=False)
            )
            args = _json_args(raw_input)
            tool_kind = classify_tool_kind(name, args)
            if tool_use_id and tool_kind:
                tool_kinds[tool_use_id] = tool_kind
            call_payload = {
                "tool": name,
                "args": args if args is not None else {"raw": input_text},
                "tool_use_id": tool_use_id,
            }
            # 1) 旧轨文本行（stdout [TOOL_USE] …）
            log_rows.append(
                {
                    **base,
                    "channel": "stdout",
                    "content_redacted": (f"[TOOL_USE] {name}: {input_text}")[:CONTENT_MAX],
                    "dedup_key": dedup + ":stdout",
                    "tool_kind": None,
                    "edit_patch": None,
                    "metadata_": {
                        "agent_event": _agent_event(
                            event_type="tool_use",
                            content=json.dumps(call_payload, ensure_ascii=False),
                            seq=seq,
                            ts=ts,
                            engine_session_id=engine_session_id,
                            tool_name=name,
                            call_id=tool_use_id,
                        )
                    },
                }
            )
            # 2) tool_call 结构化卡（前端工具卡/筛选消费）
            log_rows.append(
                {
                    **base,
                    "channel": "tool_call",
                    "content_redacted": json.dumps(call_payload, ensure_ascii=False)[:CONTENT_MAX],
                    "dedup_key": dedup + ":tool_call",
                    "tool_kind": tool_kind,
                    "edit_patch": None,
                    "metadata_": {
                        "agent_event": _agent_event(
                            event_type="tool_use",
                            content=json.dumps(call_payload, ensure_ascii=False),
                            seq=seq,
                            ts=ts,
                            engine_session_id=engine_session_id,
                            tool_name=name,
                            call_id=tool_use_id,
                        )
                    },
                }
            )
            continue

        if kind == "tool_result":
            result_text = message.get("tool_result")
            result_text = result_text if isinstance(result_text, str) else text
            log_rows.append(
                {
                    **base,
                    "channel": "stdout",
                    "content_redacted": ("[TOOL_RESULT] " + result_text)[:CONTENT_MAX],
                    "dedup_key": dedup,
                    "tool_kind": tool_kinds.get(tool_use_id or ""),
                    "edit_patch": message.get("edit_patch"),
                    "metadata_": {
                        "agent_event": _agent_event(
                            event_type="tool_result",
                            content=result_text,
                            seq=seq,
                            ts=ts,
                            engine_session_id=engine_session_id,
                            call_id=tool_use_id,
                        )
                    },
                }
            )
            continue

    first_ts = min(timestamps) if timestamps else datetime.now(UTC)
    last_ts = max(timestamps) if timestamps else first_ts
    model = next(
        (m.get("model") for m in messages if isinstance(m.get("model"), str) and m.get("model")),
        None,
    )
    run_kwargs: dict[str, Any] = {
        "id": run_id,
        "agent_type": "claude_code",
        "provider": None,  # 调用方用会话 provider 覆盖
        "model": model,
        "status": "completed",
        "spec_strategy": "interactive",
        "agent_session_id": session_id,
        "change_id": None,
        "created_at": first_ts,
        "started_at": first_ts,
        "finished_at": last_ts,
        "num_turns": reply_count,
        "metadata_": {"restored_from": RESTORE_MARKER, "restored_turn_id": turn_id},
    }
    return run_kwargs, log_rows


async def expected_turn_count(db: AsyncSession, session_id: uuid.UUID) -> int:
    """expected = 存在 user_input 日志的 run 数（按 run 去重）。"""
    stmt = (
        select(func.count(distinct(AgentRun.id)))
        .select_from(AgentRun)
        .where(
            AgentRun.agent_session_id == session_id,
            select(AgentRunLog.id)
            .where(
                AgentRunLog.run_id == AgentRun.id,
                AgentRunLog.channel == "user_input",
            )
            .exists(),
        )
    )
    return int((await db.execute(stmt)).scalar_one() or 0)


async def reconcile_turn_count(
    db: AsyncSession, session: AgentSession, *, exact: bool = False
) -> tuple[int, int]:
    """返回 (before, after)。exact=False 只下调虚高；exact=True 对齐为 expected。"""
    before = int(session.turn_count or 0)
    expected = await expected_turn_count(db, session.id)
    after = expected if exact else min(before, expected)
    session.turn_count = after
    db.add(session)
    return before, after


async def restore_turns(
    db: AsyncSession,
    session: AgentSession,
    grouped: dict[int, list[dict[str, Any]]],
    *,
    apply: bool,
    exact_turn_count: bool = True,
) -> dict[str, int]:
    """把分组后的轮次写入 DB。dry-run 只统计；apply 时单事务提交。

    ``session.info["audit_context"]`` 显式登记 actor/workspace，让审计钩子把
    回灌行记入 ``audit_logs``（可追溯）。
    """
    db.info["audit_context"] = {
        "actor_id": session.user_id,
        "workspace_id": session.workspace_id,
    }
    stats = {
        "turns": len(grouped),
        "runs_new": 0,
        "runs_existing": 0,
        "logs_new": 0,
        "logs_existing": 0,
    }
    prepared: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
    for turn_id in sorted(grouped):
        run_kwargs, log_rows = build_turn_rows(
            session_id=session.id,
            engine_session_id=session.agent_session_id,
            turn_id=turn_id,
            messages=grouped[turn_id],
        )
        run_kwargs["provider"] = session.provider
        prepared.append((run_kwargs, log_rows))
        existing_run = await db.get(AgentRun, run_kwargs["id"])
        if existing_run is None:
            stats["runs_new"] += 1
            if apply:
                db.add(AgentRun(**run_kwargs))
        else:
            stats["runs_existing"] += 1

    if apply and stats["runs_new"]:
        await db.flush()

    for run_kwargs, log_rows in prepared:
        run_id = run_kwargs["id"]
        existing_keys = set(
            (
                await db.execute(
                    select(AgentRunLog.dedup_key).where(
                        AgentRunLog.run_id == run_id,
                        col(AgentRunLog.dedup_key).is_not(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        for log_kwargs in log_rows:
            if log_kwargs["dedup_key"] in existing_keys:
                stats["logs_existing"] += 1
                continue
            stats["logs_new"] += 1
            if apply:
                log_kwargs["id"] = uuid.uuid4()
                db.add(AgentRunLog(**log_kwargs))

    if apply:
        await db.flush()
        _before, after = await reconcile_turn_count(db, session, exact=exact_turn_count)
        await db.commit()
        stats["turn_count_after"] = after
    else:
        stats["turn_count_after"] = int(session.turn_count or 0)
    return stats


def _print_stats(title: str, stats: dict[str, int]) -> None:
    print(title)
    for key in (
        "turns",
        "runs_new",
        "runs_existing",
        "logs_new",
        "logs_existing",
        "turn_count_after",
    ):
        if key in stats:
            print(f"  {key}: {stats[key]}")


async def main() -> int:
    parser = argparse.ArgumentParser(
        description="从引擎原始会话 JSONL 回灌丢失的会话轮次（默认 dry-run）"
    )
    parser.add_argument("--session", required=True, help="目标平台会话 UUID")
    parser.add_argument("--jsonl", required=True, help="归一化 agent-log JSONL 路径")
    parser.add_argument("--turn-ids", required=True, help="轮次集合，如 10-22 或 10,12,15")
    parser.add_argument("--apply", action="store_true", help="实际写库（缺省只打印计划）")
    parser.add_argument(
        "--no-sync-turn-count",
        action="store_true",
        help="apply 后不把目标会话 turn_count 对齐为实际值（默认对齐）",
    )
    args = parser.parse_args()

    try:
        session_id = uuid.UUID(args.session)
        turn_ids = parse_turn_ids(args.turn_ids)
        messages = load_messages(Path(args.jsonl))
        grouped = group_turns(messages, turn_ids)
    except (ValueError, OSError) as exc:
        print(f"参数/数据错误：{exc}", file=sys.stderr)
        return 2

    from app.core.db import get_session_factory

    factory = get_session_factory()
    async with factory() as db:
        session = await db.get(AgentSession, session_id)
        if session is None or session.deleted_at is not None:
            print(f"目标会话不存在或已软删：{session_id}", file=sys.stderr)
            return 2
        stats = await restore_turns(
            db,
            session,
            grouped,
            apply=args.apply,
            exact_turn_count=not args.no_sync_turn_count,
        )

    _print_stats(
        "dry-run 计划（未改动任何数据）" if not args.apply else "已执行回灌",
        stats,
    )
    if not args.apply:
        print("\n确认无误后加 --apply 执行（单事务）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
