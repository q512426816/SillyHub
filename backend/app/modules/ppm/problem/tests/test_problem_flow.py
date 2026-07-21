"""problem 子域 service 单测 (2026-07-20 3 态简化 + 对齐任务计划)。

重点测:
- 问题清单 3 态执行流:start_problem (新建→进行中,建 in-flight TaskExecute) /
  execute_problem (submit 回新建可重复 / complete 已完成终态) + 跨天 422
- CRUD + 创建回填 project_name/duty_user_name
- 问题变更 CRUD + 变更审批流 (deprecated,D-005;4 节点 + bug 跳部门经理 + reject)
- fsm 纯函数 (3 态 TRANSITIONS + compute_change_next_node + NODE_NAMES)

使用根 conftest 的 in-memory SQLite ``db_session`` fixture。

设计依据:change 2026-07-20-problem-list-align-task-plan tasks/task-07.md +
decisions.md D-001~D-006。
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ppm.problem.fsm import (
    NODE_NAMES,
    TRANSITIONS,
    ProblemChangeStatus,
    ProblemNode,
    ProblemStatus,
    compute_change_next_node,
)
from app.modules.ppm.problem.service import (
    ProblemError,
    ProblemNotFound,
    ProblemPendingAssignment,
    ProblemService,
)
from app.modules.ppm.project.model import PpmProjectMember
from app.modules.ppm.task.model import TaskExecute

_ACTOR = ("00000000-0000-0000-0000-000000000001", "张三")
_DUTY_USER_ID = "00000000-0000-0000-0000-000000000002"
_AUDIT_USER_ID = "00000000-0000-0000-0000-000000000003"
_DEV_USER_ID = "00000000-0000-0000-0000-000000000004"


# ===========================================================================
# helper: 建项目 + 成员 + 问题
# ===========================================================================


async def _make_project(
    session: AsyncSession,
    *,
    develop: bool = True,
    pm: bool = True,
    dept: bool = True,
) -> str:
    """建一个 ppm_project_maintenance + 按需配 3 个角色成员,返回 project_id 字符串。"""
    import uuid as _uuid

    from app.modules.ppm.project.model import PpmProjectMaintenance

    proj_id = _uuid.uuid4()
    session.add(
        PpmProjectMaintenance(
            id=proj_id, project_code=f"P-{proj_id.hex[:6]}", project_name="项目甲"
        )
    )
    roles: list[tuple[bool, str, str]] = [
        (develop, "开发经理", "李开发"),
        (pm, "项目经理", "王项目"),
        (dept, "部门经理", "赵部门"),
    ]
    for flag, role, name in roles:
        if flag:
            session.add(
                PpmProjectMember(
                    id=_uuid.uuid4(),
                    pm_project_id=proj_id,
                    user_id=_uuid.uuid4(),
                    user_name=name,
                    role_name=role,
                )
            )
    await session.commit()
    return str(proj_id)


async def _make_problem(
    svc: ProblemService,
    project_id: str,
    *,
    pro_type: str | None = None,
    duty_user_id: str = _DUTY_USER_ID,
    duty_user_name: str = "钱责任",
    audit_user_id: str | None = _AUDIT_USER_ID,
    audit_user_name: str | None = "孙验证",
) -> object:
    return await svc.create_problem(
        {
            "project_id": project_id,
            "project_name": "项目甲",
            "pro_desc": "发现一个 bug",
            "pro_type": pro_type,
            "duty_user_id": duty_user_id,
            "duty_user_name": duty_user_name,
            "audit_user_id": audit_user_id,
            "audit_user_name": audit_user_name,
        }
    )


# ===========================================================================
# CRUD
# ===========================================================================


class TestCrud:
    async def test_create_get_update_delete(self, db_session: AsyncSession) -> None:
        import uuid as _uuid

        from app.modules.auth.model import User

        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        assert p.status == ProblemStatus.NEW.value  # 3 态:新建即「新建」

        got = await svc.get_problem(p.id)
        assert got.id == p.id

        # update/delete 需放行用户 (2026-07-20 权限改造); 超管恒放行
        admin = User(
            id=_uuid.uuid4(),
            username=f"adm_crud_{_uuid.uuid4().hex[:6]}",
            display_name="管理员",
            password_hash="x",
            is_platform_admin=True,
        )
        db_session.add(admin)
        await db_session.commit()

        updated = await svc.update_problem(p.id, {"pro_desc": "修改描述"}, user=admin)
        assert updated.pro_desc == "修改描述"

        await svc.delete_problem(p.id, user=admin)
        with pytest.raises(ProblemNotFound):
            await svc.get_problem(p.id)

    async def test_effective_status_equals_status(self, db_session: AsyncSession) -> None:
        """3 态简化:effective_status 恒等于 status,不再有内存态覆盖。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        # 建一条未关闭变更 (旧变更流)
        await svc.create_change(
            {"resource_id": str(p.id), "project_id": proj_id, "change_reason": "x"}
        )
        page = await svc.list_problems(_page_req())
        assert page.total == 1
        # 不再有「变更中」内存态,effective_status == status == 新建
        assert page.items[0].effective_status == ProblemStatus.NEW.value
        assert page.items[0].status == ProblemStatus.NEW.value

    async def test_create_problem_backfills_empty_names(self, db_session: AsyncSession) -> None:
        """project_name/duty_user_name 为空 → 按 id 反查回填。"""
        import uuid as _uuid

        from app.modules.auth.model import User
        from app.modules.ppm.project.model import PpmProjectMaintenance

        proj_id = _uuid.uuid4()
        db_session.add(
            PpmProjectMaintenance(id=proj_id, project_code="P-BF1", project_name="回填项目甲")
        )
        duty_id = _uuid.uuid4()
        db_session.add(
            User(
                id=duty_id,
                username="duty_bf1",
                display_name="责任李四",
                password_hash="x",
            )
        )
        await db_session.commit()

        svc = ProblemService(db_session)
        p = await svc.create_problem(
            {
                "project_id": proj_id,
                "project_name": None,
                "pro_desc": "回填测试",
                "duty_user_id": duty_id,
                "duty_user_name": None,
            }
        )
        assert p.project_name == "回填项目甲"
        assert p.duty_user_name == "责任李四"

    async def test_create_problem_keeps_provided_names(self, db_session: AsyncSession) -> None:
        """已传入的 project_name/duty_user_name 不被回填覆盖。"""
        import uuid as _uuid

        from app.modules.auth.model import User
        from app.modules.ppm.project.model import PpmProjectMaintenance

        proj_id = _uuid.uuid4()
        db_session.add(
            PpmProjectMaintenance(id=proj_id, project_code="P-BF2", project_name="DB里的项目名")
        )
        duty_id = _uuid.uuid4()
        db_session.add(
            User(
                id=duty_id,
                username="duty_bf2",
                display_name="DB里的姓名",
                password_hash="x",
            )
        )
        await db_session.commit()

        svc = ProblemService(db_session)
        p = await svc.create_problem(
            {
                "project_id": proj_id,
                "project_name": "自定义项目名",
                "pro_desc": "不覆盖测试",
                "duty_user_id": duty_id,
                "duty_user_name": "自定义责任人",
            }
        )
        assert p.project_name == "自定义项目名"
        assert p.duty_user_name == "自定义责任人"

    async def test_update_none_clears_nullable_field(self, db_session: AsyncSession) -> None:
        """_Crud.update: 传 {nullable 字段: None} → 库该字段为 None (清空)。"""
        import uuid as _uuid

        from app.modules.auth.model import User

        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        assert p.pro_desc == "发现一个 bug"  # 初始有值

        admin = User(
            id=_uuid.uuid4(),
            username=f"adm_clr_{_uuid.uuid4().hex[:6]}",
            display_name="管理员",
            password_hash="x",
            is_platform_admin=True,
        )
        db_session.add(admin)
        await db_session.commit()

        cleared = await svc.update_problem(p.id, {"pro_desc": None}, user=admin)
        assert cleared.pro_desc is None
        # 落库后重新读取确认
        fresh = await svc.get_problem(p.id)
        assert fresh.pro_desc is None

    async def test_update_omitted_field_kept(self, db_session: AsyncSession) -> None:
        """_Crud.update: data 不含某字段 → 库该字段保持原值 (未传不动)。"""
        import uuid as _uuid

        from app.modules.auth.model import User

        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        assert p.pro_desc == "发现一个 bug"

        admin = User(
            id=_uuid.uuid4(),
            username=f"adm_keep_{_uuid.uuid4().hex[:6]}",
            display_name="管理员",
            password_hash="x",
            is_platform_admin=True,
        )
        db_session.add(admin)
        await db_session.commit()

        # 只改另一个字段,pro_desc 不在 data 里
        updated = await svc.update_problem(p.id, {"remarks": "加备注"}, user=admin)
        assert updated.remarks == "加备注"
        assert updated.pro_desc == "发现一个 bug"  # 未传 → 保持原值
        fresh = await svc.get_problem(p.id)
        assert fresh.pro_desc == "发现一个 bug"

    async def test_create_change_backfills_empty_names(self, db_session: AsyncSession) -> None:
        """变更创建同样回填 project_name/duty_user_name。"""
        import uuid as _uuid

        from app.modules.auth.model import User
        from app.modules.ppm.project.model import PpmProjectMaintenance

        proj_id = _uuid.uuid4()
        db_session.add(
            PpmProjectMaintenance(id=proj_id, project_code="P-BFC", project_name="变更回填项目")
        )
        duty_id = _uuid.uuid4()
        db_session.add(
            User(
                id=duty_id,
                username="duty_bfc",
                display_name="变更责任王五",
                password_hash="x",
            )
        )
        await db_session.commit()

        svc = ProblemService(db_session)
        source = await svc.create_problem(
            {"project_id": proj_id, "pro_desc": "源问题", "duty_user_id": duty_id}
        )
        c = await svc.create_change(
            {
                "resource_id": str(source.id),
                "project_id": proj_id,
                "project_name": None,
                "pro_desc": "变更内容",
                "duty_user_id": duty_id,
                "duty_user_name": None,
                "change_reason": "测试",
            }
        )
        assert c.project_name == "变更回填项目"
        assert c.duty_user_name == "变更责任王五"


def _page_req():
    from app.modules.ppm.common.crud import PageReq

    return PageReq(page=1, page_size=10)


# ===========================================================================
# 执行流:start / execute (3 态，对齐任务计划)
# ===========================================================================


class TestStartExecute:
    async def test_start_creates_inflight_taskexecute(self, db_session: AsyncSession) -> None:
        """新建 → 进行中:start 建一条 in-flight TaskExecute(status=DOING) + 返回其 id。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)

        exc = await svc.start_problem(p.id, execute_user_id=_duty_uuid())
        assert exc.problem_task_id == p.id
        assert exc.status == "30"  # STATUS_DOING
        assert exc.actual_start_time is not None

        problem = await svc.get_problem(p.id)
        assert problem.status == ProblemStatus.DOING.value

        # in-flight TaskExecute 落库
        execs = await _problem_executes(db_session, p.id)
        assert len(execs) == 1
        assert execs[0].status == "30"

    async def test_start_only_from_new(self, db_session: AsyncSession) -> None:
        """进行中已有 in-flight 记录,不可重复 start。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        await svc.start_problem(p.id, execute_user_id=_duty_uuid())
        with pytest.raises(ProblemError):
            await svc.start_problem(p.id, execute_user_id=_duty_uuid())

    async def test_execute_complete_to_closed(self, db_session: AsyncSession) -> None:
        """进行中 → 已完成:execute(complete) 收口 in-flight + 终态。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        exc = await svc.start_problem(p.id, execute_user_id=_duty_uuid())

        result = await svc.execute_problem(
            p.id,
            task_execute_id=exc.id,
            action="complete",
            execute_info="已修复",
            time_spent=1.5,
        )
        assert result.status == ProblemStatus.CLOSED.value
        assert result.real_end_time is not None
        # TaskExecute 收口为 END (90)
        execs = await _problem_executes(db_session, p.id)
        assert len(execs) == 1
        assert execs[0].status == "90"
        # time_spent 累加 + handle_info 追加
        assert float(result.time_spent or 0) == 1.5
        assert "已修复" in (result.handle_info or "")

    async def test_execute_submit_back_to_new_repeatable(self, db_session: AsyncSession) -> None:
        """进行中 → 新建 (submit):回新建可再次 start (重复执行)。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        exc1 = await svc.start_problem(p.id, execute_user_id=_duty_uuid())

        # submit 回新建
        result = await svc.execute_problem(
            p.id, task_execute_id=exc1.id, action="submit", time_spent=1.0
        )
        assert result.status == ProblemStatus.NEW.value
        assert float(result.time_spent or 0) == 1.0

        # 再次 start → 进行中 (新 in-flight 记录, id 不同)
        exc2 = await svc.start_problem(p.id, execute_user_id=_duty_uuid())
        assert exc2.id != exc1.id
        problem = await svc.get_problem(p.id)
        assert problem.status == ProblemStatus.DOING.value

        # complete 收口第二条
        result = await svc.execute_problem(
            p.id, task_execute_id=exc2.id, action="complete", time_spent=0.5
        )
        assert result.status == ProblemStatus.CLOSED.value
        assert float(result.time_spent or 0) == 1.5  # 1.0 + 0.5 累加

    async def test_execute_only_from_doing(self, db_session: AsyncSession) -> None:
        """新建态不可 execute (无 in-flight 记录)。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        import uuid as _uuid

        with pytest.raises(ProblemError):
            await svc.execute_problem(p.id, task_execute_id=_uuid.uuid4(), action="complete")

    async def test_execute_wrong_task_execute_id(self, db_session: AsyncSession) -> None:
        """execute 的 task_execute_id 与 problem 不匹配 → ProblemError。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p1 = await _make_problem(svc, proj_id)
        p2 = await _make_problem(svc, proj_id)
        exc2 = await svc.start_problem(p2.id, execute_user_id=_duty_uuid())
        # 用 p2 的 in-flight id 去收口 p1 → 不匹配
        with pytest.raises(ProblemError):
            await svc.execute_problem(p1.id, task_execute_id=exc2.id, action="complete")

    async def test_execute_cross_day_rejected(self, db_session: AsyncSession) -> None:
        """跨天 (actual_start vs actual_end 不同日) → ProblemError。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        day1 = datetime(2026, 7, 20, 10, 0, tzinfo=UTC)
        day2 = datetime(2026, 7, 21, 10, 0, tzinfo=UTC)
        exc = await svc.start_problem(p.id, execute_user_id=_duty_uuid(), actual_start_time=day1)
        with pytest.raises(ProblemError):
            await svc.execute_problem(
                p.id,
                task_execute_id=exc.id,
                action="complete",
                actual_end_time=day2,
            )

    async def test_execute_same_day_ok(self, db_session: AsyncSession) -> None:
        """同日 (actual_start/end 同日) → 放行。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        day1_morning = datetime(2026, 7, 20, 9, 0, tzinfo=UTC)
        day1_evening = datetime(2026, 7, 20, 18, 0, tzinfo=UTC)
        exc = await svc.start_problem(
            p.id, execute_user_id=_duty_uuid(), actual_start_time=day1_morning
        )
        result = await svc.execute_problem(
            p.id,
            task_execute_id=exc.id,
            action="complete",
            actual_end_time=day1_evening,
        )
        assert result.status == ProblemStatus.CLOSED.value


def _duty_uuid():
    import uuid as _uuid

    return _uuid.UUID(_DUTY_USER_ID)


async def _problem_executes(session: AsyncSession, problem_id: object) -> list[TaskExecute]:
    return list(
        (
            await session.execute(
                sa_select(TaskExecute).where(TaskExecute.problem_task_id == problem_id)
            )
        )
        .scalars()
        .all()
    )


# ===========================================================================
# fsm 纯函数 (3 态 + 变更流)
# ===========================================================================


class TestFsmPure:
    def test_transitions_3state(self) -> None:
        # 新建 → 进行中
        assert ProblemStatus.DOING in TRANSITIONS[ProblemStatus.NEW]
        # 进行中 → 新建 (重复执行) / 已完成
        assert ProblemStatus.NEW in TRANSITIONS[ProblemStatus.DOING]
        assert ProblemStatus.CLOSED in TRANSITIONS[ProblemStatus.DOING]
        # 已完成 终态
        assert TRANSITIONS[ProblemStatus.CLOSED] == set()
        # 新建不可直接到已完成
        assert ProblemStatus.CLOSED not in TRANSITIONS[ProblemStatus.NEW]

    def test_node_names_cover_all(self) -> None:
        for n in (10, 20, 30, 40):
            assert n in NODE_NAMES


# ===========================================================================
# 问题变更 CRUD
# ===========================================================================


class TestProblemChange:
    async def test_change_crud(self, db_session: AsyncSession) -> None:
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)

        c = await svc.create_change(
            {
                "resource_id": str(p.id),
                "project_id": proj_id,
                "change_reason": "需求变更",
                "pro_desc": "新描述",
            }
        )
        assert c.status == ProblemChangeStatus.AUDITING.value

        got = await svc.get_change(c.id)
        assert got.change_reason == "需求变更"

        updated = await svc.update_change(c.id, {"change_reason": "重新变更"})
        assert updated.change_reason == "重新变更"

        by_resource = await svc.list_changes_by_resource(str(p.id))
        assert len(by_resource) == 1

        # P2-3:导出行 (list_changes_for_export)
        rows = await svc.list_changes_for_export()
        assert any(r["change_reason"] == "重新变更" for r in rows)

        await svc.delete_change(c.id)
        with pytest.raises(ProblemNotFound):
            await svc.get_change(c.id)


# ===========================================================================
# 问题变更审批流 (deprecated,D-005;4 节点 + bug 跳部门经理 + reject)
# ===========================================================================


async def _make_change(
    svc: ProblemService,
    project_id: str,
    resource_id: str,
    *,
    pro_type: str | None = None,
    audit_user_id: str = _AUDIT_USER_ID,
    audit_user_name: str = "孙验证",
) -> object:
    return await svc.create_change(
        {
            "resource_id": resource_id,
            "project_id": project_id,
            "pro_type": pro_type,
            "audit_user_id": audit_user_id,
            "audit_user_name": audit_user_name,
        }
    )


class TestChangeFlow:
    """变更流 4 节点全路径 (task-02 AC-1..AC-5)。"""

    async def test_change_full_flow_non_bug(self, db_session: AsyncSession) -> None:
        """非 bug:申请(10)→开发经理(20)→项目经理(30)→部门经理(40)→结束(已完成)。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="requirement")
        c = await _make_change(svc, proj_id, str(p.id), pro_type="requirement")
        cid = c.id

        # 10→20 开发经理审批
        c = await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert c.status == ProblemChangeStatus.AUDITING.value
        assert c.now_node == ProblemNode.DEVELOP_MGR.value
        assert "李开发" in (c.now_handle_user_name or "")

        # 20→30 项目经理审批
        c = await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert c.now_node == ProblemNode.PM_MGR.value
        assert "王项目" in (c.now_handle_user_name or "")

        # 30→40 部门经理审批 (非 bug)
        c = await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert c.now_node == ProblemNode.DEPT_MGR.value
        assert "赵部门" in (c.now_handle_user_name or "")

        # 40→结束 (已完成)
        c = await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert c.status == ProblemChangeStatus.CLOSED.value
        assert c.now_node is None
        # 结束后处理人 = 验证人 (audit_user_id)
        assert c.now_handle_user == _AUDIT_USER_ID

    async def test_change_bug_skips_dept(self, db_session: AsyncSession) -> None:
        """bug:10→20→30→直接结束 (跳过部门经理 40)。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="bug")
        c = await _make_change(svc, proj_id, str(p.id), pro_type="bug")
        cid = c.id

        await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])  # 10→20
        await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])  # 20→30
        c = await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])  # 30→结束
        assert c.status == ProblemChangeStatus.CLOSED.value
        assert c.now_node is None  # 未经过 40

    async def test_change_reject_to_back(self, db_session: AsyncSession) -> None:
        """审核节点 (20) reject → status=3 已作废,清空在办任务。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="requirement")
        c = await _make_change(svc, proj_id, str(p.id), pro_type="requirement")
        cid = c.id

        # 推到 20 开发经理
        await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        # 在 20 节点驳回
        c = await svc.reject_change(
            cid, actor_id=_DEV_USER_ID, actor_name="李开发", comment="描述不清"
        )
        assert c.status == ProblemChangeStatus.BACK.value
        assert c.now_node is None
        assert c.now_handle_user is None

        # 驳回后清空所有在办任务
        tasks = await svc.list_change_tasks(str(cid))
        assert len(tasks) == 0

    async def test_change_reject_on_apply_rejected(self, db_session: AsyncSession) -> None:
        """申请节点 (10) 不可驳回。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        c = await _make_change(svc, proj_id, str(p.id))
        with pytest.raises(ProblemError):
            await svc.reject_change(c.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

    async def test_change_missing_role_pending(self, db_session: AsyncSession) -> None:
        """项目无项目经理 → next_change 推进到 30 但抛 ProblemPendingAssignment。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session, pm=False)
        p = await _make_problem(svc, proj_id, pro_type="requirement")
        c = await _make_change(svc, proj_id, str(p.id), pro_type="requirement")
        cid = c.id

        # 10→20 (有开发经理)
        await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        # 20→30 (无项目经理 → 抛 pending,但 now_node 已推进)
        with pytest.raises(ProblemPendingAssignment):
            await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

        fresh = await svc.get_change(cid)
        assert fresh.now_node == ProblemNode.PM_MGR.value  # 节点已推进
        assert fresh.now_handle_user is None  # 但缺处理人
        assert fresh.status == ProblemChangeStatus.AUDITING.value

    async def test_change_each_step_writes_log(self, db_session: AsyncSession) -> None:
        """每次 next_change:写一行 ChangeProcessLog + 删旧插新 ChangeProcessTask。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="bug")
        c = await _make_change(svc, proj_id, str(p.id), pro_type="bug")
        cid = c.id

        # 3 次推进 (10→20→30→结束)
        for _ in range(3):
            await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

        logs = await svc.list_change_logs(str(cid))
        assert len(logs) == 3  # 每次推进一行
        assert [log.node_key for log in logs] == ["10", "20", "30"]

        # 在办任务:最后一次推进后只剩一条 (当前节点 end/已完成)
        tasks = await svc.list_change_tasks(str(cid))
        assert len(tasks) == 1
        assert tasks[0].node_key == "end"

    async def test_change_next_on_closed_rejected(self, db_session: AsyncSession) -> None:
        """已完成 (2) / 已作废 (3) 终态再 next → ProblemError。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="bug")
        c = await _make_change(svc, proj_id, str(p.id), pro_type="bug")
        cid = c.id

        # bug 三次推进到已完成
        for _ in range(3):
            await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

        # 再次 next → 终态非法
        with pytest.raises(ProblemError):
            await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])


# ===========================================================================
# 变更流 fsm 纯函数
# ===========================================================================


class TestChangeFsmPure:
    def test_compute_change_next_node_chain(self) -> None:
        assert compute_change_next_node(10, "requirement") == 20
        assert compute_change_next_node(20, "requirement") == 30
        assert compute_change_next_node(30, "requirement") == 40
        assert compute_change_next_node(40, "requirement") is None

    def test_compute_change_next_node_bug_skips_40(self) -> None:
        assert compute_change_next_node(30, "bug") is None
        assert compute_change_next_node(20, "bug") == 30
        assert compute_change_next_node(10, "bug") == 20
