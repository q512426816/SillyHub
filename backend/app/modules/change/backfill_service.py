"""存量 run 变更上下文回填服务（2026-10-12-backfill-run-change-context）。

2026-10-12-run-level-change-attribution 的轮级打锚只对新会话生效：存量会话的
run 无 ``change_id`` 锚，变更执行用量聚合（D-002@v2）对无锚 run 只能走会话链
接摊派——变更列表仍显示同一组会话总和。本服务按会话重放绑定命令游标，把存量
``agent_runs.change_id`` 按时间线补齐，使历史数据按新口径拆分。

游标重放语义与线上 run_sync 通道逐点对齐（FR-01）：

- run 按 ``created_at, id`` 升序；每个 run **先**以当前游标打锚（仅当
  ``change_id IS NULL`` 且游标非空），**再**从该 run 的 sillyspec 命令日志
  （``channel='tool_call'`` 且 ``tool_kind='sillyspec'``，与 submit_steps 收集
  口径同源）解析绑定覆盖游标（同 run 多条取消息序最后一条）——命令所在轮保持
  旧上下文、下一轮才继承，与「submit 时写 current_change_id、inject 建轮时
  读」的运行时时序一致；
- 已锚 run（派发链写入）跳过打锚但命令照常推进游标（FR-02）；
- change_key 按 ``(session.workspace_id, change_key)`` 查 Change 行，查不到
  跳过计数、不建 placeholder（FR-03）；
- 会话处理完且解析出过命令时，游标终值写 ``agent_sessions.current_change_id``
  （FR-04，后续新轮自动接续）。

写集只有 ``agent_runs.change_id``（NULL → 锚）与 ``agent_sessions.current_change_id``
两列；链接表、quicklog、用量数值零触碰（FR-02/03）。全流程幂等：锚只补 NULL，
重跑新增打锚恒 0。
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.change.binding import extract_spec_bindings
from app.modules.change.model import Change, ChangeSessionLink


@dataclass
class BackfillStats:
    """单个会话（或工作区汇总）的回填计数（dry-run / apply 同口径上报）。"""

    runs_scanned: int = 0
    runs_stamped: int = 0
    runs_already_anchored: int = 0
    commands_parsed: int = 0
    commands_skipped_unknown_key: int = 0
    logs_parse_failed: int = 0
    #: 同 run 同 submit 批次（timestamp 并列）解析出不同绑定目标的命令组数
    #: ——批内消息序在 DB 无可靠序号（AgentRunLog 无 seq/created_at 列），终值
    #: 取 timestamp,id 决胜序（id 仅 SQL 确定性，语义取边近似随机，见风险节），
    #: 该计数>0 表示该会话存在理论错锚面（dry-run 报告暴露，人工可查）。
    ambiguous_parallel_groups: int = 0
    cursor_written: bool = False
    cursor_change_id: uuid.UUID | None = None
    unknown_keys: list[str] = field(default_factory=list)

    def merge(self, other: BackfillStats) -> None:
        """工作区汇总：数值相加、布尔取或、unknown_keys 保序去重合并。"""
        self.runs_scanned += other.runs_scanned
        self.runs_stamped += other.runs_stamped
        self.runs_already_anchored += other.runs_already_anchored
        self.commands_parsed += other.commands_parsed
        self.commands_skipped_unknown_key += other.commands_skipped_unknown_key
        self.logs_parse_failed += other.logs_parse_failed
        self.ambiguous_parallel_groups += other.ambiguous_parallel_groups
        self.cursor_written = self.cursor_written or other.cursor_written
        if other.cursor_change_id is not None:
            self.cursor_change_id = other.cursor_change_id
        for key in other.unknown_keys:
            if key not in self.unknown_keys:
                self.unknown_keys.append(key)


def _now() -> datetime:
    return datetime.now(UTC)


# ── 锚点错配扫描/修复（2026-10-13-anchor-mismatch-fix）──────────────────────

#: 主导型信息项阈值：最高占比 ≥80% 且条数 ≥5（仅报告，不自动修——阈值武断性
#: 由人工裁决兜底，design 风险节）。
DOMINANT_SHARE = 0.8
DOMINANT_MIN_COMMANDS = 5


@dataclass
class AnchorMismatch:
    """一致错配/主导型信息项的逐轮记录（报告与修复共用载体）。"""

    run_id: uuid.UUID
    current_anchor: uuid.UUID | None
    target: uuid.UUID
    commands: int
    unknown_keys: int


class ChangeContextBackfillService:
    """存量 run 变更上下文回填（只读解析 + 两列写集，幂等）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── 工作区编排（FR-05：链接是天然范围门）────────────────────────────

    async def linked_session_ids(self, workspace_id: uuid.UUID) -> list[uuid.UUID]:
        """工作区内有 change_session_links 链接的会话 id（去重、按 id 稳定序）。

        命令绑定先建链接（W2.1/W2.2 双通道共同前提），链接即「该会话出现过绑定
        命令」的保守超集——无链接会话天然无命令，跳过省扫。
        """
        rows = (
            await self._session.execute(
                select(ChangeSessionLink.session_id)
                .distinct()
                .where(col(ChangeSessionLink.session_id).is_not(None))
                .join(AgentSession, col(AgentSession.id) == col(ChangeSessionLink.session_id))
                .where(col(AgentSession.workspace_id) == workspace_id)
                .order_by(col(ChangeSessionLink.session_id))
            )
        ).all()
        return [r[0] for r in rows]

    async def backfill_workspace(self, workspace_id: uuid.UUID) -> BackfillStats:
        """工作区内全部链接会话逐一回填，计数汇总。"""
        total = BackfillStats()
        for session_id in await self.linked_session_ids(workspace_id):
            total.merge(await self.backfill_session(session_id))
        return total

    # ── 锚点错配扫描/修复（FR-01..03）────────────────────────────────────

    async def scan_anchor_mismatches(
        self, workspace_id: uuid.UUID
    ) -> tuple[list[AnchorMismatch], list[AnchorMismatch]]:
        """扫描工作区交互轮的锚点错配（只读，零写库）。

        判定基于每轮**全部已解析**绑定命令（unknown key 计数呈现、不参与判定）：

        - 一致错配：已解析命令 ≥1 条、全部指向同一变更 X、且轮锚 != X（含无
          锚轮）——「整个变更生命周期发生在单轮内」的实测形态；
        - 主导型信息项：指向 ≥2 个变更、最高占比 ≥DOMINANT_SHARE 且条数
          ≥DOMINANT_MIN_COMMANDS、最高目标 != 轮锚——仅报告人工裁决
          （巨轮类形态，自动修阈值武断，design 风险节）。

        混合指向但未达主导阈值、或最高目标恰为轮锚的轮：不进任何清单（切换轮
        ≤1 轮误差既有裁决）。批量两条查询（交互轮 + 命令日志 JOIN），零 N+1。
        """
        runs = (
            await self._session.execute(
                select(AgentRun.id, AgentRun.change_id)
                .select_from(AgentRun)
                .join(AgentSession, col(AgentSession.id) == col(AgentRun.agent_session_id))
                .where(
                    col(AgentSession.workspace_id) == workspace_id,
                    col(AgentRun.spec_strategy) == "interactive",
                )
            )
        ).all()
        if not runs:
            return [], []
        run_ids = [r[0] for r in runs]
        anchor_by_run = {r[0]: r[1] for r in runs}
        logs = (
            await self._session.execute(
                select(AgentRunLog.run_id, AgentRunLog.content_redacted).where(
                    col(AgentRunLog.run_id).in_(run_ids),
                    col(AgentRunLog.channel) == "tool_call",
                    col(AgentRunLog.tool_kind) == "sillyspec",
                )
            )
        ).all()
        commands_by_run: dict[uuid.UUID, list[str | None]] = {}
        for rid, content in logs:
            commands_by_run.setdefault(rid, []).append(content)
        change_ids = (
            await self._session.execute(
                select(Change.change_key, Change.id).where(col(Change.workspace_id) == workspace_id)
            )
        ).all()
        id_by_key = {k: i for k, i in change_ids}

        mismatches: list[AnchorMismatch] = []
        dominants: list[AnchorMismatch] = []
        for rid in run_ids:
            contents = commands_by_run.get(rid, [])
            if not contents:
                continue
            unknown = 0
            targets: dict[uuid.UUID, int] = {}
            for content in contents:
                key = _parse_change_key_from_log(content)
                if key is None:
                    if content is not None:
                        unknown += 1
                    continue
                target = id_by_key.get(key)
                if target is None:
                    unknown += 1
                    continue
                targets[target] = targets.get(target, 0) + 1
            if not targets:
                continue
            anchor = anchor_by_run[rid]
            top, top_n = max(targets.items(), key=lambda kv: kv[1])
            if len(targets) == 1:
                if top != anchor:
                    mismatches.append(AnchorMismatch(rid, anchor, top, top_n, unknown))
            elif (
                top_n / sum(targets.values()) >= DOMINANT_SHARE
                and top_n >= DOMINANT_MIN_COMMANDS
                and top != anchor
            ):
                dominants.append(AnchorMismatch(rid, anchor, top, top_n, unknown))
        return mismatches, dominants

    async def fix_anchor_mismatches(self, workspace_id: uuid.UUID) -> int:
        """把一致错配的交互轮重锚到其命令唯一指向的变更（幂等；调用方控制事务）。"""
        mismatches, _dominants = await self.scan_anchor_mismatches(workspace_id)
        for m in mismatches:
            run = await self._session.get(AgentRun, m.run_id)
            if run is None or run.change_id == m.target:
                continue
            run.change_id = m.target
            self._session.add(run)
        await self._session.flush()
        return len(mismatches)

    # ── 单会话游标重放（FR-01..04）──────────────────────────────────────

    async def backfill_session(self, session_id: uuid.UUID) -> BackfillStats:
        """重放单会话游标并打锚（调用方负责事务边界；本方法只 add/flush 不 commit）。"""
        sess = await self._session.get(AgentSession, session_id)
        if sess is None or sess.workspace_id is None:
            return BackfillStats()
        stats = BackfillStats()

        # 命令 change_key → Change.id 解析表（会话工作区 scoped，懒加载缓存）。
        change_id_by_key: dict[str, uuid.UUID | None] = {}

        async def _resolve(change_key: str) -> uuid.UUID | None:
            if change_key not in change_id_by_key:
                change_id_by_key[change_key] = (
                    await self._session.execute(
                        select(Change.id).where(
                            col(Change.workspace_id) == sess.workspace_id,
                            col(Change.change_key) == change_key,
                        )
                    )
                ).scalar_one_or_none()
            return change_id_by_key[change_key]

        # 重放种子恒 None（FR-02 幂等的关键）：锚只由该会话命令历史决定，与
        # 重跑次数无关。若从 sess.current_change_id 起步，重跑会把「首命令所在
        # 轮」（运行时语义必须保持旧上下文）也拖进锚。会话游标是重放的输出
        # （FR-04 终值写回），不是输入。
        cursor: uuid.UUID | None = None
        runs = list(
            (
                await self._session.execute(
                    select(AgentRun)
                    .where(col(AgentRun.agent_session_id) == session_id)
                    .order_by(col(AgentRun.created_at), col(AgentRun.id))
                )
            )
            .scalars()
            .all()
        )
        for run in runs:
            stats.runs_scanned += 1
            # ① 先打锚：仅无锚 run 继承当前游标（命令所在轮保持旧上下文）。
            if run.change_id is not None:
                stats.runs_already_anchored += 1
            elif cursor is not None:
                run.change_id = cursor
                self._session.add(run)
                stats.runs_stamped += 1
            # ② 再推进游标：本 run 的 sillyspec 命令按消息序，最后一条生效。
            # 排序 timestamp → id：同一 submit 批次全部日志行共享 st.now
            # （submit_steps 取一次 now），批内消息序在 DB 无可靠序号（无 seq /
            # created_at 列）——id（uuid4）只保证 SQL 层确定性（幂等重跑同序），
            # 语义上面内「批内多条不同绑定命令」的取边近似随机；并列组计入
            # ambiguous_parallel_groups 显式暴露（dry-run 报告可见，人工可查）。
            logs = list(
                (
                    await self._session.execute(
                        select(
                            AgentRunLog.timestamp,
                            AgentRunLog.id,
                            AgentRunLog.content_redacted,
                        )
                        .where(
                            col(AgentRunLog.run_id) == run.id,
                            col(AgentRunLog.channel) == "tool_call",
                            col(AgentRunLog.tool_kind) == "sillyspec",
                        )
                        .order_by(col(AgentRunLog.timestamp), col(AgentRunLog.id))
                    )
                ).all()
            )
            # 解析全部命令行 → (timestamp, resolved, key)，顺带统计批内并列组。
            entries: list[tuple[datetime, uuid.UUID | None, str | None]] = []
            for ts, _log_id, content in logs:
                key = _parse_change_key_from_log(content)
                if key is None:
                    if content is not None:
                        stats.logs_parse_failed += 1
                    continue
                entries.append((ts, await _resolve(key), key))
            resolved_by_ts: dict[datetime, set[uuid.UUID]] = {}
            for ts, resolved, _key in entries:
                if resolved is not None:
                    resolved_by_ts.setdefault(ts, set()).add(resolved)
            stats.ambiguous_parallel_groups += sum(
                1 for targets in resolved_by_ts.values() if len(targets) > 1
            )
            for _ts, resolved, key in entries:
                if resolved is None:
                    stats.commands_skipped_unknown_key += 1
                    if key not in stats.unknown_keys:
                        stats.unknown_keys.append(key)
                    continue
                stats.commands_parsed += 1
                cursor = resolved

        # FR-04：解析出过命令才写游标终值（后续新轮自动接续）。
        if stats.commands_parsed > 0 and cursor is not None and sess.current_change_id != cursor:
            sess.current_change_id = cursor
            self._session.add(sess)
            stats.cursor_written = True
            stats.cursor_change_id = cursor
        elif stats.commands_parsed > 0:
            stats.cursor_change_id = cursor
        await self._session.flush()
        return stats


def _parse_change_key_from_log(content: str | None) -> str | None:
    """sillyspec 命令日志行 → 绑定 change_key（无绑定返回 None）。

    content 与 submit_steps 收集口径同源（JSON：``args.command``），解析失败 /
    结构不符返回 None（调用方计 parse_failed）；绑定解析复用
    ``extract_spec_bindings``（run/flow 两族同规则，quick/default 无产出），
    多产出取最后一条（与运行时「最后一条生效」一致）。
    """
    if not content:
        return None
    try:
        parsed = json.loads(content)
    except (TypeError, ValueError):
        return None
    args = parsed.get("args") if isinstance(parsed, dict) else None
    command = args.get("command") if isinstance(args, dict) else None
    if not isinstance(command, str) or not command:
        return None
    bindings = extract_spec_bindings(command)
    return bindings[-1].change_key if bindings else None
