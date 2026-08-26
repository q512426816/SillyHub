"""PlatformSyncService — 进度同步层业务（workspace 隔离 + base_ts 字典序冲突检测）。

严格按跨仓契约 ``sillyhub-progress-sync-contract.md`` §4.2 算法：

- base_ts 空/缺失（None/空串）→ 无条件接受（首次同步/客户端无基准）
- ``stored > base_ts``（ISO 8601 UTC **字符串字典序** §7，不转 datetime）→ 409 冲突，
  返回平台当前完整 ``latest_progress`` 六表，**绝不 auto-merge**（§9 / D-006）
- 否则（stored None 或 stored ≤ base_ts）→ 接受 upsert

workspace 隔离（Change 2026-08-11-change-progress-projection task-06 / D-001@v1）：三方法
首位均带 ``workspace_id``，按 ``(workspace_id, change_name)`` 复合键读写。``workspace_id``
由 router 从 ``require_platform_sync`` token 派生注入（唯一通道，G6），service 内不猜测。
shk_live_ 过渡期 ``workspace_id=None`` → 用 ``is_(None)`` 过滤（SQL ``=`` 不匹配 NULL），
行为与旧版全局聚合等价（R-02）。

读并集聚合（security-audit-remediation task-06 / D-004@v1）：读三方法（list_lightweight
/ get_progress / get_approval_record）加 ``allowed_workspace_ids`` 可选参数——非 None 时
按 ``workspace_id IN (集合) OR workspace_id IS NULL`` 聚合（NULL 桶存量行并入只读兼容，
design §3 兼容策略），替代旧全局桶读语义；为 None 时维持 shpsync_ 单 workspace 原语义
（逐字节回归）。写三方法（upsert_progress / upsert_documents / set_approval）**无此参数**
——写归属只能来自 shpsync_ token 派生的单一 workspace_id，单写者语义不变（D-003@v1
documents 单写者与本变更不冲突）。

后端只存客户端 ``X-SillySpec-Pushed-At`` 原值（R-04：字典序前提，不自造时间戳）。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.model import AgentSession
from app.modules.change.binding import bind_session_to_change, bind_session_to_quicklog
from app.modules.daemon.session_events import publish_sessions_changed
from app.modules.platform_sync.model import (
    AgentSessionLogORM,
    PlatformChangeProgressORM,
    QuicklogEntryORM,
)

if TYPE_CHECKING:
    # 类型标注专用（``from __future__ import annotations`` 惰性求值），运行时零导入。
    from app.modules.platform_sync.schema import AgentLogEntry
    from app.modules.spec_workspace.schema import FileOp

log = get_logger(__name__)

# ── 2026-08-23-agent-activity-sessions task-04（design §3.3.3 / D-007）──
#: harness → tool_report 会话 ``AgentSession.provider`` 映射：激活派发用默认引擎，
#: harness 真实身份由 ``config_snapshot.harness`` 展示（创建时写入）。
_TOOL_REPORT_PROVIDER_BY_HARNESS: dict[str, str] = {
    "claude-code": "claude",
    "codex": "codex",
}


def _tool_report_provider(harness: str) -> str:
    """D-007：claude-code→'claude'、codex→'codex'、其余（zcode 等）→'claude'。"""
    return _TOOL_REPORT_PROVIDER_BY_HARNESS.get(harness, "claude")


# ── 2026-08-25-session-spec-binding task-06（design §5.W2.2/W2.3 / D-003）──
async def _bind_entry_ctx(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change_key: str | None,
    quick_id: str | None,
    target_session_id: uuid.UUID,
) -> None:
    """agent-logs entry ctx → 会话绑定（hub / 聚合两分支共用消费规则）。

    - 两键按 schema 互斥（``schema.py`` AgentLogEntry 注释「互斥：CLI quick
      优先」），并存时以 ``quick_id`` 为准只落 quicklog 绑定（防御 CLI 异常双写；
      聚合分组键虽是 ``change_key or quick_id``，组级绑定仍统一 quick 优先口径）。
    - ``change_key == "default"`` 伪键不在本层判断——``bind_session_to_change``
      内部守卫兜底（D-005@v2 / X-004：命令解析与 agent-logs 两通道统一）。
    - 两 bind 均 savepoint best-effort（失败仅 log.warning 不抛、不自行 commit），
      跟随调用方事务在 ``upsert_agent_log_entries`` 唯一一次 commit 前落盘，
      绑定失败不影响 agent-logs 上报主流程。
    """
    if quick_id:
        await bind_session_to_quicklog(session, workspace_id, quick_id, target_session_id)
    elif change_key:
        await bind_session_to_change(session, workspace_id, change_key, target_session_id)


@dataclass
class PlatformSyncResult:
    """``upsert_progress`` 返回：冲突标志 + 平台当前完整 progress（冲突时供 409 body）。"""

    conflict: bool
    platform_progress: dict[str, Any] | None
    last_pushed_at: str | None


class PlatformSyncService:
    """进度同步聚合业务（``(workspace_id, change_name)`` 复合键隔离，D-001@v1）。

    service 在请求处理函数内实例化、注入 session（conventions：异步会话隔离）。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @staticmethod
    def _workspace_filter(
        workspace_id: uuid.UUID | None,
        allowed_workspace_ids: list[uuid.UUID] | None,
    ) -> ColumnElement[bool]:
        """读查询的 workspace 过滤条件（task-06 / D-004@v1 并集聚合）。

        - ``allowed_workspace_ids`` 非 None（JWT/shk_live_ 读路径）→
          ``workspace_id IN (集合) OR workspace_id IS NULL``——有 CHANGE_READ 权限的
          workspace 并集 + NULL 桶存量行（只读兼容，design §3）。
        - ``workspace_id`` 非 None（shpsync_ 路径）→ 精确匹配（收件箱隔离原语义）。
        - 两者均 None → 仅 NULL 桶（旧全局聚合已关闭，收紧后的默认读域）。
        """
        ws_col = col(PlatformChangeProgressORM.workspace_id)
        if allowed_workspace_ids is not None:
            filters: list[ColumnElement[bool]] = [ws_col.is_(None)]
            if allowed_workspace_ids:
                filters.append(ws_col.in_(allowed_workspace_ids))
            return or_(*filters)
        if workspace_id is not None:
            return ws_col == workspace_id
        return ws_col.is_(None)

    async def _find_row(
        self, workspace_id: uuid.UUID | None, name: str
    ) -> PlatformChangeProgressORM | None:
        """按复合键取行。``workspace_id=None`` 用 ``is_(None)``（SQL ``=`` 不匹配 NULL）。"""
        stmt = select(PlatformChangeProgressORM).where(
            col(PlatformChangeProgressORM.change_name) == name,
            col(PlatformChangeProgressORM.workspace_id).is_(None)
            if workspace_id is None
            else col(PlatformChangeProgressORM.workspace_id) == workspace_id,
        )
        return (await self._session.execute(stmt)).scalar_one_or_none()

    async def upsert_progress(
        self,
        workspace_id: uuid.UUID | None,
        name: str,
        body: dict[str, Any],
        base_ts: str | None,
        pushed_at: str | None,
        user: str | None,
        user_id: uuid.UUID | None = None,
    ) -> PlatformSyncResult:
        """契约 §4.2 base_ts 乐观锁冲突检测 + 接受 upsert（workspace 隔离）。

        ``user_id``（2026-08-16-change-owner-from-token task-02 / D-001@v1）：token
        签发人真实 User id（router 从鉴权 tuple 派生透传）。接受分支在进度 + 占位行
        落定后用其对齐 ``ux_changes.owner_id``（best-effort，失败不阻断）；冲突分支
        不触碰 owner——被拒绝的上行不得改责任人。None 防御（service 直调场景）。
        """
        row = await self._find_row(workspace_id, name)

        # 分支 1：base_ts 空/缺失（None 或空串）→ 首次同步/无基准，无条件接受
        if not base_ts:
            await self._apply(workspace_id, row, name, body, pushed_at, user)
            await self._ensure_change_row(workspace_id, name, body)
            await self._sync_change_owner(workspace_id, name, user_id)
            return PlatformSyncResult(conflict=False, platform_progress=None, last_pushed_at=None)

        # 分支 2：stored 存在 AND stored > base_ts（字符串字典序 §7）→ 冲突
        stored = row.last_pushed_at if row is not None else None
        if stored is not None and stored > base_ts:
            return PlatformSyncResult(
                conflict=True,
                platform_progress=row.latest_progress if row is not None else None,
                last_pushed_at=stored,
            )

        # 分支 3：base_ts 有效（stored None 或 stored ≤ base_ts）→ 接受
        await self._apply(workspace_id, row, name, body, pushed_at, user)
        await self._ensure_change_row(workspace_id, name, body)
        await self._sync_change_owner(workspace_id, name, user_id)
        return PlatformSyncResult(conflict=False, platform_progress=None, last_pushed_at=None)

    async def _apply(
        self,
        workspace_id: uuid.UUID | None,
        row: PlatformChangeProgressORM | None,
        name: str,
        body: dict[str, Any],
        pushed_at: str | None,
        user: str | None,
    ) -> None:
        """接受分支：upsert latest_progress + 元字段（last_pushed_at/last_pusher）。

        并发自愈：sillyspec 客户端新建 change 首推会并发双发，两请求的
        ``_find_row`` 都可能在对方 commit 前返回 None，于是双双走 INSERT，
        第二个 commit 撞复合唯一约束 ``uq_platform_change_progress_workspace_change``
        → 500。这里 catch ``IntegrityError`` 回退 UPDATE（跨方言：SQLite 测试库 /
        PG 生产都抛 IntegrityError，无需 ON CONFLICT 方言分支）。详见 ql-20260811-005-6881。
        """
        if row is not None:
            self._assign(row, body, pushed_at, user)
            await self._session.commit()
            return

        try:
            self._session.add(
                PlatformChangeProgressORM(
                    # 显式 id（D-001@v1 / R-02）：model default=uuid.uuid4 会兜底，
                    # 但显式传入语义更清晰、不依赖 default 触发时机。
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    change_name=name,
                    latest_progress=body,
                    last_pushed_at=pushed_at,
                    last_pusher=user,
                    # D-003@v1 单写者：不传 documents/approval（ORM default None）。
                )
            )
            await self._session.commit()
        except IntegrityError:
            # 并发对手已抢先 INSERT 建行：rollback 清失败事务，重查行改走 UPDATE。
            # 新主键（id PK，D-001@v1 / design §5）下冲突源是 (workspace_id, change_name)
            # 复合唯一约束 uq_platform_change_progress_workspace_change（同 workspace 并发双发），
            # 而非 change_name 单主键；跨 workspace 同名各占一行、不再撞键。
            await self._session.rollback()
            existing = await self._find_row(workspace_id, name)
            if existing is None:
                # platform_sync 无删除路径，理论不发生；重抛让上层感知而非静默丢数据。
                raise
            self._assign(existing, body, pushed_at, user)
            await self._session.commit()

    async def _ensure_change_row(
        self,
        workspace_id: uuid.UUID | None,
        name: str,
        body: dict[str, Any],
    ) -> None:
        """ql-20260815-002：接受上行后确保 ux_changes 有占位行（best-effort）。

        根因：进度上行只写 ``platform_change_progress``，不建 ``ux_changes`` 行，
        而变更中心列表以 ux_changes 为主表 join 进度表——镜像 tar 同步滞后期间
        （CLI 新建 change 后、spec 同步跟上前）新建变更在界面上完全不可见。
        此处在接受分支补一个占位行（字段取自 payload 的 changes[] 同名条目），
        待镜像同步 + reparse 后由真实扫描结果接管（_apply_parsed 覆盖）。

        - ``workspace_id=None``：无法定位 workspace，跳过（与进度收件箱隔离一致，
          service 内不猜 workspace）。task-06（D-004@v1）后写端点仅 shpsync_ 可达
          （workspace_id 恒非 None），此分支仅防御 service 直调场景。
        - 幂等：已存在同 ``(workspace_id, change_key)`` 行则直接返回。
        - 并发兜底：savepoint 内 flush 撞 ``ux_changes_workspace_key`` 唯一约束
          → 回滚 savepoint 静默放弃（对端已建行，语义等价）。
        - best-effort：占位失败只记日志，不阻断进度上行主流程。
        """
        if workspace_id is None:
            return
        from app.modules.change.model import Change

        existing = (
            await self._session.execute(
                select(Change).where(
                    col(Change.workspace_id) == workspace_id,
                    col(Change.change_key) == name,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return

        info = next(
            (
                c
                for c in (body.get("changes") or [])
                if isinstance(c, dict) and c.get("name") == name
            ),
            {},
        )
        row = Change(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            change_key=name,
            title=info.get("title") or name,
            status="draft",
            location="active",
            # platform-managed 镜像扁平布局（无 .sillyspec/ 包裹），与 parser
            # rel_prefix 一致；镜像目录尚未同步时文件树为空，属预期占位态。
            path=f"changes/{name}",
            current_stage=info.get("current_stage"),
            updated_at=datetime.now(UTC),
        )
        try:
            async with self._session.begin_nested():
                self._session.add(row)
                await self._session.flush()
        except IntegrityError:
            await self._session.rollback()
            log.info(
                "platform_sync.placeholder_change_race_lost",
                workspace_id=str(workspace_id),
                change_key=name,
            )
            return
        await self._session.commit()
        log.info(
            "platform_sync.placeholder_change_created",
            workspace_id=str(workspace_id),
            change_key=name,
        )

    async def _sync_change_owner(
        self,
        workspace_id: uuid.UUID | None,
        name: str,
        user_id: uuid.UUID | None,
    ) -> None:
        """接受分支把 ``ux_changes.owner_id`` 对齐 token 签发人（best-effort）。

        2026-08-16-change-owner-from-token task-02 / D-001@v1（design §5 Phase 1.2，
        含 Grill P1-2 事务边界修正）：责任人的最可靠来源是进度上行 token 的签发人，
        每次接受的上行以最新为准 diff 更新 owner。``_apply`` 与 ``_ensure_change_row``
        各自内部 commit（独立已提交单元，不强求同事务），本方法只在其后调用。

        - savepoint 原子（``_ensure_change_row`` :239-249 范式同构）：内部 SELECT
          重查 Change 行拿 id——``_ensure_change_row`` race-lost 路径不返回行对象，
          绝不依赖上游传行；重查无行（理论不发生，占位已兜底）直接 return。
        - 三分支：``owner_id is None`` → 仅 UPDATE 首填（占位行首填非"变化"，不记
          事件）；``owner_id != user_id`` → UPDATE + INSERT 一条 ``owner_change``
          事件（``detail={from_user_id, to_user_id}`` 逐字，task-04 读侧消费契约）；
          相同 → 幂等零写（owner_id 现值判据天然拦截同值重试与 A→B→A 重复段，R-01）。
        - best-effort：savepoint 内任一步失败仅回滚 + log.warning 不阻断上行——
          ``_apply`` 已 commit 的进度行/占位行永不被 owner 失败吞掉。
        - 幂等口径 = owner_id 现值复查，无唯一约束（R-01：短期并发重复可接受）。
        """
        if workspace_id is None or user_id is None:
            return
        from app.modules.change.model import Change, ChangeEventORM

        try:
            async with self._session.begin_nested():
                row = (
                    await self._session.execute(
                        select(Change).where(
                            col(Change.workspace_id) == workspace_id,
                            col(Change.change_key) == name,
                        )
                    )
                ).scalar_one_or_none()
                if row is None:
                    return
                if row.owner_id is None:
                    # 占位行首填：只 UPDATE owner（非"变化"语义，不记事件）。
                    row.owner_id = user_id
                elif row.owner_id != user_id:
                    old_owner = row.owner_id
                    row.owner_id = user_id
                    self._session.add(
                        ChangeEventORM(
                            id=uuid.uuid4(),
                            workspace_id=workspace_id,
                            change_id=row.id,
                            event_type="owner_change",
                            detail={
                                "from_user_id": str(old_owner),
                                "to_user_id": str(user_id),
                            },
                            created_by=user_id,
                        )
                    )
                    await self._session.flush()
                # 相同 → 幂等零写，savepoint 空提交（无 DML）。
        except Exception:
            await self._session.rollback()
            log.warning(
                "platform_sync.change_owner_sync_failed",
                workspace_id=str(workspace_id),
                change_key=name,
            )
            return
        await self._session.commit()

    @staticmethod
    def _assign(
        row: PlatformChangeProgressORM,
        body: dict[str, Any],
        pushed_at: str | None,
        user: str | None,
    ) -> None:
        """UPDATE 共用：定向列覆盖 latest_progress + 元字段 + 刷新 updated_at。

        D-003@v1 单写者（2026-08-14-platform-sync-docs-approval）：绝不触碰
        documents/approval 列（POST documents / POST approval 各自写）。
        """
        row.latest_progress = body
        row.last_pushed_at = pushed_at
        row.last_pusher = user
        row.updated_at = datetime.now(UTC)

    async def list_lightweight(
        self,
        workspace_id: uuid.UUID | None,
        allowed_workspace_ids: list[uuid.UUID] | None = None,
    ) -> list[dict[str, Any]]:
        """GET /changes 轻量列表（契约 §5，按 workspace 过滤）。

        ``current_stage`` 取自裸六表 ``latest_progress.changes[0].current_stage``
        （sync.js:592 客户端按键识别）。防御性 isinstance：裸 JSON 结构可能异常。
        ``workspace_id=None`` + ``allowed_workspace_ids=None`` → 仅 NULL 桶（task-06
        前是全局聚合，已关闭）；``allowed_workspace_ids`` 非 None → 并集 + NULL 桶。
        """
        stmt = select(PlatformChangeProgressORM).where(
            self._workspace_filter(workspace_id, allowed_workspace_ids)
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        items: list[dict[str, Any]] = []
        for row in rows:
            # 占位行守卫（design §4.3 / Grill UB-1）：latest_progress 无值（仅
            # documents/approval 有值）的行不出现在列表——对 CLI pullList 维持
            # 「无进度」语义。用 Python 判断而非 SQL IS NOT NULL：SQLAlchemy JSON
            # 列缺省在 SQLite 落 JSON 编码的 'null' 字符串（非 SQL NULL），跨方言
            # SQL 过滤不可靠（task-05 实测抓到），ORM 读回 None 的语义判断才稳。
            if row.latest_progress is None:
                continue
            progress = row.latest_progress if isinstance(row.latest_progress, dict) else {}
            changes = progress.get("changes")
            first = changes[0] if isinstance(changes, list) and changes else {}
            current_stage = first.get("current_stage") if isinstance(first, dict) else None
            items.append(
                {
                    "name": row.change_name,
                    "current_stage": current_stage,
                    "last_pushed_at": row.last_pushed_at,
                    "last_pusher": row.last_pusher,
                }
            )
        return items

    async def get_progress(
        self,
        workspace_id: uuid.UUID | None,
        name: str,
        allowed_workspace_ids: list[uuid.UUID] | None = None,
    ) -> dict[str, Any] | None:
        """GET /changes/{name}/progress（契约 §6，复合键取行）：完整六表 + 顶层 ``last_pushed_at``。

        不存在/跨 workspace → None（router 层 404，对齐 main.py quick_chat 惯例）。
        ``allowed_workspace_ids`` 非 None 时按并集 + NULL 桶取行（task-06 / D-004@v1）。
        """
        stmt = select(PlatformChangeProgressORM).where(
            col(PlatformChangeProgressORM.change_name) == name,
            self._workspace_filter(workspace_id, allowed_workspace_ids),
        )
        row = (await self._session.execute(stmt)).scalar_one_or_none()
        if row is None or row.latest_progress is None:
            # 占位行守卫（design §4.3 / Grill UB-1）：仅 documents/approval 有值的行
            # 视为「无进度」→ None（router 维持 404）。否则 CLI triggerPull 拉到
            # 200 空态经 pm.import 会清空本地进度库（progress.js DELETE stages 不重建）。
            return None
        progress: dict[str, Any] = dict(row.latest_progress or {})
        progress["last_pushed_at"] = row.last_pushed_at
        return progress

    # ── Change 2026-08-14-platform-sync-docs-approval task-03（D-002@v1 / D-003@v1 单写者）──

    async def upsert_documents(
        self, workspace_id: uuid.UUID | None, name: str, documents: dict[str, str]
    ) -> int:
        """POST /changes/{name}/documents：定向 upsert documents 列。

        行有 → UPDATE 只动 documents + updated_at；行无 → INSERT 占位
        （latest_progress NULL，下行端点由占位行守卫视为「无进度」）。
        IntegrityError 并发自愈与 ``_apply`` 同模式。
        """
        row = await self._find_row(workspace_id, name)
        if row is not None:
            row.documents = dict(documents)
            row.updated_at = datetime.now(UTC)
            await self._session.commit()
            return len(documents)
        try:
            self._session.add(
                PlatformChangeProgressORM(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    change_name=name,
                    documents=dict(documents),
                )
            )
            await self._session.commit()
        except IntegrityError:
            await self._session.rollback()
            existing = await self._find_row(workspace_id, name)
            if existing is None:
                raise
            existing.documents = dict(documents)
            existing.updated_at = datetime.now(UTC)
            await self._session.commit()
        return len(documents)

    async def set_approval(
        self,
        workspace_id: uuid.UUID | None,
        name: str,
        decision: str,
        reason: str | None,
        decided_by: str,
    ) -> dict[str, Any]:
        """POST /changes/{name}/approval：定向写 approval 列（D-001@v1 完整闭环）。

        approval JSON = ``{status, reason, decided_at, decided_by}``；重复提交覆盖
        （后写赢）。行无 → INSERT 占位。
        """
        record: dict[str, Any] = {
            "status": decision,
            "reason": reason,
            "decided_at": datetime.now(UTC).isoformat(),
            "decided_by": decided_by,
        }
        row = await self._find_row(workspace_id, name)
        if row is not None:
            row.approval = record
            row.updated_at = datetime.now(UTC)
            await self._session.commit()
            return record
        try:
            self._session.add(
                PlatformChangeProgressORM(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    change_name=name,
                    approval=record,
                )
            )
            await self._session.commit()
        except IntegrityError:
            await self._session.rollback()
            existing = await self._find_row(workspace_id, name)
            if existing is None:
                raise
            existing.approval = record
            existing.updated_at = datetime.now(UTC)
            await self._session.commit()
        return record

    async def get_approval_record(
        self,
        workspace_id: uuid.UUID | None,
        name: str,
        allowed_workspace_ids: list[uuid.UUID] | None = None,
    ) -> dict[str, Any] | None:
        """GET /changes/{name}/approval：读 approval 列。

        行不存在 / approval NULL（含仅 documents 的占位行）→ None——router 层
        映射默认 approved 放行（ql-20260812-001-6eb8 兼容语义）。
        ``allowed_workspace_ids`` 非 None 时按并集 + NULL 桶取行（task-06 / D-004@v1：
        跨 workspace 的 change 名不可读，不可见行回落默认 approved，不泄漏 status）。
        """
        stmt = select(PlatformChangeProgressORM).where(
            col(PlatformChangeProgressORM.change_name) == name,
            self._workspace_filter(workspace_id, allowed_workspace_ids),
        )
        row = (await self._session.execute(stmt)).scalar_one_or_none()
        if row is None:
            return None
        return row.approval if isinstance(row.approval, dict) else None

    async def upsert_quicklog_entry(
        self,
        workspace_id: uuid.UUID,
        payload: dict[str, Any],
    ) -> QuicklogEntryORM:
        """POST /quicklog-entries：幂等 upsert（design §5.2 / D-004）。

        ``(workspace_id, ql_id)`` 存在→整条覆盖（CLI 重跑 ``--done`` 幂等）；不存在→
        插入。**不做 base_ts 乐观锁**——quicklog 条目是单写者（同一 quick 会话的 CLI）
        整条覆盖，无变更 progress 那种双向编辑冲突面（D-004）。

        ``payload`` 裸存推送原文（D-005：派生字段查询时算，不入库）；
        ``workspace_id`` 由 router 从 require_platform_sync_write 派生注入（唯一通道）。
        """
        ql_id = str(payload.get("ql_id", ""))
        stmt = select(QuicklogEntryORM).where(
            col(QuicklogEntryORM.workspace_id) == workspace_id,
            col(QuicklogEntryORM.ql_id) == ql_id,
        )
        row = (await self._session.execute(stmt)).scalar_one_or_none()
        now = datetime.now(UTC)
        if row is None:
            row = QuicklogEntryORM(
                workspace_id=workspace_id,
                ql_id=ql_id,
                payload=payload,
                created_at=now,
                updated_at=now,
            )
            self._session.add(row)
        else:
            row.payload = payload
            row.updated_at = now
        await self._session.commit()
        await self._session.refresh(row)
        return row

    # ── Change 2026-08-17-spec-file-incremental-sync task-01（design §5.2/§5.3）──

    async def get_spec_manifest(
        self, workspace_id: uuid.UUID
    ) -> dict[str, dict[str, str | int | bool]]:
        """GET /changes/-/spec-manifest：透调 ``SpecWorkspaceService.get_manifest``。

        workspace 级鉴权与归属校验在 router 层完成（``require_platform_sync_write``
        从 shpsync_ token 派生 workspace_id 后才进来）；本层不重复校验，直接实例化
        ``SpecWorkspaceService``（共享同一 session）读服务器权威清单全量行
        （含 ``exists=False`` 软删行，design §5.3）。
        """
        from app.modules.spec_workspace.service import SpecWorkspaceService

        return await SpecWorkspaceService(self._session).get_manifest(workspace_id)

    async def apply_spec_ops(self, workspace_id: uuid.UUID, ops: list[FileOp]) -> dict[str, object]:
        """POST /changes/-/spec-sync：透调 ``SpecWorkspaceService.apply_ops``（design §5.2/§7）。

        workspace 级鉴权与归属校验在 router 层完成（同 ``get_spec_manifest`` 范式，
        ``require_platform_sync_write`` 从 shpsync_ token 派生 workspace_id 后才进来）；
        ``apply_ops`` 本身不校验权限（design §5.2 权限说明），本层不重复校验，共享
        同一 session 直接调用。

        ``apply_ops`` 内部自带单事务（全部 ops 一次 commit：成功全部落盘 / 失败全部
        回滚，design §5.2 事务说明），返回 ``{"new_versions": ..., "conflict": ...,
        "server_versions": ...}``。``change_dirs`` 不传——CLI 直跑场景由 apply_ops
        无标注时扫 ops 路径 ``changes/`` 前缀兜底触发 reparse（行为等价，design §5.2）。
        """
        from app.modules.spec_workspace.service import SpecWorkspaceService

        return await SpecWorkspaceService(self._session).apply_ops(workspace_id, ops)

    # ── Change 2026-08-23-platform-agent-log-ingest task-02（design §3.2 API 契约）──
    # ── 2026-08-23-agent-activity-sessions task-04（design §3.3.3 归属扩展）──
    # ── 2026-08-25-session-spec-binding task-06（design §5.W2.2/W2.3 双分支 ctx 绑定）──

    async def upsert_agent_log_entries(
        self,
        workspace_id: uuid.UUID,
        entries: list[AgentLogEntry],
        pushed_at: str | None,
        scan_run_id: str | None,
        user_id: uuid.UUID,
        hub_session_id: uuid.UUID | None = None,
    ) -> int:
        """POST /agent-logs：批量幂等 upsert + 落库后归属（design §3.2/§3.3.3）。

        落库部分按 ``(workspace_id, log_path)`` 复合键 IN 批量预取（ql-20260826-012
        前为逐条 select）：无则 INSERT、有则整行覆盖——``invocations`` /
        ``first_seen_at`` 等一律以 CLI 值为准整行写入，服务端**不自行累加**（CLI
        留底文件是计数权威，D-005）；``created_at`` 首插后保留不动，仅刷
        ``updated_at``。同请求内重复 ``log_path`` 先按首现位置去重保序、以靠后
        条目为准（design §3.2）。

        归属部分（task-04，同事务——归属写在本方法唯一一次 commit 之前）：

        1. ``hub_session_id`` 分支（daemon env 注入的平台会话）：select
           ``agent_sessions`` where id=hub 且 workspace=token 派生 ws 且未软删——
           命中 → 本批全部 entries 挂该会话；未命中/跨 ws → **静默跳过**（D-005
           best-effort：entries 仍入库，绝不 4xx/抛错）。
        2. 无 hub 分支（entry 级 ctx，D-009）：entries 按 ``(harness,
           coalesce(change_key, quick_id, ''))`` 分组，每组 find-or-create
           ``origin='tool_report'`` 会话——find 按 ``aggregation_key="{harness}|{ctx}"``
           取 ``last_active_at`` 最新一行（D-006：无唯一约束，并发撞键重复行按最新
           收敛、败者僵尸行不清理）；create 由本服务单一写者写入（owner=token
           派生 user，provider 走 D-007 映射，title=``{harness} · {ctx 或 '本地活动'}``，
           quick_id 显示为原样短码）。find 命中也刷新 ``last_active_at``，不改
           status（生命周期契约：已有活跃/终态会话只刷活跃时间）。

        归属后双分支均按 entry 级 ctx 落自动绑定（task-06 / design §5.W2.2/W2.3，
        D-003 检测双通道）：``quick_id`` → quicklog_session_links（quick 绑定唯一
        可靠通道，FR-02；并存时 quick 优先）、``change_key`` → change_session_links
        （变更不存在建 placeholder；default 伪键由 bind 内部守卫跳过，D-005@v2）。
        绑定与归属同事务（本方法唯一一次 commit 前完成）且 best-effort，失败
        不影响上报主流程。

        返回落库行数（去重后）。
        """
        # dict 化去重：键保留首现顺序（保序），值被靠后条目覆盖（后者为准）。
        deduped: dict[str, AgentLogEntry] = {entry.log_path: entry for entry in entries}
        now = datetime.now(UTC)
        # ql-20260826-012：IN 批量预取替代逐 entry SELECT（N+1）——tool_report
        # 全量重推一批几百条 entries 原来要几百条串行查询；(workspace_id,
        # log_path) 复合唯一约束保证至多一行/键（model.py:200），dict 命中与原
        # scalar_one_or_none 语义等价。
        existing_by_path: dict[str, AgentSessionLogORM] = {}
        if deduped:
            existing_rows = (
                (
                    await self._session.execute(
                        select(AgentSessionLogORM).where(
                            col(AgentSessionLogORM.workspace_id) == workspace_id,
                            col(AgentSessionLogORM.log_path).in_(deduped.keys()),
                        )
                    )
                )
                .scalars()
                .all()
            )
            existing_by_path = {row.log_path: row for row in existing_rows}
        # (entry, ORM 行) 配对留存：归属阶段需要 entry 级 harness/ctx 对应到落库行。
        persisted: list[tuple[AgentLogEntry, AgentSessionLogORM]] = []
        for entry in deduped.values():
            row = existing_by_path.get(entry.log_path)
            if row is None:
                row = AgentSessionLogORM(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    log_path=entry.log_path,
                    harness=entry.harness,
                    format=entry.format,
                    session_id=entry.session_id,
                    originator=entry.originator,
                    detected_via=entry.detected_via,
                    agent_cwd=entry.agent_cwd,
                    exists=entry.exists if entry.exists is not None else True,
                    size_bytes=entry.size_bytes,
                    mtime_ms=entry.mtime_ms,
                    first_seen_at=entry.first_seen_at,
                    last_seen_at=entry.last_seen_at,
                    invocations=entry.invocations,
                    last_command=entry.last_command,
                    scan_run_id=scan_run_id,
                    pushed_at=pushed_at,
                    created_at=now,
                    updated_at=now,
                )
                self._session.add(row)
            else:
                # 整行覆盖（D-005）：除 id/workspace_id/log_path/created_at 外全列以本次
                # 上报为准；exists None 回落 ORM 列默认 true（NOT NULL）。
                row.harness = entry.harness
                row.format = entry.format
                row.session_id = entry.session_id
                row.originator = entry.originator
                row.detected_via = entry.detected_via
                row.agent_cwd = entry.agent_cwd
                row.exists = entry.exists if entry.exists is not None else True
                row.size_bytes = entry.size_bytes
                row.mtime_ms = entry.mtime_ms
                row.first_seen_at = entry.first_seen_at
                row.last_seen_at = entry.last_seen_at
                row.invocations = entry.invocations
                row.last_command = entry.last_command
                row.scan_run_id = scan_run_id
                row.pushed_at = pushed_at
                row.updated_at = now
            persisted.append((entry, row))

        # ── 归属（design §3.3.3：与 entries upsert 同事务，commit 前写归属列）──
        # task-03（2026-08-24-sessions-live-updates）：本批新 INSERT 的 tool_report
        # 会话（session_id + user_id），commit 后逐个广播 created；命中已有会话
        # 只刷 last_active_at 不进此清单（列表视图无变化，零发布）。hub 分支只挂
        # 已有会话、无 INSERT，恒为空清单。
        created_group_sessions: list[tuple[uuid.UUID, uuid.UUID]] = []
        if hub_session_id is not None:
            hub_session = (
                await self._session.execute(
                    select(AgentSession).where(
                        col(AgentSession.id) == hub_session_id,
                        col(AgentSession.workspace_id) == workspace_id,
                        col(AgentSession.deleted_at).is_(None),
                    )
                )
            ).scalar_one_or_none()
            if hub_session is not None:
                for entry, log_row in persisted:
                    log_row.agent_session_id = hub_session.id
                    # task-06（design §5.W2.2 / D-003）：hub 命中补消费 entry 级 ctx
                    # （quick 绑定唯一可靠通道）——绑定主体为 hub 会话，与归属同事务
                    # （唯一一次 commit 前完成）；bind 内部 best-effort 不影响本流程。
                    await _bind_entry_ctx(
                        self._session,
                        workspace_id,
                        entry.change_key,
                        entry.quick_id,
                        hub_session.id,
                    )
            # D-005 best-effort：hub 会话不存在/跨 workspace/已软删 → 静默跳过归属
            # 与绑定，entries 仍入库（不抛错不 4xx），目标会话 status 也不受影响。
        else:
            # D-009 entry 级 ctx 分组：变更 B 的日志不因全量重推挂到变更 A 的会话。
            # task-06：分组值改留 (entry, log_row) 配对——组级绑定需要留存原始
            # change_key / quick_id（design §5.W2.3）。
            groups: dict[tuple[str, str], list[tuple[AgentLogEntry, AgentSessionLogORM]]] = {}
            for entry, log_row in persisted:
                ctx = entry.change_key or entry.quick_id or ""
                groups.setdefault((entry.harness, ctx), []).append((entry, log_row))
            for (harness, ctx), group_items in groups.items():
                agg_key = f"{harness}|{ctx}"
                # D-006 find-then-insert：普通索引非唯一，极小概率并发重复行按
                # last_active_at 最新取一，后续上报自然收敛到该行。
                found = (
                    await self._session.execute(
                        select(AgentSession)
                        .where(
                            col(AgentSession.origin) == "tool_report",
                            col(AgentSession.workspace_id) == workspace_id,
                            col(AgentSession.aggregation_key) == agg_key,
                            col(AgentSession.deleted_at).is_(None),
                        )
                        .order_by(col(AgentSession.last_active_at).desc().nulls_last())
                        .limit(1)
                    )
                ).scalar_one_or_none()
                if found is not None:
                    # 命中只刷活跃时间，不改 status/turn_count（生命周期契约）。
                    found.last_active_at = now
                    group_session_id = found.id
                else:
                    # create（单一写者=本服务）：owner=token 派生 user（R-02）、
                    # provider 走 D-007 映射、ctx 空显示「本地活动」（D-001 回落单桶）。
                    group_session_id = uuid.uuid4()
                    self._session.add(
                        AgentSession(
                            id=group_session_id,
                            user_id=user_id,
                            workspace_id=workspace_id,
                            provider=_tool_report_provider(harness),
                            status="pending",
                            origin="tool_report",
                            aggregation_key=agg_key,
                            title=f"{harness} · {ctx or '本地活动'}",
                            config_snapshot={"harness": harness},
                            turn_count=0,
                            last_active_at=now,
                        )
                    )
                    created_group_sessions.append((group_session_id, user_id))
                for _entry, log_row in group_items:
                    log_row.agent_session_id = group_session_id
                # task-06（design §5.W2.3 / D-003）：tool_report 会话同款 ctx 绑定——
                # 组级一次（同组 entries 的 coalesce ctx 相同，bind 幂等无需逐条）；
                # 空 ctx 组（本地活动单桶）两键皆 None，_bind_entry_ctx 天然跳过不落
                # 任何绑定；两键并存 quick 优先与 hub 分支同口径。
                group_change_key = next(
                    (e.change_key for e, _row in group_items if e.change_key), None
                )
                group_quick_id = next((e.quick_id for e, _row in group_items if e.quick_id), None)
                await _bind_entry_ctx(
                    self._session,
                    workspace_id,
                    group_change_key,
                    group_quick_id,
                    group_session_id,
                )
        await self._session.commit()
        # task-03（design §3）：仅新 INSERT 的 tool_report 会话广播 created（列表
        # 出现新行）；publish 内部静默容错，Redis 抖动不影响 CLI 上报主流程。
        for created_sid, created_uid in created_group_sessions:
            await publish_sessions_changed("created", created_sid, created_uid)
        return len(deduped)

    async def list_agent_logs(
        self,
        workspace_id: uuid.UUID | None,
        allowed_workspace_ids: list[uuid.UUID] | None = None,
        filter_workspace_id: uuid.UUID | None = None,
        filter_session_id: uuid.UUID | None = None,
        limit: int = 20,
    ) -> list[AgentSessionLogORM]:
        """GET /agent-logs：按读 scope 聚合列表（design §3.2 / D-004 读通道）。

        - ``allowed_workspace_ids`` 非 None（JWT/shk_live_ 读路径）→ workspace_id
          ``IN (并集)`` 聚合——本表 workspace_id NOT NULL，无 NULL 桶子句（X-04）；
          空集合即空结果。
        - ``workspace_id`` 非 None（shpsync_ 路径）→ 精确匹配（token 收件箱）。
        - 两者均 None（防御，router ``_read_args`` 恒给其一）→ 空结果（fail-closed）。
        - ``filter_workspace_id`` 非 None 时再 AND 等值——不在 scope 内（越权）=
          空结果不报错（不 403 不泄漏 workspace 存在性，D-004）。
        - ``filter_session_id`` 非 None（task-04 / design §3.3.6）再 AND
          ``agent_session_id`` 等值——scope 内会话的关联条目；会话存在但不属
          scope（越权）→ 空列表同既有语义（scope 过滤天然拦截，不泄漏存在性）。

        排序 ``last_seen_at DESC NULLS LAST``（显式 nulls_last 消除 PG/SQLite 方言
        分叉 X-07；ISO 8601 UTC 字符串字典序 = 时间序，D-003），``limit`` 由 router
        层 Query 校验（默认 20 上限 100）。
        """
        ws_col = col(AgentSessionLogORM.workspace_id)
        filters: list[ColumnElement[bool]] = []
        if allowed_workspace_ids is not None:
            filters.append(ws_col.in_(allowed_workspace_ids))
        elif workspace_id is not None:
            filters.append(ws_col == workspace_id)
        else:
            return []
        if filter_workspace_id is not None:
            filters.append(ws_col == filter_workspace_id)
        if filter_session_id is not None:
            filters.append(col(AgentSessionLogORM.agent_session_id) == filter_session_id)
        stmt = (
            select(AgentSessionLogORM)
            .where(*filters)
            .order_by(col(AgentSessionLogORM.last_seen_at).desc().nulls_last())
            .limit(limit)
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        return list(rows)
