"""明细-任务联动单测 (task-07)。

覆盖 FR-01 ~ FR-07 的 GWT 边界,只断言可观测行为 (任务是否建 / 字段值 /
关联 ps_plan_node_detail_id / 版本链 / 回滚),不绑定私有方法内部细节。

使用根 conftest 的 in-memory SQLite ``db_session`` fixture:
- 根 conftest 已注册 ppm.task model (PlanTask 表可建)
- plan/tests/conftest.py 已注册 ppm.plan model + ppm.project model
  (PsProjectPlan / PsPlanNode / PsPlanNodeDetail / PpmProjectMember 等可建)
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ppm.plan.model import (
    PsPlanNode,
    PsPlanNodeDetail,
    PsProjectPlan,
)
from app.modules.ppm.plan.schema import (
    ImportCommitReq,
    ImportCommitSheet,
    ImportPreviewRow,
)
from app.modules.ppm.plan.service import PlanService
from app.modules.ppm.project import model as _project_model  # noqa: F401
from app.modules.ppm.project.model import PpmProjectMember
from app.modules.ppm.task.model import PlanTask

_ACTOR = ("00000000-0000-0000-0000-000000000099", "操作员")


def _now() -> datetime:
    return datetime.now(UTC)


async def _seed_project_plan(
    session: AsyncSession,
    *,
    project_id: uuid.UUID | None = None,
    project_name: str = "联动测试项目",
) -> PsProjectPlan:
    plan = PsProjectPlan(
        id=uuid.uuid4(),
        project_id=project_id or uuid.uuid4(),
        project_name=project_name,
        status="draft",
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(plan)
    await session.commit()
    await session.refresh(plan)
    return plan


async def _seed_node(session: AsyncSession, plan_id: uuid.UUID) -> PsPlanNode:
    node = PsPlanNode(
        id=uuid.uuid4(),
        ps_project_plan_id=plan_id,
        overall_stage="阶段一",
        no="1",
        status="draft",
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(node)
    await session.commit()
    await session.refresh(node)
    return node


async def _seed_member(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    user_name: str = "张三",
    project_id: uuid.UUID | None = None,
) -> PpmProjectMember:
    """建一条项目成员 (用于 _lookup_user_name 姓名反查)。

    SQLite 默认不强制 FK,pm_project_id / user_id 可指向任意 UUID 而无需父行存在。
    """
    member = PpmProjectMember(
        id=uuid.uuid4(),
        pm_project_id=project_id or uuid.uuid4(),
        user_id=user_id,
        user_name=user_name,
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(member)
    await session.commit()
    await session.refresh(member)
    return member


async def _count_tasks(session: AsyncSession) -> int:
    rows = (await session.execute(select(PlanTask))).scalars().all()
    return len(rows)


async def _get_task_by_detail(session: AsyncSession, detail_id: uuid.UUID) -> PlanTask | None:
    stmt = select(PlanTask).where(PlanTask.ps_plan_node_detail_id == detail_id).limit(1)
    return (await session.execute(stmt)).scalar_one_or_none()


async def _get_task_by_id(session: AsyncSession, task_id: uuid.UUID) -> PlanTask | None:
    return await session.get(PlanTask, task_id)


# ===========================================================================
# FR-01: 明细变 done 建任务 (create_detail 直建 done / save_process→DONE)
# ===========================================================================


class TestFR01CreateDetailBuildsTask:
    """FR-01: create_detail 传 status=done 且有执行人 → 建一条 PlanTask。"""

    async def test_done_detail_creates_task_with_full_field_mapping(
        self, db_session: AsyncSession
    ) -> None:
        """FR-01a 建:done 明细 + 执行人 → PlanTask 1 条,字段映射正确。

        字段映射 (design §5.3):
        user_id=execute_user_id, content=task_theme, start/end_time,
        work_load=plan_workload, ps_plan_node_detail_id, module_id, status="未开始"。
        """
        plan = await _seed_project_plan(db_session)
        node = await _seed_node(db_session, plan.id)
        member = await _seed_member(
            db_session, user_id=uuid.uuid4(), user_name="李四", project_id=plan.project_id
        )
        begin = datetime(2026, 1, 1, tzinfo=UTC)
        end = datetime(2026, 1, 10, tzinfo=UTC)

        svc = PlanService(db_session)
        detail = await svc.create_detail(
            {
                "plan_node_id": node.id,
                "no": "1",
                "task_theme": "需求调研",
                "plan_workload": "8",
                "plan_begin_time": begin,
                "plan_complete_time": end,
                "execute_user_id": member.user_id,
                "module_id": uuid.uuid4(),
                "status": "done",
            }
        )

        assert await _count_tasks(db_session) == 1
        task = await _get_task_by_detail(db_session, detail.id)
        assert task is not None
        # 全字段映射断言
        assert task.user_id == member.user_id
        assert task.user_name == "李四"  # _lookup_user_name 姓名反查
        assert task.content == "需求调研"
        # SQLite 存 datetime 不保 tzinfo (读回为 naive),比较去掉 tzinfo
        assert task.start_time == begin.replace(tzinfo=None)
        assert task.end_time == end.replace(tzinfo=None)
        assert task.work_load == "8"
        assert task.ps_plan_node_detail_id == detail.id
        assert task.module_id == detail.module_id
        assert task.status == "未开始"  # 新建任务初始态
        # 项目上下文回溯
        assert task.project_id == plan.project_id
        assert task.project_name == "联动测试项目"

    async def test_draft_detail_does_not_create_task(self, db_session: AsyncSession) -> None:
        """FR-01b:draft 明细不建任务。"""
        plan = await _seed_project_plan(db_session)
        node = await _seed_node(db_session, plan.id)

        svc = PlanService(db_session)
        await svc.create_detail(
            {
                "plan_node_id": node.id,
                "no": "1",
                "task_theme": "草稿明细",
                "status": "draft",
                "execute_user_id": uuid.uuid4(),
            }
        )
        assert await _count_tasks(db_session) == 0

    async def test_done_detail_without_executor_skips_task(self, db_session: AsyncSession) -> None:
        """FR-01c / D-003:done 但 execute_user_id 为空 → 跳过不建任务。"""
        plan = await _seed_project_plan(db_session)
        node = await _seed_node(db_session, plan.id)

        svc = PlanService(db_session)
        detail = await svc.create_detail(
            {
                "plan_node_id": node.id,
                "no": "1",
                "task_theme": "无执行人明细",
                "status": "done",
                "execute_user_id": None,
            }
        )
        assert detail.status == "done"
        assert await _count_tasks(db_session) == 0

    async def test_save_process_to_done_creates_task(self, db_session: AsyncSession) -> None:
        """FR-01d:draft 明细经 save_process 推进到 DONE → 建一条任务。

        触发点: _transition 在 target=done 时调 _ensure_task_for_detail。
        """
        plan = await _seed_project_plan(db_session)
        node = await _seed_node(db_session, plan.id)
        member = await _seed_member(db_session, user_id=uuid.uuid4(), user_name="王五")

        svc = PlanService(db_session)
        detail = await svc.create_detail(
            {
                "plan_node_id": node.id,
                "no": "1",
                "task_theme": "流转明细",
                "execute_user_id": member.user_id,
                "status": "draft",
            }
        )
        assert await _count_tasks(db_session) == 0

        # draft → review → approve → done (3 次 save_process)
        for _ in range(3):
            await svc.save_process(detail.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

        assert (await svc.get_detail(detail.id)).status == "done"
        assert await _count_tasks(db_session) == 1
        task = await _get_task_by_detail(db_session, detail.id)
        assert task is not None
        assert task.status == "未开始"
        assert task.content == "流转明细"


# ===========================================================================
# FR-02: 导入批量建任务 (done 行建, draft 行不建)
# ===========================================================================


def _make_row(
    *,
    duty_user_id: uuid.UUID | None,
    valid: bool = True,
    task_theme: str = "导入任务",
    duty_matched: bool = True,
    plan_workload: str | None = "5",
    plan_begin: datetime | None = None,
    plan_complete: datetime | None = None,
    detailed_stage: str = "阶段",
    task_description: str = "描述",
) -> ImportPreviewRow:
    return ImportPreviewRow(
        sheet_name="Sheet1",
        plan_type="正常计划",
        module_name=None,
        detailed_stage=detailed_stage,
        task_theme=task_theme,
        task_description=task_description,
        plan_workload=plan_workload,
        duty_user_name="某人" if duty_user_id else None,
        duty_user_id=duty_user_id,
        duty_matched=duty_matched,
        plan_begin_time=plan_begin,
        plan_complete_time=plan_complete,
        valid=valid,
    )


class TestFR02ImportBatchBuild:
    """FR-02: import_commit 批量建任务 (必填齐全→done→建, 缺失→draft→不建)。"""

    async def test_import_done_rows_create_tasks_draft_rows_do_not(
        self, db_session: AsyncSession
    ) -> None:
        """FR-02:done 行数 = PlanTask 数;draft 行不建任务。"""
        plan = await _seed_project_plan(db_session)
        node = await _seed_node(db_session, plan.id)
        member = await _seed_member(db_session, user_id=uuid.uuid4(), user_name="导入员")

        begin = datetime(2026, 2, 1, tzinfo=UTC)
        end = datetime(2026, 2, 5, tzinfo=UTC)
        # done 行: 全部必填字段齐全 (含 duty_user_id)
        row_done_a = _make_row(
            duty_user_id=member.user_id,
            task_theme="导入任务A",
            plan_begin=begin,
            plan_complete=end,
            plan_workload="6",
        )
        row_done_b = _make_row(
            duty_user_id=member.user_id,
            task_theme="导入任务B",
            plan_begin=begin,
            plan_complete=end,
            plan_workload="4",
        )
        # draft 行: 缺 duty_user_id 但 valid=True (构造为 draft, 不建任务)
        row_draft = _make_row(
            duty_user_id=None,
            duty_matched=False,
            valid=True,
            task_theme="无责任人明细",
            plan_begin=begin,
            plan_complete=end,
            plan_workload="3",
        )

        req = ImportCommitReq(
            sheets=[
                ImportCommitSheet(
                    name="Sheet1",
                    plan_type="正常计划",
                    rows=[row_done_a, row_done_b, row_draft],
                )
            ]
        )

        svc = PlanService(db_session)
        result = await svc.import_commit(req, str(node.id))

        assert result.created_details == 3
        # done 行 = 2 → 任务数 = 2 (draft 行不建)
        assert await _count_tasks(db_session) == 2
        contents = {t.content for t in (await db_session.execute(select(PlanTask))).scalars().all()}
        assert contents == {"导入任务A", "导入任务B"}


# ===========================================================================
# FR-03: 编辑同步任务字段 (task.status 不变)
# ===========================================================================


class TestFR03EditSyncsTaskFields:
    """FR-03: update_detail 改 task_theme/workload/execute_user_id →
    同 task.id 字段已变, 但 status 不变 (仍是"未开始")。"""

    async def test_update_detail_syncs_fields_keeps_status(self, db_session: AsyncSession) -> None:
        plan = await _seed_project_plan(db_session)
        node = await _seed_node(db_session, plan.id)
        m1 = await _seed_member(db_session, user_id=uuid.uuid4(), user_name="原执行人")
        m2 = await _seed_member(db_session, user_id=uuid.uuid4(), user_name="新执行人")

        svc = PlanService(db_session)
        detail = await svc.create_detail(
            {
                "plan_node_id": node.id,
                "no": "1",
                "task_theme": "原标题",
                "plan_workload": "5",
                "execute_user_id": m1.user_id,
                "status": "done",
            }
        )
        task_before = await _get_task_by_detail(db_session, detail.id)
        assert task_before is not None
        assert task_before.status == "未开始"
        task_id = task_before.id

        # 编辑: 改主题 / 工作量 / 执行人
        await svc.update_detail(
            detail.id,
            {
                "task_theme": "新标题",
                "plan_workload": "12",
                "execute_user_id": m2.user_id,
            },
        )

        task_after = await _get_task_by_id(db_session, task_id)
        assert task_after is not None
        assert task_after.id == task_id  # 同一条任务 (未新建)
        assert task_after.content == "新标题"
        assert task_after.work_load == "12"
        assert task_after.user_id == m2.user_id
        assert task_after.user_name == "新执行人"
        # status 不变 (D-007)
        assert task_after.status == "未开始"
        # 仅一条任务
        assert await _count_tasks(db_session) == 1


# ===========================================================================
# FR-04: 变更迁移任务到新版本 (不产生第二条)
# ===========================================================================


class TestFR04ChangeMigratesTask:
    """FR-04 / D-001: change_process 把任务的 ps_plan_node_detail_id
    从旧版本迁到新版本,PlanTask 仍 1 条。"""

    async def test_change_process_migrates_task_binding(self, db_session: AsyncSession) -> None:
        plan = await _seed_project_plan(db_session)
        node = await _seed_node(db_session, plan.id)
        member = await _seed_member(db_session, user_id=uuid.uuid4(), user_name="变更员")

        svc = PlanService(db_session)
        detail = await svc.create_detail(
            {
                "plan_node_id": node.id,
                "no": "1",
                "task_theme": "变更前明细",
                "execute_user_id": member.user_id,
                "status": "done",
            }
        )
        task = await _get_task_by_detail(db_session, detail.id)
        assert task is not None
        task_id = task.id
        assert await _count_tasks(db_session) == 1

        # 发起变更 (明细须 done 才可变更)
        new_detail = await svc.change_process(
            detail.id,
            actor_id=_ACTOR[0],
            actor_name=_ACTOR[1],
            change_reason="需求变更",
        )

        # 旧版本 archived, 新版本 draft
        assert (await svc.get_detail(detail.id)).status == "archived"
        assert new_detail.status == "draft"
        # 任务迁移: 同 task.id 的 ps_plan_node_detail_id == 新版本 id
        task_after = await _get_task_by_id(db_session, task_id)
        assert task_after is not None
        assert task_after.ps_plan_node_detail_id == new_detail.id
        # 不产生第二条任务
        assert await _count_tasks(db_session) == 1


# ===========================================================================
# FR-05: 删除解关联 (任务保留, ps_plan_node_detail_id 置 null)
# ===========================================================================


class TestFR05DeleteUnlinksTask:
    """FR-05 / D-004: delete_detail → 任务保留, ps_plan_node_detail_id=None。"""

    async def test_delete_detail_unlinks_but_keeps_task(self, db_session: AsyncSession) -> None:
        plan = await _seed_project_plan(db_session)
        node = await _seed_node(db_session, plan.id)
        member = await _seed_member(db_session, user_id=uuid.uuid4(), user_name="删除员")

        svc = PlanService(db_session)
        detail = await svc.create_detail(
            {
                "plan_node_id": node.id,
                "no": "1",
                "task_theme": "待删明细",
                "execute_user_id": member.user_id,
                "status": "done",
            }
        )
        task = await _get_task_by_detail(db_session, detail.id)
        assert task is not None
        task_id = task.id

        await svc.delete_detail(detail.id)

        # 任务仍在 (未删), 且 ps_plan_node_detail_id 已置 None
        task_after = await _get_task_by_id(db_session, task_id)
        assert task_after is not None
        assert task_after.ps_plan_node_detail_id is None
        assert await _count_tasks(db_session) == 1


# ===========================================================================
# FR-06: 强一致回滚 (建任务失败 → 明细操作整体回滚)
# ===========================================================================


class TestFR06RollbackOnTaskFailure:
    """FR-06 / R-07: _ensure_task_for_detail 抛异常 → create_detail 整体抛异常,
    明细未入库 (强一致回滚)。"""

    async def test_create_detail_rolls_back_when_ensure_task_raises(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plan = await _seed_project_plan(db_session)
        node = await _seed_node(db_session, plan.id)
        member = await _seed_member(db_session, user_id=uuid.uuid4(), user_name="回滚员")

        async def _boom(self: PlanService, detail: PsPlanNodeDetail) -> PlanTask:
            raise RuntimeError("模拟建任务失败")

        monkeypatch.setattr(PlanService, "_ensure_task_for_detail", _boom)

        svc = PlanService(db_session)
        with pytest.raises(RuntimeError, match="模拟建任务失败"):
            await svc.create_detail(
                {
                    "plan_node_id": node.id,
                    "no": "1",
                    "task_theme": "回滚明细",
                    "execute_user_id": member.user_id,
                    "status": "done",
                }
            )

        # service 不自行 try/except rollback —— 由调用边界 (请求级 get_session
        # 依赖在异常时 rollback) 负责。测试显式 rollback 模拟该边界后,明细与任务
        # 均不应落库 (强一致回滚, R-07)。
        await db_session.rollback()
        details = (await db_session.execute(select(PsPlanNodeDetail))).scalars().all()
        assert len(details) == 0
        # 任务也未建
        assert await _count_tasks(db_session) == 0


# ===========================================================================
# FR-07: 历史 done 明细不补建 (仅实时触发)
# ===========================================================================


class TestFR07HistoricalNoBackfill:
    """FR-07: 直接 ORM 建的 done 明细 (不经任何触发点) → 不被回填任务。"""

    async def test_historical_done_detail_not_backfilled(self, db_session: AsyncSession) -> None:
        plan = await _seed_project_plan(db_session)
        node = await _seed_node(db_session, plan.id)
        member = await _seed_member(db_session, user_id=uuid.uuid4(), user_name="历史员")

        # 直接 ORM 建一条 done 明细, 不调 create_detail / save_process / 任何触发点
        detail = PsPlanNodeDetail(
            id=uuid.uuid4(),
            plan_node_id=node.id,
            no="1",
            task_theme="历史明细",
            execute_user_id=member.user_id,
            status="done",
            created_at=_now(),
            updated_at=_now(),
        )
        db_session.add(detail)
        await db_session.commit()
        await db_session.refresh(detail)

        # 仅实时触发, 不回填历史 → 无任务
        assert await _count_tasks(db_session) == 0
