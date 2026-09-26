"""变更合成时间线聚合只读服务（2026-09-26-change-real-timeline FR-01）。

复刻 CLI ``sillyspec watcher timeline --change <名>`` 的合成展示到平台——
「真实留痕」三源合成（thin 轻量变更进度不落 sillyspec.db、steps 恒空，
主线叙事由观测事件流承担）：

- 事件轴：``platform_change_events`` 表（watcher 推送，恒 provisional）按
  ``(workspace_id, change_name=change_key, ts)`` 正序直读；
- 诞生锚：归档/在途目录 ``requirements.md`` frontmatter ``created_at``
  （watcher 后拉起时事件流缺诞生事件，工件元数据补位——CLI 同款口径）；
- 任务面：``tasks.md`` ``- [x]/- [ ] task-NN:`` 行（勾选态 + 描述）；
- 提交锚：事件 ``kind=commit`` 的 detail 短哈希 → ``GitLogService.list_commits``
  （daemon RPC，limit 50）sha 前缀匹配标题（best-effort，失败降级仅哈希）；
- 脚注统计：墙钟（首末事件 ts 差）/ 事件数 / 提交数 / 勾选比——纯计算。

红线 D-004 延续：events 表只读、零业务判定（无流程外键、无状态机联动）；
逐源 fail-open——单源缺失降级为空/None，不影响其余段与变更详情主功能。
目录解析复用 ``ChangeAssetsQueryService._resolve_change_dir``（跨服务私有
方法复用先例：assets 对 ChangeService 已同款）。
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ChangeNotFound
from app.core.logging import get_logger
from app.modules.change.assets import ChangeAssetsQueryService
from app.modules.change.model import Change
from app.modules.change.schema import (
    ChangeTimelineRead,
    TimelineEvent,
    TimelineStats,
    TimelineTask,
)
from app.modules.git_log.service import GitLogService
from app.modules.platform_sync.model import PlatformChangeEventORM

log = get_logger(__name__)

# tasks.md 任务行（thin-agent-tasks 机器预填格式，宽容匹配未来描述形态）。
_TASK_LINE_RE = re.compile(r"^\s*-\s+\[( |x)\]\s+(task-\d+)\s*:\s*(.*)$")

# requirements.md frontmatter created_at（诞生锚）。
_BORN_RE = re.compile(r"^created_at:\s*[\"']?([^\"'\n]+)[\"']?\s*$", re.M)


def _read_tasks(change_dir: Path) -> list[tuple[str, bool, str]]:
    """读 ``tasks.md`` 任务行 → ``(task_id, checked, desc)``（缺文件/坏行跳过）。"""
    try:
        text = (change_dir / "tasks.md").read_text(encoding="utf-8")
    except OSError as exc:
        log.info("change.timeline_tasks_unavailable", dir=str(change_dir), error=str(exc))
        return []
    out: list[tuple[str, bool, str]] = []
    for line in text.splitlines():
        m = _TASK_LINE_RE.match(line)
        if m:
            out.append((m.group(2), m.group(1) == "x", m.group(3).strip()))
    return out


def _read_born_at(change_dir: Path) -> str | None:
    """读 ``requirements.md`` frontmatter ``created_at``（缺失 → None）。"""
    try:
        text = (change_dir / "requirements.md").read_text(encoding="utf-8")
    except OSError as exc:
        log.info("change.timeline_born_unavailable", dir=str(change_dir), error=str(exc))
        return None
    m = _BORN_RE.search(text)
    return m.group(1).strip() if m else None


def _parse_ts(ts: str) -> datetime | None:
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


class ChangeTimelineQueryService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_change_timeline(
        self, workspace_id: uuid.UUID, change_id: uuid.UUID, user_id: uuid.UUID
    ) -> ChangeTimelineRead:
        """聚合单变更合成时间线（只读；变更不存在/跨工作区 → ChangeNotFound）。"""
        change = await self._get_change(workspace_id, change_id)
        change_dir = await ChangeAssetsQueryService(self._session)._resolve_change_dir(
            workspace_id, change
        )

        # 事件轴：正序快照（ts 字符串 ISO 字典序=时间序，表注释 R-04 先例）。
        res = await self._session.execute(
            select(PlatformChangeEventORM)
            .where(
                PlatformChangeEventORM.workspace_id == workspace_id,
                PlatformChangeEventORM.change_name == change.change_key,
            )
            .order_by(PlatformChangeEventORM.ts.asc())
        )
        rows = list(res.scalars().all())

        # 提交窗口（best-effort）：commit 事件短哈希 → 标题；任务锚复用同窗口。
        commit_shas = [r.detail for r in rows if r.kind == "commit" and r.detail]
        titles, commit_pairs = await self._load_commit_window(workspace_id, user_id, commit_shas)

        events = [
            TimelineEvent(
                ts=r.ts,
                kind=r.kind,
                label=r.detail or r.kind,
                rule=r.rule,
                severity=r.severity,
                provisional=r.provisional,
                commit_title=titles.get(r.detail or "") if r.kind == "commit" else None,
            )
            for r in rows
        ]
        # 任务面提交锚（CLI 同款「消息含 task token」推断）：倒序取最新命中。
        tasks = [
            TimelineTask(
                id=task_id,
                checked=checked,
                desc=desc,
                commit_sha=next(
                    (short for short, msg in reversed(commit_pairs) if task_id in msg),
                    None,
                ),
            )
            for task_id, checked, desc in _read_tasks(change_dir)
        ]

        stats = TimelineStats(
            event_count=len(rows),
            commit_count=len(commit_shas),
            checked=sum(1 for t in tasks if t.checked),
            total=len(tasks),
            wall_clock_s=self._wall_clock(rows),
        )
        return ChangeTimelineRead(
            change_key=change.change_key,
            born_at=_read_born_at(change_dir),
            events=events,
            tasks=tasks,
            stats=stats,
        )

    async def _load_commit_window(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, shas: list[str]
    ) -> tuple[dict[str, str | None], list[tuple[str, str]]]:
        """git_log 窗口 → (短哈希→标题映射, (short, message) 窗口对列表)。

        daemon 离线/非 git/任何异常 → (全 None 映射, 空窗口)——调用方降级仅哈希
        （best-effort 通道，观测事件卡先例；不阻塞聚合主响应）。
        """
        titles: dict[str, str | None] = {s: None for s in shas}
        if not shas:
            return titles, []
        try:
            commits = await GitLogService(self._session).list_commits(
                workspace_id, user_id, limit=50
            )
        except Exception as exc:
            log.info("change.timeline_git_titles_degraded", error=str(exc))
            return titles, []
        pairs = [
            (c.short or c.hash[:9], (c.message or "").splitlines()[0] if c.message else "")
            for c in commits.commits
        ]
        for sha in shas:
            for short, title in pairs:
                if short.startswith(sha):
                    titles[sha] = title or None
                    break
        return titles, pairs

    @staticmethod
    def _wall_clock(rows: list[PlatformChangeEventORM]) -> int | None:
        """首末事件 ts 差秒数（解析失败/不足两事件 → None）。"""
        if len(rows) < 2:
            return None
        start = _parse_ts(rows[0].ts)
        end = _parse_ts(rows[-1].ts)
        if start is None or end is None:
            return None
        return int((end - start).total_seconds())

    async def _get_change(self, workspace_id: uuid.UUID, change_id: uuid.UUID) -> Change:
        res = await self._session.execute(
            select(Change).where(Change.id == change_id, Change.workspace_id == workspace_id)
        )
        change = res.scalar_one_or_none()
        if change is None:
            raise ChangeNotFound("变更不存在或不属于该工作区")
        return change
