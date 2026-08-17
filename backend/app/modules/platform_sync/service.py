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
from typing import Any

from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.platform_sync.model import PlatformChangeProgressORM, QuicklogEntryORM

log = get_logger(__name__)


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
